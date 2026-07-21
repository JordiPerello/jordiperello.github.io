/*
 * Shared account/dashboard Firestore helpers (lazy section loads).
 */
(function (global) {
  const cache = {
    profile: null,
    plans: null,
    payments: null,
    uid: null,
  };

  function authApi() {
    return global.TourAiAuth;
  }

  function t(key, fallback) {
    return authApi()?.t?.(key, fallback) ?? fallback;
  }

  function resetCacheIfNeeded(uid) {
    if (cache.uid !== uid) {
      cache.uid = uid;
      cache.profile = null;
      cache.plans = null;
      cache.payments = null;
    }
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
    const locale = global.TourAiI18n?.getLocale?.() || "es-ES";
    return date.toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function formatMoney(amountCents, currency) {
    const cents = Number(amountCents) || 0;
    const code = (currency || "EUR").toUpperCase();
    const locale = global.TourAiI18n?.getLocale?.() || "es-ES";
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: code,
      }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2)} ${code}`;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  async function fetchProfile(user) {
    resetCacheIfNeeded(user.uid);
    if (cache.profile) {
      return cache.profile;
    }
    const db = await authApi().getFirestore();
    const snap = await db.collection("Users").doc(user.uid).get();
    cache.profile = {
      ...(snap.exists ? snap.data() : {}),
      AuthEmail: user.email || "",
    };
    return cache.profile;
  }

  async function fetchPlans(user) {
    resetCacheIfNeeded(user.uid);
    if (cache.plans) {
      return cache.plans;
    }
    const db = await authApi().getFirestore();
    const snap = await db.collection("Users").doc(user.uid).collection("UserPlans").get();
    cache.plans = snap.docs.map((doc) => ({ Id: doc.id, ...doc.data() }));
    return cache.plans;
  }

  async function fetchPayments(user) {
    resetCacheIfNeeded(user.uid);
    if (cache.payments) {
      return cache.payments;
    }
    const db = await authApi().getFirestore();
    const snap = await db.collection("Users").doc(user.uid).collection("UserPayments").get();
    cache.payments = snap.docs.map((doc) => ({ Id: doc.id, ...doc.data() }));
    return cache.payments;
  }

  function renderActivePlanHtml(plans) {
    const active = plans.find((p) => planState(p) === "active");
    if (!active) {
      return `<p class="account-empty">${t(
        "account.plan.freemium",
        "Ahora mismo usas Freemium en la app. El cupo diario de uso gratuito se gestiona en el dispositivo (anuncios recompensados) y no aparece aquí."
      )}</p>`;
    }

    const included = Number(active.TokensIncluded) || 0;
    const consumed = Number(active.TokensConsumed) || 0;
    const remaining = Math.max(0, included - consumed);

    return `
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

  function renderPlansHtml(plans) {
    if (!plans.length) {
      return `<p class="account-empty">${t(
        "account.plan.empty",
        "Aún no tienes planes Premium guardados en la cuenta."
      )}</p>`;
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

    return `
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

  function renderPaymentsHtml(payments) {
    if (!payments.length) {
      return `<p class="account-empty">${t(
        "account.payment.empty",
        "Todavía no hay pagos registrados."
      )}</p>`;
    }

    const rows = payments
      .slice()
      .sort((a, b) => (toDate(b.CreatedAt)?.getTime() || 0) - (toDate(a.CreatedAt)?.getTime() || 0))
      .map((payment) => {
        const method = payment.PaymentMethod || payment.PaymentMethodStatus || "—";
        return `<tr>
          <td>${formatDate(payment.CreatedAt)}</td>
          <td>${formatMoney(payment.Amount, payment.Currency)}</td>
          <td>${escapeHtml(methodLabel(method))}</td>
          <td>${escapeHtml(paymentStatusLabel(payment.PaymentStatus))}</td>
        </tr>`;
      })
      .join("");

    return `
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

  function clearCache() {
    cache.uid = null;
    cache.profile = null;
    cache.plans = null;
    cache.payments = null;
  }

  global.TourAiAccountData = {
    t,
    fetchProfile,
    fetchPlans,
    fetchPayments,
    renderActivePlanHtml,
    renderPlansHtml,
    renderPaymentsHtml,
    clearCache,
  };
})(window);
