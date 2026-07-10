(function () {
  const MODAL_ID = "storeUnsubscribeModal";

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

  function isBusy() {
    return window.TourAiLoading?.isVisible?.() === true;
  }

  let loadedStatusEmail = null;

  function applyUnsubscribeVerificationBox(email) {
    window.TourAiForms?.applyEmailVerificationBox(
      email,
      {
        boxId: "unsubVerificationBox",
        messageId: "unsubVerificationMessage",
        sendButtonId: "unsubSendVerificationBtn",
      },
      "unsubscribe"
    );
  }

  function getSelectedPlatforms() {
    const platforms = [];
    const iosInput = document.getElementById("unsubIos");
    const androidInput = document.getElementById("unsubAndroid");

    if (iosInput?.checked && !iosInput.disabled) {
      platforms.push("iOS");
    }
    if (androidInput?.checked && !androidInput.disabled) {
      platforms.push("Android");
    }

    return platforms;
  }

  function resetLoadedStatus() {
    loadedStatusEmail = null;
  }

  function getEmailInput() {
    return document.getElementById("unsubEmail");
  }

  function ensureModal() {
    if (document.getElementById(MODAL_ID)) {
      return;
    }

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-content store-unsubscribe-content">
        <span class="close" data-close-unsub role="button" aria-label="Cerrar">&times;</span>
        <h3 style="color: var(--primary);" data-i18n="unsubscribe.title">Gestionar alertas de lanzamiento</h3>
        <p data-i18n="unsubscribe.intro">Introduce tu correo para verificar tu identidad y cancelar las alertas de App Store o Google Play.</p>
        <form id="unsubForm" onsubmit="return false;" novalidate>
          <input type="email" id="unsubEmail" name="email" autocomplete="email" data-i18n-placeholder="index.modal.email" placeholder="Tu correo electrónico">
          <div id="unsubVerificationBox" class="verification-box">
            <p id="unsubVerificationMessage" data-i18n="contact.verify.prompt">Verifica tu correo para continuar.</p>
            <div class="verification-actions">
              <button type="button" id="unsubSendVerificationBtn" data-i18n="contact.verify.button">VERIFICAR CORREO</button>
            </div>
          </div>
          <div id="unsubCodeSection" class="unsub-code-section" hidden>
            <label for="unsubCodeInput" data-i18n="contact.verify.code">Código de verificación</label>
            <input type="text" id="unsubCodeInput" class="verification-code-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code" data-i18n-placeholder="contact.verify.code.placeholder" placeholder="000000">
            <p id="unsubCodeStatus" class="verification-status" hidden></p>
            <div class="verification-actions">
              <button type="button" id="unsubConfirmCodeBtn" data-i18n="contact.verify.submit">Confirmar código</button>
              <button type="button" id="unsubResendCodeBtn" class="link-button" data-i18n="contact.verify.resend">Reenviar código</button>
            </div>
          </div>
          <div id="unsubManageSection" class="unsub-manage-section" hidden>
            <p data-i18n="unsubscribe.selectStores">Selecciona las tiendas de las que quieres darte de baja:</p>
            <label class="unsub-store-option">
              <input type="checkbox" id="unsubIos" value="iOS">
              <span data-i18n="unsubscribe.store.ios">App Store (iOS)</span>
            </label>
            <label class="unsub-store-option">
              <input type="checkbox" id="unsubAndroid" value="Android">
              <span data-i18n="unsubscribe.store.android">Google Play (Android)</span>
            </label>
            <p id="unsubNoSubscriptions" class="unsub-empty-message" hidden data-i18n="unsubscribe.none">No tienes alertas activas con este correo.</p>
            <button type="button" id="unsubSubmitBtn" disabled data-i18n="unsubscribe.submit">Darme de baja</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector("[data-close-unsub]")?.addEventListener("click", (event) => {
      event.preventDefault();
      closeModal();
    });

    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });

    modal.querySelector(".modal-content").addEventListener("click", (event) => {
      event.stopPropagation();
    });

    const codeInput = document.getElementById("unsubCodeInput");
    codeInput.addEventListener("input", function () {
      this.value = this.value.replace(/\D/g, "").slice(0, 6);
    });
    codeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        confirmCode();
      }
    });

    document.getElementById("unsubSendVerificationBtn").addEventListener("click", startVerification);
    document.getElementById("unsubConfirmCodeBtn").addEventListener("click", confirmCode);
    document.getElementById("unsubResendCodeBtn").addEventListener("click", resendCode);
    document.getElementById("unsubSubmitBtn").addEventListener("click", submitUnsubscribe);
    getEmailInput()?.addEventListener("input", function () {
      window.TourAiForms?.onWebEmailInput(this.value);
      resetManageSection();
      updateVerificationBox();
      scheduleUnsubscribeEmailCheck();
    });
    getEmailInput()?.addEventListener("blur", scheduleUnsubscribeEmailCheck);

    ["unsubIos", "unsubAndroid"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", updateUnsubscribeButton);
    });
  }

  function setVerificationBoxState({ visible, verified, showVerifyButton }) {
    window.TourAiForms?.renderEmailVerificationBox(
      {
        boxId: "unsubVerificationBox",
        messageId: "unsubVerificationMessage",
        sendButtonId: "unsubSendVerificationBtn",
      },
      { visible, verified, showVerifyButton }
    );
  }

  function showCodeStatus(message, type) {
    const status = document.getElementById("unsubCodeStatus");
    status.textContent = message;
    status.className = "verification-status " + (type ?? "");
    status.hidden = false;
  }

  function resetManageSection() {
    resetLoadedStatus();
    const manageSection = document.getElementById("unsubManageSection");
    const codeSection = document.getElementById("unsubCodeSection");
    manageSection.hidden = true;
    codeSection.hidden = true;
    document.getElementById("unsubCodeInput").value = "";
    document.getElementById("unsubCodeStatus").hidden = true;
    document.getElementById("unsubNoSubscriptions").hidden = true;
    document.getElementById("unsubIos").checked = false;
    document.getElementById("unsubAndroid").checked = false;
    document.getElementById("unsubIos").disabled = true;
    document.getElementById("unsubAndroid").disabled = true;
    updateUnsubscribeButton();
  }

  function updateVerificationBox() {
    const email = getEmailInput()?.value?.trim().toLowerCase() ?? "";
    const isEmailValid = window.TourAiForms?.isValidEmail(email) ?? false;

    if (!isEmailValid) {
      window.TourAiForms?.clearWebEmailVerification();
      window.TourAiForms?.resetEmailRegistrationCheck();
      setVerificationBoxState({ visible: false, verified: false, showVerifyButton: false });
      resetManageSection();
      return;
    }

    applyUnsubscribeVerificationBox(email);

    if (window.TourAiForms?.isWebEmailVerified(email)) {
      loadSubscriptionStatus().catch(() => undefined);
    } else {
      resetManageSection();
    }
  }

  function scheduleUnsubscribeEmailCheck() {
    const email = getEmailInput()?.value?.trim() ?? "";
    window.TourAiForms?.scheduleEmailRegistrationCheck(email, {
      context: "unsubscribe",
      getEmail: () => getEmailInput()?.value ?? "",
      onStateChange: updateVerificationBox,
      onCheckComplete: async () => {
        const normalized = getEmailInput()?.value?.trim().toLowerCase() ?? "";
        if (window.TourAiForms?.isWebEmailVerified(normalized)) {
          await loadSubscriptionStatus();
        }
      },
    });
  }

  function updateUnsubscribeButton() {
    const button = document.getElementById("unsubSubmitBtn");
    const canSubmit = getSelectedPlatforms().length > 0;
    if (button) {
      button.disabled = !canSubmit;
    }
  }

  async function loadSubscriptionStatus() {
    const email = getEmailInput()?.value?.trim().toLowerCase() ?? "";
    if (!window.TourAiForms?.isWebEmailVerified(email)) {
      return;
    }

    if (loadedStatusEmail === email) {
      return;
    }

    const result = await window.TourAiForms.checkStoreSubscription(email, null, {
      loading: false,
    });
    if (!result.ok) {
      throw new Error(tOr("unsubscribe.statusError", "No se pudo comprobar tus alertas. Inténtalo de nuevo."));
    }

    const subscriptions = result.body?.subscriptions ?? {};
    const iosActive = subscriptions.iOS === true;
    const androidActive = subscriptions.Android === true;
    const manageSection = document.getElementById("unsubManageSection");
    const noSubscriptions = document.getElementById("unsubNoSubscriptions");
    const iosInput = document.getElementById("unsubIos");
    const androidInput = document.getElementById("unsubAndroid");

    iosInput.disabled = !iosActive;
    androidInput.disabled = !androidActive;
    iosInput.checked = false;
    androidInput.checked = false;

    if (!iosActive && !androidActive) {
      manageSection.hidden = false;
      noSubscriptions.hidden = false;
      document.getElementById("unsubSubmitBtn").disabled = true;
      loadedStatusEmail = email;
      return;
    }

    manageSection.hidden = false;
    noSubscriptions.hidden = true;
    loadedStatusEmail = email;
    updateUnsubscribeButton();
  }

  async function startVerification() {
    if (isBusy()) {
      return;
    }

    const email = getEmailInput()?.value?.trim() ?? "";
    const button = document.getElementById("unsubSendVerificationBtn");
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

      document.getElementById("unsubCodeSection").hidden = false;
      showCodeStatus(
        tOr("contact.verify.sent", "Código enviado. Revisa tu bandeja de entrada y spam."),
        "success"
      );
      document.getElementById("unsubCodeInput").focus();
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
      updateVerificationBox();
    }
  }

  async function resendCode() {
    if (isBusy()) {
      return;
    }

    const button = document.getElementById("unsubResendCodeBtn");
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
      showCodeStatus(
        tOr("contact.verify.resent", "Se ha enviado un nuevo código."),
        "success"
      );
    } catch (error) {
      showCodeStatus(error.message, "error");
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
    const code = document.getElementById("unsubCodeInput")?.value?.trim() ?? "";
    const button = document.getElementById("unsubConfirmCodeBtn");
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
        showCodeStatus(tOr(entry[0], entry[1]), "error");
        return;
      }

      document.getElementById("unsubCodeSection").hidden = true;
      updateVerificationBox();
      await loadSubscriptionStatus();
    } catch (error) {
      showCodeStatus(
        tOr("contact.verify.invalidCode", "El código no es correcto. Inténtalo de nuevo."),
        "error"
      );
    } finally {
      button.textContent = originalText;
      button.disabled = false;
    }
  }

  async function submitUnsubscribe() {
    if (isBusy()) {
      window.TourAiFeedback?.show({
        type: "info",
        message: tOr("loading.processing", "Procesando..."),
      });
      return;
    }

    const email = getEmailInput()?.value?.trim() ?? "";
    const platforms = getSelectedPlatforms();

    if (!window.TourAiForms?.isWebEmailVerified(email)) {
      window.TourAiFeedback?.show({
        type: "info",
        message: tOr("contact.error.notVerified", "Debes verificar tu correo antes de continuar."),
      });
      return;
    }

    if (platforms.length === 0) {
      window.TourAiFeedback?.show({
        type: "info",
        message: tOr(
          "unsubscribe.selectRequired",
          "Marca al menos una tienda de la que quieras darte de baja."
        ),
      });
      return;
    }

    const button = document.getElementById("unsubSubmitBtn");
    const originalText = tOr("unsubscribe.submit", button?.textContent ?? "Darme de baja");

    try {
      button.disabled = true;
      button.textContent = tOr("unsubscribe.submitting", "PROCESANDO...");
      const result = await window.TourAiForms.unsubscribeStoreNotifications(email, platforms);
      if (result.ok) {
        resetLoadedStatus();
        closeModal();
        window.TourAiForms.clearWebEmailVerification();
        window.TourAiFeedback?.show({
          type: "success",
          title: tOr("unsubscribe.successTitle", "Baja completada"),
          message: tOr(
            "unsubscribe.success",
            "Hemos cancelado las alertas seleccionadas. Ya no recibirás avisos de esas tiendas."
          ),
        });
        return;
      }

      if (result.error === "not_subscribed") {
        window.TourAiFeedback?.show({
          type: "info",
          message: tOr("unsubscribe.none", "No tienes alertas activas con este correo."),
        });
        await loadSubscriptionStatus();
        return;
      }

      if (result.error === "email_not_verified") {
        window.TourAiFeedback?.show({
          type: "info",
          message: tOr("contact.error.notVerified", "Debes verificar tu correo antes de continuar."),
          onClose: () => startVerification(),
        });
        return;
      }

      throw new Error(tOr("unsubscribe.error", "No se pudo completar la baja. Inténtalo de nuevo."));
    } catch (error) {
      window.TourAiFeedback?.show({
        type: "error",
        message: error.message || tOr("unsubscribe.error", "No se pudo completar la baja. Inténtalo de nuevo."),
      });
    } finally {
      button.textContent = originalText;
      updateUnsubscribeButton();
    }
  }

  function openModal() {
    ensureModal();
    if (typeof window.closeModal === "function") {
      window.closeModal();
    }

    window.TourAiForms?.clearWebEmailVerification();
    window.TourAiForms?.resetEmailRegistrationCheck();
    document.getElementById("unsubForm")?.reset();
    resetManageSection();
    updateVerificationBox();

    const modal = document.getElementById(MODAL_ID);
    modal.style.display = "block";

    if (window.TourAiI18n?.applyTranslations) {
      window.TourAiI18n.applyTranslations(window.TourAiI18n.getLocale());
    }
  }

  function closeModal() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) {
      modal.style.display = "none";
    }
  }

  window.TourAiStoreUnsubscribe = {
    init() {
      ensureModal();
      window.openStoreUnsubscribe = openModal;
      window.closeStoreUnsubscribe = closeModal;
    },
  };
})();
