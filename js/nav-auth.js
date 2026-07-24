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
      renderAvatar(avatar, profile);

      const label = document.createElement("span");
      label.className = "nav-account-label";
      label.textContent = accountLabel(profile);

      link.appendChild(avatar);
      link.appendChild(label);
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

  function profileFromAuthUser(user, firestoreData, fallbackUrls) {
    const data = firestoreData || {};
    const displayName =
      (data.DisplayName && String(data.DisplayName).trim()) ||
      (user.displayName && String(user.displayName).trim()) ||
      "";
    const email = data.Email || user.email || "";
    const photoUrls = resolvePhotoUrls(user.uid, data, user, fallbackUrls);

    return {
      uid: user.uid,
      displayName: displayName,
      email: email,
      photoUrl: photoUrls[0] || "",
      photoUrls: photoUrls,
      firstName: firstNameFrom(displayName, email),
      initials: initialsFrom(displayName, email),
    };
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

  auth.onAuthStateChanged(sync).catch(function (err) {
    // Auth could not be restored — do not keep a cached "signed in" avatar.
    console.warn("[TourAI nav-auth]", err);
    forceSignedOutNav();
  });
})(window);
