/* TourAI auth: Firebase session, password strength, nav avatar, login/register/reset boots */
/*
 * Shared Firebase Auth + Firestore helpers for TourAI web account pages.
 * Requires site-config (+ secrets) and firebase-app/auth/firestore compat scripts.
 */
(function (global) {
  const TourAiAuth = {
    _ready: null,

    /** Fallback if PublicConfig/Legal cannot be read. Live value lives in Firestore. */
    LegalDocumentsVersion: "2026-07-26",

    t(key, fallback) {
      const locale = global.TourAiI18n?.getLocale?.();
      return global.TourAiI18n?.tOr?.(key, locale, null, fallback) ?? fallback;
    },

    getFirebaseConfig() {
      const cfg = global.TourAiSite?.config?.firebaseAuth;
      if (!cfg?.apiKey || !cfg?.authDomain || !cfg?.projectId) {
        return null;
      }
      const config = {
        apiKey: cfg.apiKey,
        authDomain: cfg.authDomain,
        projectId: cfg.projectId,
      };
      if (cfg.storageBucket) {
        config.storageBucket = cfg.storageBucket;
      }
      return config;
    },

    ensureFirebase() {
      if (this._ready) {
        return this._ready;
      }

      this._ready = new Promise((resolve, reject) => {
        if (global.location?.protocol === "file:") {
          reject(new Error("FILE_PROTOCOL"));
          return;
        }
        const firebaseConfig = this.getFirebaseConfig();
        if (!firebaseConfig) {
          reject(new Error("CONFIG_MISSING"));
          return;
        }
        if (!global.firebase?.auth) {
          reject(new Error("FIREBASE_SDK_MISSING"));
          return;
        }
        if (!global.firebase.apps?.length) {
          global.firebase.initializeApp(firebaseConfig);
        }
        resolve(global.firebase.auth());
      }).catch((err) => {
        // Allow retry after fixing config / protocol (do not cache failures forever).
        this._ready = null;
        throw err;
      });

      return this._ready;
    },

    async getFirestore() {
      await this.ensureFirebase();
      if (!global.firebase?.firestore) {
        throw new Error("FIRESTORE_SDK_MISSING");
      }
      return global.firebase.firestore();
    },

    onAuthStateChanged(callback) {
      return this.ensureFirebase().then((auth) => {
        return auth.onAuthStateChanged(callback);
      });
    },

    currentUser() {
      return global.firebase?.auth?.()?.currentUser ?? null;
    },

    async signIn(email, password, options) {
      const auth = await this.ensureFirebase();
      const remember = options?.remember !== false;
      if (global.firebase?.auth?.Auth?.Persistence) {
        const persistence = remember
          ? global.firebase.auth.Auth.Persistence.LOCAL
          : global.firebase.auth.Auth.Persistence.SESSION;
        await auth.setPersistence(persistence);
      }
      return auth.signInWithEmailAndPassword(email, password);
    },

    async signUp(email, password) {
      const auth = await this.ensureFirebase();
      return auth.createUserWithEmailAndPassword(email, password);
    },

    async updateProfile(displayName) {
      const user = this.currentUser();
      if (!user) {
        throw new Error("NO_USER");
      }
      return user.updateProfile({ displayName: displayName || null });
    },

    /**
     * Verifies the current password against Firebase Auth, then sets a new one.
     * Reauthentication is the Auth backend check (not a "forgot password" flow).
     */
    async changePassword(currentPassword, newPassword) {
      const user = this.currentUser();
      if (!user) {
        throw new Error("NO_USER");
      }
      const email = user.email;
      if (!email) {
        throw new Error("NO_EMAIL");
      }
      const current = String(currentPassword || "");
      const next = String(newPassword || "");
      if (!current || !next) {
        throw new Error("PASSWORD_REQUIRED");
      }
      const credential = global.firebase.auth.EmailAuthProvider.credential(email, current);
      await user.reauthenticateWithCredential(credential);
      await user.updatePassword(next);
    },

    async signOut() {
      const auth = await this.ensureFirebase();
      try {
        if (typeof this.clearNavProfileCache === "function") {
          this.clearNavProfileCache();
        } else {
          global.sessionStorage.removeItem("tourai-nav-profile-v1");
          global.sessionStorage.removeItem("tourai-nav-profile-v2");
          global.localStorage.removeItem("tourai-nav-profile-v1");
          global.localStorage.removeItem("tourai-nav-profile-v2");
        }
      } catch {
        /* ignore */
      }
      return auth.signOut();
    },

    async sendPasswordReset(email) {
      const auth = await this.ensureFirebase();
      const continueUrl = `${global.location.origin}/reset-password.html`;
      return auth.sendPasswordResetEmail(email, {
        url: continueUrl,
        handleCodeInApp: false,
      });
    },

    getRememberedEmail() {
      try {
        return global.localStorage.getItem("tourai-login-email") || "";
      } catch {
        return "";
      }
    },

    setRememberedEmail(email) {
      try {
        const value = (email || "").trim();
        if (value) {
          global.localStorage.setItem("tourai-login-email", value);
        } else {
          global.localStorage.removeItem("tourai-login-email");
        }
      } catch {
        /* ignore quota / private mode */
      }
    },

    getRememberPreference() {
      try {
        const raw = global.localStorage.getItem("tourai-login-remember");
        if (raw === null) {
          return true;
        }
        return raw === "1";
      } catch {
        return true;
      }
    },

    setRememberPreference(remember) {
      try {
        global.localStorage.setItem("tourai-login-remember", remember ? "1" : "0");
      } catch {
        /* ignore */
      }
    },

    requireUser({ loginUrl = "login.html", next } = {}) {
      return this.onAuthStateChanged((user) => {
        if (!user) {
          const target = new URL(loginUrl, global.location.href);
          if (next) {
            target.searchParams.set("next", next);
          }
          global.location.replace(target.toString());
        }
      });
    },

    redirectIfSignedIn(url = "dashboard.html") {
      return this.onAuthStateChanged((user) => {
        if (user) {
          global.location.replace(url);
        }
      });
    },

    mapAuthError(error) {
      const code = error?.code || error?.message || "";
      switch (code) {
        case "auth/email-already-in-use":
          return this.t("register.error.emailInUse", "Ya existe una cuenta con ese correo.");
        case "auth/weak-password":
          return this.t("register.error.weakPassword", "La contraseña es demasiado débil.");
        case "auth/operation-not-allowed":
          return this.t("register.error.notAllowed", "El registro por correo no está habilitado.");
        case "auth/invalid-email":
          return this.t("login.error.invalidEmail", "Introduce un correo válido.");
        case "auth/user-disabled":
          return this.t("login.error.disabled", "Esta cuenta está deshabilitada.");
        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-credential":
          return this.t("login.error.credentials", "Correo o contraseña incorrectos.");
        case "auth/too-many-requests":
          return this.t("login.error.rateLimited", "Demasiados intentos. Espera unos minutos.");
        case "auth/network-request-failed":
          return this.t("login.error.network", "Error de red. Comprueba tu conexión.");
        case "CONFIG_MISSING":
        case "FIREBASE_SDK_MISSING":
        case "FIRESTORE_SDK_MISSING":
          return this.t(
            "login.error.config",
            "Configuración de acceso no disponible. En local, copia js/site-config.secrets.js y sirve la web por http://localhost (no abras el HTML a pelo)."
          );
        case "FILE_PROTOCOL":
          return this.t(
            "login.error.fileProtocol",
            "Firebase Auth no funciona con file://. Abre la web con un servidor local (por ejemplo: npx serve) o en https://tourai.es tras desplegar."
          );
        case "auth/unauthorized-domain":
          return this.t(
            "login.error.unauthorizedDomain",
            "Este dominio no está autorizado en Firebase Authentication."
          );
        case "auth/invalid-api-key":
        case "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
          return this.t(
            "login.error.apiKey",
            "La clave de acceso web no es válida. Revisa la configuración de Firebase."
          );
        case "permission-denied":
          return this.t("account.error.permission", "No tienes permiso para leer estos datos.");
        default: {
          const raw = `${code} ${error?.message || ""}`.toLowerCase();
          if (raw.includes("referer") || raw.includes("referrer") || raw.includes("api_key_http_referrer_blocked")) {
            return this.t(
              "login.error.referrer",
              "Este origen no está permitido para la clave de Firebase. Prueba en https://tourai.es o añade el dominio en Google Cloud (restricciones HTTP)."
            );
          }
          if (String(code).includes("permission")) {
            return this.t("account.error.permission", "No tienes permiso para leer estos datos.");
          }
          return this.t("login.error.generic", "No se pudo iniciar sesión. Inténtalo de nuevo.");
        }
      }
    },
  };

  global.TourAiAuth = TourAiAuth;
})(window);

/**
 * Password strength evaluation and secure password generation.
 * Mirrors TourAI.Core.Helpers.PasswordStrengthHelper (Weak / Medium / Strong).
 */
(function (global) {
  const MINIMUM_LENGTH = 8;
  const STRONG_LENGTH = 12;
  const GENERATED_LENGTH = 16;

  const LOWER = "abcdefghijkmnopqrstuvwxyz";
  const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const DIGITS = "23456789";
  const SPECIAL = "!@#$%&*-_=+?";

  const Level = {
    None: 0,
    Weak: 1,
    Medium: 2,
    Strong: 3,
  };

  function evaluate(password) {
    if (!password) {
      return Level.None;
    }

    const length = password.length;
    let hasLower = false;
    let hasUpper = false;
    let hasDigit = false;
    let hasSpecial = false;

    for (let i = 0; i < length; i++) {
      const ch = password[i];
      if (ch >= "a" && ch <= "z") {
        hasLower = true;
      } else if (ch >= "A" && ch <= "Z") {
        hasUpper = true;
      } else if (ch >= "0" && ch <= "9") {
        hasDigit = true;
      } else if (ch.trim() !== "") {
        hasSpecial = true;
      }
    }

    const classCount =
      (hasLower ? 1 : 0) +
      (hasUpper ? 1 : 0) +
      (hasDigit ? 1 : 0) +
      (hasSpecial ? 1 : 0);

    let score = 0;
    if (length >= MINIMUM_LENGTH) {
      score++;
    }
    if (length >= STRONG_LENGTH) {
      score++;
    }
    score += classCount;

    if (score <= 2 || length < MINIMUM_LENGTH) {
      return Level.Weak;
    }
    if (score <= 4) {
      return Level.Medium;
    }
    return Level.Strong;
  }

  function meetsMinimum(password) {
    return evaluate(password) >= Level.Medium;
  }

  function nextIndex(exclusiveMax) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0] % exclusiveMax;
  }

  function pick(chars) {
    return chars[nextIndex(chars.length)];
  }

  function generateSecurePassword(length) {
    let size = typeof length === "number" ? length : GENERATED_LENGTH;
    if (size < STRONG_LENGTH) {
      size = STRONG_LENGTH;
    }

    const allChars = LOWER + UPPER + DIGITS + SPECIAL;
    const chars = new Array(size);

    chars[0] = pick(LOWER);
    chars[1] = pick(UPPER);
    chars[2] = pick(DIGITS);
    chars[3] = pick(SPECIAL);

    for (let i = 4; i < size; i++) {
      chars[i] = pick(allChars);
    }

    for (let i = size - 1; i > 0; i--) {
      const j = nextIndex(i + 1);
      const tmp = chars[i];
      chars[i] = chars[j];
      chars[j] = tmp;
    }

    return chars.join("");
  }

  global.TourAiPasswordStrength = {
    Level,
    MinimumLength: MINIMUM_LENGTH,
    StrongLength: STRONG_LENGTH,
    GeneratedLength: GENERATED_LENGTH,
    evaluate,
    meetsMinimum,
    generateSecurePassword,
  };
})(window);

/*
 * Restore signed-in nav state across the public site when Firebase session persists
 * ("Recordarme" → LOCAL persistence).
 * Shows avatar (Firestore photo or initials) + short greeting.
 * Paints immediately from local/session cache to avoid "Mi cuenta" → avatar flash.
 */
(function (global) {
  const auth = global.TourAiAuth;
  if (!auth) {
    return;
  }

  const PROFILE_CACHE_KEY = "tourai-nav-profile-v2";
  let currentUser = null;
  let currentProfile = null;
  let firestoreLoader = null;

  function t(key, fallback, vars) {
    let value = auth.t(key, fallback);
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        value = String(value).split("{" + name + "}").join(vars[name]);
      });
    }
    return value;
  }

  function readStorage(storage) {
    try {
      const raw = storage.getItem(PROFILE_CACHE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.uid) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function readAnyCache() {
    return readStorage(global.sessionStorage) || readStorage(global.localStorage);
  }

  function readCache(uid) {
    const cached = readAnyCache();
    if (!cached || cached.uid !== uid) {
      return null;
    }
    return cached;
  }

  function writeCache(profile) {
    const payload = JSON.stringify(profile);
    try {
      global.sessionStorage.setItem(PROFILE_CACHE_KEY, payload);
    } catch {
      /* ignore */
    }
    try {
      if (auth.getRememberPreference && auth.getRememberPreference()) {
        global.localStorage.setItem(PROFILE_CACHE_KEY, payload);
      } else {
        global.localStorage.removeItem(PROFILE_CACHE_KEY);
      }
    } catch {
      /* ignore */
    }
  }

  function clearCache() {
    try {
      global.sessionStorage.removeItem(PROFILE_CACHE_KEY);
      global.sessionStorage.removeItem("tourai-nav-profile-v1");
    } catch {
      /* ignore */
    }
    try {
      global.localStorage.removeItem(PROFILE_CACHE_KEY);
      global.localStorage.removeItem("tourai-nav-profile-v1");
    } catch {
      /* ignore */
    }
  }

  function markAuthResolved() {
    document.documentElement.classList.remove("tourai-auth-pending");
  }

  function getStorageBucket() {
    const cfg = global.TourAiSite?.config?.firebaseAuth;
    if (cfg?.storageBucket) {
      return String(cfg.storageBucket).trim();
    }
    if (cfg?.projectId) {
      return String(cfg.projectId).trim() + ".firebasestorage.app";
    }
    return "";
  }

  /**
   * Same idea as CloudStorageHelper.NormalizeDownloadUrl / BuildPublicUrl:
   * storage.googleapis.com URLs often 403; Firebase download API honors storage.rules.
   */
  function normalizePhotoUrl(url) {
    const trimmed = String(url || "").trim();
    if (!trimmed) {
      return "";
    }
    if (/firebasestorage\.googleapis\.com/i.test(trimmed)) {
      return trimmed;
    }

    const gcsPrefix = "https://storage.googleapis.com/";
    if (!trimmed.toLowerCase().startsWith(gcsPrefix)) {
      return trimmed;
    }

    let rest = trimmed.slice(gcsPrefix.length);
    if (rest.toLowerCase().startsWith("storage/v1/")) {
      return trimmed;
    }
    const queryIndex = rest.indexOf("?");
    if (queryIndex >= 0) {
      rest = rest.slice(0, queryIndex);
    }
    const slashIndex = rest.indexOf("/");
    if (slashIndex <= 0 || slashIndex >= rest.length - 1) {
      return trimmed;
    }

    const bucket = decodeURIComponent(rest.slice(0, slashIndex));
    const objectName = decodeURIComponent(rest.slice(slashIndex + 1));
    return buildPublicStorageUrl(bucket, objectName) || trimmed;
  }

  function buildPublicStorageUrl(bucket, objectName) {
    if (!bucket || !objectName) {
      return "";
    }
    return (
      "https://firebasestorage.googleapis.com/v0/b/" +
      encodeURIComponent(bucket) +
      "/o/" +
      encodeURIComponent(objectName) +
      "?alt=media"
    );
  }

  function buildUserPhotoStorageUrl(uid) {
    const bucket = getStorageBucket();
    if (!bucket || !uid) {
      return "";
    }
    return buildPublicStorageUrl(bucket, "userPhotoOriginal_" + uid + ".jpg");
  }

  function uniqueUrls(urls) {
    const seen = Object.create(null);
    const out = [];
    urls.forEach(function (raw) {
      const url = normalizePhotoUrl(raw);
      if (!url || seen[url]) {
        return;
      }
      seen[url] = true;
      out.push(url);
    });
    return out;
  }

  function resolvePhotoUrls(uid, firestoreData, user, fallbackUrls) {
    const data = firestoreData || {};
    const candidates = [
      data.PhotoOriginalUrl,
      user && user.photoURL,
      ...(fallbackUrls || []),
      buildUserPhotoStorageUrl(uid),
    ];
    return uniqueUrls(candidates);
  }

  function ensureFirestoreSdk() {
    if (global.firebase?.firestore) {
      return Promise.resolve();
    }
    if (firestoreLoader) {
      return firestoreLoader;
    }
    firestoreLoader = new Promise(function (resolve, reject) {
      function done() {
        if (global.firebase?.firestore) {
          resolve();
          return;
        }
        reject(new Error("FIRESTORE_SDK_MISSING"));
      }

      const existing = document.querySelector('script[data-tourai-firestore]');
      if (existing) {
        if (existing.dataset.loaded === "1" || global.firebase?.firestore) {
          done();
          return;
        }
        existing.addEventListener("load", done);
        existing.addEventListener("error", reject);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js";
      script.async = true;
      script.setAttribute("data-tourai-firestore", "1");
      script.onload = function () {
        script.dataset.loaded = "1";
        done();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    }).catch(function (err) {
      firestoreLoader = null;
      throw err;
    });
    return firestoreLoader;
  }

  function initialsFrom(name, email) {
    const n = String(name || "").trim();
    if (n) {
      const parts = n.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
      }
      if (n.length >= 2) {
        return n.slice(0, 2).toUpperCase();
      }
      return (n.charAt(0) + n.charAt(0)).toUpperCase();
    }
    const local = String(email || "").split("@")[0];
    if (local.length >= 2) {
      return local.slice(0, 2).toUpperCase();
    }
    return "?";
  }

  function firstNameFrom(name, email) {
    const n = String(name || "").trim();
    if (n) {
      return n.split(/\s+/).filter(Boolean)[0];
    }
    return String(email || "").split("@")[0] || "";
  }

  function accountLabel(profile) {
    const name = profile.firstName;
    if (!name) {
      return t("nav.accountSignedInGeneric", "Mi cuenta");
    }
    return t("nav.accountSignedIn", "Hola, {name}", { name: name });
  }

  function accountLinks() {
    return document.querySelectorAll(
      'nav a[data-i18n="nav.account"], nav a[data-auth-account], nav a[data-i18n-account-key], nav a.nav-account--signed-in, .footer-col a[data-i18n="nav.account"], .footer-col a[data-auth-account], .footer-col a[data-i18n-account-key], .footer-col a.nav-account--signed-in'
    );
  }

  function profileFromAuthUser(user, firestoreData, fallbackUrls) {
    const data = firestoreData || {};
    const displayName =
      (data.DisplayName && String(data.DisplayName).trim()) ||
      (user.displayName && String(user.displayName).trim()) ||
      "";
    const email = data.Email || user.email || "";
    const photoUrls = resolvePhotoUrls(user.uid, data, user, fallbackUrls);
    const offsetX = Number(data.PhotoCropOffsetXNorm);
    const offsetY = Number(data.PhotoCropOffsetYNorm);
    const scaleRaw = Number(data.PhotoCropUserScale);

    return {
      uid: user.uid,
      displayName: displayName,
      email: email,
      photoUrl: photoUrls[0] || "",
      photoUrls: photoUrls,
      firstName: firstNameFrom(displayName, email),
      initials: initialsFrom(displayName, email),
      photoCropOffsetXNorm: Number.isFinite(offsetX) ? offsetX : 0,
      photoCropOffsetYNorm: Number.isFinite(offsetY) ? offsetY : 0,
      photoCropUserScale:
        Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1,
      termsAccepted: data.TermsAccepted === true,
      legalAcceptedVersion: String(data.LegalAcceptedVersion || "").trim(),
    };
  }

  /** Fallback only — live value is PublicConfig/Legal.CurrentVersion in Firestore. */
  const LEGAL_DOCUMENTS_VERSION = auth.LegalDocumentsVersion || "2026-07-26";
  let legalModalBusy = false;
  let cachedLegalVersion = null;

  async function fetchLegalDocumentsVersion() {
    if (cachedLegalVersion) {
      return cachedLegalVersion;
    }
    try {
      const db = await auth.getFirestore();
      const snap = await db.collection("PublicConfig").doc("Legal").get();
      if (snap.exists) {
        const version = String(snap.data()?.CurrentVersion || "").trim();
        if (version) {
          cachedLegalVersion = version;
          return cachedLegalVersion;
        }
      }
    } catch (_) {
      // Offline / missing doc → fallback embedded version.
    }
    cachedLegalVersion = LEGAL_DOCUMENTS_VERSION;
    return cachedLegalVersion;
  }

  function needsLegalReacceptance(profileOrData, currentVersion) {
    if (!profileOrData) {
      return true;
    }
    const termsOk =
      profileOrData.termsAccepted === true ||
      profileOrData.TermsAccepted === true;
    if (!termsOk) {
      return true;
    }
    const version = String(
      profileOrData.legalAcceptedVersion ||
        profileOrData.LegalAcceptedVersion ||
        ""
    ).trim();
    const required = String(currentVersion || LEGAL_DOCUMENTS_VERSION).trim();
    return version !== required;
  }

  const legalDocHtmlCache = { terms: null, privacy: null };

  function extractLegalMainHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const main =
      doc.querySelector("main.legal-content") ||
      doc.querySelector("main.container.legal-content") ||
      doc.querySelector("[data-i18n-html] main") ||
      doc.querySelector("main");
    if (!main) {
      return "";
    }
    return main.innerHTML;
  }

  async function loadLegalDocumentHtml(kind) {
    if (legalDocHtmlCache[kind]) {
      return legalDocHtmlCache[kind];
    }

    const locale = global.TourAiI18n?.getLocale?.() || "es-ES";
    const i18nKey = kind === "privacy" ? "page.privacy.content" : "page.terms.content";
    if (locale === "en-GB" && typeof global.TourAiI18n?.t === "function") {
      const translated = global.TourAiI18n.t(i18nKey, locale);
      if (translated) {
        legalDocHtmlCache[kind] = extractLegalMainHtml(translated) || translated;
        return legalDocHtmlCache[kind];
      }
    }

    const url = kind === "privacy" ? "privacy.html" : "terms.html";
    const response = await fetch(url, { credentials: "same-origin", cache: "no-cache" });
    if (!response.ok) {
      throw new Error("LEGAL_FETCH_FAILED");
    }
    legalDocHtmlCache[kind] = extractLegalMainHtml(await response.text());
    if (!legalDocHtmlCache[kind]) {
      throw new Error("LEGAL_PARSE_FAILED");
    }
    return legalDocHtmlCache[kind];
  }

  function shouldLeavePrivateAreaAfterLegalDecline() {
    const path = String(global.location.pathname || "").toLowerCase();
    return /(^|\/)(account|dashboard)\.html$/i.test(path);
  }

  async function acceptCurrentLegalDocuments(uid, version) {
    const db = await auth.getFirestore();
    const now = firebase.firestore.Timestamp.now();
    const legalVersion = String(version || LEGAL_DOCUMENTS_VERSION).trim();
    await db.collection("Users").doc(uid).update({
      TermsAccepted: true,
      TermsAcceptedAt: now,
      LegalAcceptedVersion: legalVersion,
    });
    return legalVersion;
  }

  async function promptLegalReacceptanceIfNeeded(profile) {
    const currentVersion = await fetchLegalDocumentsVersion();
    if (!currentUser || !profile || !needsLegalReacceptance(profile, currentVersion) || legalModalBusy) {
      return true;
    }
    legalModalBusy = true;

    return new Promise(function (resolve) {
      let activeTab = "terms";
      const overlay = document.createElement("div");
      overlay.className = "tourai-legal-reaccept";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute(
        "aria-label",
        t("legal.reaccept.title", "Documentos legales actualizados")
      );
      overlay.innerHTML =
        '<div class="tourai-legal-reaccept__backdrop" aria-hidden="true"></div>' +
        '<div class="tourai-legal-reaccept__dialog">' +
        '<div class="tourai-legal-reaccept__header">' +
        '<h2 class="tourai-legal-reaccept__title">' +
        escapeHtml(t("legal.reaccept.title", "Documentos legales actualizados")) +
        "</h2>" +
        '<p class="tourai-legal-reaccept__intro">' +
        escapeHtml(
          t(
            "legal.reaccept.body",
            "Hemos actualizado los Términos y Condiciones y/o la Política de Privacidad. Léelos aquí y acéptalos para continuar (una aceptación vale para la app y la web con la misma cuenta)."
          )
        ) +
        "</p></div>" +
        '<div class="tourai-legal-reaccept__tabs" role="tablist">' +
        '<button type="button" class="tourai-legal-reaccept__tab is-active" role="tab" aria-selected="true" data-legal-tab="terms">' +
        escapeHtml(t("legal.reaccept.tab.terms", "Términos")) +
        "</button>" +
        '<button type="button" class="tourai-legal-reaccept__tab" role="tab" aria-selected="false" data-legal-tab="privacy">' +
        escapeHtml(t("legal.reaccept.tab.privacy", "Privacidad")) +
        "</button></div>" +
        '<div class="tourai-legal-reaccept__body">' +
        '<p class="tourai-legal-reaccept__status" data-legal-status>' +
        escapeHtml(t("legal.reaccept.loading", "Cargando documentos…")) +
        "</p>" +
        '<div class="tourai-legal-reaccept__panel" data-legal-panel hidden></div></div>' +
        '<div class="tourai-legal-reaccept__footer">' +
        '<p class="tourai-legal-reaccept__hint">' +
        escapeHtml(
          t(
            "legal.reaccept.hint",
            "Si no aceptas, se cerrará tu sesión. Podrás seguir viendo el contenido público de la web, pero no la zona de cuenta hasta que aceptes."
          )
        ) +
        "</p>" +
        '<div class="tourai-legal-reaccept__actions">' +
        '<button type="button" class="btn-secondary" data-legal-decline>' +
        escapeHtml(t("legal.reaccept.decline", "No acepto · Cerrar sesión")) +
        "</button>" +
        '<button type="button" class="btn-primary" data-legal-accept disabled>' +
        escapeHtml(t("legal.reaccept.accept", "He leído y acepto")) +
        "</button></div></div></div>";

      document.body.appendChild(overlay);
      document.body.classList.add("tourai-legal-reaccept-open");

      const statusEl = overlay.querySelector("[data-legal-status]");
      const panelEl = overlay.querySelector("[data-legal-panel]");
      const acceptBtn = overlay.querySelector("[data-legal-accept]");
      const declineBtn = overlay.querySelector("[data-legal-decline]");

      async function finish(ok) {
        overlay.remove();
        document.body.classList.remove("tourai-legal-reaccept-open");
        legalModalBusy = false;
        resolve(ok);
      }

      async function showTab(kind) {
        activeTab = kind;
        overlay.querySelectorAll("[data-legal-tab]").forEach(function (tab) {
          const selected = tab.getAttribute("data-legal-tab") === kind;
          tab.classList.toggle("is-active", selected);
          tab.setAttribute("aria-selected", selected ? "true" : "false");
        });
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.classList.remove("tourai-legal-reaccept__status--error");
          statusEl.textContent = t("legal.reaccept.loading", "Cargando documentos…");
        }
        if (panelEl) {
          panelEl.hidden = true;
          panelEl.innerHTML = "";
        }
        if (acceptBtn) {
          acceptBtn.disabled = true;
        }
        try {
          const html = await loadLegalDocumentHtml(kind);
          if (panelEl) {
            panelEl.innerHTML = html;
            panelEl.hidden = false;
          }
          if (statusEl) {
            statusEl.hidden = true;
          }
          if (acceptBtn) {
            acceptBtn.disabled = false;
          }
          const body = overlay.querySelector(".tourai-legal-reaccept__body");
          if (body) {
            body.scrollTop = 0;
          }
        } catch (_) {
          if (statusEl) {
            statusEl.hidden = false;
            statusEl.classList.add("tourai-legal-reaccept__status--error");
            statusEl.textContent = t(
              "legal.reaccept.error",
              "No se pudieron cargar los documentos. Revisa tu conexión e inténtalo de nuevo."
            );
          }
        }
      }

      overlay.querySelectorAll("[data-legal-tab]").forEach(function (tab) {
        tab.addEventListener("click", function () {
          const kind = tab.getAttribute("data-legal-tab");
          if (kind && kind !== activeTab) {
            showTab(kind);
          }
        });
      });

      panelEl?.addEventListener("click", function (event) {
        const link = event.target?.closest?.("a");
        if (!link) {
          return;
        }
        const href = String(link.getAttribute("href") || "");
        if (/privacy\.html/i.test(href)) {
          event.preventDefault();
          showTab("privacy");
        } else if (/terms\.html/i.test(href)) {
          event.preventDefault();
          showTab("terms");
        }
      });

      declineBtn?.addEventListener("click", async function () {
        if (declineBtn) {
          declineBtn.disabled = true;
        }
        if (acceptBtn) {
          acceptBtn.disabled = true;
        }
        try {
          await auth.signOut();
        } catch (_) {
          /* ignore */
        }
        await finish(false);
        if (shouldLeavePrivateAreaAfterLegalDecline()) {
          global.location.href = "index.html";
        }
      });

      acceptBtn?.addEventListener("click", async function () {
        if (acceptBtn) {
          acceptBtn.disabled = true;
        }
        if (declineBtn) {
          declineBtn.disabled = true;
        }
        try {
          const saved = await acceptCurrentLegalDocuments(currentUser.uid, currentVersion);
          profile.termsAccepted = true;
          profile.legalAcceptedVersion = saved;
          writeCache(profile);
          await finish(true);
        } catch (err) {
          console.error("[TourAI legal] accept failed", err);
          if (acceptBtn) {
            acceptBtn.disabled = false;
          }
          if (declineBtn) {
            declineBtn.disabled = false;
          }
        }
      });

      showTab("terms");
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Match account profile crop math (120px / radius 58), scaled to nav avatar size. */
  function navPhotoCropStyle(profile, avatarSize) {
    const size = Number(avatarSize) > 0 ? Number(avatarSize) : 32;
    const sizeRatio = size / 120;
    const radius = 58 * sizeRatio;
    const offsetX = Number(profile?.photoCropOffsetXNorm);
    const offsetY = Number(profile?.photoCropOffsetYNorm);
    const scaleRaw = Number(profile?.photoCropUserScale);
    const x = Number.isFinite(offsetX) ? offsetX : 0;
    const y = Number.isFinite(offsetY) ? offsetY : 0;
    const userScale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1;
    // Scale both pan and zoom so the framing matches the 120px profile avatar.
    return (
      "transform: translate(calc(-50% + " +
      x * radius +
      "px), calc(-50% + " +
      y * radius +
      "px)) scale(" +
      userScale * sizeRatio +
      ");"
    );
  }

  function showInitials(avatarEl, initials) {
    avatarEl.textContent = initials;
    avatarEl.setAttribute("data-initials", initials);
  }

  function renderAvatar(avatarEl, profile) {
    avatarEl.textContent = "";
    avatarEl.removeAttribute("data-initials");

    const initials = profile.initials || "?";
    const urls = Array.isArray(profile.photoUrls)
      ? profile.photoUrls.filter(Boolean)
      : profile.photoUrl
        ? [profile.photoUrl]
        : [];

    showInitials(avatarEl, initials);

    if (!urls.length) {
      return;
    }

    let cancelled = false;
    avatarEl._touraiCancelPhoto = function () {
      cancelled = true;
    };

    function tryUrl(index) {
      if (cancelled || index >= urls.length) {
        return;
      }

      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";

      img.addEventListener("load", function () {
        if (cancelled) {
          return;
        }
        avatarEl.textContent = "";
        avatarEl.removeAttribute("data-initials");
        avatarEl.appendChild(img);
        const size = avatarEl.offsetWidth || 32;
        img.setAttribute("style", navPhotoCropStyle(profile, size));
        // Prefer the working URL for cache / next paint.
        if (profile.photoUrl !== urls[index]) {
          profile.photoUrl = urls[index];
          writeCache(profile);
        }
      });

      img.addEventListener("error", function () {
        if (cancelled) {
          return;
        }
        tryUrl(index + 1);
      });

      img.src = urls[index];
    }

    tryUrl(0);
  }

  function applySignedIn(profile) {
    accountLinks().forEach(function (link) {
      link.href = "dashboard.html";
      link.classList.add("nav-account--signed-in");
      if (link.getAttribute("data-i18n") === "nav.account") {
        link.setAttribute("data-i18n-account-key", "nav.account");
        link.removeAttribute("data-i18n");
      }

      link.textContent = "";
      const avatar = document.createElement("span");
      avatar.className = "nav-account-avatar";
      avatar.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.className = "nav-account-label";
      label.textContent = accountLabel(profile);

      link.appendChild(avatar);
      link.appendChild(label);
      // After attach so offsetWidth matches nav (32) vs footer (28).
      renderAvatar(avatar, profile);
      link.setAttribute("title", profile.displayName || profile.email || label.textContent);
      link.setAttribute("data-default-text", label.textContent);
    });
    markAuthResolved();
  }

  function applySignedOut() {
    accountLinks().forEach(function (link) {
      link.href = "login.html";
      link.classList.remove("nav-account--signed-in");
      link.removeAttribute("title");
      if (link.hasAttribute("data-i18n-account-key") || !link.hasAttribute("data-i18n")) {
        link.setAttribute("data-i18n", link.getAttribute("data-i18n-account-key") || "nav.account");
        link.removeAttribute("data-i18n-account-key");
      }
      link.textContent = "Mi cuenta";
      link.setAttribute("data-default-text", "Mi cuenta");
    });
    if (global.TourAiI18n?.applyTranslations && global.TourAiI18n?.getLocale) {
      global.TourAiI18n.applyTranslations(global.TourAiI18n.getLocale());
    }
    markAuthResolved();
  }

  function stashAuthUser(user) {
    if (!user) {
      return null;
    }
    const profile = profileFromAuthUser(user, null);
    writeCache(profile);
    return profile;
  }

  async function loadProfile(user) {
    const cached = readCache(user.uid);
    let firestoreData = null;
    try {
      await ensureFirestoreSdk();
      const db = await auth.getFirestore();
      const snap = await db.collection("Users").doc(user.uid).get();
      if (snap.exists) {
        firestoreData = snap.data() || {};
      }
    } catch (err) {
      console.warn("[TourAI nav-auth] profile load failed, using Auth/cache", err);
      if (cached) {
        return cached;
      }
    }

    const fallbackUrls = [];
    if (cached?.photoUrl) {
      fallbackUrls.push(cached.photoUrl);
    }
    if (Array.isArray(cached?.photoUrls)) {
      fallbackUrls.push.apply(fallbackUrls, cached.photoUrls);
    }

    const profile = profileFromAuthUser(user, firestoreData, fallbackUrls);
    writeCache(profile);
    return profile;
  }

  async function enrichNavProfile(user) {
    if (!user) {
      return null;
    }
    const profile = await loadProfile(user);
    currentProfile = profile;
    applySignedIn(profile);
    return profile;
  }

  async function sync(user) {
    currentUser = user || null;
    if (!currentUser) {
      currentProfile = null;
      clearCache();
      applySignedOut();
      return;
    }

    const cached = readCache(currentUser.uid);
    if (cached) {
      currentProfile = cached;
      applySignedIn(cached);
    } else {
      currentProfile = profileFromAuthUser(currentUser, null);
      applySignedIn(currentProfile);
      writeCache(currentProfile);
    }

    try {
      const enriched = await loadProfile(currentUser);
      currentProfile = enriched;
      applySignedIn(enriched);
      await promptLegalReacceptanceIfNeeded(enriched);
    } catch (err) {
      console.warn("[TourAI nav-auth]", err);
      markAuthResolved();
    }
  }

  // Drop legacy cache that often lacked a usable photo URL.
  try {
    global.sessionStorage.removeItem("tourai-nav-profile-v1");
    global.localStorage.removeItem("tourai-nav-profile-v1");
  } catch {
    /* ignore */
  }

  const earlyProfile = readAnyCache();
  if (earlyProfile) {
    currentProfile = earlyProfile;
    applySignedIn(earlyProfile);
  }

  document.addEventListener("tourai:locale-changed", function () {
    if (currentProfile) {
      applySignedIn(currentProfile);
    }
  });

  function forceSignedOutNav() {
    currentUser = null;
    currentProfile = null;
    clearCache();
    applySignedOut();
  }

  auth.stashNavProfile = stashAuthUser;
  auth.enrichNavProfile = enrichNavProfile;
  auth.clearNavProfileCache = clearCache;
  auth.forceSignedOutNav = forceSignedOutNav;
  auth.getNavProfile = function () {
    return currentProfile;
  };

  auth.onAuthStateChanged(sync).catch(function (err) {
    // Auth could not be restored — do not keep a cached "signed in" avatar.
    console.warn("[TourAI nav-auth]", err);
    forceSignedOutNav();
  });
})(window);


/* --- login.js --- */
(function () {
  if (!/login\.html/i.test(String(window.location.pathname || '') + String(window.location.href || ''))) {
    return;
  }

  const form = document.getElementById("loginForm");
  const emailInput = document.getElementById("loginEmail");
  const passwordInput = document.getElementById("loginPassword");
  const rememberInput = document.getElementById("loginRemember");
  const statusEl = document.getElementById("loginStatus");
  const submitBtn = document.getElementById("loginSubmit");
  const forgotBtn = document.getElementById("forgotPasswordBtn");
  const auth = window.TourAiAuth;
  let busy = false;

  if (!form) {
    return;
  }

  form.setAttribute("data-login-bound", "1");

  function t(key, fallback) {
    if (auth && typeof auth.t === "function") {
      return auth.t(key, fallback);
    }
    if (window.TourAiI18n && typeof window.TourAiI18n.tOr === "function") {
      return window.TourAiI18n.tOr(key, window.TourAiI18n.getLocale(), null, fallback);
    }
    return fallback;
  }

  function setStatus(message, isError) {
    if (!statusEl) {
      return;
    }
    statusEl.hidden = !message;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", !!isError);
    statusEl.classList.toggle("is-visible", !!message);
  }

  function setBusy(isBusy, statusMessage) {
    busy = !!isBusy;
    if (submitBtn) {
      submitBtn.disabled = busy;
      submitBtn.classList.toggle("is-loading", busy);
      submitBtn.setAttribute("aria-busy", busy ? "true" : "false");
    }
    if (forgotBtn) {
      forgotBtn.disabled = busy;
    }
    if (statusMessage !== undefined) {
      setStatus(statusMessage, false);
    }
    if (window.TourAiLoading) {
      if (busy) {
        window.TourAiLoading.show(
          statusMessage || t("login.status.signingIn", "Iniciando sesión...")
        );
      } else {
        while (window.TourAiLoading.isVisible()) {
          window.TourAiLoading.hide();
        }
      }
    }
  }

  function nextUrl() {
    const next = new URLSearchParams(window.location.search).get("next");
    // Allow "page.html" or "page.html?foo=bar" (no absolute / protocol URLs).
    if (
      next &&
      next.startsWith("/") === false &&
      !next.includes("://") &&
      /^[a-zA-Z0-9._-]+\.html(\?[^#]*)?$/.test(next)
    ) {
      return next;
    }
    return "dashboard.html";
  }

  function mapError(err) {
    if (auth && typeof auth.mapAuthError === "function") {
      return auth.mapAuthError(err);
    }
    return t("login.error.generic", "No se pudo iniciar sesión. Inténtalo de nuevo.");
  }

  function rememberChecked() {
    return !rememberInput || !!rememberInput.checked;
  }

  if (!auth) {
    setStatus(
      t(
        "login.error.config",
        "No se pudo cargar el módulo de acceso. Recarga la página (Ctrl+F5) o comprueba la consola del navegador."
      ),
      true
    );
    return;
  }

  // Prefill remembered email / preference (never the password).
  if (emailInput && !emailInput.value) {
    emailInput.value = auth.getRememberedEmail() || "";
  }
  if (rememberInput) {
    rememberInput.checked = auth.getRememberPreference();
  }

  auth.ensureFirebase().catch(function (err) {
    setStatus(mapError(err), true);
  });

  auth.redirectIfSignedIn(nextUrl()).catch(function (err) {
    setStatus(mapError(err), true);
  });

  // Keep ?next= when sending guests to register.
  document.querySelectorAll('a[href="register.html"], a[href="./register.html"]').forEach(function (link) {
    const next = new URLSearchParams(window.location.search).get("next");
    if (
      next &&
      next.startsWith("/") === false &&
      !next.includes("://") &&
      /^[a-zA-Z0-9._-]+\.html(\?[^#]*)?$/.test(next)
    ) {
      link.href = "register.html?next=" + encodeURIComponent(next);
    }
  });

  async function doSignIn() {
    if (busy) {
      return;
    }

    const email = (emailInput && emailInput.value ? emailInput.value : "").trim();
    const password = passwordInput && passwordInput.value ? passwordInput.value : "";
    const remember = rememberChecked();

    if (!email || !password) {
      setStatus(t("login.error.required", "Introduce correo y contraseña."), true);
      if (!email && emailInput) {
        emailInput.focus();
      } else if (passwordInput) {
        passwordInput.focus();
      }
      return;
    }

    const signingInMsg = t("login.status.signingIn", "Iniciando sesión...");
    setBusy(true, signingInMsg);

    try {
      auth.setRememberPreference(remember);
      const credential = await auth.signIn(email, password, { remember: remember });
      if (remember) {
        auth.setRememberedEmail(email);
      } else {
        auth.setRememberedEmail("");
      }
      if (credential?.user) {
        if (auth.enrichNavProfile) {
          try {
            await auth.enrichNavProfile(credential.user);
          } catch (enrichErr) {
            console.warn("[TourAI login] profile enrich failed", enrichErr);
            if (auth.stashNavProfile) {
              auth.stashNavProfile(credential.user);
            }
          }
        } else if (auth.stashNavProfile) {
          auth.stashNavProfile(credential.user);
        }
      }
      setStatus(t("login.status.redirecting", "Acceso correcto. Redirigiendo..."), false);
      window.location.replace(nextUrl());
    } catch (err) {
      console.error("[TourAI login]", err);
      setBusy(false);
      setStatus(mapError(err), true);
    }
  }

  async function sendResetLink(email) {
    const sendingMsg = t("login.status.resetSending", "Enviando enlace de restablecimiento...");
    setBusy(true, sendingMsg);
    try {
      await auth.sendPasswordReset(email);
      setBusy(false);
      const okMsg = t(
        "login.status.resetSent",
        "Si existe una cuenta con ese correo, recibirás un enlace para restablecer la contraseña. Revisa también la carpeta de spam."
      );
      setStatus(okMsg, false);
      if (window.TourAiFeedback) {
        window.TourAiFeedback.show({
          type: "success",
          title: t("login.reset.title", "Recuperar contraseña"),
          message: okMsg,
          buttonText: t("feedback.close", "Entendido"),
        });
      }
    } catch (err) {
      console.error("[TourAI login reset]", err);
      setBusy(false);
      setStatus(mapError(err), true);
    }
  }

  function requestPasswordReset() {
    if (busy) {
      return;
    }

    const email = (emailInput && emailInput.value ? emailInput.value : "").trim();
    if (!email) {
      setStatus(
        t("login.error.forgotEmail", "Escribe tu correo para enviarte el enlace de restablecimiento."),
        true
      );
      if (emailInput) {
        emailInput.focus();
      }
      return;
    }

    const confirmMsg = t(
      "login.reset.confirm",
      "Se enviará un enlace para restablecer la contraseña a {email}. ¿Continuar?"
    ).replace("{email}", email);

    if (!window.confirm(confirmMsg)) {
      return;
    }

    sendResetLink(email);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    event.stopPropagation();
    doSignIn();
  });

  forgotBtn?.addEventListener("click", function () {
    requestPasswordReset();
  });
})();


/* --- register.js --- */
(function () {
  if (!/register\.html/i.test(String(window.location.pathname || '') + String(window.location.href || ''))) {
    return;
  }

  const form = document.getElementById("registerForm");
  const nameInput = document.getElementById("registerName");
  const emailInput = document.getElementById("registerEmail");
  const passwordInput = document.getElementById("registerPassword");
  const confirmInput = document.getElementById("registerConfirm");
  const termsInput = document.getElementById("registerTerms");
  const statusEl = document.getElementById("registerStatus");
  const submitBtn = document.getElementById("registerSubmit");
  const strengthSection = document.getElementById("passwordStrength");
  const strengthLabel = document.getElementById("passwordStrengthLabel");
  const strengthBars = strengthSection?.querySelectorAll(".auth-password-strength__bar");
  const passwordError = document.getElementById("passwordError");
  const confirmError = document.getElementById("confirmPasswordError");
  const auth = window.TourAiAuth;
  const strength = window.TourAiPasswordStrength;

  if (!form || !auth) {
    return;
  }

  function nextUrl() {
    const next = new URLSearchParams(window.location.search).get("next");
    if (
      next &&
      next.startsWith("/") === false &&
      !next.includes("://") &&
      /^[a-zA-Z0-9._-]+\.html(\?[^#]*)?$/.test(next)
    ) {
      return next;
    }
    return "dashboard.html";
  }

  function t(key, fallback) {
    return auth.t(key, fallback);
  }

  function setStatus(message, isError) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", !!isError);
  }

  function webDeviceId() {
    const key = "tourai-web-device-id";
    let id = localStorage.getItem(key);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(key, id);
    }
    return id;
  }

  function updateStrengthUI() {
    if (!strength || !passwordInput || !strengthSection) {
      return strength?.Level?.None ?? 0;
    }
    const level = strength.evaluate(passwordInput.value || "");
    strengthSection.hidden = level === strength.Level.None;
    strengthBars?.forEach((bar) => {
      bar.className = "auth-password-strength__bar";
    });
    if (strengthLabel) {
      strengthLabel.className = "auth-password-strength__label";
    }
    if (level === strength.Level.Weak) {
      strengthBars?.[0]?.classList.add("is-active", "is-weak");
      if (strengthLabel) {
        strengthLabel.className = "auth-password-strength__label is-weak";
        strengthLabel.textContent = t("resetPassword.strength.weak", "Débil");
      }
    } else if (level === strength.Level.Medium) {
      strengthBars?.[0]?.classList.add("is-active", "is-medium");
      strengthBars?.[1]?.classList.add("is-active", "is-medium");
      if (strengthLabel) {
        strengthLabel.className = "auth-password-strength__label is-medium";
        strengthLabel.textContent = t("resetPassword.strength.medium", "Media");
      }
    } else if (level === strength.Level.Strong) {
      strengthBars?.[0]?.classList.add("is-active", "is-strong");
      strengthBars?.[1]?.classList.add("is-active", "is-strong");
      strengthBars?.[2]?.classList.add("is-active", "is-strong");
      if (strengthLabel) {
        strengthLabel.className = "auth-password-strength__label is-strong";
        strengthLabel.textContent = t("resetPassword.strength.strong", "Fuerte");
      }
    }
    return level;
  }

  passwordInput?.addEventListener("input", updateStrengthUI);

  auth.redirectIfSignedIn(nextUrl()).catch(function (err) {
    setStatus(auth.mapAuthError(err), true);
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    const displayName = (nameInput?.value || "").trim();
    const email = (emailInput?.value || "").trim();
    const password = passwordInput?.value || "";
    const confirm = confirmInput?.value || "";

    if (passwordError) {
      passwordError.hidden = true;
    }
    if (confirmError) {
      confirmError.hidden = true;
    }

    if (!displayName || !email || !password || !confirm) {
      setStatus(t("register.error.required", "Completa todos los campos."), true);
      return;
    }

    if (!termsInput?.checked) {
      setStatus(t("register.error.terms", "Debes aceptar los términos de uso."), true);
      return;
    }

    const level = updateStrengthUI();
    if (!strength || level < strength.Level.Medium) {
      if (passwordError) {
        passwordError.hidden = false;
      }
      setStatus(
        t(
          "resetPassword.error.weak",
          "La contraseña es demasiado débil. Usa al menos 8 caracteres con mayúsculas, minúsculas y números."
        ),
        true
      );
      return;
    }

    if (password !== confirm) {
      if (confirmError) {
        confirmError.hidden = false;
      }
      setStatus(t("resetPassword.error.mismatch", "Las contraseñas no coinciden."), true);
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
    }
    setStatus(t("register.status.creating", "Creando cuenta..."), false);

    try {
      const credential = await auth.signUp(email, password);
      const user = credential.user;
      await auth.updateProfile(displayName);

      const db = await auth.getFirestore();
      const now = firebase.firestore.Timestamp.now();
      let legalVersion = auth.LegalDocumentsVersion || "2026-07-26";
      try {
        const legalSnap = await db.collection("PublicConfig").doc("Legal").get();
        const fromConfig = String(legalSnap.data()?.CurrentVersion || "").trim();
        if (fromConfig) {
          legalVersion = fromConfig;
        }
      } catch (_) {
        // Keep fallback.
      }
      await db
        .collection("Users")
        .doc(user.uid)
        .set({
          Id: user.uid,
          Email: email,
          DisplayName: displayName,
          AccountType: "Freemium",
          Version: 1,
          CreatedAt: now,
          TermsAccepted: true,
          TermsAcceptedAt: now,
          LegalAcceptedVersion: legalVersion,
          DeviceId: webDeviceId(),
          SessionLastSeenAt: now,
          Preferences: "[]",
          PhotoCropOffsetXNorm: 0,
          PhotoCropOffsetYNorm: 0,
          PhotoCropUserScale: 1,
        });

      setStatus(t("register.status.success", "Cuenta creada. Entrando..."), false);
      window.location.replace(nextUrl());
    } catch (err) {
      console.error(err);
      // Auth may have succeeded while profile write failed — keep session and open dashboard.
      if (auth.currentUser()) {
        setStatus(
          t(
            "register.error.profile",
            "La cuenta se creó, pero hubo un problema al guardar el perfil. Entra en Mi cuenta o reintenta más tarde."
          ),
          true
        );
        setTimeout(function () {
          window.location.replace(nextUrl());
        }, 1800);
        return;
      }
      setStatus(auth.mapAuthError(err), true);
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  });
})();


/* --- reset-password.js --- */
(function () {
  if (!/reset-password\.html/i.test(String(window.location.pathname || '') + String(window.location.href || ''))) {
    return;
  }

  const config = window.TourAiSite?.config;
  const strength = window.TourAiPasswordStrength;
  const statusEl = document.getElementById("resetStatus");
  const form = document.getElementById("resetPasswordForm");
  const successEl = document.getElementById("resetSuccess");
  const newPasswordInput = document.getElementById("newPassword");
  const confirmPasswordInput = document.getElementById("confirmPassword");
  const strengthSection = document.getElementById("passwordStrength");
  const strengthLabel = document.getElementById("passwordStrengthLabel");
  const strengthBars = strengthSection?.querySelectorAll(".auth-password-strength__bar");
  const passwordError = document.getElementById("passwordError");
  const confirmError = document.getElementById("confirmPasswordError");
  const generateButton = document.getElementById("generateSecurePassword");
  const toggleButtons = [
    document.getElementById("toggleNewPassword"),
    document.getElementById("toggleConfirmPassword"),
  ].filter(Boolean);

  let passwordsVisible = false;

  function t(key, fallback) {
    const locale = window.TourAiI18n?.getLocale?.();
    return window.TourAiI18n?.tOr?.(key, locale, null, fallback) ?? fallback;
  }

  const firebaseConfig = config?.firebaseAuth;
  if (!config || !firebaseConfig?.apiKey) {
    if (statusEl) {
      statusEl.textContent = t(
        "resetPassword.status.configMissing",
        "Configuración de Firebase no disponible."
      );
      statusEl.classList.add("error");
    }
    if (form) {
      form.style.display = "none";
    }
    return;
  }

  function readQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name) ?? "";
  }

  // Prefer apiKey/authDomain from the email link so Development reset codes
  // (tourai-1f3d9) work on the public Production-hosted page.
  const queryApiKey = readQueryParam("apiKey");
  const queryAuthDomain = readQueryParam("authDomain");
  const resolvedFirebaseConfig = {
    apiKey: queryApiKey || firebaseConfig.apiKey,
    authDomain: queryAuthDomain || firebaseConfig.authDomain,
    projectId:
      (queryAuthDomain && queryAuthDomain.replace(/\.firebaseapp\.com$/i, "")) ||
      firebaseConfig.projectId,
  };

  if (!window.firebase?.apps?.length) {
    firebase.initializeApp(resolvedFirebaseConfig);
  }

  const auth = firebase.auth();

  function setStatus(message, isError) {
    if (!statusEl) {
      return;
    }

    statusEl.textContent = message ?? "";
    statusEl.classList.toggle("error", !!isError);
  }

  function showSuccess() {
    if (form) {
      form.style.display = "none";
    }
    if (successEl) {
      successEl.hidden = false;
    }
    setStatus("", false);
  }

  function setPasswordsVisible(visible) {
    passwordsVisible = visible;
    const type = visible ? "text" : "password";
    const label = visible
      ? t("resetPassword.hide", "Ocultar")
      : t("resetPassword.show", "Mostrar");
    const aria = visible
      ? t("resetPassword.hide.aria", "Ocultar contraseña")
      : t("resetPassword.show.aria", "Mostrar contraseña");

    if (newPasswordInput) {
      newPasswordInput.type = type;
    }
    if (confirmPasswordInput) {
      confirmPasswordInput.type = type;
    }

    toggleButtons.forEach((button) => {
      button.textContent = label;
      button.setAttribute("aria-label", aria);
    });
  }

  function updatePasswordStrengthUi(password) {
    if (!strength || !strengthSection || !strengthLabel || !strengthBars?.length) {
      return;
    }

    const level = strength.evaluate(password);
    const hasPassword = level !== strength.Level.None;
    strengthSection.hidden = !hasPassword;

    if (!hasPassword) {
      return;
    }

    strengthBars.forEach((bar) => {
      bar.className = "auth-password-strength__bar";
    });

    strengthSection.dataset.level = String(level);

    if (level === strength.Level.Weak) {
      strengthBars[0].classList.add("is-active", "is-weak");
      strengthLabel.textContent = t("resetPassword.strength.weak", "Débil");
      strengthLabel.className = "auth-password-strength__label is-weak";
    } else if (level === strength.Level.Medium) {
      strengthBars[0].classList.add("is-active", "is-medium");
      strengthBars[1].classList.add("is-active", "is-medium");
      strengthLabel.textContent = t("resetPassword.strength.medium", "Media");
      strengthLabel.className = "auth-password-strength__label is-medium";
    } else {
      strengthBars[0].classList.add("is-active", "is-strong");
      strengthBars[1].classList.add("is-active", "is-strong");
      strengthBars[2].classList.add("is-active", "is-strong");
      strengthLabel.textContent = t("resetPassword.strength.strong", "Fuerte");
      strengthLabel.className = "auth-password-strength__label is-strong";
    }
  }

  function updateFieldErrors() {
    const password = newPasswordInput?.value ?? "";
    const confirmPassword = confirmPasswordInput?.value ?? "";

    updatePasswordStrengthUi(password);

    if (passwordError) {
      const showWeak = password.length > 0 && !strength?.meetsMinimum(password);
      passwordError.hidden = !showWeak;
    }

    if (confirmError) {
      const showMismatch =
        confirmPassword.length > 0 && password !== confirmPassword;
      confirmError.hidden = !showMismatch;
    }
  }

  const mode = readQueryParam("mode");
  const oobCode = readQueryParam("oobCode");

  if (mode !== "resetPassword" || !oobCode) {
    setStatus(
      t(
        "resetPassword.status.invalidLink",
        "Este enlace no es válido o ha caducado. Solicita un nuevo restablecimiento desde la app TourAI."
      ),
      true
    );
    if (form) {
      form.style.display = "none";
    }
    return;
  }

  newPasswordInput?.addEventListener("input", updateFieldErrors);
  confirmPasswordInput?.addEventListener("input", updateFieldErrors);

  toggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setPasswordsVisible(!passwordsVisible);
    });
  });

  generateButton?.addEventListener("click", () => {
    if (!strength) {
      return;
    }

    const password = strength.generateSecurePassword();
    if (newPasswordInput) {
      newPasswordInput.value = password;
    }
    if (confirmPasswordInput) {
      confirmPasswordInput.value = password;
    }

    setPasswordsVisible(true);
    updateFieldErrors();
    setStatus("", false);
  });

  document.addEventListener("tourai:locale-changed", () => {
    setPasswordsVisible(passwordsVisible);
    updateFieldErrors();
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const newPassword = newPasswordInput?.value ?? "";
    const confirmPassword = confirmPasswordInput?.value ?? "";

    updateFieldErrors();

    if (!strength?.meetsMinimum(newPassword)) {
      setStatus(
        t(
          "resetPassword.error.weak",
          "La contraseña es demasiado débil. Usa al menos 8 caracteres con mayúsculas, minúsculas y números."
        ),
        true
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setStatus(
        t("resetPassword.error.mismatch", "Las contraseñas no coinciden."),
        true
      );
      return;
    }

    setStatus(t("resetPassword.status.saving", "Guardando contraseña..."), false);

    try {
      await auth.confirmPasswordReset(oobCode, newPassword);
      showSuccess();
    } catch (error) {
      const message =
        error?.code === "auth/expired-action-code"
          ? t(
              "resetPassword.status.expired",
              "El enlace ha caducado. Solicita uno nuevo desde la app."
            )
          : t(
              "resetPassword.status.failed",
              "No se pudo actualizar la contraseña. Solicita un nuevo enlace."
            );
      setStatus(message, true);
    }
  });
})();

