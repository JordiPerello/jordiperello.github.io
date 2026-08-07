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

  const autoVerificationGate = {
    lastStartedEmail: null,
    inFlight: false,
  };

  function resetEmailRegistrationCheck() {
    emailRegistrationCheck.email = null;
    emailRegistrationCheck.status = null;
    if (emailRegistrationCheck.timeout) {
      clearTimeout(emailRegistrationCheck.timeout);
      emailRegistrationCheck.timeout = null;
    }
  }

  function resetAutoVerificationGate() {
    autoVerificationGate.lastStartedEmail = null;
    autoVerificationGate.inFlight = false;
  }

  function maybeStartAutoVerification(email, handler) {
    const normalized = (email ?? "").trim().toLowerCase();
    if (!normalized || typeof handler !== "function") {
      return;
    }
    if (autoVerificationGate.inFlight) {
      return;
    }
    if (autoVerificationGate.lastStartedEmail === normalized) {
      return;
    }
    if (window.TourAiForms.isWebEmailVerified(normalized)) {
      return;
    }

    autoVerificationGate.lastStartedEmail = normalized;
    autoVerificationGate.inFlight = true;
    Promise.resolve()
      .then(() => handler(normalized))
      .catch(() => {
        autoVerificationGate.lastStartedEmail = null;
      })
      .finally(() => {
        autoVerificationGate.inFlight = false;
      });
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
        messageFallback: "Email validado correctamente.",
      };
    }

    // No manual "verify email" CTA: unknown emails open the OTP modal automatically on blur.
    return { visible: false, verified: false, showVerifyButton: false };
  }

  function tOrVerification(key, fallback) {
    const locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    return window.TourAiI18n?.tOr?.(key, locale, null, fallback) ?? fallback;
  }

  function getEmailCheckLoadingMessage(context) {
    if (context === "unsubscribe") {
      return tOrVerification("unsubscribe.checkingEmail");
    }

    return tOrVerification("contact.verify.checkingEmail");
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
      if (actions) {
        actions.style.display = "none";
      }
      if (sendBtn) {
        sendBtn.style.display = "none";
      }
      return;
    }

    box.classList.add("visible");
    box.classList.toggle("verified", !!ui.verified);
    box.classList.remove("button-only");

    if (message) {
      if (ui.verified) {
        message.hidden = false;
        if (ui.messageKey) {
          message.textContent = tOrVerification(ui.messageKey, ui.messageFallback);
        }
      } else {
        message.hidden = true;
      }
    }

    if (actions) {
      actions.style.display = "none";
    }
    if (sendBtn) {
      sendBtn.style.display = "none";
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

    emailRegistrationCheck.email = normalized;
    emailRegistrationCheck.status = "pending";
    settings.onStateChange?.();

    emailRegistrationCheck.timeout = setTimeout(async () => {
      emailRegistrationCheck.timeout = null;
      const requestId = ++emailRegistrationCheck.requestId;
      let loadingShown = false;
      let shouldAutoVerify = false;

      emailRegistrationCheck.email = normalized;
      emailRegistrationCheck.status = "checking";
      settings.onStateChange?.();

      // Spinner only when leaving the field (blur) — avoid flashing while typing.
      if (window.TourAiLoading && settings.autoOpenVerification === true) {
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

        const isKnown = result.ok && result.body?.knownSubscriber === true;
        if (isKnown) {
          window.TourAiForms.markTrustedSubscriberVerification(normalized);
          autoVerificationGate.lastStartedEmail = null;
        }

        if (settings.platform && result.ok && result.body?.subscribed) {
          settings.onAlreadySubscribed?.(result.body.platform ?? settings.platform);
        }

        settings.onStateChange?.();
        settings.onCheckComplete?.(result);

        shouldAutoVerify =
          settings.autoOpenVerification === true &&
          !isKnown &&
          !window.TourAiForms.isWebEmailVerified(normalized);
      } catch {
        if (requestId !== emailRegistrationCheck.requestId) {
          return;
        }
        if (emailRegistrationCheck.email === normalized) {
          emailRegistrationCheck.status = "checked";
          settings.onStateChange?.();
          shouldAutoVerify = settings.autoOpenVerification === true;
        }
      } finally {
        if (loadingShown) {
          window.TourAiLoading.hide();
        }
        // Safety net: never leave this request stuck in "checking" after the spinner closes.
        if (
          requestId === emailRegistrationCheck.requestId &&
          emailRegistrationCheck.email === normalized &&
          emailRegistrationCheck.status === "checking"
        ) {
          emailRegistrationCheck.status = "checked";
          settings.onStateChange?.();
          if (settings.autoOpenVerification === true) {
            shouldAutoVerify = true;
          }
        }

        // Start OTP only after the check spinner is gone (handlers bail while loading is visible).
        if (
          shouldAutoVerify &&
          requestId === emailRegistrationCheck.requestId &&
          emailRegistrationCheck.email === normalized &&
          !window.TourAiForms.isWebEmailVerified(normalized)
        ) {
          maybeStartAutoVerification(normalized, settings.onNeedsVerification);
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

  function genericActionErrorMessage() {
    return tOrVerification("forms.error.generic");
  }

  function mapSendVerificationError(result) {
    if (!result || result.ok) {
      return null;
    }
    if (result.error === "smtp_not_configured") {
      return tOrVerification("contact.verify.sendError");
    }
    if (result.error === "forbidden_origin") {
      return tOrVerification("forms.error.generic");
    }
    return tOrVerification("contact.verify.sendError");
  }

  function isTechnicalErrorMessage(message) {
    return /failed to fetch|networkerror|load failed|network request failed|internal_error|network_error|request_failed|abort(ed)?|cors/i.test(
      String(message || "")
    );
  }

  /** Never surface browser/network internals (e.g. "Failed to fetch") to users. */
  function toUserFacingErrorMessage(error, fallbackMessage) {
    const fallback = fallbackMessage || genericActionErrorMessage();
    const message =
      typeof error === "string"
        ? error.trim()
        : typeof error?.message === "string"
          ? error.message.trim()
          : "";

    if (!message || isTechnicalErrorMessage(message)) {
      return fallback;
    }

    if (error && (error.name === "TypeError" || error.name === "NetworkError")) {
      return fallback;
    }

    return message;
  }

  /** Remaining wait as m:ss / mm:ss (matches app rate-limit UX). */
  function formatRetryAfterClock(retryAfterMs, retryAfterMinutes) {
    let ms = typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs)
      ? retryAfterMs
      : null;
    if (
      ms == null &&
      typeof retryAfterMinutes === "number" &&
      Number.isFinite(retryAfterMinutes)
    ) {
      ms = Math.max(1, retryAfterMinutes) * 60 * 1000;
    }
    if (ms == null || !Number.isFinite(ms)) {
      ms = 60 * 60 * 1000;
    }

    const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function rateLimitedMessage(result, key, fallback) {
    const hasRetryHint =
      (typeof result?.body?.retryAfterMs === "number" &&
        Number.isFinite(result.body.retryAfterMs)) ||
      (typeof result?.body?.retryAfterMinutes === "number" &&
        Number.isFinite(result.body.retryAfterMinutes));

    if (!hasRetryHint) {
      return tOrVerification("contact.verify.rateLimitedGeneric");
    }

    const time = formatRetryAfterClock(
      result.body.retryAfterMs,
      result.body.retryAfterMinutes
    );
    const locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    const template =
      window.TourAiI18n?.t?.(key, locale, { time }) ||
      window.TourAiI18n?.tOr?.(key, locale, { time }, fallback) ||
      fallback ||
      "";
    return String(template).split("{time}").join(time);
  }

  async function postJson(url, payload, options) {
    const execute = async () => {
      try {
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
      } catch {
        return { ok: false, error: "network_error", status: 0, body: null };
      }
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
        resetAutoVerificationGate();
      } else if (
        autoVerificationGate.lastStartedEmail &&
        autoVerificationGate.lastStartedEmail !== normalized
      ) {
        resetAutoVerificationGate();
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

      const result = await postJson(config.checkStoreSubscriptionUrl, { email: normalized }, { loading: false });
      if (!result.ok) {
        return result;
      }

      const ios = result.body?.ios === true;
      const android = result.body?.android === true;
      const normalizedPlatform = (platform ?? "").trim().toLowerCase();
      let subscribed = ios || android;
      if (normalizedPlatform === "ios") {
        subscribed = ios;
      } else if (normalizedPlatform === "android") {
        subscribed = android;
      }

      return {
        ok: true,
        body: {
          ...result.body,
          subscribed,
          platform: platform || undefined,
          subscriptions: { iOS: ios, Android: android },
        },
      };
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

    toUserFacingErrorMessage(error, fallbackMessage) {
      return toUserFacingErrorMessage(error, fallbackMessage);
    },

    rateLimitedMessage(result, key, fallback) {
      return rateLimitedMessage(result, key, fallback);
    },

    genericActionErrorMessage() {
      return genericActionErrorMessage();
    },

    mapSendVerificationError(result) {
      return mapSendVerificationError(result);
    },

    resetEmailRegistrationCheck() {
      resetEmailRegistrationCheck();
      resetAutoVerificationGate();
    },

    resetAutoVerificationGate() {
      resetAutoVerificationGate();
    },

    allowAutoVerificationRetry(email) {
      const normalized = (email ?? "").trim().toLowerCase();
      if (!normalized || autoVerificationGate.lastStartedEmail === normalized) {
        autoVerificationGate.lastStartedEmail = null;
      }
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

      const platform = (payload.platform ?? "").trim().toLowerCase();
      const ios = payload.ios === true || platform === "ios";
      const android = payload.android === true || platform === "android";
      if (!ios && !android) {
        return { ok: false, error: "invalid_payload" };
      }

      const requestPayload = {
        name: payload.name ?? "TourAI subscription",
        email,
        subject: payload.subject ?? "TourAI launch alert",
        message: payload.message ?? "",
        privacy: true,
        ios,
        android,
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

      const result = await postJson(config.checkStoreSubscriptionUrl, payload, options);
      if (!result.ok) {
        return result;
      }

      const ios = result.body?.ios === true;
      const android = result.body?.android === true;
      const normalizedPlatform = (platform ?? "").trim().toLowerCase();
      let subscribed = ios || android;
      if (normalizedPlatform === "ios") {
        subscribed = ios;
      } else if (normalizedPlatform === "android") {
        subscribed = android;
      }

      return {
        ok: true,
        body: {
          ...result.body,
          ios,
          android,
          subscribed,
          platform: platform || undefined,
          subscriptions: { iOS: ios, Android: android },
        },
      };
    },

    async unsubscribeStoreNotifications(email, platformsOrFlags) {
      const normalized = (email ?? "").trim().toLowerCase();
      if (!window.TourAiForms.isValidEmail(normalized)) {
        return { ok: false, error: "invalid_email" };
      }

      if (!window.TourAiForms.isWebEmailVerified(normalized)) {
        return { ok: false, error: "email_not_verified" };
      }

      let ios = false;
      let android = false;
      if (Array.isArray(platformsOrFlags)) {
        platformsOrFlags.forEach((entry) => {
          const value = String(entry ?? "").trim().toLowerCase();
          if (value === "ios") {
            ios = true;
          }
          if (value === "android") {
            android = true;
          }
        });
      } else if (platformsOrFlags && typeof platformsOrFlags === "object") {
        ios = platformsOrFlags.ios === true;
        android = platformsOrFlags.android === true;
      }

      if (!ios && !android) {
        return { ok: false, error: "invalid_payload" };
      }

      const payload = {
        email: normalized,
        ios,
        android,
      };

      const verificationToken = window.TourAiForms.getWebEmailVerificationToken(normalized);
      if (verificationToken) {
        payload.verificationToken = verificationToken;
      } else if (window.TourAiForms.isTrustedStoreSubscriber(normalized)) {
        // Signed-in owner path: prove session ownership to the Cloud Function.
        const user = window.TourAiAuth?.currentUser?.();
        if (user?.email && String(user.email).trim().toLowerCase() === normalized) {
          try {
            payload.idToken = await user.getIdToken();
          } catch (err) {
            console.warn("[TourAI forms] getIdToken for unsubscribe failed", err);
          }
        }
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

  /* Account deletion must never reuse a prior OTP session across page loads. */
  const VERIFIED_STORAGE_KEY = "tourai-account-deletion-verified";
  try {
    sessionStorage.removeItem(VERIFIED_STORAGE_KEY);
  } catch {
    /* ignore */
  }

  const verificationState = {
    token: null,
    verifiedEmail: null,
  };

  function tOr(key, fallbackOrVars, maybeVars) {
    const locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    const vars =
      fallbackOrVars && typeof fallbackOrVars === "object" && !Array.isArray(fallbackOrVars)
        ? fallbackOrVars
        : maybeVars;
    const fallback = typeof fallbackOrVars === "string" ? fallbackOrVars : undefined;
    return window.TourAiI18n?.tOr?.(key, locale, vars, fallback) ?? fallback ?? "";
  }

  function isValidEmail(email) {
    return window.TourAiForms?.isValidEmail(email) ?? false;
  }

  function clearVerification() {
    verificationState.token = null;
    verificationState.verifiedEmail = null;
  }

  function isEmailVerified(email) {
    const normalized = (email ?? "").trim().toLowerCase();
    if (!normalized) {
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

    /** Drop any in-memory OTP proof (call on page entry). */
    resetVerification() {
      clearVerification();
    },

    isEmailVerified(email) {
      return isEmailVerified(email);
    },

    async sendVerificationCode(email) {
      const normalized = (email ?? "").trim().toLowerCase();
      if (!isValidEmail(normalized)) {
        return { ok: false, error: "invalid_email" };
      }

      /* A new code invalidates any previous proof on this page. */
      clearVerification();

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
      } else if (result.ok) {
        clearVerification();
        return {
          ok: false,
          error: "invalid_payload",
          status: result.status,
          body: result.body,
        };
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
  let activeConfig = null;
  let alreadySubscribedNoticeKey = null;
  let alreadySubscribedToPlatform = false;

  function tOr(key, fallbackOrVars, maybeVars) {
    const locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    const vars =
      fallbackOrVars && typeof fallbackOrVars === "object" && !Array.isArray(fallbackOrVars)
        ? fallbackOrVars
        : maybeVars;
    const fallback = typeof fallbackOrVars === "string" ? fallbackOrVars : undefined;
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
      title: tOr("index.modal.alreadySubscribed.title"),
      message: tOr("index.modal.alreadySubscribed", { platform }),
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

  function openSubscribeVerifyModal() {
    window.TourAiEmailVerifyModal.open({
      onConfirm: confirmCode,
      onResend: resendCode,
    });
  }

  function setVerificationBoxState({ visible, verified }) {
    window.TourAiForms?.renderEmailVerificationBox(
      {
        boxId: activeConfig.verificationBoxId,
        messageId: activeConfig.verificationMessageId,
        sendButtonId: activeConfig.sendVerificationBtnId,
      },
      { visible, verified, showVerifyButton: false }
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
    window.TourAiEmailVerifyModal?.setStatus(message, type);
  }

  async function startVerification() {
    if (isBusy()) {
      window.TourAiForms?.allowAutoVerificationRetry?.(getEmailInput()?.value);
      return;
    }

    const email = getEmailInput()?.value?.trim() ?? "";
    if (!window.TourAiForms?.isValidEmail(email)) {
      window.TourAiFeedback?.show({
        type: "info",
        message: tOr("contact.email.invalid"),
      });
      window.TourAiForms?.allowAutoVerificationRetry?.(email);
      return;
    }

    try {
      const result = await window.TourAiForms.sendWebEmailVerificationCode(email);
      if (!result.ok) {
        if (result.error === "rate_limited") {
          throw new Error(
            window.TourAiForms.rateLimitedMessage(result, "contact.verify.rateLimited")
          );
        }
        throw new Error(window.TourAiForms.genericActionErrorMessage());
      }

      openSubscribeVerifyModal();
    } catch (error) {
      window.TourAiForms?.allowAutoVerificationRetry?.(email);
      window.TourAiFeedback?.show({
        type: "error",
        message: window.TourAiForms.toUserFacingErrorMessage(error),
      });
    } finally {
      validateSubscriptionForm();
    }
  }

  async function resendCode() {
    if (isBusy()) {
      return;
    }

    try {
      const result = await window.TourAiForms.sendWebEmailVerificationCode(
        getEmailInput()?.value?.trim() ?? ""
      );
      if (!result.ok) {
        if (result.error === "rate_limited") {
          throw new Error(
            window.TourAiForms.rateLimitedMessage(result, "contact.verify.rateLimited")
          );
        }
        throw new Error(window.TourAiForms.genericActionErrorMessage());
      }
      window.TourAiEmailVerifyModal.setStatus(
        tOr("contact.verify.resent"),
        "success"
      );
      window.TourAiEmailVerifyModal.clearAndFocus();
    } catch (error) {
      window.TourAiEmailVerifyModal.setStatus(
        window.TourAiForms.toUserFacingErrorMessage(error),
        "error"
      );
    }
  }

  async function confirmCode(codeFromModal) {
    if (isBusy()) {
      return;
    }

    const email = getEmailInput()?.value?.trim() ?? "";
    const code = codeFromModal || window.TourAiEmailVerifyModal.getCode();

    try {
      const result = await window.TourAiForms.verifyWebEmailCode(email, code);
      if (!result.ok) {
        const errorMap = {
          invalid_code: ["contact.verify.invalidCode", "El código no coincide."],
          expired: ["contact.verify.expired", "El código ha caducado. Solicita uno nuevo."],
          too_many_attempts: ["contact.verify.rateLimited", "Demasiados intentos. Espera unos minutos."],
          not_found: ["contact.verify.invalidCode", "El código no coincide."],
        };
        const entry = errorMap[result.error] ?? errorMap.invalid_code;
        window.TourAiEmailVerifyModal.setStatus(tOr(entry[0], entry[1]), "error");
        window.TourAiEmailVerifyModal.clearAndFocus();
        return;
      }

      window.TourAiEmailVerifyModal.close();
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
      window.TourAiEmailVerifyModal.setStatus(
        tOr("contact.verify.invalidCode"),
        "error"
      );
      window.TourAiEmailVerifyModal.clearAndFocus();
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

  function syncSubscriptionEmailState(options) {
    const email = getEmailInput()?.value?.trim() ?? "";
    const platform = getCurrentPlatform();
    const settings = options ?? {};

    window.TourAiForms?.scheduleEmailRegistrationCheck(email, {
      context: "subscribe",
      platform,
      getEmail: () => getEmailInput()?.value ?? "",
      onAlreadySubscribed: handleAlreadySubscribedNotice,
      onStateChange: validateSubscriptionForm,
      autoOpenVerification: settings.autoOpenVerification === true,
      onNeedsVerification: () => startVerification(),
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
      const translated = window.TourAiI18n.t("index.modal.text", locale, { platform });
      if (translated) {
        intro.textContent = translated;
      }
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
    const originalText = tOr("index.modal.submit");

    if (!window.TourAiForms?.isValidEmail(email)) {
      window.TourAiFeedback?.show({
        type: "info",
        message: tOr("contact.email.invalid"),
      });
      return;
    }

    if (!window.TourAiForms.isWebEmailVerified(email)) {
      startVerification();
      return;
    }

    if (!privacy) {
      window.TourAiFeedback?.show({
        type: "info",
        message: tOr("index.modal.privacyRequired"),
      });
      return;
    }

    if (!canSubmitSubscription()) {
      return;
    }

    try {
      button.disabled = true;
      button.textContent = tOr("index.modal.submitting");
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
          title: tOr("index.modal.successTitle"),
          message: tOr("index.modal.success"),
        });
      } else if (result.error === "already_subscribed") {
        showAlreadySubscribedFeedback(result.body?.platform ?? platform);
      } else {
        const errorMessages = {
          email_not_verified: tOr("contact.error.notVerified"),
          smtp_not_configured: tOr("contact.error.smtp"),
        };
        throw new Error(errorMessages[result.error] ?? window.TourAiForms.genericActionErrorMessage());
      }
    } catch (error) {
      const rawMessage = typeof error?.message === "string" ? error.message : "";
      const shouldVerify = rawMessage.toLowerCase().includes("verificar");
      window.TourAiFeedback?.show({
        type: "error",
        message: window.TourAiForms.toUserFacingErrorMessage(error, window.TourAiForms.genericActionErrorMessage()),
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
      });
      emailInput?.addEventListener("change", function () {
        syncSubscriptionEmailState({ autoOpenVerification: true });
      });
      emailInput?.addEventListener("blur", function () {
        syncSubscriptionEmailState({ autoOpenVerification: true });
      });
      getPrivacyInput()?.addEventListener("change", validateSubscriptionForm);
      getPrivacyInput()?.addEventListener("click", validateSubscriptionForm);

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

  function tOr(key, fallbackOrVars, maybeVars) {
    const locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    const vars =
      fallbackOrVars && typeof fallbackOrVars === "object" && !Array.isArray(fallbackOrVars)
        ? fallbackOrVars
        : maybeVars;
    const fallback = typeof fallbackOrVars === "string" ? fallbackOrVars : undefined;
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
          <input type="email" id="unsubEmail" name="email" autocomplete="email" data-i18n-placeholder="index.modal.email" placeholder="">
          <button type="button" id="unsubViewSubscriptionsBtn" class="btn-primary" data-i18n="unsubscribe.viewSubscriptions">Ver suscripciones</button>
          <div id="unsubVerificationBox" class="verification-box">
            <p id="unsubVerificationMessage" data-i18n="contact.verify.success">Email validado correctamente.</p>
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
            <button type="button" id="unsubSubmitBtn" class="btn-primary" disabled data-i18n="unsubscribe.submit">Darme de baja</button>
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

    document.getElementById("unsubSubmitBtn").addEventListener("click", submitUnsubscribe);
    document
      .getElementById("unsubViewSubscriptionsBtn")
      ?.addEventListener("click", viewSubscriptions);
    getEmailInput()?.addEventListener("input", function () {
      window.TourAiForms?.onWebEmailInput(this.value);
      resetManageSection();
      syncSignedInOwnerVerification();
      updateVerificationBox();
    });
    getEmailInput()?.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        viewSubscriptions();
      }
    });

    ["unsubIos", "unsubAndroid"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", updateUnsubscribeButton);
    });
  }

  function getSignedInEmail() {
    const email = window.TourAiAuth?.currentUser?.()?.email;
    return email ? String(email).trim().toLowerCase() : "";
  }

  /** Session owner: Firebase login already proves ownership of this email. */
  function syncSignedInOwnerVerification() {
    const email = getEmailInput()?.value?.trim().toLowerCase() ?? "";
    if (!window.TourAiForms?.isValidEmail(email)) {
      return false;
    }
    const signedIn = getSignedInEmail();
    if (signedIn && signedIn === email) {
      window.TourAiForms.markTrustedSubscriberVerification(email);
      return true;
    }
    return false;
  }

  function setVerificationBoxState({ visible, verified }) {
    window.TourAiForms?.renderEmailVerificationBox(
      {
        boxId: "unsubVerificationBox",
        messageId: "unsubVerificationMessage",
        sendButtonId: "unsubSendVerificationBtn",
      },
      { visible, verified, showVerifyButton: false }
    );
  }

  function showCodeStatus(message, type) {
    window.TourAiEmailVerifyModal?.setStatus(message, type);
  }

  function resetManageSection() {
    resetLoadedStatus();
    const manageSection = document.getElementById("unsubManageSection");
    if (manageSection) {
      manageSection.hidden = true;
    }
    const noSubscriptions = document.getElementById("unsubNoSubscriptions");
    if (noSubscriptions) {
      noSubscriptions.hidden = true;
    }
    const ios = document.getElementById("unsubIos");
    const android = document.getElementById("unsubAndroid");
    if (ios) {
      ios.checked = false;
      ios.disabled = true;
    }
    if (android) {
      android.checked = false;
      android.disabled = true;
    }
    updateUnsubscribeButton();
  }

  function updateVerificationBox() {
    const email = getEmailInput()?.value?.trim().toLowerCase() ?? "";
    const isEmailValid = window.TourAiForms?.isValidEmail(email) ?? false;

    if (!isEmailValid) {
      window.TourAiForms?.clearWebEmailVerification();
      window.TourAiForms?.resetEmailRegistrationCheck();
      setVerificationBoxState({ visible: false, verified: false });
      resetManageSection();
      return;
    }

    applyUnsubscribeVerificationBox(email);
  }

  async function viewSubscriptions() {
    if (isBusy()) {
      window.TourAiFeedback?.show({
        type: "info",
        message: tOr("loading.processing"),
      });
      return;
    }

    const email = getEmailInput()?.value?.trim() ?? "";
    if (!window.TourAiForms?.isValidEmail(email)) {
      window.TourAiFeedback?.show({
        type: "info",
        message: tOr("contact.email.invalid"),
      });
      return;
    }

    const viewBtn = document.getElementById("unsubViewSubscriptionsBtn");
    const originalLabel = tOr("unsubscribe.viewSubscriptions");

    try {
      if (viewBtn) {
        viewBtn.disabled = true;
        viewBtn.textContent = tOr("unsubscribe.checkingEmail");
      }

      // Same email as the signed-in account → trust session, no OTP.
      if (syncSignedInOwnerVerification()) {
        updateVerificationBox();
        await loadSubscriptionStatus({ force: true });
        return;
      }

      // Already verified via OTP in this session.
      if (window.TourAiForms?.isWebEmailVerified(email)) {
        updateVerificationBox();
        await loadSubscriptionStatus({ force: true });
        return;
      }

      // Ownership must be proven with a code before listing/removing alerts.
      await startVerification();
    } catch (error) {
      window.TourAiFeedback?.show({
        type: "error",
        message: window.TourAiForms.toUserFacingErrorMessage(
          error,
          tOr("unsubscribe.statusError")
        ),
      });
    } finally {
      if (viewBtn) {
        viewBtn.disabled = false;
        viewBtn.textContent = originalLabel;
      }
    }
  }

  function updateUnsubscribeButton() {
    const button = document.getElementById("unsubSubmitBtn");
    const canSubmit = getSelectedPlatforms().length > 0;
    if (button) {
      button.disabled = !canSubmit;
    }
  }

  async function loadSubscriptionStatus(options) {
    const force = options?.force === true;
    const email = getEmailInput()?.value?.trim().toLowerCase() ?? "";
    if (!window.TourAiForms?.isWebEmailVerified(email)) {
      return;
    }

    if (!force && loadedStatusEmail === email) {
      return;
    }

    const result = await window.TourAiForms.checkStoreSubscription(email, null, {
      loading: false,
    });
    if (!result.ok) {
      throw new Error(
        tOr("unsubscribe.statusError")
      );
    }

    const subscriptions = result.body?.subscriptions ?? {};
    const iosActive = result.body?.ios === true || subscriptions.iOS === true;
    const androidActive = result.body?.android === true || subscriptions.Android === true;
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
      window.TourAiForms?.allowAutoVerificationRetry?.(getEmailInput()?.value);
      return;
    }

    const email = getEmailInput()?.value?.trim() ?? "";
    if (!window.TourAiForms?.isValidEmail(email)) {
      window.TourAiFeedback?.show({
        type: "info",
        message: tOr("contact.email.invalid"),
      });
      window.TourAiForms?.allowAutoVerificationRetry?.(email);
      return;
    }

    try {
      const result = await window.TourAiForms.sendWebEmailVerificationCode(email);
      if (!result.ok) {
        if (result.error === "rate_limited") {
          throw new Error(
            window.TourAiForms.rateLimitedMessage(result, "contact.verify.rateLimited")
          );
        }
        throw new Error(window.TourAiForms.genericActionErrorMessage());
      }

      window.TourAiEmailVerifyModal.open({
        onConfirm: confirmCode,
        onResend: resendCode,
      });
    } catch (error) {
      window.TourAiForms?.allowAutoVerificationRetry?.(email);
      window.TourAiFeedback?.show({
        type: "error",
        message: window.TourAiForms.toUserFacingErrorMessage(error),
      });
    } finally {
      updateVerificationBox();
    }
  }

  async function resendCode() {
    if (isBusy()) {
      return;
    }

    try {
      const result = await window.TourAiForms.sendWebEmailVerificationCode(
        getEmailInput()?.value?.trim() ?? ""
      );
      if (!result.ok) {
        if (result.error === "rate_limited") {
          throw new Error(
            window.TourAiForms.rateLimitedMessage(result, "contact.verify.rateLimited")
          );
        }
        throw new Error(window.TourAiForms.genericActionErrorMessage());
      }
      window.TourAiEmailVerifyModal.setStatus(
        tOr("contact.verify.resent"),
        "success"
      );
      window.TourAiEmailVerifyModal.clearAndFocus();
    } catch (error) {
      window.TourAiEmailVerifyModal.setStatus(
        window.TourAiForms.toUserFacingErrorMessage(error),
        "error"
      );
    }
  }

  async function confirmCode(codeFromModal) {
    if (isBusy()) {
      return;
    }

    const email = getEmailInput()?.value?.trim() ?? "";
    const code = codeFromModal || window.TourAiEmailVerifyModal.getCode();

    try {
      const result = await window.TourAiForms.verifyWebEmailCode(email, code);
      if (!result.ok) {
        const errorMap = {
          invalid_code: ["contact.verify.invalidCode", "El código no coincide."],
          expired: ["contact.verify.expired", "El código ha caducado. Solicita uno nuevo."],
          too_many_attempts: ["contact.verify.rateLimited", "Demasiados intentos. Espera unos minutos."],
          not_found: ["contact.verify.invalidCode", "El código no coincide."],
        };
        const entry = errorMap[result.error] ?? errorMap.invalid_code;
        window.TourAiEmailVerifyModal.setStatus(tOr(entry[0], entry[1]), "error");
        window.TourAiEmailVerifyModal.clearAndFocus();
        return;
      }

      window.TourAiEmailVerifyModal.close();
      updateVerificationBox();
      await loadSubscriptionStatus({ force: true });
    } catch (error) {
      window.TourAiEmailVerifyModal.setStatus(
        tOr("contact.verify.invalidCode"),
        "error"
      );
      window.TourAiEmailVerifyModal.clearAndFocus();
    }
  }

  async function submitUnsubscribe() {
    if (isBusy()) {
      window.TourAiFeedback?.show({
        type: "info",
        message: tOr("loading.processing"),
      });
      return;
    }

    const email = getEmailInput()?.value?.trim() ?? "";
    const platforms = getSelectedPlatforms();

    if (!window.TourAiForms?.isWebEmailVerified(email)) {
      window.TourAiFeedback?.show({
        type: "info",
        message: tOr("contact.error.notVerified"),
      });
      return;
    }

    if (platforms.length === 0) {
      window.TourAiFeedback?.show({
        type: "info",
        message: tOr("unsubscribe.selectRequired"),
      });
      return;
    }

    const button = document.getElementById("unsubSubmitBtn");
    const originalText = tOr("unsubscribe.submit");

    try {
      button.disabled = true;
      button.textContent = tOr("unsubscribe.submitting");
      const result = await window.TourAiForms.unsubscribeStoreNotifications(email, platforms);
      if (result.ok) {
        resetLoadedStatus();
        closeModal();
        window.TourAiForms.clearWebEmailVerification();
        window.TourAiFeedback?.show({
          type: "success",
          title: tOr("unsubscribe.successTitle"),
          message: tOr("unsubscribe.success"),
        });
        return;
      }

      if (result.error === "not_subscribed") {
        window.TourAiFeedback?.show({
          type: "info",
          message: tOr("unsubscribe.none"),
        });
        await loadSubscriptionStatus({ force: true });
        return;
      }

      if (result.error === "email_not_verified") {
        startVerification();
        return;
      }

      throw new Error(window.TourAiForms.genericActionErrorMessage());
    } catch (error) {
      window.TourAiFeedback?.show({
        type: "error",
        message: window.TourAiForms.toUserFacingErrorMessage(error),
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

    const signedInEmail = getSignedInEmail();
    if (signedInEmail) {
      const emailInput = getEmailInput();
      if (emailInput) {
        emailInput.value = signedInEmail;
      }
      window.TourAiForms?.markTrustedSubscriberVerification(signedInEmail);
    }

    updateVerificationBox();

    const modal = document.getElementById(MODAL_ID);
    modal.style.display = "block";

    if (window.TourAiI18n?.applyTranslations) {
      window.TourAiI18n.applyTranslations(window.TourAiI18n.getLocale());
    }

    getEmailInput()?.focus();
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

