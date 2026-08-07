// Placeholder only. Real secrets: D:\Proyectos\Documents\docs-touraiweb\Secrets\site-config.secrets.js
// For local HTTP: copy that file to js/site-config.secrets.js (gitignored). Never commit real secrets.
(function () {
  window.TourAiSite = window.TourAiSite || {};
  window.TourAiSite.config = window.TourAiSite.config || {};

  window.TourAiSite.config.firebaseAuth = {
    apiKey: "REPLACE_WITH_FIREBASE_WEB_API_KEY",
    authDomain: "tourai-production-7dabf.firebaseapp.com",
    projectId: "tourai-production-7dabf",
    storageBucket: "tourai-production-7dabf.firebasestorage.app",
    // Required for App Check token exchange:
    appId: "REPLACE_WITH_FIREBASE_WEB_APP_ID",
  };

  // Public reCAPTCHA v3 site key for Firebase App Check (not a server secret).
  // Register the web app in Firebase Console → App Check → reCAPTCHA v3.
  window.TourAiSite.config.appCheckRecaptchaSiteKey =
    "REPLACE_WITH_RECAPTCHA_V3_SITE_KEY";

  // Localhost only — one shared UUID registered in Firebase Console → App Check → Manage debug tokens.
  // Production (tourai.es) ignores this; real users use reCAPTCHA v3 above.
  // window.TourAiSite.config.appCheckDebugToken = "00000000-0000-0000-0000-000000000000";
})();
