(function () {
  const config = window.TourAiSite?.config;
  const strength = window.TourAiPasswordStrength;
  const statusEl = document.getElementById("resetStatus");
  const form = document.getElementById("resetPasswordForm");
  const successEl = document.getElementById("resetSuccess");
  const newPasswordInput = document.getElementById("newPassword");
  const confirmPasswordInput = document.getElementById("confirmPassword");
  const strengthSection = document.getElementById("passwordStrength");
  const strengthLabel = document.getElementById("passwordStrengthLabel");
  const strengthBars = strengthSection?.querySelectorAll(".auth-password-strength__bar");
  const passwordError = document.getElementById("passwordError");
  const confirmError = document.getElementById("confirmPasswordError");
  const generateButton = document.getElementById("generateSecurePassword");
  const toggleButtons = [
    document.getElementById("toggleNewPassword"),
    document.getElementById("toggleConfirmPassword"),
  ].filter(Boolean);

  let passwordsVisible = false;

  const firebaseConfig = config?.firebaseAuth;
  if (!config || !firebaseConfig?.apiKey) {
    if (statusEl) {
      statusEl.textContent = "Configuración de Firebase no disponible.";
      statusEl.classList.add("error");
    }
    if (form) {
      form.style.display = "none";
    }
    return;
  }

  if (!window.firebase?.apps?.length) {
    firebase.initializeApp(firebaseConfig);
  }

  const auth = firebase.auth();

  function setStatus(message, isError) {
    if (!statusEl) {
      return;
    }

    statusEl.textContent = message ?? "";
    statusEl.classList.toggle("error", !!isError);
  }

  function readQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name) ?? "";
  }

  function showSuccess() {
    if (form) {
      form.style.display = "none";
    }
    if (successEl) {
      successEl.hidden = false;
    }
    setStatus("", false);
  }

  function setPasswordsVisible(visible) {
    passwordsVisible = visible;
    const type = visible ? "text" : "password";
    const label = visible ? "Ocultar" : "Mostrar";

    if (newPasswordInput) {
      newPasswordInput.type = type;
    }
    if (confirmPasswordInput) {
      confirmPasswordInput.type = type;
    }

    toggleButtons.forEach((button) => {
      button.textContent = label;
      button.setAttribute(
        "aria-label",
        visible ? "Ocultar contraseña" : "Mostrar contraseña"
      );
    });
  }

  function updatePasswordStrengthUi(password) {
    if (!strength || !strengthSection || !strengthLabel || !strengthBars?.length) {
      return;
    }

    const level = strength.evaluate(password);
    const hasPassword = level !== strength.Level.None;
    strengthSection.hidden = !hasPassword;

    if (!hasPassword) {
      return;
    }

    strengthBars.forEach((bar) => {
      bar.className = "auth-password-strength__bar";
    });

    strengthSection.dataset.level = String(level);

    if (level === strength.Level.Weak) {
      strengthBars[0].classList.add("is-active", "is-weak");
      strengthLabel.textContent = "Débil";
      strengthLabel.className = "auth-password-strength__label is-weak";
    } else if (level === strength.Level.Medium) {
      strengthBars[0].classList.add("is-active", "is-medium");
      strengthBars[1].classList.add("is-active", "is-medium");
      strengthLabel.textContent = "Media";
      strengthLabel.className = "auth-password-strength__label is-medium";
    } else {
      strengthBars[0].classList.add("is-active", "is-strong");
      strengthBars[1].classList.add("is-active", "is-strong");
      strengthBars[2].classList.add("is-active", "is-strong");
      strengthLabel.textContent = "Fuerte";
      strengthLabel.className = "auth-password-strength__label is-strong";
    }
  }

  function updateFieldErrors() {
    const password = newPasswordInput?.value ?? "";
    const confirmPassword = confirmPasswordInput?.value ?? "";

    updatePasswordStrengthUi(password);

    if (passwordError) {
      const showWeak = password.length > 0 && !strength?.meetsMinimum(password);
      passwordError.hidden = !showWeak;
    }

    if (confirmError) {
      const showMismatch =
        confirmPassword.length > 0 && password !== confirmPassword;
      confirmError.hidden = !showMismatch;
    }
  }

  const mode = readQueryParam("mode");
  const oobCode = readQueryParam("oobCode");

  if (mode !== "resetPassword" || !oobCode) {
    setStatus(
      "Este enlace no es válido o ha caducado. Solicita un nuevo restablecimiento desde la app TourAI.",
      true
    );
    if (form) {
      form.style.display = "none";
    }
    return;
  }

  newPasswordInput?.addEventListener("input", updateFieldErrors);
  confirmPasswordInput?.addEventListener("input", updateFieldErrors);

  toggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setPasswordsVisible(!passwordsVisible);
    });
  });

  generateButton?.addEventListener("click", () => {
    if (!strength) {
      return;
    }

    const password = strength.generateSecurePassword();
    if (newPasswordInput) {
      newPasswordInput.value = password;
    }
    if (confirmPasswordInput) {
      confirmPasswordInput.value = password;
    }

    setPasswordsVisible(true);
    updateFieldErrors();
    setStatus("", false);
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const newPassword = newPasswordInput?.value ?? "";
    const confirmPassword = confirmPasswordInput?.value ?? "";

    updateFieldErrors();

    if (!strength?.meetsMinimum(newPassword)) {
      setStatus(
        "La contraseña es demasiado débil. Usa al menos 8 caracteres con mayúsculas, minúsculas y números.",
        true
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setStatus("Las contraseñas no coinciden.", true);
      return;
    }

    setStatus("Guardando contraseña...", false);

    try {
      await auth.confirmPasswordReset(oobCode, newPassword);
      showSuccess();
    } catch (error) {
      const message =
        error?.code === "auth/expired-action-code"
          ? "El enlace ha caducado. Solicita uno nuevo desde la app."
          : "No se pudo actualizar la contraseña. Solicita un nuevo enlace.";
      setStatus(message, true);
    }
  });
})();
