(function () {
  const form = document.getElementById("loginForm");
  const emailInput = document.getElementById("loginEmail");
  const passwordInput = document.getElementById("loginPassword");
  const rememberInput = document.getElementById("loginRemember");
  const statusEl = document.getElementById("loginStatus");
  const submitBtn = document.getElementById("loginSubmit");
  const forgotBtn = document.getElementById("forgotPasswordBtn");
  const auth = window.TourAiAuth;
  let busy = false;

  if (!form) {
    return;
  }

  form.setAttribute("data-login-bound", "1");

  function t(key, fallback) {
    if (auth && typeof auth.t === "function") {
      return auth.t(key, fallback);
    }
    if (window.TourAiI18n && typeof window.TourAiI18n.tOr === "function") {
      return window.TourAiI18n.tOr(key, window.TourAiI18n.getLocale(), null, fallback);
    }
    return fallback;
  }

  function setStatus(message, isError) {
    if (!statusEl) {
      return;
    }
    statusEl.hidden = !message;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", !!isError);
    statusEl.classList.toggle("is-visible", !!message);
  }

  function setBusy(isBusy, statusMessage) {
    busy = !!isBusy;
    if (submitBtn) {
      submitBtn.disabled = busy;
      submitBtn.classList.toggle("is-loading", busy);
      submitBtn.setAttribute("aria-busy", busy ? "true" : "false");
    }
    if (forgotBtn) {
      forgotBtn.disabled = busy;
    }
    if (statusMessage !== undefined) {
      setStatus(statusMessage, false);
    }
    if (window.TourAiLoading) {
      if (busy) {
        window.TourAiLoading.show(
          statusMessage || t("login.status.signingIn", "Iniciando sesión...")
        );
      } else {
        while (window.TourAiLoading.isVisible()) {
          window.TourAiLoading.hide();
        }
      }
    }
  }

  function nextUrl() {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next && next.startsWith("/") === false && !next.includes("://") && next.endsWith(".html")) {
      return next;
    }
    return "dashboard.html";
  }

  function mapError(err) {
    if (auth && typeof auth.mapAuthError === "function") {
      return auth.mapAuthError(err);
    }
    return t("login.error.generic", "No se pudo iniciar sesión. Inténtalo de nuevo.");
  }

  function rememberChecked() {
    return !rememberInput || !!rememberInput.checked;
  }

  if (!auth) {
    setStatus(
      t(
        "login.error.config",
        "No se pudo cargar el módulo de acceso. Recarga la página (Ctrl+F5) o comprueba la consola del navegador."
      ),
      true
    );
    return;
  }

  // Prefill remembered email / preference (never the password).
  if (emailInput && !emailInput.value) {
    emailInput.value = auth.getRememberedEmail() || "";
  }
  if (rememberInput) {
    rememberInput.checked = auth.getRememberPreference();
  }

  auth.ensureFirebase().catch(function (err) {
    setStatus(mapError(err), true);
  });

  auth.redirectIfSignedIn(nextUrl()).catch(function (err) {
    setStatus(mapError(err), true);
  });

  async function doSignIn() {
    if (busy) {
      return;
    }

    const email = (emailInput && emailInput.value ? emailInput.value : "").trim();
    const password = passwordInput && passwordInput.value ? passwordInput.value : "";
    const remember = rememberChecked();

    if (!email || !password) {
      setStatus(t("login.error.required", "Introduce correo y contraseña."), true);
      if (!email && emailInput) {
        emailInput.focus();
      } else if (passwordInput) {
        passwordInput.focus();
      }
      return;
    }

    const signingInMsg = t("login.status.signingIn", "Iniciando sesión...");
    setBusy(true, signingInMsg);

    try {
      auth.setRememberPreference(remember);
      await auth.signIn(email, password, { remember: remember });
      if (remember) {
        auth.setRememberedEmail(email);
      } else {
        auth.setRememberedEmail("");
      }
      setStatus(t("login.status.redirecting", "Acceso correcto. Redirigiendo..."), false);
      window.location.replace(nextUrl());
    } catch (err) {
      console.error("[TourAI login]", err);
      setBusy(false);
      setStatus(mapError(err), true);
    }
  }

  async function sendResetLink(email) {
    const sendingMsg = t("login.status.resetSending", "Enviando enlace de restablecimiento...");
    setBusy(true, sendingMsg);
    try {
      await auth.sendPasswordReset(email);
      setBusy(false);
      const okMsg = t(
        "login.status.resetSent",
        "Si existe una cuenta con ese correo, recibirás un enlace para restablecer la contraseña. Revisa también la carpeta de spam."
      );
      setStatus(okMsg, false);
      if (window.TourAiFeedback) {
        window.TourAiFeedback.show({
          type: "success",
          title: t("login.reset.title", "Recuperar contraseña"),
          message: okMsg,
          buttonText: t("feedback.close", "Entendido"),
        });
      }
    } catch (err) {
      console.error("[TourAI login reset]", err);
      setBusy(false);
      setStatus(mapError(err), true);
    }
  }

  function requestPasswordReset() {
    if (busy) {
      return;
    }

    const email = (emailInput && emailInput.value ? emailInput.value : "").trim();
    if (!email) {
      setStatus(
        t("login.error.forgotEmail", "Escribe tu correo para enviarte el enlace de restablecimiento."),
        true
      );
      if (emailInput) {
        emailInput.focus();
      }
      return;
    }

    const confirmMsg = t(
      "login.reset.confirm",
      "Se enviará un enlace para restablecer la contraseña a {email}. ¿Continuar?"
    ).replace("{email}", email);

    if (!window.confirm(confirmMsg)) {
      return;
    }

    sendResetLink(email);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    event.stopPropagation();
    doSignIn();
  });

  forgotBtn?.addEventListener("click", function () {
    requestPasswordReset();
  });
})();
