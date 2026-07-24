/* TourAI shared UI: consent defaults, cookie banner, loading overlay, feedback modal */
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

(function () {
  const OVERLAY_ID = "tourai-loading-overlay";
  let depth = 0;

  function getMessage(fallback) {
    const locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    return (
      window.TourAiI18n?.tOr("loading.processing", locale, null, fallback) ?? fallback
    );
  }

  function ensureOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      return overlay;
    }

    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "tourai-loading-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="tourai-loading-panel" role="status" aria-live="polite" aria-busy="true">
        <div class="tourai-loading-spinner" aria-hidden="true"></div>
        <p class="tourai-loading-message" data-default-text="Procesando...">Procesando...</p>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function syncOverlay() {
    const overlay = ensureOverlay();
    const visible = depth > 0;
    overlay.classList.toggle("visible", visible);
    overlay.setAttribute("aria-hidden", visible ? "false" : "true");
    document.body.classList.toggle("tourai-loading-active", visible);
  }

  window.TourAiLoading = {
    show(message) {
      const overlay = ensureOverlay();
      const messageEl = overlay.querySelector(".tourai-loading-message");
      if (messageEl) {
        const fallback = messageEl.getAttribute("data-default-text") ?? "Procesando...";
        messageEl.textContent = message ?? getMessage(fallback);
      }

      depth += 1;
      syncOverlay();
    },

    hide() {
      depth = Math.max(0, depth - 1);
      syncOverlay();
    },

    async run(task, message) {
      this.show(message);
      try {
        return await task();
      } finally {
        this.hide();
      }
    },

    /** Keep skeleton / loading UI visible at least `ms` (default 500). */
    async ensureMinMs(startedAt, ms) {
      const minMs = typeof ms === "number" ? ms : 500;
      const wait = minMs - (Date.now() - (startedAt || Date.now()));
      if (wait > 0) {
        await new Promise(function (resolve) {
          setTimeout(resolve, wait);
        });
      }
    },

    isVisible() {
      return depth > 0;
    },
  };
})();

(function () {
  const MODAL_ID = "tourai-feedback-modal";
  let onCloseCallback = null;

  function tOr(key, fallback) {
    const locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    return window.TourAiI18n?.tOr(key, locale, null, fallback) ?? fallback;
  }

  function ensureModal() {
    if (document.getElementById(MODAL_ID)) {
      return;
    }

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "tourai-feedback-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="tourai-feedback-panel" role="dialog" aria-modal="true" aria-labelledby="touraiFeedbackTitle">
        <div class="tourai-feedback-icon" id="touraiFeedbackIcon" aria-hidden="true"></div>
        <h3 id="touraiFeedbackTitle" class="tourai-feedback-title"></h3>
        <p id="touraiFeedbackMessage" class="tourai-feedback-message"></p>
        <button type="button" id="touraiFeedbackCloseBtn" class="tourai-feedback-btn"></button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        window.TourAiFeedback.hide();
      }
    });

    modal.querySelector(".tourai-feedback-panel").addEventListener("click", (event) => {
      event.stopPropagation();
    });

    document.getElementById("touraiFeedbackCloseBtn").addEventListener("click", () => {
      window.TourAiFeedback.hide();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal.classList.contains("visible")) {
        window.TourAiFeedback.hide();
      }
    });
  }

  window.TourAiFeedback = {
    show(options) {
      ensureModal();
      const type = options?.type ?? "info";
      const modal = document.getElementById(MODAL_ID);
      const icon = document.getElementById("touraiFeedbackIcon");
      const titleEl = document.getElementById("touraiFeedbackTitle");
      const messageEl = document.getElementById("touraiFeedbackMessage");
      const button = document.getElementById("touraiFeedbackCloseBtn");

      const defaultTitles = {
        success: tOr("feedback.success.title", "¡Listo!"),
        error: tOr("feedback.error.title", "No se pudo completar"),
        info: tOr("feedback.info.title", "Acción necesaria"),
      };

      icon.className = `tourai-feedback-icon tourai-feedback-icon--${type}`;
      titleEl.textContent = options?.title ?? defaultTitles[type] ?? defaultTitles.info;
      messageEl.textContent = options?.message ?? "";
      button.textContent = options?.buttonText ?? tOr("feedback.close", "Entendido");

      onCloseCallback = options?.onClose ?? null;

      modal.classList.add("visible");
      modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("tourai-feedback-open");
      button.focus();
    },

    hide() {
      const modal = document.getElementById(MODAL_ID);
      if (modal) {
        modal.classList.remove("visible");
        modal.setAttribute("aria-hidden", "true");
      }
      document.body.classList.remove("tourai-feedback-open");

      const callback = onCloseCallback;
      onCloseCallback = null;
      if (callback) {
        callback();
      }
    },
  };
})();

