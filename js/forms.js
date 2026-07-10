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
