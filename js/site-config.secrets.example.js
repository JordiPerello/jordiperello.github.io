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
  };
})();
