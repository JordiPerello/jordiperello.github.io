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
