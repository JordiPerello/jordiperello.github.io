(function () {
  var STORAGE_KEY = "cookies-aceptadas";

  function updateConsent(granted) {
    localStorage.setItem(STORAGE_KEY, granted ? "true" : "false");

    if (window.gtag) {
      window.gtag("consent", "update", {
        ad_storage: granted ? "granted" : "denied",
        analytics_storage: granted ? "granted" : "denied",
        ad_user_data: granted ? "granted" : "denied",
        ad_personalization: granted ? "granted" : "denied",
      });
    }

    var banner = document.getElementById("cookie-banner");
    if (banner) {
      banner.hidden = true;
    }
  }

  function initCookieBanner() {
    var banner = document.getElementById("cookie-banner");
    if (!banner) {
      return;
    }

    if (!localStorage.getItem(STORAGE_KEY)) {
      banner.hidden = false;
    }

    banner.querySelector("[data-cookie-accept]")?.addEventListener("click", function () {
      updateConsent(true);
    });

    banner.querySelector("[data-cookie-reject]")?.addEventListener("click", function () {
      updateConsent(false);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCookieBanner);
  } else {
    initCookieBanner();
  }
})();
