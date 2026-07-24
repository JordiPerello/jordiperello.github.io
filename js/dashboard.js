(function () {
  const auth = window.TourAiAuth;
  const data = window.TourAiAccountData;
  const signedInPanel = document.getElementById("dashboardSignedIn");
  const loadingPanel = document.getElementById("dashboardLoading");
  const logoutBtn = document.getElementById("dashboardLogout");
  const statusEl = document.getElementById("dashboardStatus");
  const planDetailModal = document.getElementById("planDetailModal");
  const planDetailBody = document.getElementById("planDetailBody");
  let currentUser = null;
  let planDetailBusy = false;

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
    if (typeof auth.forceSignedOutNav === "function") {
      auth.forceSignedOutNav();
    } else if (typeof auth.clearNavProfileCache === "function") {
      auth.clearNavProfileCache();
    }
    const target = new URL("login.html", window.location.href);
    target.searchParams.set("next", "dashboard.html");
    window.location.replace(target.toString());
  }

  function setSectionState(section, state, html) {
    const body = section.querySelector("[data-section-body]");
    if (!body) {
      return;
    }
    section.dataset.loadState = state;
    if (html !== undefined) {
      body.innerHTML = html;
    }
  }

  function closePlanDetail() {
    if (!planDetailModal) {
      return;
    }
    planDetailModal.classList.remove("is-open");
    planDetailModal.hidden = true;
    planDetailModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (planDetailBody) {
      planDetailBody.innerHTML = "";
    }
  }

  async function openPlanDetail(planId) {
    if (!currentUser || !planId || planDetailBusy || !planDetailModal || !planDetailBody) {
      return;
    }

    const plan = data.getPlanById(planId);
    if (!plan) {
      setStatus(t("account.plan.detail.missing", "No se encontró el plan seleccionado."), true);
      return;
    }

    planDetailBusy = true;
    planDetailBody.innerHTML = `<p class="account-empty">${t(
      "dashboard.section.loading",
      "Cargando..."
    )}</p>`;
    planDetailModal.hidden = false;
    planDetailModal.classList.add("is-open");
    planDetailModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    try {
      const usages = await data.fetchTokenUsage(currentUser, planId);
      planDetailBody.innerHTML = data.renderPlanDetailHtml(plan, usages);
      const title = planDetailBody.querySelector(".plan-detail__title");
      if (title) {
        title.id = "planDetailTitle";
      }
    } catch (err) {
      console.error("[TourAI dashboard] plan detail", err);
      planDetailBody.innerHTML = `<p class="account-empty account-empty--error">${
        auth.mapAuthError(err) ||
        t("account.plan.detail.error", "No se pudo cargar el detalle del plan.")
      }</p>
      <div class="plan-detail__actions">
        <button type="button" class="btn-secondary" data-close-plan-detail>${t(
          "account.plan.detail.back",
          "Anterior"
        )}</button>
      </div>`;
    } finally {
      planDetailBusy = false;
    }
  }

  async function loadSection(section) {
    if (!currentUser) {
      return;
    }

    const key = section.getAttribute("data-section");
    const state = section.dataset.loadState;
    if (state === "loaded" || state === "loading") {
      return;
    }

    setSectionState(
      section,
      "loading",
      `<p class="account-empty">${t("dashboard.section.loading", "Cargando...")}</p>`
    );

    try {
      let html = "";
      if (key === "activePlan" || key === "plans") {
        const plans = await data.fetchPlans(currentUser);
        html = key === "activePlan" ? data.renderActivePlanHtml(plans) : data.renderPlansHtml(plans);
      } else if (key === "payments") {
        const payments = await data.fetchPayments(currentUser);
        html = data.renderPaymentsHtml(payments);
        const note = t(
          "account.payment.buyNote",
          "La compra de planes desde la web llegará en la siguiente fase."
        );
        html += `<p class="account-note">${note}</p>`;
      } else {
        html = `<p class="account-empty">${t("dashboard.section.unknown", "Sección no disponible.")}</p>`;
      }
      setSectionState(section, "loaded", html);
    } catch (err) {
      console.error("[TourAI dashboard]", key, err);
      setSectionState(
        section,
        "error",
        `<p class="account-empty account-empty--error">${
          auth.mapAuthError(err) || t("account.error.load", "No se pudieron cargar los datos.")
        }</p>`
      );
    }
  }

  function toggleSection(section, forceOpen) {
    const toggle = section.querySelector(".account-accordion__toggle");
    const panel = section.querySelector(".account-accordion__panel");
    if (!toggle || !panel) {
      return;
    }

    const willOpen = forceOpen === true ? true : forceOpen === false ? false : !section.classList.contains("is-open");
    section.classList.toggle("is-open", willOpen);
    toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
    panel.hidden = !willOpen;

    if (willOpen) {
      loadSection(section);
    }
  }

  document.querySelectorAll("[data-section]").forEach((section) => {
    const toggle = section.querySelector(".account-accordion__toggle");
    toggle?.addEventListener("click", function () {
      toggleSection(section);
    });
  });

  document.addEventListener("click", function (event) {
    const closer = event.target.closest("[data-close-plan-detail]");
    if (closer) {
      closePlanDetail();
      return;
    }

    if (event.target === planDetailModal) {
      closePlanDetail();
      return;
    }

    const card = event.target.closest(".plan-list-card--interactive[data-plan-id]");
    if (!card) {
      return;
    }
    const section = card.closest('[data-section="plans"], [data-section="activePlan"]');
    if (!section) {
      return;
    }
    openPlanDetail(card.getAttribute("data-plan-id"));
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && planDetailModal?.classList.contains("is-open")) {
      closePlanDetail();
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const card = event.target.closest?.(".plan-list-card--interactive[data-plan-id]");
    if (!card || !card.closest('[data-section="plans"], [data-section="activePlan"]')) {
      return;
    }
    event.preventDefault();
    openPlanDetail(card.getAttribute("data-plan-id"));
  });

  auth
    .onAuthStateChanged(async function (user) {
      if (!user) {
        redirectToLogin();
        return;
      }
      currentUser = user;
      showSignedIn();
      setStatus("", false);
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
