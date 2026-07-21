(function () {
  const auth = window.TourAiAuth;
  const data = window.TourAiAccountData;
  const emailEl = document.getElementById("accountEmail");
  const nameEl = document.getElementById("accountDisplayName");
  const typeEl = document.getElementById("accountType");
  const statusEl = document.getElementById("accountStatus");
  const signedInPanel = document.getElementById("accountSignedIn");
  const loadingPanel = document.getElementById("accountLoading");
  const logoutBtn = document.getElementById("accountLogout");

  if (!auth || !data) {
    return;
  }

  function t(key, fallback) {
    return data.t(key, fallback);
  }

  function setStatus(message, isError) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", !!isError);
  }

  function showSignedIn() {
    if (loadingPanel) {
      loadingPanel.hidden = true;
    }
    if (signedInPanel) {
      signedInPanel.hidden = false;
    }
  }

  function redirectToLogin() {
    const target = new URL("login.html", window.location.href);
    target.searchParams.set("next", "account.html");
    window.location.replace(target.toString());
  }

  async function loadProfile(user) {
    const profile = await data.fetchProfile(user);
    if (emailEl) {
      emailEl.textContent = profile.Email || profile.AuthEmail || user.email || "—";
    }
    if (nameEl) {
      nameEl.textContent = profile.DisplayName || t("account.profile.noName", "Sin nombre");
    }
    if (typeEl) {
      const accountType = profile.AccountType || "Freemium";
      typeEl.textContent =
        accountType === "Premium"
          ? t("account.profile.type.premium", "Premium")
          : t("account.profile.type.freemium", "Freemium");
    }
  }

  auth
    .onAuthStateChanged(async function (user) {
      if (!user) {
        redirectToLogin();
        return;
      }

      showSignedIn();
      setStatus(t("account.loadingData", "Cargando tu perfil..."), false);
      try {
        await loadProfile(user);
        setStatus("", false);
      } catch (err) {
        console.error(err);
        setStatus(
          auth.mapAuthError(err) ||
            t("account.error.load", "No se pudieron cargar los datos de la cuenta."),
          true
        );
      }
    })
    .catch(function (err) {
      console.error(err);
      redirectToLogin();
    });

  logoutBtn?.addEventListener("click", async function () {
    setStatus(t("account.status.signingOut", "Cerrando sesión..."), false);
    try {
      data.clearCache();
      await auth.signOut();
      window.location.replace("login.html");
    } catch (err) {
      setStatus(auth.mapAuthError(err), true);
    }
  });
})();
