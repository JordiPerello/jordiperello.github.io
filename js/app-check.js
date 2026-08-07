/* TourAI Firebase App Check (reCAPTCHA v3) for web Cloud Functions that require it.
 * Site key is public (reCAPTCHA); never put Cloud Functions API key / HMAC here.
 */
(function (global) {
  "use strict";

  var initPromise = null;

  function authApi() {
    return global.TourAiAuth;
  }

  function siteKey() {
    return String(global.TourAiSite?.config?.appCheckRecaptchaSiteKey || "").trim();
  }

  function ensureAppCheck() {
    if (initPromise) {
      return initPromise;
    }

    initPromise = (async function () {
      await authApi().ensureFirebase();
      var key = siteKey();
      if (!key) {
        throw new Error("APP_CHECK_CONFIG_MISSING");
      }
      if (!global.firebase?.appCheck) {
        throw new Error("APP_CHECK_SDK_MISSING");
      }

      // Local HTTP testing: set appCheckDebug true in site-config.secrets.js, then
      // register the console debug token in Firebase Console → App Check.
      if (
        /localhost|127\.0\.0\.1/i.test(global.location?.hostname || "") &&
        global.TourAiSite?.config?.appCheckDebug === true
      ) {
        global.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
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

  async function getToken(forceRefresh) {
    var appCheck = await ensureAppCheck();
    var result = await appCheck.getToken(!!forceRefresh);
    var token = result && result.token;
    if (!token) {
      throw new Error("APP_CHECK_TOKEN_MISSING");
    }
    return token;
  }

  global.TourAiAppCheck = {
    ensure: ensureAppCheck,
    getToken: getToken,
  };
})(window);
