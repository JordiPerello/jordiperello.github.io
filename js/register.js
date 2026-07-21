(function () {
  const form = document.getElementById("registerForm");
  const nameInput = document.getElementById("registerName");
  const emailInput = document.getElementById("registerEmail");
  const passwordInput = document.getElementById("registerPassword");
  const confirmInput = document.getElementById("registerConfirm");
  const termsInput = document.getElementById("registerTerms");
  const statusEl = document.getElementById("registerStatus");
  const submitBtn = document.getElementById("registerSubmit");
  const strengthSection = document.getElementById("passwordStrength");
  const strengthLabel = document.getElementById("passwordStrengthLabel");
  const strengthBars = strengthSection?.querySelectorAll(".auth-password-strength__bar");
  const passwordError = document.getElementById("passwordError");
  const confirmError = document.getElementById("confirmPasswordError");
  const auth = window.TourAiAuth;
  const strength = window.TourAiPasswordStrength;

  if (!form || !auth) {
    return;
  }

  function t(key, fallback) {
    return auth.t(key, fallback);
  }

  function setStatus(message, isError) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", !!isError);
  }

  function webDeviceId() {
    const key = "tourai-web-device-id";
    let id = localStorage.getItem(key);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(key, id);
    }
    return id;
  }

  function updateStrengthUI() {
    if (!strength || !passwordInput || !strengthSection) {
      return strength?.Level?.None ?? 0;
    }
    const level = strength.evaluate(passwordInput.value || "");
    strengthSection.hidden = level === strength.Level.None;
    strengthBars?.forEach((bar) => {
      bar.className = "auth-password-strength__bar";
    });
    if (strengthLabel) {
      strengthLabel.className = "auth-password-strength__label";
    }
    if (level === strength.Level.Weak) {
      strengthBars?.[0]?.classList.add("is-active", "is-weak");
      if (strengthLabel) {
        strengthLabel.className = "auth-password-strength__label is-weak";
        strengthLabel.textContent = t("resetPassword.strength.weak", "Débil");
      }
    } else if (level === strength.Level.Medium) {
      strengthBars?.[0]?.classList.add("is-active", "is-medium");
      strengthBars?.[1]?.classList.add("is-active", "is-medium");
      if (strengthLabel) {
        strengthLabel.className = "auth-password-strength__label is-medium";
        strengthLabel.textContent = t("resetPassword.strength.medium", "Media");
      }
    } else if (level === strength.Level.Strong) {
      strengthBars?.[0]?.classList.add("is-active", "is-strong");
      strengthBars?.[1]?.classList.add("is-active", "is-strong");
      strengthBars?.[2]?.classList.add("is-active", "is-strong");
      if (strengthLabel) {
        strengthLabel.className = "auth-password-strength__label is-strong";
        strengthLabel.textContent = t("resetPassword.strength.strong", "Fuerte");
      }
    }
    return level;
  }

  passwordInput?.addEventListener("input", updateStrengthUI);

  auth.redirectIfSignedIn("account.html").catch(function (err) {
    setStatus(auth.mapAuthError(err), true);
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    const displayName = (nameInput?.value || "").trim();
    const email = (emailInput?.value || "").trim();
    const password = passwordInput?.value || "";
    const confirm = confirmInput?.value || "";

    if (passwordError) {
      passwordError.hidden = true;
    }
    if (confirmError) {
      confirmError.hidden = true;
    }

    if (!displayName || !email || !password || !confirm) {
      setStatus(t("register.error.required", "Completa todos los campos."), true);
      return;
    }

    if (!termsInput?.checked) {
      setStatus(t("register.error.terms", "Debes aceptar los términos de uso."), true);
      return;
    }

    const level = updateStrengthUI();
    if (!strength || level < strength.Level.Medium) {
      if (passwordError) {
        passwordError.hidden = false;
      }
      setStatus(
        t(
          "resetPassword.error.weak",
          "La contraseña es demasiado débil. Usa al menos 8 caracteres con mayúsculas, minúsculas y números."
        ),
        true
      );
      return;
    }

    if (password !== confirm) {
      if (confirmError) {
        confirmError.hidden = false;
      }
      setStatus(t("resetPassword.error.mismatch", "Las contraseñas no coinciden."), true);
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
    }
    setStatus(t("register.status.creating", "Creando cuenta..."), false);

    try {
      const credential = await auth.signUp(email, password);
      const user = credential.user;
      await auth.updateProfile(displayName);

      const db = await auth.getFirestore();
      const now = firebase.firestore.Timestamp.now();
      await db
        .collection("Users")
        .doc(user.uid)
        .set({
          Id: user.uid,
          Email: email,
          DisplayName: displayName,
          AccountType: "Freemium",
          Version: 1,
          CreatedAt: now,
          TermsAccepted: true,
          TermsAcceptedAt: now,
          DeviceId: webDeviceId(),
          SessionLastSeenAt: now,
          Preferences: "[]",
          PhotoCropOffsetXNorm: 0.5,
          PhotoCropOffsetYNorm: 0.5,
          PhotoCropUserScale: 1,
        });

      setStatus(t("register.status.success", "Cuenta creada. Entrando..."), false);
      window.location.replace("account.html");
    } catch (err) {
      console.error(err);
      // Auth may have succeeded while profile write failed — keep session and open account.
      if (auth.currentUser()) {
        setStatus(
          t(
            "register.error.profile",
            "La cuenta se creó, pero hubo un problema al guardar el perfil. Entra en Mi cuenta o reintenta más tarde."
          ),
          true
        );
        setTimeout(function () {
          window.location.replace("account.html");
        }, 1800);
        return;
      }
      setStatus(auth.mapAuthError(err), true);
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  });
})();
