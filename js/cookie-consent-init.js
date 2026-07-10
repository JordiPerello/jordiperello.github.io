(function () {
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
