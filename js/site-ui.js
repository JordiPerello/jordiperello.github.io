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

  gtag("consent", "default", {
    // Web has no advertising or third-party analytics today; keep these denied
    // even if the user acknowledges the technical-cookie notice.
    ad_storage: "denied",
    analytics_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    wait_for_update: 500,
  });
})();

(function () {
  // Dismiss flag for the technical-storage notice (not a marketing consent).
  var STORAGE_KEY = "cookies-aceptadas";

  function cookieBannerHtml() {
    return (
      '<div class="site-cookie-banner__inner">' +
      '<p class="site-cookie-banner__text">' +
      '<span data-i18n="cookie.text">Usamos almacenamiento local técnico necesario (idioma, sesión y preferencias). Esta web no usa publicidad ni analítica de terceros.</span> ' +
      '<a href="cookies.html" data-i18n="cookie.more">Más info</a>.' +
      "</p>" +
      '<div class="site-cookie-banner__actions">' +
      '<button type="button" class="site-cookie-banner__accept" data-cookie-dismiss data-i18n="cookie.dismiss">Entendido</button>' +
      "</div></div>"
    );
  }

  function ensureCookieBanner() {
    var banner = document.getElementById("cookie-banner");
    if (!banner) {
      if (!document.body) {
        return null;
      }
      banner = document.createElement("div");
      banner.id = "cookie-banner";
      banner.className = "site-cookie-banner";
      banner.hidden = true;
      banner.setAttribute("aria-live", "polite");
      document.body.appendChild(banner);
    }

    banner.innerHTML = cookieBannerHtml();
    if (window.TourAiI18n?.applyTranslations && window.TourAiI18n?.getLocale) {
      window.TourAiI18n.applyTranslations(window.TourAiI18n.getLocale());
    }
    return banner;
  }

  function dismissNotice() {
    localStorage.setItem(STORAGE_KEY, "true");

    if (window.gtag) {
      window.gtag("consent", "update", {
        ad_storage: "denied",
        analytics_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
    }

    var banner = document.getElementById("cookie-banner");
    if (banner) {
      banner.hidden = true;
    }
  }

  function initCookieBanner() {
    var banner = ensureCookieBanner();
    if (!banner) {
      return;
    }

    if (!localStorage.getItem(STORAGE_KEY)) {
      banner.hidden = false;
    }

    banner.querySelector("[data-cookie-dismiss]")?.addEventListener("click", function () {
      dismissNotice();
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
        <p class="tourai-loading-message" data-default-text="" data-i18n="loading.processing"></p>
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
        const fallback = window.TourAiI18n?.t?.("loading.processing", window.TourAiI18n.getLocale()) ?? messageEl.getAttribute("data-default-text") ?? "";
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
        success: tOr("feedback.success.title"),
        error: tOr("forms.error.generic"),
        info: tOr("feedback.info.title"),
      };

      const customTitle =
        typeof options?.title === "string" ? options.title.trim() : "";
      const message =
        typeof options?.message === "string" ? options.message.trim() : "";

      icon.className = `tourai-feedback-icon tourai-feedback-icon--${type}`;

      // Errors: single title-styled line (avoid title + nearly identical body).
      if (type === "error" && !customTitle) {
        titleEl.textContent = message || defaultTitles.error;
        messageEl.textContent = "";
        messageEl.hidden = true;
      } else {
        titleEl.textContent = customTitle || defaultTitles[type] || defaultTitles.info;
        messageEl.textContent = message;
        messageEl.hidden = !message;
      }

      button.textContent = options?.buttonText ?? tOr("feedback.close");

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

/* Shared chrome: mobile nav + footer year (replaces duplicated inline page scripts). */
(function () {
  function fillCurrentYear() {
    var el = document.getElementById("current-year");
    if (el) {
      el.textContent = String(new Date().getFullYear());
    }
  }

  window.toggleMenu = function toggleMenu() {
    var links =
      document.getElementById("navLinks") || document.getElementById("nav-links");
    if (!links) {
      return;
    }
    var open = links.classList.contains("active") || links.classList.contains("show");
    // site.css treats .active and .show the same; keep both in sync across pages.
    links.classList.toggle("active", !open);
    links.classList.toggle("show", !open);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fillCurrentYear);
  } else {
    fillCurrentYear();
  }
})();

/* Six-digit OTP inputs (same interaction pattern as TourAI app VerificationCodeInputView). */
(function () {
  function digitInputs(root) {
    return Array.prototype.slice.call(
      root.querySelectorAll('input[data-otp-digit]')
    );
  }

  function syncHidden(root) {
    var hiddenId = root.getAttribute("data-otp-hidden");
    if (!hiddenId) {
      return;
    }
    var hidden = document.getElementById(hiddenId);
    if (hidden) {
      hidden.value = window.TourAiOtpDigits.getCode(root);
    }
  }

  function fillFromString(root, value) {
    var digits = String(value || "").replace(/\D/g, "").slice(0, 6).split("");
    digitInputs(root).forEach(function (input, index) {
      input.value = digits[index] || "";
    });
    syncHidden(root);
  }

  function focusIndex(root, index) {
    var inputs = digitInputs(root);
    var target = inputs[Math.max(0, Math.min(index, inputs.length - 1))];
    if (target) {
      target.focus();
      target.select();
    }
  }

  function mount(root, options) {
    if (!root || root.getAttribute("data-otp-ready") === "1") {
      return root;
    }
    var opts = options || {};
    var length = Math.max(4, Math.min(8, Number(opts.length) || 6));
    var hiddenId = opts.hiddenInputId || root.getAttribute("data-otp-hidden") || "";
    var ariaLabel =
      opts.ariaLabel ||
      root.getAttribute("aria-label") ||
      "Código de verificación";

    root.classList.add("otp-digits");
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", ariaLabel);
    if (hiddenId) {
      root.setAttribute("data-otp-hidden", hiddenId);
    }
    root.innerHTML = "";

    for (var i = 0; i < length; i++) {
      var input = document.createElement("input");
      input.type = "text";
      input.inputMode = "numeric";
      input.autocomplete = i === 0 ? "one-time-code" : "off";
      input.maxLength = 1;
      input.pattern = "[0-9]*";
      input.className = "otp-digits__cell";
      input.setAttribute("data-otp-digit", String(i));
      input.setAttribute("aria-label", "Dígito " + (i + 1));
      root.appendChild(input);
    }

    root.addEventListener("input", function (event) {
      var target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.hasAttribute("data-otp-digit")) {
        return;
      }
      var cleaned = target.value.replace(/\D/g, "");
      if (cleaned.length > 1) {
        fillFromString(root, cleaned);
        var filled = window.TourAiOtpDigits.getCode(root);
        focusIndex(root, Math.min(filled.length, length - 1));
        if (filled.length >= length && typeof opts.onComplete === "function") {
          opts.onComplete(filled);
        }
        return;
      }
      target.value = cleaned.slice(0, 1);
      syncHidden(root);
      if (target.value) {
        var idx = Number(target.getAttribute("data-otp-digit") || "0");
        focusIndex(root, idx + 1);
      }
      var code = window.TourAiOtpDigits.getCode(root);
      if (code.length >= length && typeof opts.onComplete === "function") {
        opts.onComplete(code);
      }
    });

    root.addEventListener("keydown", function (event) {
      var target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.hasAttribute("data-otp-digit")) {
        return;
      }
      var idx = Number(target.getAttribute("data-otp-digit") || "0");
      if (event.key === "Backspace" && !target.value && idx > 0) {
        focusIndex(root, idx - 1);
        return;
      }
      if (event.key === "ArrowLeft" && idx > 0) {
        event.preventDefault();
        focusIndex(root, idx - 1);
        return;
      }
      if (event.key === "ArrowRight" && idx < length - 1) {
        event.preventDefault();
        focusIndex(root, idx + 1);
        return;
      }
      if (event.key === "Enter" && typeof opts.onEnter === "function") {
        event.preventDefault();
        opts.onEnter(window.TourAiOtpDigits.getCode(root));
      }
    });

    root.addEventListener("paste", function (event) {
      var text = (event.clipboardData || window.clipboardData)?.getData("text") || "";
      if (!/\d/.test(text)) {
        return;
      }
      event.preventDefault();
      fillFromString(root, text);
      var code = window.TourAiOtpDigits.getCode(root);
      focusIndex(root, Math.min(code.length, length - 1));
      if (code.length >= length && typeof opts.onComplete === "function") {
        opts.onComplete(code);
      }
    });

    root.setAttribute("data-otp-ready", "1");
    return root;
  }

  window.TourAiOtpDigits = {
    mount: mount,
    getCode: function (root) {
      if (!root) {
        return "";
      }
      return digitInputs(root)
        .map(function (input) {
          return input.value || "";
        })
        .join("");
    },
    clear: function (root) {
      if (!root) {
        return;
      }
      digitInputs(root).forEach(function (input) {
        input.value = "";
      });
      syncHidden(root);
    },
    focusFirst: function (root) {
      focusIndex(root, 0);
    },
  };
})();

/* Shared “Verifica tu correo” OTP modal for contact, subscribe, unsubscribe, delete-account. */
(function () {
  var MODAL_ID = "tourai-email-verify-modal";
  var session = {
    onConfirm: null,
    onResend: null,
    confirming: false,
    resending: false,
  };

  function tOr(key, fallback) {
    var locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    return window.TourAiI18n?.tOr?.(key, locale, null, fallback) ?? fallback;
  }

  function otpRoot() {
    return document.getElementById("touraiEmailVerifyOtp");
  }

  function statusEl() {
    return document.getElementById("touraiEmailVerifyStatus");
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) {
      el.textContent = text;
    }
  }

  function runConfirm() {
    if (session.confirming || typeof session.onConfirm !== "function") {
      return;
    }
    var code = window.TourAiEmailVerifyModal.getCode();
    if (!/^\d{6}$/.test(code)) {
      return;
    }
    session.confirming = true;
    Promise.resolve(session.onConfirm(code))
      .catch(function () {
        /* Caller shows status */
      })
      .finally(function () {
        session.confirming = false;
      });
  }

  function runResend() {
    if (session.resending || typeof session.onResend !== "function") {
      return;
    }
    session.resending = true;
    Promise.resolve(session.onResend())
      .catch(function () {
        /* Caller shows status */
      })
      .finally(function () {
        session.resending = false;
      });
  }

  function ensure() {
    if (document.getElementById(MODAL_ID)) {
      return;
    }

    var modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "modal-overlay tourai-email-verify-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML =
      '<div class="modal-content tourai-email-verify-modal__card" role="dialog" aria-modal="true" aria-labelledby="touraiEmailVerifyTitle">' +
      '<h3 id="touraiEmailVerifyTitle" class="tourai-email-verify-modal__title">Introduce el código de verificación</h3>' +
      '<p id="touraiEmailVerifyIntro" class="tourai-email-verify-modal__intro" hidden></p>' +
      '<div class="tourai-email-verify-modal__divider" aria-hidden="true"></div>' +
      '<div id="touraiEmailVerifyOtp" class="otp-digits" data-otp-hidden="touraiEmailVerifyCode" aria-label="Código recibido por email"></div>' +
      '<input type="hidden" id="touraiEmailVerifyCode" value="" autocomplete="one-time-code">' +
      '<p id="touraiEmailVerifyStatus" class="verification-status tourai-email-verify-modal__status" hidden></p>' +
      '<p id="touraiEmailVerifySpamHint" class="tourai-email-verify-modal__hint"></p>' +
      '<button type="button" id="touraiEmailVerifyResend" class="tourai-email-verify-modal__link">Reenviar código</button>' +
      '<button type="button" id="touraiEmailVerifySubmit" class="tourai-email-verify-modal__primary">Validar código</button>' +
      '<div class="tourai-email-verify-modal__divider" aria-hidden="true"></div>' +
      '<button type="button" id="touraiEmailVerifyClose" class="tourai-email-verify-modal__exit">Cerrar</button>' +
      "</div>";
    document.body.appendChild(modal);

    modal.addEventListener("click", function (event) {
      if (event.target === modal) {
        window.TourAiEmailVerifyModal.close();
      }
    });
    modal.querySelector(".modal-content")?.addEventListener("click", function (event) {
      event.stopPropagation();
    });

    var root = otpRoot();
    if (root && window.TourAiOtpDigits) {
      window.TourAiOtpDigits.mount(root, {
        length: 6,
        hiddenInputId: "touraiEmailVerifyCode",
        onEnter: runConfirm,
        onComplete: runConfirm,
      });
    }

    document.getElementById("touraiEmailVerifySubmit")?.addEventListener("click", runConfirm);
    document.getElementById("touraiEmailVerifyResend")?.addEventListener("click", runResend);
    document.getElementById("touraiEmailVerifyClose")?.addEventListener("click", function () {
      window.TourAiEmailVerifyModal.close();
    });
  }

  window.TourAiEmailVerifyModal = {
    open: function (options) {
      ensure();
      var opts = options || {};
      session.onConfirm = opts.onConfirm || null;
      session.onResend = opts.onResend || null;
      session.confirming = false;
      session.resending = false;

      setText(
        "touraiEmailVerifyTitle",
        opts.title ||
          tOr("contact.verify.title")
      );

      var introEl = document.getElementById("touraiEmailVerifyIntro");
      if (introEl) {
        var introText =
          typeof opts.intro === "string" ? opts.intro.trim() : "";
        introEl.textContent = introText;
        introEl.hidden = !introText;
      }

      setText(
        "touraiEmailVerifySpamHint",
        opts.spamHint ||
          tOr("contact.verify.spamHint")
      );
      setText(
        "touraiEmailVerifySubmit",
        opts.submitLabel || tOr("contact.verify.submit")
      );
      setText(
        "touraiEmailVerifyResend",
        opts.resendLabel || tOr("contact.verify.resend")
      );
      setText(
        "touraiEmailVerifyClose",
        opts.closeLabel || tOr("contact.verify.close")
      );

      var status = statusEl();
      if (status) {
        if (opts.statusMessage) {
          status.textContent = opts.statusMessage;
          status.className =
            "verification-status tourai-email-verify-modal__status " +
            (opts.statusType || "success");
          status.hidden = false;
        } else {
          status.hidden = true;
          status.textContent = "";
          status.className =
            "verification-status tourai-email-verify-modal__status";
        }
      }

      var modal = document.getElementById(MODAL_ID);
      modal.style.display = "flex";
      modal.setAttribute("aria-hidden", "false");

      /* Focus after the modal is visible (and after any loading overlay hides). */
      window.TourAiEmailVerifyModal.clearAndFocus();
      window.requestAnimationFrame(function () {
        window.TourAiEmailVerifyModal.focusFirstDigit();
        window.setTimeout(function () {
          window.TourAiEmailVerifyModal.focusFirstDigit();
        }, 50);
      });
    },

    close: function () {
      var modal = document.getElementById(MODAL_ID);
      if (modal) {
        modal.style.display = "none";
        modal.setAttribute("aria-hidden", "true");
      }
      session.onConfirm = null;
      session.onResend = null;
      session.confirming = false;
      session.resending = false;
    },

    setStatus: function (message, type) {
      var status = statusEl();
      if (!status) {
        return;
      }
      status.textContent = message || "";
      status.className =
        "verification-status tourai-email-verify-modal__status " + (type || "");
      status.hidden = !message;
    },

    getCode: function () {
      var root = otpRoot();
      if (root && window.TourAiOtpDigits) {
        return window.TourAiOtpDigits.getCode(root);
      }
      return document.getElementById("touraiEmailVerifyCode")?.value?.trim() || "";
    },

    clearAndFocus: function () {
      var root = otpRoot();
      if (root && window.TourAiOtpDigits) {
        window.TourAiOtpDigits.clear(root);
        window.TourAiOtpDigits.focusFirst(root);
      }
    },

    focusFirstDigit: function () {
      var root = otpRoot();
      var modal = document.getElementById(MODAL_ID);
      if (!root || !window.TourAiOtpDigits || !modal || modal.style.display !== "flex") {
        return;
      }
      window.TourAiOtpDigits.focusFirst(root);
    },

    isOpen: function () {
      var modal = document.getElementById(MODAL_ID);
      return !!(modal && modal.style.display === "flex");
    },
  };
})();

/* Shared confirm dialog (logout, delete account, etc.) */
(function () {
  var MODAL_ID = "touraiConfirmModal";
  var resolver = null;

  function tOr(key, fallback) {
    var locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    return window.TourAiI18n?.tOr(key, locale, null, fallback) ?? fallback;
  }

  function closeConfirm(result) {
    var modal = document.getElementById(MODAL_ID);
    if (modal) {
      modal.hidden = true;
    }
    document.body.classList.remove("community-confirm-open");
    var resolve = resolver;
    resolver = null;
    if (resolve) {
      resolve(!!result);
    }
  }

  function ensureConfirmModal() {
    if (document.getElementById(MODAL_ID)) {
      return;
    }

    var modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "community-confirm-modal";
    modal.hidden = true;
    modal.innerHTML =
      '<div class="community-confirm-modal__backdrop" data-confirm-cancel tabindex="-1"></div>' +
      '<div class="community-confirm-modal__dialog" role="dialog" aria-modal="true" ' +
      'aria-labelledby="touraiConfirmTitle" aria-describedby="touraiConfirmMessage">' +
      '<h2 id="touraiConfirmTitle" class="community-confirm-modal__title"></h2>' +
      '<p id="touraiConfirmMessage" class="community-confirm-modal__message"></p>' +
      '<div class="community-confirm-modal__actions">' +
      '<button type="button" class="btn-secondary" id="touraiConfirmCancel"></button>' +
      '<button type="button" class="btn-primary" id="touraiConfirmOk"></button>' +
      "</div></div>";
    document.body.appendChild(modal);

    modal.addEventListener("click", function (event) {
      if (event.target === modal || event.target.closest("[data-confirm-cancel]")) {
        closeConfirm(false);
      }
    });

    document.getElementById("touraiConfirmCancel").addEventListener("click", function () {
      closeConfirm(false);
    });
    document.getElementById("touraiConfirmOk").addEventListener("click", function () {
      closeConfirm(true);
    });

    document.addEventListener("keydown", function (event) {
      var open = document.getElementById(MODAL_ID);
      if (!open || open.hidden) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeConfirm(false);
      }
    });
  }

  window.TourAiConfirm = {
    /**
     * @param {{ title?: string, message?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean, alert?: boolean }} options
     * @returns {Promise<boolean>}
     */
    show: function (options) {
      ensureConfirmModal();
      var opts = options || {};
      var modal = document.getElementById(MODAL_ID);
      var titleEl = document.getElementById("touraiConfirmTitle");
      var messageEl = document.getElementById("touraiConfirmMessage");
      var okBtn = document.getElementById("touraiConfirmOk");
      var cancelBtn = document.getElementById("touraiConfirmCancel");
      var dialog = modal.querySelector(".community-confirm-modal__dialog");
      var isAlert = opts.alert === true;

      if (resolver) {
        closeConfirm(false);
      }

      titleEl.textContent = opts.title || "";
      messageEl.textContent = opts.message || "";
      okBtn.textContent =
        opts.confirmLabel ||
        (isAlert
          ? tOr("account.alert.ok")
          : tOr("account.confirm.ok"));
      cancelBtn.textContent = opts.cancelLabel || tOr("account.confirm.cancel");
      cancelBtn.hidden = isAlert;

      if (opts.danger) {
        okBtn.classList.add("btn-primary--danger");
        dialog?.classList.add("community-confirm-modal__dialog--danger");
      } else {
        okBtn.classList.remove("btn-primary--danger");
        dialog?.classList.remove("community-confirm-modal__dialog--danger");
      }

      modal.hidden = false;
      document.body.classList.add("community-confirm-open");
      okBtn.focus();

      return new Promise(function (resolve) {
        resolver = resolve;
      });
    },
  };
})();

