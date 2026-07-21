(function () {
  const form = document.getElementById("loginForm");
  const emailInput = document.getElementById("loginEmail");
  const passwordInput = document.getElementById("loginPassword");
  const statusEl = document.getElementById("loginStatus");
  const submitBtn = document.getElementById("loginSubmit");
  const forgotBtn = document.getElementById("forgotPasswordBtn");
  const auth = window.TourAiAuth;

  function t(key, fallback) {
    if (auth?.t) {
      return auth.t(key, fallback);
    }
    return fallback;
  }

  function setStatus(message, isError) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", !!isError);
  }

  function nextUrl() {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next && next.startsWith("/") === false && !next.includes("://") && next.endsWith(".html")) {
      return next;
    }
    return "account.html";
  }

  if (!form) {
    return;
  }

  if (!auth) {
    setStatus(
      t(
        "login.error.config",
        "No se pudo cargar el módulo de acceso. Recarga la página o comprueba la consola del navegador."
      ),
      true
    );
    return;
  }

  // Surface config / file:// problems immediately (not only after clicking Entrar).
  auth.ensureFirebase().catch(function (err) {
    setStatus(auth.mapAuthError(err), true);
  });

  auth.redirectIfSignedIn(nextUrl()).catch(function (err) {
    setStatus(auth.mapAuthError(err), true);
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    event.stopPropagation();

    const email = (emailInput && emailInput.value ? emailInput.value : "").trim();
    const password = passwordInput && passwordInput.value ? passwordInput.value : "";

    if (!email || !password) {
      setStatus(t("login.error.required", "Introduce correo y contraseña."), true);
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
    }
    setStatus(t("login.status.signingIn", "Iniciando sesión..."), false);

    try {
      await auth.signIn(email, password);
      window.location.replace(nextUrl());
    } catch (err) {
      console.error("[TourAI login]", err);
      setStatus(auth.mapAuthError(err), true);
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  });

  if (forgotBtn) {
    forgotBtn.addEventListener("click", async function () {
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

      setStatus(t("login.status.resetSending", "Enviando enlace de restablecimiento..."), false);
      try {
        await auth.sendPasswordReset(email);
        setStatus(
          t(
            "login.status.resetSent",
            "Si existe una cuenta con ese correo, recibirás un enlace para restablecer la contraseña."
          ),
          false
        );
      } catch (err) {
        console.error("[TourAI login reset]", err);
        setStatus(auth.mapAuthError(err), true);
      }
    });
  }
})();
