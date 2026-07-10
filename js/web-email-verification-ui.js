(function () {
  function tOr(key, fallback) {
    var locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    return window.TourAiI18n?.tOr?.(key, locale, null, fallback) ?? fallback;
  }

  function setVerificationBoxState(options) {
    window.TourAiForms?.renderEmailVerificationBox(
      {
        boxId: options.boxId ?? "emailVerificationBox",
        messageId: options.messageId ?? "emailVerificationMessage",
        sendButtonId: options.sendButtonId ?? "sendVerificationBtn",
      },
      options
    );
  }

  function applyVerificationBoxFromEmail(email, options) {
    window.TourAiForms?.applyEmailVerificationBox(
      email,
      {
        boxId: options.boxId,
        messageId: options.messageId,
        sendButtonId: options.sendButtonId,
      },
      options.context
    );
  }

  function openEmailVerificationModal(modalId) {
    var modal = document.getElementById(modalId ?? "emailVerificationModal");
    if (!modal) {
      return;
    }

    modal.style.display = "flex";
    var status = document.getElementById("verificationModalStatus");
    if (status) {
      status.hidden = true;
      status.className = "verification-status";
    }

    var codeInput = document.getElementById("verificationCode");
    if (codeInput) {
      codeInput.value = "";
      codeInput.focus();
    }
  }

  function closeEmailVerificationModal(modalId) {
    var modal = document.getElementById(modalId ?? "emailVerificationModal");
    if (modal) {
      modal.style.display = "none";
    }
  }

  function showVerificationModalStatus(message, type) {
    var status = document.getElementById("verificationModalStatus");
    if (!status) {
      return;
    }

    status.textContent = message;
    status.className = "verification-status " + (type ?? "");
    status.hidden = false;
  }

  async function startEmailVerification(options) {
    if (window.TourAiLoading?.isVisible()) {
      return;
    }

    var emailInput = document.getElementById(options.emailInputId);
    var button = document.getElementById(options.sendButtonId ?? "sendVerificationBtn");
    var email = emailInput?.value?.trim() ?? "";
    var originalText = tOr("contact.verify.button", button?.textContent ?? "VERIFICAR CORREO");

    try {
      if (button) {
        button.disabled = true;
        button.textContent = tOr("contact.verify.sending", "Enviando código...");
      }

      var result = await window.TourAiForms.sendContactVerificationCode(email);
      if (!result.ok) {
        if (result.error === "rate_limited") {
          throw new Error(tOr("contact.verify.rateLimited", "Demasiados intentos. Espera unos minutos."));
        }
        throw new Error(tOr("contact.verify.sendError", "No se pudo enviar el código."));
      }

      openEmailVerificationModal(options.modalId);
      showVerificationModalStatus(
        tOr("contact.verify.sent", "Código enviado. Revisa tu bandeja de entrada y spam."),
        "success"
      );
    } catch (error) {
      window.TourAiFeedback?.show({
        type: "error",
        message: error.message || tOr("contact.verify.sendError", "No se pudo enviar el código."),
      });
    } finally {
      if (button) {
        button.textContent = originalText;
        button.disabled = false;
      }
      options.onStateChange?.();
    }
  }

  async function resendVerificationCode(options) {
    if (window.TourAiLoading?.isVisible()) {
      return;
    }

    var button = document.getElementById(options.resendButtonId ?? "resendVerificationBtn");
    var emailInput = document.getElementById(options.emailInputId);
    var originalText = tOr("contact.verify.resend", button?.textContent ?? "Reenviar código");

    try {
      if (button) {
        button.disabled = true;
      }

      var result = await window.TourAiForms.sendContactVerificationCode(emailInput?.value?.trim() ?? "");
      if (!result.ok) {
        if (result.error === "rate_limited") {
          throw new Error(tOr("contact.verify.rateLimited", "Demasiados intentos. Espera unos minutos."));
        }
        throw new Error(tOr("contact.verify.sendError", "No se pudo enviar el código."));
      }

      showVerificationModalStatus(
        tOr("contact.verify.resent", "Se ha enviado un nuevo código."),
        "success"
      );
    } catch (error) {
      showVerificationModalStatus(error.message, "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  async function confirmVerificationCode(options) {
    if (window.TourAiLoading?.isVisible()) {
      return;
    }

    var emailInput = document.getElementById(options.emailInputId);
    var codeInput = document.getElementById("verificationCode");
    var button = document.getElementById(options.verifyButtonId ?? "verifyCodeBtn");
    var email = emailInput?.value?.trim() ?? "";
    var code = codeInput?.value?.trim() ?? "";
    var originalText = tOr("contact.verify.submit", button?.textContent ?? "Confirmar código");

    try {
      if (button) {
        button.disabled = true;
        button.textContent = tOr("contact.verify.verifying", "VERIFICANDO...");
      }

      var result = await window.TourAiForms.verifyContactCode(email, code);
      if (!result.ok) {
        var errorKey = {
          invalid_code: ["contact.verify.invalidCode", "El código no es correcto. Inténtalo de nuevo."],
          expired: ["contact.verify.expired", "El código ha caducado. Solicita uno nuevo."],
          too_many_attempts: ["contact.verify.rateLimited", "Demasiados intentos. Espera unos minutos."],
          not_found: ["contact.verify.invalidCode", "El código no es correcto. Inténtalo de nuevo."],
        }[result.error] ?? ["contact.verify.invalidCode", "El código no es correcto. Inténtalo de nuevo."];

        showVerificationModalStatus(tOr(errorKey[0], errorKey[1]), "error");
        return;
      }

      closeEmailVerificationModal(options.modalId);
      applyVerificationBoxFromEmail(email, options);
      options.onStateChange?.();
    } catch (error) {
      showVerificationModalStatus(
        tOr("contact.verify.invalidCode", "El código no es correcto. Inténtalo de nuevo."),
        "error"
      );
    } finally {
      if (button) {
        button.textContent = originalText;
        button.disabled = false;
      }
    }
  }

  function bindVerificationCodeInput() {
    var codeInput = document.getElementById("verificationCode");
    if (!codeInput || codeInput.dataset.bound === "true") {
      return;
    }

    codeInput.dataset.bound = "true";
    codeInput.addEventListener("input", function () {
      this.value = this.value.replace(/\D/g, "").slice(0, 6);
    });
    codeInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        window.TourAiWebEmailVerification?.confirmVerificationCode();
      }
    });
  }

  function bindEmailVerificationSync(options) {
    var emailInput = document.getElementById(options.emailInputId);
    if (!emailInput || emailInput.dataset.verificationSyncBound === "true") {
      return;
    }

    emailInput.dataset.verificationSyncBound = "true";

    function refreshUi() {
      applyVerificationBoxFromEmail(emailInput.value, options);
      options.onStateChange?.();
    }

    function runSync() {
      window.TourAiForms?.scheduleEmailRegistrationCheck(emailInput.value, {
        context: options.context,
        platform: options.platform,
        getEmail: function () {
          return emailInput.value;
        },
        onAlreadySubscribed: options.onAlreadySubscribed,
        onStateChange: refreshUi,
      });
    }

    emailInput.addEventListener("input", function () {
      window.TourAiForms?.onContactEmailInput(this.value);
      refreshUi();
      runSync();
    });
    emailInput.addEventListener("blur", runSync);
  }

  function bindModalClose(options) {
    var modal = document.getElementById(options.modalId);
    if (!modal || modal.dataset.closeBound === "true") {
      return;
    }

    modal.dataset.closeBound = "true";
    var closeHandler = options.onClose;

    modal.querySelector(options.closeSelector ?? ".close-modal")?.addEventListener("click", function (event) {
      event.preventDefault();
      closeHandler();
    });

    modal.addEventListener("click", function (event) {
      if (event.target === modal) {
        closeHandler();
      }
    });
  }

  window.TourAiWebEmailVerification = {
    setVerificationBoxState: setVerificationBoxState,
    applyVerificationBoxFromEmail: applyVerificationBoxFromEmail,
    openEmailVerificationModal: openEmailVerificationModal,
    closeEmailVerificationModal: closeEmailVerificationModal,
    startEmailVerification: startEmailVerification,
    resendVerificationCode: resendVerificationCode,
    confirmVerificationCode: confirmVerificationCode,
    bindVerificationCodeInput: bindVerificationCodeInput,
    bindEmailVerificationSync: bindEmailVerificationSync,
    bindModalClose: bindModalClose,
  };
})();
