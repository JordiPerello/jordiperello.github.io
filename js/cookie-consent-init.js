(function () {
  // Avoid nav flash: if we likely have a persisted session, hide "Mi cuenta"
  // until nav-auth paints the signed-in avatar/name (or confirms signed out).
  try {
    var hasProfile =
      !!window.sessionStorage.getItem("tourai-nav-profile-v2") ||
      !!window.localStorage.getItem("tourai-nav-profile-v2") ||
      !!window.sessionStorage.getItem("tourai-nav-profile-v1") ||
      !!window.localStorage.getItem("tourai-nav-profile-v1");
    var remember = window.localStorage.getItem("tourai-login-remember");
    if (hasProfile || remember === "1") {
      document.documentElement.classList.add("tourai-auth-pending");
    }
  } catch (e) {
    /* ignore */
  }

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = window.gtag || gtag;

  var consentState = localStorage.getItem("cookies-aceptadas");
  var granted = consentState === "true";

  gtag("consent", "default", {
    ad_storage: granted ? "granted" : "denied",
    analytics_storage: granted ? "granted" : "denied",
    ad_user_data: granted ? "granted" : "denied",
    ad_personalization: granted ? "granted" : "denied",
    wait_for_update: 500,
  });
})();
