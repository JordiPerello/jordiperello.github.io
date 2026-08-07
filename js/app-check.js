/* TourAI Firebase App Check (reCAPTCHA v3) for web Cloud Functions that require it.
 * Site key is public (reCAPTCHA); never put Cloud Functions API key / HMAC here.
 *
 * Production (tourai.es): reCAPTCHA v3 only — one site key, all users.
 * Localhost dev: set appCheckDebugToken to the single UUID registered in
 * Firebase Console → App Check → web app → Manage debug tokens.
 * Never mint per-browser debug tokens (we only register one in Firebase).
 */
(function (global) {
  "use strict";

  var LEGACY_STORAGE_KEY = "tourai-app-check-debug-token";
  var initPromise = null;
  var loggedDebugToken = false;

  function authApi() {
    return global.TourAiAuth;
  }

  function siteKey() {
    return String(global.TourAiSite?.config?.appCheckRecaptchaSiteKey || "").trim();
  }

  function isLocalHost() {
    return /localhost|127\.0\.0\.1/i.test(global.location?.hostname || "");
  }

  /** Localhost only: fixed UUID from site-config.secrets.js (shared dev token). */
  function resolveDebugToken() {
    if (!isLocalHost()) {
      return "";
    }
    return String(global.TourAiSite?.config?.appCheckDebugToken || "").trim();
  }

  function dropLegacyPerBrowserDebugToken() {
    try {
      global.localStorage?.removeItem(LEGACY_STORAGE_KEY);
    } catch (_e) {
      /* ignore */
    }
  }

  function logDebugToken(token) {
    if (!token || loggedDebugToken) {
      return;
    }
    loggedDebugToken = true;
    console.info(
      "[TourAI App Check] Using configured debug token (localhost only). Must match Firebase Console → App Check → Manage debug tokens."
    );
  }

  function warnMissingDebugTokenOnLocalhost() {
    if (!isLocalHost() || resolveDebugToken()) {
      return;
    }
    console.warn(
      "[TourAI App Check] localhost without appCheckDebugToken in site-config.secrets.js — checkout may fail. " +
        "Set the single UUID registered in Firebase Console → App Check → Manage debug tokens."
    );
  }

  /** Must run before appCheck.activate / getToken. */
  function enableDebugTokenIfConfigured() {
    dropLegacyPerBrowserDebugToken();
    var token = resolveDebugToken();
    if (!token) {
      warnMissingDebugTokenOnLocalhost();
      return "";
    }
    global.FIREBASE_APPCHECK_DEBUG_TOKEN = token;
    logDebugToken(token);
    return token;
  }

  enableDebugTokenIfConfigured();

  function ensureAppCheck() {
    if (initPromise) {
      return initPromise;
    }

    initPromise = (async function () {
      enableDebugTokenIfConfigured();
      await authApi().ensureFirebase();
      var key = siteKey();
      if (!key) {
        throw new Error("APP_CHECK_CONFIG_MISSING");
      }
      if (!global.firebase?.appCheck) {
        throw new Error("APP_CHECK_SDK_MISSING");
      }

      var appCheck = global.firebase.appCheck();
      if (!global.__tourAiAppCheckActivated) {
        appCheck.activate(key, /* isTokenAutoRefreshEnabled */ true);
        global.__tourAiAppCheckActivated = true;
      }
      return appCheck;
    })().catch(function (err) {
      initPromise = null;
      throw err;
    });

    return initPromise;
  }

  function isDebugExchangeForbidden(err) {
    var code = String(err?.code || "");
    var msg = String(err?.message || err || "");
    return (
      code.indexOf("appCheck/fetch-status-error") !== -1 ||
      /HTTP status:\s*403/i.test(msg) ||
      /exchangeDebugToken/i.test(msg)
    );
  }

  async function getToken(forceRefresh) {
    var debugToken = enableDebugTokenIfConfigured();
    try {
      var appCheck = await ensureAppCheck();
      var result = await appCheck.getToken(!!forceRefresh);
      var token = result && result.token;
      if (!token) {
        throw new Error("APP_CHECK_TOKEN_MISSING");
      }
      return token;
    } catch (err) {
      if (debugToken && isDebugExchangeForbidden(err)) {
        console.error(
          "[TourAI App Check] Debug token rejected (403). Check appCheckDebugToken in site-config.secrets.js matches Firebase Console → App Check → Manage debug tokens."
        );
      }
      throw err;
    }
  }

  global.TourAiAppCheck = {
    ensure: ensureAppCheck,
    getToken: getToken,
    /** Localhost helper: returns the configured debug UUID (empty on production). */
    getDebugToken: resolveDebugToken,
  };
})(window);
