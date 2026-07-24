(function () {
  const config = window.TourAiSite?.config;
  if (!config) {
    return;
  }

  const VERIFIED_EMAILS_STORAGE_KEY = "tourai-web-verified-emails";
  const TRUSTED_SUBSCRIBER_TOKEN = "__trusted_store_subscriber__";
  const VERIFICATION_STORAGE_TTL_MS = 30 * 60 * 1000;

  const contactVerificationState = {
    token: null,
    verifiedEmail: null,
    trustedSubscriber: false,
  };

  const emailRegistrationCheck = {
    email: null,
    status: null,
    requestId: 0,
    timeout: null,
  };

  function resetEmailRegistrationCheck() {
    emailRegistrationCheck.email = null;
    emailRegistrationCheck.status = null;
    if (emailRegistrationCheck.timeout) {
      clearTimeout(emailRegistrationCheck.timeout);
      emailRegistrationCheck.timeout = null;
    }
  }

  function resolveEmailVerificationUi(email, options) {
    const normalized = (email ?? "").trim().toLowerCase();

    if (!window.TourAiForms.isValidEmail(normalized)) {
      return { visible: false, verified: false, showVerifyButton: false };
    }

    if (window.TourAiForms.isWebEmailVerified(normalized)) {
      return {
        visible: true,
        verified: true,
        showVerifyButton: false,
        messageKey: "contact.verify.success",
        messageFallback: "Correo verificado correctamente.",
      };
    }

    const check = emailRegistrationCheck;
    if (check.email !== normalized || !check.status || check.status === "checking") {
      return { visible: false, verified: false, showVerifyButton: false };
    }

    return {
      visible: true,
      verified: false,
      showVerifyButton: true,
    };
  }

  function tOrVerification(key, fallback) {
    const locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    return window.TourAiI18n?.tOr?.(key, locale, null, fallback) ?? fallback;
  }

  function getEmailCheckLoadingMessage(context) {
    if (context === "unsubscribe") {
      return tOrVerification(
        "unsubscribe.checkingEmail",
        "Comprobando si tienes alertas activas..."
      );
    }

    return tOrVerification("contact.verify.checkingEmail", "Comprobando tu correo...");
  }

  function renderEmailVerificationBox(config, ui) {
    const box = document.getElementById(config.boxId);
    const message = document.getElementById(config.messageId);
    const sendBtn = document.getElementById(config.sendButtonId);
    const actions = box?.querySelector(".verification-actions");

    if (!box || !ui) {
      return;
    }

    if (!ui.visible) {
      box.classList.remove("visible", "verified", "button-only");
      return;
    }

    box.classList.add("visible");
    box.classList.toggle("verified", !!ui.verified);
    box.classList.toggle("button-only", !!ui.showVerifyButton && !ui.verified);

    if (message) {
      message.hidden = !ui.verified;
      if (ui.verified && ui.messageKey) {
        message.textContent = tOrVerification(ui.messageKey, ui.messageFallback);
      }
    }

    if (actions) {
      actions.style.display = ui.showVerifyButton ? "flex" : "none";
    }
    if (sendBtn) {
      sendBtn.style.display = ui.showVerifyButton ? "inline-block" : "none";
    }
  }

  function applyEmailVerificationBox(email, config, context) {
    const ui = resolveEmailVerificationUi(email, { context });
    renderEmailVerificationBox(config, ui);
  }

  function scheduleEmailRegistrationCheck(email, options) {
    const normalized = (email ?? "").trim().toLowerCase();
    const settings = options ?? {};

    if (emailRegistrationCheck.timeout) {
      clearTimeout(emailRegistrationCheck.timeout);
      emailRegistrationCheck.timeout = null;
    }

    if (!window.TourAiForms.isValidEmail(normalized)) {
      resetEmailRegistrationCheck();
      settings.onStateChange?.();
      return;
    }

    if (
      contactVerificationState.verifiedEmail !== normalized &&
      restoreVerificationFromStorage(normalized)
    ) {
      emailRegistrationCheck.email = normalized;
      emailRegistrationCheck.status = "checked";
      settings.onStateChange?.();
      return;
    }

    if (window.TourAiForms.isWebEmailVerified(normalized)) {
      emailRegistrationCheck.email = normalized;
      emailRegistrationCheck.status = "checked";
      settings.onStateChange?.();
      return;
    }

    emailRegistrationCheck.timeout = setTimeout(async () => {
      emailRegistrationCheck.timeout = null;
      const requestId = ++emailRegistrationCheck.requestId;
      let loadingShown = false;

      emailRegistrationCheck.email = normalized;
      emailRegistrationCheck.status = "checking";
      settings.onStateChange?.();

      if (window.TourAiLoading) {
        window.TourAiLoading.show(getEmailCheckLoadingMessage(settings.context));
        loadingShown = true;
      }

      try {
        const result = await window.TourAiForms.previewStoreSubscriptionStatus(
          normalized,
          settings.platform
        );

        if (requestId !== emailRegistrationCheck.requestId) {
          return;
        }

        const currentEmail = (settings.getEmail?.() ?? normalized).trim().toLowerCase();
        if (currentEmail !== normalized) {
          return;
        }

        emailRegistrationCheck.status = "checked";

        if (result.ok && result.body?.knownSubscriber) {
          window.TourAiForms.markTrustedSubscriberVerification(normalized);
        }

        if (settings.platform && result.ok && result.body?.subscribed) {
          settings.onAlreadySubscribed?.(result.body.platform ?? settings.platform);
        }

        settings.onStateChange?.();
        settings.onCheckComplete?.(result);
      } finally {
        if (loadingShown) {
          window.TourAiLoading.hide();
        }
      }
    }, settings.debounceMs ?? 400);
  }

  function loadVerifiedEmailsFromStorage() {
    try {
      const raw = sessionStorage.getItem(VERIFIED_EMAILS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveVerifiedEmailToStorage(email, token, expiresAt) {
    const entries = loadVerifiedEmailsFromStorage();
    entries[email] = { token, expiresAt };
    sessionStorage.setItem(VERIFIED_EMAILS_STORAGE_KEY, JSON.stringify(entries));
  }

  function removeVerifiedEmailFromStorage(email) {
    const entries = loadVerifiedEmailsFromStorage();
    delete entries[email];
    sessionStorage.setItem(VERIFIED_EMAILS_STORAGE_KEY, JSON.stringify(entries));
  }

  function restoreVerificationFromStorage(email) {
    const normalized = (email ?? "").trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    const entries = loadVerifiedEmailsFromStorage();
    const entry = entries[normalized];
    if (!entry?.token || !entry.expiresAt || entry.expiresAt <= Date.now()) {
      if (entry) {
        removeVerifiedEmailFromStorage(normalized);
      }
      return false;
    }

    contactVerificationState.token = entry.token;
    contactVerificationState.verifiedEmail = normalized;
    contactVerificationState.trustedSubscriber = entry.token === TRUSTED_SUBSCRIBER_TOKEN;
    return true;
  }

  function markTrustedSubscriberVerification(email) {
    const normalized = (email ?? "").trim().toLowerCase();
    contactVerificationState.token = TRUSTED_SUBSCRIBER_TOKEN;
    contactVerificationState.verifiedEmail = normalized;
    contactVerificationState.trustedSubscriber = true;
    saveVerifiedEmailToStorage(
      normalized,
      TRUSTED_SUBSCRIBER_TOKEN,
      Date.now() + VERIFICATION_STORAGE_TTL_MS
    );
  }

  function persistVerificationToken(email, token) {
    const normalized = (email ?? "").trim().toLowerCase();
    contactVerificationState.token = token;
    contactVerificationState.verifiedEmail = normalized;
    contactVerificationState.trustedSubscriber = false;
    saveVerifiedEmailToStorage(
      normalized,
      token,
      Date.now() + VERIFICATION_STORAGE_TTL_MS
    );
  }

  async function postJson(url, payload, options) {
    const execute = async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (!response.ok) {
        return {
          ok: false,
          error: body?.error ?? "request_failed",
          status: response.status,
          body,
        };
      }

      if (body && body.success === false) {
        return {
          ok: false,
          error: body.error ?? "unknown_error",
          status: response.status,
          body,
        };
      }

      return { ok: true, body };
    };

    if (window.TourAiLoading && options?.loading !== false) {
      return window.TourAiLoading.run(execute);
    }

    return execute();
  }

  function getLocaleCulture() {
    const locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    return locale === "en-GB" ? "en-GB" : "es-ES";
  }

  window.TourAiForms = {
    isValidEmail(email) {
      const value = (email ?? "").trim();
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
    },

    isWebEmailVerified(email) {
      const normalized = (email ?? "").trim().toLowerCase();
      if (!normalized) {
        return false;
      }

      if (
        contactVerificationState.verifiedEmail !== normalized &&
        !restoreVerificationFromStorage(normalized)
      ) {
        return false;
      }

      return (
        !!contactVerificationState.token &&
        contactVerificationState.verifiedEmail === normalized
      );
    },

    isContactEmailVerified(email) {
      return window.TourAiForms.isWebEmailVerified(email);
    },

    isTrustedStoreSubscriber(email) {
      const normalized = (email ?? "").trim().toLowerCase();
      return (
        window.TourAiForms.isWebEmailVerified(normalized) &&
        contactVerificationState.trustedSubscriber === true &&
        contactVerificationState.verifiedEmail === normalized
      );
    },

    getWebEmailVerificationToken(email) {
      const normalized = (email ?? "").trim().toLowerCase();
      if (!window.TourAiForms.isWebEmailVerified(normalized)) {
        return null;
      }

      if (contactVerificationState.trustedSubscriber) {
        return null;
      }

      return contactVerificationState.token;
    },

    getContactVerificationToken(email) {
      return window.TourAiForms.getWebEmailVerificationToken(email);
    },

    markTrustedSubscriberVerification(email) {
      markTrustedSubscriberVerification(email);
    },

    clearWebEmailVerification() {
      const previousEmail = contactVerificationState.verifiedEmail;
      contactVerificationState.token = null;
      contactVerificationState.verifiedEmail = null;
      contactVerificationState.trustedSubscriber = false;
      if (previousEmail) {
        removeVerifiedEmailFromStorage(previousEmail);
      }
    },

    clearContactEmailVerification() {
      window.TourAiForms.clearWebEmailVerification();
    },

    onWebEmailInput(email) {
      const normalized = (email ?? "").trim().toLowerCase();
      if (
        contactVerificationState.verifiedEmail &&
        contactVerificationState.verifiedEmail !== normalized
      ) {
        window.TourAiForms.clearWebEmailVerification();
        resetEmailRegistrationCheck();
      }
    },

    onContactEmailInput(email) {
      window.TourAiForms.onWebEmailInput(email);
    },

    async previewStoreSubscriptionStatus(email, platform) {
      const normalized = (email ?? "").trim().toLowerCase();
      if (!window.TourAiForms.isValidEmail(normalized)) {
        return { ok: false, error: "invalid_email" };
      }

      const payload = { email: normalized };
      if (platform) {
        payload.platform = platform;
      }

      return postJson(config.checkStoreSubscriptionUrl, payload, { loading: false });
    },

    resolveEmailVerificationUi(email, options) {
      return resolveEmailVerificationUi(email, options);
    },

    renderEmailVerificationBox(config, ui) {
      renderEmailVerificationBox(config, ui);
    },

    applyEmailVerificationBox(email, config, context) {
      applyEmailVerificationBox(email, config, context);
    },

    resetEmailRegistrationCheck() {
      resetEmailRegistrationCheck();
    },

    scheduleEmailRegistrationCheck(email, options) {
      scheduleEmailRegistrationCheck(email, options);
    },

    syncWebEmailVerification(email, options) {
      const settings = options ?? {};
      if (!settings.getEmail) {
        settings.getEmail = () => email;
      }
      scheduleEmailRegistrationCheck(email, settings);
    },

    async sendWebEmailVerificationCode(email) {
      const normalized = (email ?? "").trim().toLowerCase();
      if (!window.TourAiForms.isValidEmail(normalized)) {
        return { ok: false, error: "invalid_email" };
      }

      return postJson(config.contactSendVerificationUrl, {
        email: normalized,
        culture: getLocaleCulture(),
      });
    },

    async sendContactVerificationCode(email) {
      return window.TourAiForms.sendWebEmailVerificationCode(email);
    },

    async verifyWebEmailCode(email, code) {
      const normalized = (email ?? "").trim().toLowerCase();
      const trimmedCode = (code ?? "").trim();

      if (!window.TourAiForms.isValidEmail(normalized) || !/^\d{6}$/.test(trimmedCode)) {
        return { ok: false, error: "invalid_payload" };
      }

      const result = await postJson(config.contactVerifyCodeUrl, {
        email: normalized,
        code: trimmedCode,
      });

      if (result.ok && result.body?.verificationToken) {
        persistVerificationToken(normalized, result.body.verificationToken);
      }

      return result;
    },

    async verifyContactCode(email, code) {
      return window.TourAiForms.verifyWebEmailCode(email, code);
    },

    async submitContact(form) {
      const name = form.querySelector("[name='name']")?.value?.trim() ?? "";
      const email = form.querySelector("[name='email']")?.value?.trim() ?? "";
      const subject = form.querySelector("[name='subject']")?.value?.trim() ?? "Web contact";
      const message = form.querySelector("[name='message']")?.value?.trim() ?? "";
      const privacy = form.querySelector("[name='privacy']")?.checked === true;

      if (!name || !email || !message || !privacy) {
        return { ok: false, error: "invalid_payload" };
      }

      if (!window.TourAiForms.isValidEmail(email)) {
        return { ok: false, error: "invalid_email" };
      }

      if (!window.TourAiForms.isWebEmailVerified(email)) {
        return { ok: false, error: "email_not_verified" };
      }

      const payload = {
        name,
        email,
        subject,
        message,
        privacy,
      };

      const verificationToken = window.TourAiForms.getContactVerificationToken(email);
      if (verificationToken) {
        payload.verificationToken = verificationToken;
      }

      return postJson(config.contactFormUrl, payload);
    },

    async submitSubscription(payload) {
      const email = payload.email?.trim() ?? "";
      if (!email || payload.privacy !== true) {
        return { ok: false, error: "invalid_payload" };
      }

      if (!window.TourAiForms.isValidEmail(email)) {
        return { ok: false, error: "invalid_email" };
      }

      if (!window.TourAiForms.isWebEmailVerified(email)) {
        return { ok: false, error: "email_not_verified" };
      }

      const requestPayload = {
        name: payload.name ?? "TourAI subscription",
        email,
        subject: payload.subject ?? "TourAI launch alert",
        platform: payload.platform ?? "Web",
        message: payload.message ?? "",
        privacy: true,
      };

      const verificationToken = window.TourAiForms.getWebEmailVerificationToken(email);
      if (verificationToken) {
        requestPayload.verificationToken = verificationToken;
      }

      return postJson(config.subscribeFormUrl, requestPayload);
    },

    async checkStoreSubscription(email, platform, options) {
      const normalized = (email ?? "").trim().toLowerCase();
      if (!window.TourAiForms.isValidEmail(normalized)) {
        return { ok: false, error: "invalid_email" };
      }

      const payload = { email: normalized };
      const verificationToken = window.TourAiForms.getWebEmailVerificationToken(normalized);
      if (verificationToken) {
        payload.verificationToken = verificationToken;
      }

      if (platform) {
        payload.platform = platform;
      }

      return postJson(config.checkStoreSubscriptionUrl, payload, options);
    },

    async unsubscribeStoreNotifications(email, platforms) {
      const normalized = (email ?? "").trim().toLowerCase();
      if (!window.TourAiForms.isValidEmail(normalized)) {
        return { ok: false, error: "invalid_email" };
      }

      if (!Array.isArray(platforms) || platforms.length === 0) {
        return { ok: false, error: "invalid_payload" };
      }

      if (!window.TourAiForms.isWebEmailVerified(normalized)) {
        return { ok: false, error: "email_not_verified" };
      }

      const payload = {
        email: normalized,
        platforms,
      };

      const verificationToken = window.TourAiForms.getWebEmailVerificationToken(normalized);
      if (verificationToken) {
        payload.verificationToken = verificationToken;
      }

      return postJson(config.unsubscribeStoreNotificationsUrl, payload);
    },
  };
})();

(function () {
  const config = window.TourAiSite?.config;
  if (!config) {
    return;
  }

  const VERIFIED_STORAGE_KEY = "tourai-account-deletion-verified";
  const VERIFICATION_STORAGE_TTL_MS = 30 * 60 * 1000;

  const verificationState = {
    token: null,
    verifiedEmail: null,
  };

  function tOr(key, fallback) {
    const locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    return window.TourAiI18n?.tOr?.(key, locale, null, fallback) ?? fallback;
  }

  function isValidEmail(email) {
    return window.TourAiForms?.isValidEmail(email) ?? false;
  }

  function loadVerifiedFromStorage() {
    try {
      const raw = sessionStorage.getItem(VERIFIED_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveVerifiedToStorage(email, token, expiresAt) {
    const entries = loadVerifiedFromStorage();
    entries[email] = { token, expiresAt };
    sessionStorage.setItem(VERIFIED_STORAGE_KEY, JSON.stringify(entries));
  }

  function removeVerifiedFromStorage(email) {
    const entries = loadVerifiedFromStorage();
    delete entries[email];
    sessionStorage.setItem(VERIFIED_STORAGE_KEY, JSON.stringify(entries));
  }

  function restoreVerifiedFromStorage(email) {
    const normalized = (email ?? "").trim().toLowerCase();
    const entry = loadVerifiedFromStorage()[normalized];
    if (!entry?.token || !entry.expiresAt || entry.expiresAt <= Date.now()) {
      if (entry) {
        removeVerifiedFromStorage(normalized);
      }
      return false;
    }

    verificationState.token = entry.token;
    verificationState.verifiedEmail = normalized;
    return true;
  }

  function clearVerification() {
    const previousEmail = verificationState.verifiedEmail;
    verificationState.token = null;
    verificationState.verifiedEmail = null;
    if (previousEmail) {
      removeVerifiedFromStorage(previousEmail);
    }
  }

  function isEmailVerified(email) {
    const normalized = (email ?? "").trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    if (
      verificationState.verifiedEmail !== normalized &&
      !restoreVerifiedFromStorage(normalized)
    ) {
      return false;
    }

    return (
      !!verificationState.token &&
      verificationState.verifiedEmail === normalized
    );
  }

  async function postJson(url, payload) {
    const execute = async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (!response.ok) {
        return {
          ok: false,
          error: body?.error ?? "request_failed",
          status: response.status,
          body,
        };
      }

      if (body && body.success === false) {
        return {
          ok: false,
          error: body.error ?? "unknown_error",
          status: response.status,
          body,
        };
      }

      return { ok: true, body };
    };

    if (window.TourAiLoading) {
      return window.TourAiLoading.run(execute);
    }

    return execute();
  }

  function getLocaleCulture() {
    const locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    return locale === "en-GB" ? "en-GB" : "es-ES";
  }

  window.TourAiDeleteAccount = {
    onEmailInput(email) {
      const normalized = (email ?? "").trim().toLowerCase();
      if (
        verificationState.verifiedEmail &&
        verificationState.verifiedEmail !== normalized
      ) {
        clearVerification();
      }
    },

    isEmailVerified(email) {
      return isEmailVerified(email);
    },

    async sendVerificationCode(email) {
      const normalized = (email ?? "").trim().toLowerCase();
      if (!isValidEmail(normalized)) {
        return { ok: false, error: "invalid_email" };
      }

      return postJson(config.accountDeletionSendVerificationUrl, {
        email: normalized,
        culture: getLocaleCulture(),
      });
    },

    async verifyCode(email, code) {
      const normalized = (email ?? "").trim().toLowerCase();
      const trimmedCode = (code ?? "").trim();

      if (!isValidEmail(normalized) || !/^\d{6}$/.test(trimmedCode)) {
        return { ok: false, error: "invalid_payload" };
      }

      const result = await postJson(config.accountDeletionVerifyCodeUrl, {
        email: normalized,
        code: trimmedCode,
      });

      if (result.ok && result.body?.verificationToken) {
        verificationState.token = result.body.verificationToken;
        verificationState.verifiedEmail = normalized;
        saveVerifiedToStorage(
          normalized,
          result.body.verificationToken,
          Date.now() + VERIFICATION_STORAGE_TTL_MS
        );
      }

      return result;
    },

    async deleteAccount(email) {
      const normalized = (email ?? "").trim().toLowerCase();
      if (!isValidEmail(normalized)) {
        return { ok: false, error: "invalid_email" };
      }

      if (!isEmailVerified(normalized)) {
        return { ok: false, error: "email_not_verified" };
      }

      const result = await postJson(config.accountDeletionDeleteUrl, {
        email: normalized,
        verificationToken: verificationState.token,
        culture: getLocaleCulture(),
      });

      if (result.ok) {
        clearVerification();
      }

      return result;
    },

    tOr,
  };
})();

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

