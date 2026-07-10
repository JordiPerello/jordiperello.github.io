(function () {
  const CODE_MODAL_ID = "webEmailCodeModal";
  let activeConfig = null;
  let alreadySubscribedNoticeKey = null;
  let alreadySubscribedToPlatform = false;

  function tOr(key, fallback, vars) {
    const locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    let result = window.TourAiI18n?.tOr(key, locale, vars, fallback) ?? fallback;
    if (vars) {
      Object.keys(vars).forEach((name) => {
        result = result.replace(`{${name}}`, vars[name]);
      });
    }
    return result;
  }

  function getCurrentPlatform() {
    return document.getElementById(activeConfig.platformId)?.innerText?.trim() ?? "";
  }

  function showAlreadySubscribedFeedback(platform) {
    window.TourAiFeedback?.show({
      type: "info",
      title: tOr("index.modal.alreadySubscribed.title", "Ya estás suscrito"),
      message: tOr(
        "index.modal.alreadySubscribed",
        "Este correo ya tiene activada la alerta para {platform}. Si quieres la otra tienda, selecciónala y repite el proceso.",
        { platform }
      ),
      onClose: () => closePlatformModal(),
    });
  }

  function isBusy() {
    return window.TourAiLoading?.isVisible?.() === true;
  }

  async function checkAlreadySubscribed(email, platform) {
    const result = await window.TourAiForms.checkStoreSubscription(email, platform);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return {
      ok: true,
      subscribed: result.body?.subscribed === true,
      platform: result.body?.platform ?? platform,
    };
  }

  function getEmailInput() {
    return document.getElementById(activeConfig.emailInputId);
  }

  function getPrivacyInput() {
    return document.getElementById(activeConfig.privacyInputId);
  }

  function getSubmitButton() {
    return document.getElementById(activeConfig.submitBtnId);
  }

  function ensureCodeModal() {
    if (document.getElementById(CODE_MODAL_ID)) {
      return;
    }

    const modal = document.createElement("div");
    modal.id = CODE_MODAL_ID;
    modal.className = "web-email-code-modal";
    modal.innerHTML = `
      <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="webEmailCodeTitle">
        <span class="close-modal" data-close-code-modal role="button" aria-label="Cerrar">&times;</span>
        <h3 id="webEmailCodeTitle" data-i18n="contact.verify.title">Verifica tu correo</h3>
        <p data-i18n="contact.verify.intro">Te hemos enviado un código de 6 dígitos. Introdúcelo para confirmar tu dirección.</p>
        <label for="webEmailCodeInput" data-i18n="contact.verify.code">Código de verificación</label>
        <input type="text" id="webEmailCodeInput" class="verification-code-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code" data-i18n-placeholder="contact.verify.code.placeholder" placeholder="000000">
        <p id="webEmailCodeStatus" class="verification-status" hidden></p>
        <button type="button" id="webEmailCodeSubmitBtn" data-i18n="contact.verify.submit">Confirmar código</button>
        <p class="verification-hint">
          <button type="button" id="webEmailCodeResendBtn" style="background:transparent;color:#4db8ff;padding:0;width:auto;font-size:0.9em;border:none;cursor:pointer;" data-i18n="contact.verify.resend">Reenviar código</button>
        </p>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector("[data-close-code-modal]")?.addEventListener("click", (event) => {
      event.preventDefault();
      closeCodeModal();
    });

    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeCodeModal();
      }
    });

    modal.querySelector(".modal-content").addEventListener("click", (event) => {
      event.stopPropagation();
    });

    const codeInput = document.getElementById("webEmailCodeInput");
    codeInput.addEventListener("input", function () {
      this.value = this.value.replace(/\D/g, "").slice(0, 6);
    });
    codeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        confirmCode();
      }
    });

    document.getElementById("webEmailCodeSubmitBtn").addEventListener("click", confirmCode);
    document.getElementById("webEmailCodeResendBtn").addEventListener("click", resendCode);
  }

  function setVerificationBoxState({ visible, verified, showVerifyButton }) {
    window.TourAiForms?.renderEmailVerificationBox(
      {
        boxId: activeConfig.verificationBoxId,
        messageId: activeConfig.verificationMessageId,
        sendButtonId: activeConfig.sendVerificationBtnId,
      },
      { visible, verified, showVerifyButton }
    );
  }

  function applySubscriptionVerificationBox(email) {
    window.TourAiForms?.applyEmailVerificationBox(
      email,
      {
        boxId: activeConfig.verificationBoxId,
        messageId: activeConfig.verificationMessageId,
        sendButtonId: activeConfig.sendVerificationBtnId,
      },
      "subscribe"
    );
  }

  function showCodeModalStatus(message, type) {
    const status = document.getElementById("webEmailCodeStatus");
    status.textContent = message;
    status.className = "verification-status " + (type ?? "");
    status.hidden = false;
  }

  function openCodeModal() {
    ensureCodeModal();
    const modal = document.getElementById(CODE_MODAL_ID);
    modal.style.display = "flex";
    const status = document.getElementById("webEmailCodeStatus");
    status.hidden = true;
    status.className = "verification-status";
    const codeInput = document.getElementById("webEmailCodeInput");
    codeInput.value = "";
    codeInput.focus();
    if (window.TourAiI18n?.applyTranslations) {
      window.TourAiI18n.applyTranslations(window.TourAiI18n.getLocale());
    }
  }

  function closeCodeModal() {
    const modal = document.getElementById(CODE_MODAL_ID);
    if (modal) {
      modal.style.display = "none";
    }
  }

  async function startVerification() {
    if (isBusy()) {
      return;
    }

    const email = getEmailInput()?.value?.trim() ?? "";
    const button = document.getElementById(activeConfig.sendVerificationBtnId);
    const originalText = tOr("contact.verify.button", button?.textContent ?? "VERIFICAR CORREO");

    if (!window.TourAiForms?.isValidEmail(email)) {
      window.TourAiFeedback?.show({
        type: "info",
        message: tOr("contact.email.invalid", "Introduce una dirección de correo válida."),
      });
      return;
    }

    try {
      if (button) {
        button.disabled = true;
        button.textContent = tOr("contact.verify.sending", "Enviando código...");
      }

      const result = await window.TourAiForms.sendWebEmailVerificationCode(email);
      if (!result.ok) {
        if (result.error === "rate_limited") {
          throw new Error(tOr("contact.verify.rateLimited", "Demasiados intentos. Espera unos minutos."));
        }
        throw new Error(tOr("contact.verify.sendError", "No se pudo enviar el código."));
      }

      openCodeModal();
      showCodeModalStatus(
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
      validateSubscriptionForm();
    }
  }

  async function resendCode() {
    if (isBusy()) {
      return;
    }

    const button = document.getElementById("webEmailCodeResendBtn");
    const originalText = tOr("contact.verify.resend", button?.textContent ?? "Reenviar código");
    try {
      button.disabled = true;
      const result = await window.TourAiForms.sendWebEmailVerificationCode(
        getEmailInput()?.value?.trim() ?? ""
      );
      if (!result.ok) {
        if (result.error === "rate_limited") {
          throw new Error(tOr("contact.verify.rateLimited", "Demasiados intentos. Espera unos minutos."));
        }
        throw new Error(tOr("contact.verify.sendError", "No se pudo enviar el código."));
      }
      showCodeModalStatus(
        tOr("contact.verify.resent", "Se ha enviado un nuevo código."),
        "success"
      );
    } catch (error) {
      showCodeModalStatus(error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function confirmCode() {
    if (isBusy()) {
      return;
    }

    const email = getEmailInput()?.value?.trim() ?? "";
    const code = document.getElementById("webEmailCodeInput")?.value?.trim() ?? "";
    const button = document.getElementById("webEmailCodeSubmitBtn");
    const originalText = tOr("contact.verify.submit", button?.textContent ?? "Confirmar código");

    try {
      button.disabled = true;
      button.textContent = tOr("contact.verify.verifying", "VERIFICANDO...");
      const result = await window.TourAiForms.verifyWebEmailCode(email, code);
      if (!result.ok) {
        const errorMap = {
          invalid_code: ["contact.verify.invalidCode", "El código no es correcto. Inténtalo de nuevo."],
          expired: ["contact.verify.expired", "El código ha caducado. Solicita uno nuevo."],
          too_many_attempts: ["contact.verify.rateLimited", "Demasiados intentos. Espera unos minutos."],
          not_found: ["contact.verify.invalidCode", "El código no es correcto. Inténtalo de nuevo."],
        };
        const entry = errorMap[result.error] ?? errorMap.invalid_code;
        showCodeModalStatus(tOr(entry[0], entry[1]), "error");
        return;
      }

      closeCodeModal();
      applySubscriptionVerificationBox(email);

      const platform = getCurrentPlatform();
      if (platform) {
        const subscriptionCheck = await checkAlreadySubscribed(email, platform);
        if (subscriptionCheck.ok && subscriptionCheck.subscribed) {
          showAlreadySubscribedFeedback(subscriptionCheck.platform);
          window.TourAiForms.clearWebEmailVerification();
          validateSubscriptionForm();
          return;
        }
      }

      validateSubscriptionForm();
    } catch (error) {
      showCodeModalStatus(
        tOr("contact.verify.invalidCode", "El código no es correcto. Inténtalo de nuevo."),
        "error"
      );
    } finally {
      button.textContent = originalText;
      button.disabled = false;
    }
  }

  function canSubmitSubscription() {
    const email = getEmailInput()?.value?.trim() ?? "";
    return (
      window.TourAiForms?.isValidEmail(email) === true &&
      window.TourAiForms?.isWebEmailVerified(email) === true &&
      getPrivacyInput()?.checked === true
    );
  }

  function handleAlreadySubscribedNotice(platform) {
    const email = getEmailInput()?.value?.trim().toLowerCase() ?? "";
    const noticeKey = `${email}:${platform}`;
    alreadySubscribedToPlatform = true;
    if (alreadySubscribedNoticeKey === noticeKey) {
      validateSubscriptionForm();
      return;
    }

    alreadySubscribedNoticeKey = noticeKey;
    showAlreadySubscribedFeedback(platform);
    validateSubscriptionForm();
  }

  function syncSubscriptionEmailState() {
    const email = getEmailInput()?.value?.trim() ?? "";
    const platform = getCurrentPlatform();

    window.TourAiForms?.scheduleEmailRegistrationCheck(email, {
      context: "subscribe",
      platform,
      getEmail: () => getEmailInput()?.value ?? "",
      onAlreadySubscribed: handleAlreadySubscribedNotice,
      onStateChange: validateSubscriptionForm,
    });
  }

  function validateSubscriptionForm() {
    const email = getEmailInput()?.value?.trim() ?? "";
    const privacy = getPrivacyInput()?.checked === true;
    const button = getSubmitButton();
    const isEmailValid = window.TourAiForms?.isValidEmail(email) ?? false;
    const isEmailVerified = window.TourAiForms?.isWebEmailVerified(email) ?? false;
    const canSubmit =
      isEmailValid && isEmailVerified && privacy && !alreadySubscribedToPlatform;

    if (!isEmailValid) {
      alreadySubscribedNoticeKey = null;
      alreadySubscribedToPlatform = false;
      window.TourAiForms?.clearWebEmailVerification();
      window.TourAiForms?.resetEmailRegistrationCheck();
      setVerificationBoxState({ visible: false, verified: false, showVerifyButton: false });
    } else {
      applySubscriptionVerificationBox(email);
    }

    if (button) {
      button.disabled = !canSubmit;
      button.setAttribute("aria-disabled", canSubmit ? "false" : "true");
    }
  }

  function openPlatformModal(platform) {
    if (isBusy()) {
      return;
    }

    const platformEl = document.getElementById(activeConfig.platformId);
    if (platformEl) {
      platformEl.innerText = platform;
    }

    const locale = window.TourAiI18n?.getLocale() ?? "es-ES";
    const intro = document.getElementById(activeConfig.introId);
    if (intro && window.TourAiI18n) {
      const template = intro.getAttribute("data-default-text") ?? intro.textContent ?? "";
      const translated = window.TourAiI18n.t("index.modal.text", locale, { platform });
      intro.textContent = (translated ?? template).replace("{platform}", platform);
    }

    window.TourAiForms?.clearWebEmailVerification();
    window.TourAiForms?.resetEmailRegistrationCheck();
    alreadySubscribedNoticeKey = null;
    alreadySubscribedToPlatform = false;
    const form = document.getElementById(activeConfig.formId);
    form?.reset();
    const submitBtn = getSubmitButton();
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute("aria-disabled", "true");
    }
    document.getElementById(activeConfig.modalId).style.display = "block";
    validateSubscriptionForm();
  }

  function closePlatformModal() {
    document.getElementById(activeConfig.modalId).style.display = "none";
    if (activeConfig.termsBoxId) {
      const termsBox = document.getElementById(activeConfig.termsBoxId);
      if (termsBox) {
        termsBox.style.display = "none";
      }
    }
  }

  async function handleSubscription(event) {
    event.preventDefault();
    if (isBusy()) {
      return;
    }

    validateSubscriptionForm();

    const email = getEmailInput()?.value?.trim() ?? "";
    const privacy = getPrivacyInput()?.checked === true;
    const platform = document.getElementById(activeConfig.platformId)?.innerText ?? "Web";
    const button = getSubmitButton();
    const originalText = tOr("index.modal.submit", button?.textContent ?? "Activar Alerta");

    if (!window.TourAiForms?.isValidEmail(email)) {
      window.TourAiFeedback?.show({
        type: "info",
        message: tOr("contact.email.invalid", "Introduce una dirección de correo válida."),
      });
      return;
    }

    if (!window.TourAiForms.isWebEmailVerified(email)) {
      window.TourAiFeedback?.show({
        type: "info",
        message: tOr("contact.error.notVerified", "Debes verificar tu correo antes de continuar."),
        onClose: () => startVerification(),
      });
      return;
    }

    if (!privacy) {
      window.TourAiFeedback?.show({
        type: "info",
        message: tOr(
          "index.modal.privacyRequired",
          "Debes aceptar el envío de avisos y la política de privacidad para continuar."
        ),
      });
      return;
    }

    if (!canSubmitSubscription()) {
      return;
    }

    try {
      button.disabled = true;
      button.textContent = tOr("index.modal.submitting", "ACTIVANDO...");
      const result = await window.TourAiForms.submitSubscription({
        name: "Launch alert",
        email,
        subject: "Launch alert - " + platform,
        platform,
        message: "User requested launch notification for " + platform,
        privacy,
      });

      if (result.ok) {
        closePlatformModal();
        document.getElementById(activeConfig.formId)?.reset();
        window.TourAiForms.clearWebEmailVerification();
        window.TourAiFeedback?.show({
          type: "success",
          title: tOr("index.modal.successTitle", "¡Alerta activada!"),
          message: tOr(
            "index.modal.success",
            "Te avisaremos en cuanto la app esté disponible en la tienda."
          ),
        });
      } else if (result.error === "already_subscribed") {
        showAlreadySubscribedFeedback(result.body?.platform ?? platform);
      } else {
        const errorMessages = {
          email_not_verified: tOr("contact.error.notVerified", "Debes verificar tu correo antes de continuar."),
          smtp_not_configured: tOr("contact.error.smtp", "El servicio no está disponible temporalmente."),
        };
        throw new Error(errorMessages[result.error] ?? tOr("index.modal.error", "Hubo un error al procesar tu suscripción."));
      }
    } catch (error) {
      const shouldVerify = (error.message || "").toLowerCase().includes("verificar");
      window.TourAiFeedback?.show({
        type: "error",
        message: error.message || tOr("index.modal.error", "Hubo un error al procesar tu suscripción."),
        onClose: shouldVerify ? () => startVerification() : undefined,
      });
    } finally {
      button.textContent = originalText;
      validateSubscriptionForm();
    }
  }

  window.TourAiStoreSubscription = {
    init(config) {
      activeConfig = config;
      ensureCodeModal();

      window.openModal = openPlatformModal;
      window.closeModal = closePlatformModal;
      window.validateSubscriptionForm = validateSubscriptionForm;
      window.handleSubscription = handleSubscription;
      window.startSubscriptionEmailVerification = startVerification;

      const emailInput = getEmailInput();
      emailInput?.addEventListener("input", function () {
        window.TourAiForms?.onWebEmailInput(this.value);
        alreadySubscribedNoticeKey = null;
        alreadySubscribedToPlatform = false;
        validateSubscriptionForm();
        syncSubscriptionEmailState();
      });
      emailInput?.addEventListener("change", syncSubscriptionEmailState);
      emailInput?.addEventListener("blur", syncSubscriptionEmailState);
      getPrivacyInput()?.addEventListener("change", validateSubscriptionForm);
      getPrivacyInput()?.addEventListener("click", validateSubscriptionForm);
      document
        .getElementById(activeConfig.sendVerificationBtnId)
        ?.addEventListener("click", startVerification);

      document
        .getElementById(activeConfig.modalId)
        ?.querySelector(".close")
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          closePlatformModal();
        });

      window.addEventListener("click", (event) => {
        const modal = document.getElementById(activeConfig.modalId);
        if (event.target === modal) {
          closePlatformModal();
        }
      });
    },
  };
})();
