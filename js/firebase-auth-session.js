/*
 * Shared Firebase Auth + Firestore helpers for TourAI web account pages.
 * Requires site-config (+ secrets) and firebase-app/auth/firestore compat scripts.
 */
(function (global) {
  const TourAiAuth = {
    _ready: null,

    t(key, fallback) {
      const locale = global.TourAiI18n?.getLocale?.();
      return global.TourAiI18n?.tOr?.(key, locale, null, fallback) ?? fallback;
    },

    getFirebaseConfig() {
      const cfg = global.TourAiSite?.config?.firebaseAuth;
      if (!cfg?.apiKey || !cfg?.authDomain || !cfg?.projectId) {
        return null;
      }
      return {
        apiKey: cfg.apiKey,
        authDomain: cfg.authDomain,
        projectId: cfg.projectId,
      };
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

    async signOut() {
      const auth = await this.ensureFirebase();
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
