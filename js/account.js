(function () {
  const auth = window.TourAiAuth;
  const emailEl = document.getElementById("accountEmail");
  const nameEl = document.getElementById("accountDisplayName");
  const typeEl = document.getElementById("accountType");
  const statusEl = document.getElementById("accountStatus");
  const signedInPanel = document.getElementById("accountSignedIn");
  const loadingPanel = document.getElementById("accountLoading");
  const logoutBtn = document.getElementById("accountLogout");
  const activePlanEl = document.getElementById("activePlanSummary");
  const plansListEl = document.getElementById("plansList");
  const paymentsListEl = document.getElementById("paymentsList");

  if (!auth) {
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

  function toDate(value) {
    if (!value) {
      return null;
    }
    if (typeof value.toDate === "function") {
      return value.toDate();
    }
    if (typeof value.seconds === "number") {
      return new Date(value.seconds * 1000);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatDate(value) {
    const date = toDate(value);
    if (!date) {
      return "—";
    }
    const locale = window.TourAiI18n?.getLocale?.() || "es-ES";
    return date.toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function formatMoney(amountCents, currency) {
    const cents = Number(amountCents) || 0;
    const code = (currency || "EUR").toUpperCase();
    const locale = window.TourAiI18n?.getLocale?.() || "es-ES";
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: code,
      }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2)} ${code}`;
    }
  }

  function planState(plan) {
    const now = Date.now();
    const start = toDate(plan.StartDate);
    const end = toDate(plan.EndDate);
    const expiry = toDate(plan.ExpiryDate);
    const included = Number(plan.TokensIncluded) || 0;
    const consumed = Number(plan.TokensConsumed) || 0;
    const remaining = included - consumed;
    const consumedOut = included > 0 && remaining <= 0;

    if (!start && expiry && expiry.getTime() >= now) {
      return "pending";
    }
    if (start && end && now >= start.getTime() && now <= end.getTime() && !consumedOut) {
      return "active";
    }
    if (consumedOut) {
      return "consumed";
    }
    if (expiry && now >= expiry.getTime()) {
      return "expired";
    }
    if (end && now > end.getTime()) {
      return "expired";
    }
    return "other";
  }

  function stateLabel(state) {
    switch (state) {
      case "active":
        return t("account.plan.state.active", "En uso");
      case "pending":
        return t("account.plan.state.pending", "Pendiente de activar");
      case "consumed":
        return t("account.plan.state.consumed", "Cupo agotado");
      case "expired":
        return t("account.plan.state.expired", "Caducado");
      default:
        return t("account.plan.state.other", "Otro");
    }
  }

  function paymentStatusLabel(status) {
    switch ((status || "").toString()) {
      case "Paid":
        return t("account.payment.status.paid", "Pagado");
      case "Pending":
        return t("account.payment.status.pending", "Pendiente");
      case "Failed":
        return t("account.payment.status.failed", "Fallido");
      case "Free":
        return t("account.payment.status.free", "Gratis");
      default:
        return status || "—";
    }
  }

  function methodLabel(method) {
    switch ((method || "").toString()) {
      case "Stripe":
        return "Stripe";
      case "Google":
        return "Google Play";
      case "Apple":
        return "App Store";
      case "Windows":
        return "Microsoft Store";
      case "Promo":
        return t("account.payment.method.promo", "Promoción");
      default:
        return method || "—";
    }
  }

  function renderActivePlan(plans) {
    if (!activePlanEl) {
      return;
    }

    const active = plans.find((p) => planState(p) === "active");
    if (!active) {
      activePlanEl.innerHTML = `
        <p class="account-empty">${t(
          "account.plan.freemium",
          "Ahora mismo usas Freemium en la app. El cupo diario de uso gratuito se gestiona en el dispositivo (anuncios recompensados) y no aparece aquí."
        )}</p>`;
      return;
    }

    const included = Number(active.TokensIncluded) || 0;
    const consumed = Number(active.TokensConsumed) || 0;
    const remaining = Math.max(0, included - consumed);

    activePlanEl.innerHTML = `
      <dl class="account-meta">
        <dt>${t("account.plan.name", "Plan")}</dt>
        <dd>${escapeHtml(active.PlanName || active.PlanId || "—")}</dd>
        <dt>${t("account.plan.allowance", "Cupo restante")}</dt>
        <dd>${remaining} / ${included}</dd>
        <dt>${t("account.plan.period", "Periodo")}</dt>
        <dd>${formatDate(active.StartDate)} → ${formatDate(active.EndDate)}</dd>
        <dt>${t("account.plan.status", "Estado")}</dt>
        <dd><span class="account-badge account-badge--active">${stateLabel("active")}</span></dd>
      </dl>`;
  }

  function renderPlans(plans) {
    if (!plansListEl) {
      return;
    }

    if (!plans.length) {
      plansListEl.innerHTML = `<p class="account-empty">${t(
        "account.plan.empty",
        "Aún no tienes planes Premium guardados en la cuenta."
      )}</p>`;
      return;
    }

    const rows = plans
      .slice()
      .sort((a, b) => (toDate(b.CreatedAt)?.getTime() || 0) - (toDate(a.CreatedAt)?.getTime() || 0))
      .map((plan) => {
        const state = planState(plan);
        const included = Number(plan.TokensIncluded) || 0;
        const consumed = Number(plan.TokensConsumed) || 0;
        const remaining = Math.max(0, included - consumed);
        return `<tr>
          <td>${escapeHtml(plan.PlanName || plan.PlanId || "—")}</td>
          <td>${stateLabel(state)}</td>
          <td>${remaining}/${included}</td>
          <td>${formatDate(plan.StartDate)}</td>
          <td>${formatDate(plan.EndDate || plan.ExpiryDate)}</td>
        </tr>`;
      })
      .join("");

    plansListEl.innerHTML = `
      <div class="account-table-wrap">
        <table class="account-table">
          <thead>
            <tr>
              <th>${t("account.plan.name", "Plan")}</th>
              <th>${t("account.plan.status", "Estado")}</th>
              <th>${t("account.plan.allowance", "Cupo")}</th>
              <th>${t("account.plan.start", "Inicio")}</th>
              <th>${t("account.plan.end", "Fin")}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function renderPayments(payments) {
    if (!paymentsListEl) {
      return;
    }

    if (!payments.length) {
      paymentsListEl.innerHTML = `<p class="account-empty">${t(
        "account.payment.empty",
        "Todavía no hay pagos registrados."
      )}</p>`;
      return;
    }

    const rows = payments
      .slice()
      .sort((a, b) => (toDate(b.CreatedAt)?.getTime() || 0) - (toDate(a.CreatedAt)?.getTime() || 0))
      .map((payment) => {
        const method =
          payment.PaymentMethod ||
          payment.PaymentMethodStatus ||
          "—";
        return `<tr>
          <td>${formatDate(payment.CreatedAt)}</td>
          <td>${formatMoney(payment.Amount, payment.Currency)}</td>
          <td>${escapeHtml(methodLabel(method))}</td>
          <td>${escapeHtml(paymentStatusLabel(payment.PaymentStatus))}</td>
        </tr>`;
      })
      .join("");

    paymentsListEl.innerHTML = `
      <div class="account-table-wrap">
        <table class="account-table">
          <thead>
            <tr>
              <th>${t("account.payment.date", "Fecha")}</th>
              <th>${t("account.payment.amount", "Importe")}</th>
              <th>${t("account.payment.method", "Método")}</th>
              <th>${t("account.payment.status", "Estado")}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function loadDashboard(user) {
    const db = await auth.getFirestore();
    const uid = user.uid;

    const [userSnap, plansSnap, paymentsSnap] = await Promise.all([
      db.collection("Users").doc(uid).get(),
      db.collection("Users").doc(uid).collection("UserPlans").get(),
      db.collection("Users").doc(uid).collection("UserPayments").get(),
    ]);

    const profile = userSnap.exists ? userSnap.data() : {};
    if (emailEl) {
      emailEl.textContent = profile.Email || user.email || "—";
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

    const plans = plansSnap.docs.map((doc) => ({ Id: doc.id, ...doc.data() }));
    const payments = paymentsSnap.docs.map((doc) => ({ Id: doc.id, ...doc.data() }));

    renderActivePlan(plans);
    renderPlans(plans);
    renderPayments(payments);
  }

  function showSignedIn() {
    if (loadingPanel) {
      loadingPanel.hidden = true;
    }
    if (signedInPanel) {
      signedInPanel.hidden = false;
    }
  }

  auth
    .onAuthStateChanged(async function (user) {
      if (!user) {
        const target = new URL("login.html", window.location.href);
        target.searchParams.set("next", "account.html");
        window.location.replace(target.toString());
        return;
      }

      showSignedIn();
      setStatus(t("account.loadingData", "Cargando tus datos..."), false);
      try {
        await loadDashboard(user);
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
      const target = new URL("login.html", window.location.href);
      target.searchParams.set("next", "account.html");
      window.location.replace(target.toString());
    });

  logoutBtn?.addEventListener("click", async function () {
    setStatus(t("account.status.signingOut", "Cerrando sesión..."), false);
    try {
      await auth.signOut();
      window.location.replace("login.html");
    } catch (err) {
      setStatus(auth.mapAuthError(err), true);
    }
  });
})();
