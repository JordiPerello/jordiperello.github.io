// Copy to docs-touraiweb/Secrets/site-config.secrets.js (never commit the real file).
(function () {
  window.TourAiSite = window.TourAiSite || {};
  window.TourAiSite.config = window.TourAiSite.config || {};

  window.TourAiSite.config.firebaseAuth = {
    apiKey: "REPLACE_WITH_FIREBASE_WEB_API_KEY",
    authDomain: "tourai-production-7dabf.firebaseapp.com",
    projectId: "tourai-production-7dabf",
  };
})();
