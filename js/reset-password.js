(function () {
  const config = window.TourAiSite?.config;
  const statusEl = document.getElementById("resetStatus");
  const form = document.getElementById("resetPasswordForm");
  const successEl = document.getElementById("resetSuccess");

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

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const newPassword = document.getElementById("newPassword")?.value ?? "";
    const confirmPassword = document.getElementById("confirmPassword")?.value ?? "";

    if (newPassword.length < 6) {
      setStatus("La contraseña debe tener al menos 6 caracteres.", true);
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
