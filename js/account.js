/* TourAI account: shared data helpers + account page + dashboard page */
/*
 * Shared account/dashboard Firestore helpers (lazy section loads).
 */
(function (global) {
  const cache = {
    profile: null,
    plans: null,
    payments: null,
    stripeStatusByPaymentId: {},
    uid: null,
  };

  const PLANS_PAGE = 4;
  const PAYMENTS_PAGE = 5;
  const USAGE_PAGE = 5;

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
      cache.stripeStatusByPaymentId = {};
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

  function formatDateTime(value) {
    const date = toDate(value);
    if (!date) {
      return "—";
    }
    const locale = global.TourAiI18n?.getLocale?.() || "es-ES";
    return date.toLocaleString(locale, {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
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
        return t("account.plan.state.active");
      case "pending":
        return t("account.plan.state.pending");
      case "consumed":
        return t("account.plan.state.consumed");
      case "expired":
        return t("account.plan.state.expired");
      case "freemium":
        return t("account.plan.state.freemium");
      default:
        return t("account.plan.state.other");
    }
  }

  function planStatusMeta(plan) {
    const accountType = String(plan.AccountType || "Premium");
    if (accountType === "Freemium") {
      return { state: "freemium", label: stateLabel("freemium") };
    }
    const state = planState(plan);
    return { state: state, label: stateLabel(state) };
  }

  function isBonusPlan(plan) {
    const type = plan.AcquisitionType;
    return type === "Bonus" || type === 1 || type === "1";
  }

  function acquisitionLabel(plan) {
    return isBonusPlan(plan)
      ? t("account.plan.acquisition.bonus")
      : t("account.plan.acquisition.purchase");
  }

  function paymentStatusLabel(statusOrRecord) {
    var status;
    var failureReason = "";
    if (statusOrRecord && typeof statusOrRecord === "object") {
      status = String(statusOrRecord.PaymentStatus || "");
      failureReason = String(statusOrRecord.PaymentFailureReason || "");
    } else {
      status = String(statusOrRecord || "");
    }

    switch (status) {
      case "Paid":
        return t("account.payment.status.paid");
      case "Pending":
        return t("account.payment.status.pending");
      case "Failed":
        if (failureReason === "checkout_cancelled_by_user") {
          return t("account.payment.status.cancelled");
        }
        if (failureReason === "stripe_checkout_session_expired") {
          return t("account.payment.status.notCompleted");
        }
        return t("account.payment.status.failed");
      case "Free":
        return t("account.payment.status.free");
      default:
        return status || "—";
    }
  }

  function paymentStatusTone(statusOrRecord) {
    var status;
    var failureReason = "";
    if (statusOrRecord && typeof statusOrRecord === "object") {
      status = String(statusOrRecord.PaymentStatus || "");
      failureReason = String(statusOrRecord.PaymentFailureReason || "");
    } else {
      status = String(statusOrRecord || "");
    }

    switch (status) {
      case "Paid":
      case "Free":
        return "paid";
      case "Pending":
        return "pending";
      case "Failed":
        if (failureReason === "checkout_cancelled_by_user") {
          return "cancelled";
        }
        if (failureReason === "stripe_checkout_session_expired") {
          return "pending";
        }
        return "cancelled";
      default:
        return "neutral";
    }
  }

  function paymentStatusHtml(statusOrRecord) {
    const label = paymentStatusLabel(statusOrRecord);
    const tone = paymentStatusTone(statusOrRecord);
    if (tone === "neutral") {
      return escapeHtml(label);
    }
    return `<span class="account-payment-status account-payment-status--${tone}">${escapeHtml(
      label
    )}</span>`;
  }

  function stripePaymentStatusTone(stripePaymentStatus, stripeSessionStatus) {
    if (String(stripeSessionStatus || "") === "cancelled") {
      return "cancelled";
    }
    switch (String(stripePaymentStatus || "")) {
      case "paid":
        return "paid";
      case "unpaid":
        return "pending";
      default:
        return "neutral";
    }
  }

  function stripePaymentStatusHtml(stripePaymentStatus, stripeSessionStatus) {
    const label = stripePaymentStatusLabel(stripePaymentStatus, stripeSessionStatus);
    const tone = stripePaymentStatusTone(stripePaymentStatus, stripeSessionStatus);
    if (tone === "neutral") {
      return escapeHtml(label);
    }
    return `<span class="account-payment-status account-payment-status--${tone}">${escapeHtml(
      label
    )}</span>`;
  }

  function reconcileStripeCheckoutUrl() {
    return String(global.TourAiSite?.config?.reconcileStripeCheckoutUrl || "").trim();
  }

  function cancelStripeCheckoutUrl() {
    return String(global.TourAiSite?.config?.cancelStripeCheckoutUrl || "").trim();
  }

  function resolveStripePaymentStatus(payment) {
    return String(payment?.StripePaymentStatus || "").trim();
  }

  function stripePaymentStatusLabel(stripePaymentStatus, stripeSessionStatus) {
    if (String(stripeSessionStatus || "") === "cancelled") {
      return t("account.payment.stripeStatus.cancelled");
    }

    switch ((stripePaymentStatus || "").toString()) {
      case "paid":
        return t("account.payment.stripeStatus.paid");
      case "unpaid":
        return t("account.payment.stripeStatus.unpaid");
      case null:
      case "":
        return t("account.payment.stripeStatus.none");
      default:
        return t("account.payment.stripeStatus.unknown");
    }
  }

  async function cancelStripePayment(user, payment) {
    const url = cancelStripeCheckoutUrl();
    if (!url || !user || !payment?.Id) {
      return null;
    }

    const idToken = await user.getIdToken();
    const appCheckToken = await global.TourAiAppCheck.getToken(false);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + idToken,
        "X-Firebase-AppCheck": appCheckToken,
      },
      body: JSON.stringify({
        userId: user.uid,
        userPaymentId: payment.Id,
      }),
    });

    let body = null;
    try {
      body = await response.json();
    } catch (err) {
      body = null;
    }

    if (!response.ok || !body?.success) {
      return null;
    }

    if (cache.payments) {
      const match = cache.payments.find(function (item) {
        return item.Id === payment.Id;
      });
      if (match && body.cancelled) {
        match.PaymentStatus = "Failed";
        match.PaymentFailureReason = body.paymentFailureReason || "checkout_cancelled_by_user";
        match.StripePaymentStatus = "unpaid";
        match.StripeSessionStatus = "cancelled";
      }
    }

    if (body.cancelled && cache.plans && payment.UserPlanId) {
      const plan = cache.plans.find(function (item) {
        return item.Id === payment.UserPlanId;
      });
      if (plan) {
        plan.PaymentStatus = "Failed";
        plan.PaymentFailureReason = body.paymentFailureReason || "checkout_cancelled_by_user";
      }
    }

    return body;
  }

  async function cancelStripePaymentById(user, userPaymentId) {
    if (!user || !userPaymentId) {
      return null;
    }
    return cancelStripePayment(user, { Id: userPaymentId });
  }

  async function reconcileStripePayment(user, payment) {
    const url = reconcileStripeCheckoutUrl();
    if (!url || !user || !payment?.Id) {
      return null;
    }

    const idToken = await user.getIdToken();
    const appCheckToken = await global.TourAiAppCheck.getToken(false);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + idToken,
        "X-Firebase-AppCheck": appCheckToken,
      },
      body: JSON.stringify({
        userId: user.uid,
        userPaymentId: payment.Id,
      }),
    });

    let body = null;
    try {
      body = await response.json();
    } catch (err) {
      body = null;
    }

    if (!response.ok || !body?.success) {
      return null;
    }

    if (cache.payments) {
      const match = cache.payments.find(function (item) {
        return item.Id === payment.Id;
      });
      if (match) {
        if (body.reconciled) {
          match.PaymentStatus = "Paid";
        }
        if (body.markedFailed) {
          match.PaymentStatus = "Failed";
        }
        if (body.stripePaymentStatus) {
          match.StripePaymentStatus = body.stripePaymentStatus;
        }
        if (body.stripeSessionStatus) {
          match.StripeSessionStatus = body.stripeSessionStatus;
        }
      }
    }

    if (body.reconciled && cache.plans && payment.UserPlanId) {
      const plan = cache.plans.find(function (item) {
        return item.Id === payment.UserPlanId;
      });
      if (plan) {
        plan.PaymentStatus = "Paid";
      }
    }

    if (body.markedFailed && cache.plans && payment.UserPlanId) {
      const plan = cache.plans.find(function (item) {
        return item.Id === payment.UserPlanId;
      });
      if (plan) {
        plan.PaymentStatus = "Failed";
      }
    }

    cache.stripeStatusByPaymentId[payment.Id] = {
      stripePaymentStatus: body.stripePaymentStatus,
      stripeSessionStatus: body.stripeSessionStatus,
      sessionId: body.sessionId,
      firestoreStatus: body.firestoreStatus,
      reconciled: body.reconciled === true,
      markedFailed: body.markedFailed === true,
    };

    return cache.stripeStatusByPaymentId[payment.Id];
  }

  async function reconcileStripePaymentById(user, userPaymentId) {
    if (!user || !userPaymentId) {
      return null;
    }
    return reconcileStripePayment(user, { Id: userPaymentId });
  }

  function isPendingStripePayment(payment) {
    const method = payment?.PaymentMethod || payment?.PaymentMethodStatus || "";
    return (
      String(payment?.PaymentStatus || "") === "Pending"
      && String(method) === "Stripe"
      && String(payment?.StripeSessionStatus || "") !== "expired"
      && String(payment?.StripeSessionStatus || "") !== "cancelled"
    );
  }

  async function enrichStripePaymentStatuses(user, payments) {
    if (!user || !payments?.length) {
      return;
    }

    const pendingStripe = payments.filter(isPendingStripePayment);

    await Promise.all(
      pendingStripe.map(function (payment) {
        return reconcileStripePayment(user, payment);
      })
    );
  }

  async function fetchAllPaymentsPages(user) {
    let cursor = null;
    let hasMore = true;

    while (hasMore) {
      const page = await fetchPaymentsPage(user, cursor);
      hasMore = page.hasMore;
      cursor = page.cursor;
      if (!page.items.length) {
        break;
      }
    }

    return cache.payments || [];
  }

  async function reconcileAllPendingStripePayments(user) {
    if (!user || !reconcileStripeCheckoutUrl()) {
      return;
    }

    try {
      const payments = await fetchAllPaymentsPages(user);
      await enrichStripePaymentStatuses(user, payments);
      cache.plans = null;
      cache.payments = null;
    } catch (err) {
      console.error("[TourAI account] reconcile pending Stripe payments", err);
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
        return t("account.payment.method.promo");
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
    // Prefer paged API; this loads only the first block if something still calls it.
    const page = await fetchPlansPage(user, null);
    return cache.plans || page.items;
  }

  async function fetchPayments(user) {
    resetCacheIfNeeded(user.uid);
    if (cache.payments) {
      return cache.payments;
    }
    const page = await fetchPaymentsPage(user, null);
    return cache.payments || page.items;
  }

  function mergeById(existing, items) {
    const list = existing ? existing.slice() : [];
    items.forEach(function (item) {
      const idx = list.findIndex(function (row) {
        return row.Id === item.Id;
      });
      if (idx >= 0) {
        list[idx] = item;
      } else {
        list.push(item);
      }
    });
    return list;
  }

  async function fetchPlansPage(user, cursorDoc) {
    resetCacheIfNeeded(user.uid);
    const db = await authApi().getFirestore();
    let query = db
      .collection("Users")
      .doc(user.uid)
      .collection("UserPlans")
      .orderBy("CreatedAt", "desc")
      .limit(PLANS_PAGE);
    if (cursorDoc) {
      query = query.startAfter(cursorDoc);
    }
    const snap = await query.get();
    const items = snap.docs.map(function (doc) {
      return { Id: doc.id, _doc: doc, ...doc.data() };
    });
    cache.plans = mergeById(cache.plans, items);
    return {
      items: items,
      cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
      hasMore: snap.docs.length >= PLANS_PAGE,
    };
  }

  async function fetchPaymentsPage(user, cursorDoc) {
    resetCacheIfNeeded(user.uid);
    const db = await authApi().getFirestore();
    let query = db
      .collection("Users")
      .doc(user.uid)
      .collection("UserPayments")
      .orderBy("CreatedAt", "desc")
      .limit(PAYMENTS_PAGE);
    if (cursorDoc) {
      query = query.startAfter(cursorDoc);
    }
    const snap = await query.get();
    const items = snap.docs.map(function (doc) {
      return { Id: doc.id, _doc: doc, ...doc.data() };
    });
    cache.payments = mergeById(cache.payments, items);
    return {
      items: items,
      cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
      hasMore: snap.docs.length >= PAYMENTS_PAGE,
    };
  }

  async function fetchActivePlan(user) {
    let cursor = null;
    for (let i = 0; i < 3; i += 1) {
      const page = await fetchPlansPage(user, cursor);
      const active = page.items.find(function (plan) {
        return planState(plan) === "active";
      });
      if (active) {
        return active;
      }
      if (!page.hasMore) {
        break;
      }
      cursor = page.cursor;
    }
    return null;
  }

  function renderActivePlanHtml(plansOrActive) {
    const active = Array.isArray(plansOrActive)
      ? plansOrActive.find((p) => planState(p) === "active")
      : plansOrActive;
    if (!active) {
      return renderFreemiumPromoHtml();
    }

    return `<div class="plan-list">${renderPlanCardHtml(active, { interactive: true })}</div>`;
  }

  function renderFreemiumPromoHtml() {
    const title = escapeHtml(t("account.plan.freemium.promoTitle"));
    const body = escapeHtml(t("account.plan.freemium.promoBody"));
    const cta = escapeHtml(t("account.plan.freemium.promoCta"));
    const note = escapeHtml(t("account.plan.freemium.promoNote"));

    return `<aside class="plan-freemium-promo" role="note">
  <p class="plan-freemium-promo__eyebrow">${escapeHtml(
    t("account.plan.state.freemium")
  )}</p>
  <h3 class="plan-freemium-promo__title">${title}</h3>
  <p class="plan-freemium-promo__body">${body}</p>
  <p class="plan-freemium-promo__actions">
    <a class="btn-primary" href="dashboard.html#buy-plans-section" data-buy-premium="true">${cta}</a>
  </p>
  <p class="account-note">${note}</p>
</aside>`;
  }

  function planSortKey(plan, state) {
    switch (state) {
      case "active":
      case "consumed":
        return toDate(plan.StartDate)?.getTime() || 0;
      case "pending":
      case "expired":
        return toDate(plan.ExpiryDate)?.getTime() || toDate(plan.EndDate)?.getTime() || 0;
      default:
        return toDate(plan.CreatedAt)?.getTime() || 0;
    }
  }

  function isAcquiredPlan(plan) {
    if (!plan || String(plan.AccountType || "") === "Freemium") {
      return false;
    }
    const status = String(plan.PaymentStatus || "");
    return status === "Paid" || status === "Free";
  }

  function orderPlansLikeApp(plans) {
    // Same grouping as UserPlansHistoryView: InUse → Pending → Consumed → Expired → Other.
    const groups = {
      active: [],
      pending: [],
      consumed: [],
      expired: [],
      other: [],
    };

    plans.forEach(function (plan) {
      if (!isAcquiredPlan(plan)) {
        return;
      }
      const state = planState(plan);
      const bucket = groups[state] ? state : "other";
      groups[bucket].push(plan);
    });

    ["active", "pending", "consumed", "expired", "other"].forEach(function (state) {
      groups[state].sort(function (a, b) {
        return planSortKey(b, state) - planSortKey(a, state);
      });
    });

    return groups.active
      .concat(groups.pending)
      .concat(groups.consumed)
      .concat(groups.expired)
      .concat(groups.other);
  }

  function renderPlanCardHtml(plan, options) {
    const opts = options || {};
    const interactive = opts.interactive !== false;
    const status = planStatusMeta(plan);
    const planId = escapeHtml(plan.Id || "");
    const name = escapeHtml(plan.PlanName || plan.PlanId || "—");
    const description = String(plan.PlanDescription || "").trim();
    const accountType = escapeHtml(String(plan.AccountType || "Premium").toUpperCase());
    const acquisition = escapeHtml(acquisitionLabel(plan).toUpperCase());
    const start = formatDateTime(plan.StartDate);
    const end = formatDateTime(plan.EndDate || plan.ExpiryDate);
    const paymentStatus = String(plan.PaymentStatus || "");
    const showPaymentStatus =
      String(plan.AccountType || "") !== "Freemium"
      && paymentStatus
      && paymentStatus !== "Paid";
    const interactiveAttrs = interactive
      ? ` role="button" tabindex="0" data-plan-id="${planId}" aria-label="${escapeHtml(
          t("account.plan.openDetail")
        )}: ${name}"`
      : "";

    return `<article class="plan-list-card${interactive ? " plan-list-card--interactive" : ""}" data-plan-state="${escapeHtml(
      status.state
    )}"${interactiveAttrs}>
      <div class="plan-list-card__header">
        <span class="plan-list-card__bullet" aria-hidden="true"></span>
        <div class="plan-list-card__titles">
          <h3 class="plan-list-card__title">${name}</h3>
          <p class="plan-list-card__status">${escapeHtml(status.label)}</p>
        </div>
      </div>
      ${
        description
          ? `<p class="plan-list-card__description">${escapeHtml(description)}</p>`
          : ""
      }
      <div class="plan-list-card__divider" aria-hidden="true"></div>
      <dl class="plan-list-card__metrics">
        <div>
          <dt>${t("account.plan.accountType")}</dt>
          <dd class="plan-list-card__metric-accent">${accountType}</dd>
        </div>
        <div>
          <dt>${t("account.plan.acquisition")}</dt>
          <dd class="plan-list-card__metric-accent">${acquisition}</dd>
        </div>
        ${
          showPaymentStatus
            ? `<div>
          <dt>${t("account.plan.paymentStatus")}</dt>
          <dd class="plan-list-card__metric-accent">${paymentStatusHtml(plan)}</dd>
        </div>`
            : ""
        }
        <div>
          <dt>${t("account.plan.start")}</dt>
          <dd class="plan-list-card__metric-date">${escapeHtml(start)}</dd>
        </div>
        <div>
          <dt>${t("account.plan.end")}</dt>
          <dd class="plan-list-card__metric-date">${escapeHtml(end)}</dd>
        </div>
      </dl>
    </article>`;
  }

  function renderPlansHtml(plans, options) {
    const opts = options || {};
    const ordered = orderPlansLikeApp(plans);
    if (!ordered.length && !opts.loading && !opts.hasMore) {
      return `<p class="account-empty">${t("account.plan.empty")}</p>`;
    }

    const cards = ordered.map((plan) => renderPlanCardHtml(plan, { interactive: true })).join("");
    return `<div class="plan-list" data-plans-list>${cards}</div>
      ${opts.loading ? renderSkeletonHtml("plans") : ""}
      ${
        !opts.loading && opts.hasMore
          ? '<div class="tourai-scroll-sentinel" data-plans-sentinel aria-hidden="true"></div>'
          : ""
      }`;
  }

  function getPlanById(planId) {
    if (!cache.plans || !planId) {
      return null;
    }
    return cache.plans.find((p) => p.Id === planId) || null;
  }

  async function fetchTokenUsage(user, planId) {
    const page = await fetchTokenUsagePage(user, planId, null);
    return page.items;
  }

  async function fetchTokenUsagePage(user, planId, cursorDoc) {
    const db = await authApi().getFirestore();
    let query = db
      .collection("Users")
      .doc(user.uid)
      .collection("UserPlans")
      .doc(planId)
      .collection("TokensUsage")
      .orderBy("Date", "asc")
      .limit(USAGE_PAGE);
    if (cursorDoc) {
      query = query.startAfter(cursorDoc);
    }
    const snap = await query.get();
    const items = snap.docs.map(function (doc) {
      return { Id: doc.id, _doc: doc, ...doc.data() };
    });
    return {
      items: items,
      cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
      hasMore: snap.docs.length >= USAGE_PAGE,
    };
  }

  function renderSkeletonHtml(kind) {
    if (kind === "usage") {
      return `<div class="tourai-skeleton tourai-skeleton--usage" aria-hidden="true">
        <div class="tourai-skeleton__row"><div class="tourai-skeleton__line tourai-skeleton__line--lg"></div><div class="tourai-skeleton__line tourai-skeleton__line--sm"></div></div>
        <div class="tourai-skeleton__row"><div class="tourai-skeleton__line tourai-skeleton__line--lg"></div><div class="tourai-skeleton__line tourai-skeleton__line--sm"></div></div>
        <div class="tourai-skeleton__row"><div class="tourai-skeleton__line tourai-skeleton__line--md"></div><div class="tourai-skeleton__line tourai-skeleton__line--sm"></div></div>
      </div>`;
    }
    return `<div class="tourai-skeleton" aria-hidden="true">
      <div class="tourai-skeleton__card"><div class="tourai-skeleton__line tourai-skeleton__line--lg"></div><div class="tourai-skeleton__line tourai-skeleton__line--sm"></div></div>
      <div class="tourai-skeleton__card"><div class="tourai-skeleton__line tourai-skeleton__line--lg"></div><div class="tourai-skeleton__line tourai-skeleton__line--sm"></div></div>
      <div class="tourai-skeleton__card"><div class="tourai-skeleton__line tourai-skeleton__line--lg"></div><div class="tourai-skeleton__line tourai-skeleton__line--sm"></div></div>
    </div>`;
  }

  function renderTokenUsageRowsHtml(usages, options) {
    const opts = options || {};
    if (!usages.length && !opts.loading && !opts.hasMore) {
      return `<p class="account-empty">${t("account.plan.usage.empty")}</p>`;
    }

    const rows = usages
      .map((usage) => {
        const query = escapeHtml(usage.QueryText || "—");
        const date = escapeHtml(formatDateTime(usage.Date));
        return `<div class="plan-usage-row">
          <div class="plan-usage-row__query">${query}</div>
          <div class="plan-usage-row__date">${date}</div>
        </div>`;
      })
      .join("");

    const countLabel = t("account.plan.usage.loaded")
      .split("{loaded}")
      .join(String(usages.length));

    return `<div class="plan-usage-table" role="table" aria-label="${escapeHtml(
      t("account.plan.usage.title")
    )}">
      <div class="plan-usage-table__head" role="row">
        <div class="plan-usage-table__query" role="columnheader">${t("account.plan.usage.query")}</div>
        <div class="plan-usage-table__date" role="columnheader">${t("account.plan.usage.date")}</div>
      </div>
      <div class="plan-usage-table__body" data-usage-body>${rows}</div>
    </div>
    <p class="plan-usage-count" data-usage-count>${escapeHtml(countLabel)}</p>
    ${opts.loading ? renderSkeletonHtml("usage") : ""}
    ${
      !opts.loading && opts.hasMore
        ? '<div class="tourai-scroll-sentinel" data-usage-sentinel aria-hidden="true"></div>'
        : ""
    }`;
  }

  function renderPlanDetailHtml(plan, usages, options) {
    return `<div class="plan-detail">
      <div class="plan-detail__intro">
        <h2 class="plan-detail__title">${t("account.plan.detail.title")}</h2>
        <p class="plan-detail__subtitle">${t("account.plan.detail.subtitle")}</p>
      </div>
      ${renderPlanCardHtml(plan, { interactive: false })}
      <div data-usage-panel>${renderTokenUsageRowsHtml(usages || [], options || {})}</div>
      <div class="plan-detail__actions">
        <button type="button" class="btn-secondary" data-close-plan-detail>${t("account.plan.detail.back")}</button>
      </div>
    </div>`;
  }

  function renderPaymentsHtml(payments, options) {
    const opts = options || {};
    if (!payments.length && !opts.loading && !opts.hasMore) {
      return `<p class="account-empty">${t("account.payment.empty")}</p>`;
    }

    const rows = payments
      .map((payment) => {
        const method = payment.PaymentMethod || payment.PaymentMethodStatus || "—";
        const stripeStatus = resolveStripePaymentStatus(payment);
        const rowTone = paymentStatusTone(payment);
        const rowClass =
          rowTone === "cancelled" ? ' class="account-table__row--cancelled"' : "";
        return `<tr${rowClass}>
          <td>${formatDate(payment.CreatedAt)}</td>
          <td>${formatMoney(payment.Amount, payment.Currency)}</td>
          <td>${escapeHtml(methodLabel(method))}</td>
          <td>${paymentStatusHtml(payment)}</td>
          <td>${stripePaymentStatusHtml(stripeStatus, payment.StripeSessionStatus)}</td>
        </tr>`;
      })
      .join("");

    const table =
      payments.length > 0
        ? `
      <div class="account-table-wrap">
        <table class="account-table">
          <thead>
            <tr>
              <th>${t("account.payment.date")}</th>
              <th>${t("account.payment.amount")}</th>
              <th>${t("account.payment.method")}</th>
              <th>${t("account.payment.status")}</th>
              <th>${t("account.payment.stripeStatus")}</th>
            </tr>
          </thead>
          <tbody data-payments-body>${rows}</tbody>
        </table>
      </div>`
        : "";

    return `${table}
      ${opts.loading ? renderSkeletonHtml("payments") : ""}
      ${
        !opts.loading && opts.hasMore
          ? '<div class="tourai-scroll-sentinel" data-payments-sentinel aria-hidden="true"></div>'
          : ""
      }`;
  }

  function clearCache() {
    cache.uid = null;
    cache.profile = null;
    cache.plans = null;
    cache.payments = null;
    cache.stripeStatusByPaymentId = {};
  }

  function getStorageBucket() {
    const cfg = global.TourAiSite?.config?.firebaseAuth;
    if (cfg?.storageBucket) {
      return String(cfg.storageBucket).trim();
    }
    if (cfg?.projectId) {
      return String(cfg.projectId).trim() + ".firebasestorage.app";
    }
    return "";
  }

  function profilePhotoUrls(profile, user) {
    const uid = user?.uid || profile?.Id || "";
    const urls = [];
    const seen = Object.create(null);
    function add(url) {
      const value = String(url || "").trim();
      if (!value || seen[value]) {
        return;
      }
      seen[value] = true;
      urls.push(value);
    }
    add(profile?.PhotoOriginalUrl);
    add(user?.photoURL);
    const bucket = getStorageBucket();
    if (bucket && uid) {
      add(
        "https://firebasestorage.googleapis.com/v0/b/" +
          encodeURIComponent(bucket) +
          "/o/" +
          encodeURIComponent("userPhotoOriginal_" + uid + ".jpg") +
          "?alt=media"
      );
    }
    return urls;
  }

  function profileInitials(name, email) {
    const n = String(name || "").trim();
    if (n) {
      const parts = n.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
      }
      if (n.length >= 2) {
        return n.slice(0, 2).toUpperCase();
      }
      return (n.charAt(0) + n.charAt(0)).toUpperCase();
    }
    const local = String(email || "").split("@")[0];
    if (local.length >= 2) {
      return local.slice(0, 2).toUpperCase();
    }
    return "?";
  }

  function formatBirthDateInput(value) {
    const date = toDate(value);
    if (!date) {
      return "";
    }
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  }

  function profilePhotoViewport() {
    return { size: 120, radius: 58 };
  }

  function normalizePhotoCrop(cropOrProfile) {
    const offsetX = Number(
      cropOrProfile?.offsetXNorm ?? cropOrProfile?.PhotoCropOffsetXNorm
    );
    const offsetY = Number(
      cropOrProfile?.offsetYNorm ?? cropOrProfile?.PhotoCropOffsetYNorm
    );
    const scaleRaw = Number(
      cropOrProfile?.userScale ?? cropOrProfile?.PhotoCropUserScale
    );
    return {
      offsetXNorm: Number.isFinite(offsetX) ? offsetX : 0,
      offsetYNorm: Number.isFinite(offsetY) ? offsetY : 0,
      userScale: Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1,
    };
  }

  function clampPhotoCrop(crop, naturalWidth, naturalHeight) {
    const viewport = profilePhotoViewport();
    const next = normalizePhotoCrop(crop);
    const width = Number(naturalWidth) || 0;
    const height = Number(naturalHeight) || 0;
    if (width <= 0 || height <= 0 || viewport.radius <= 0) {
      return next;
    }
    const halfW = (width * next.userScale) / 2;
    const halfH = (height * next.userScale) / 2;
    const maxX = Math.max(0, halfW - viewport.radius);
    const maxY = Math.max(0, halfH - viewport.radius);
    let offsetX = next.offsetXNorm * viewport.radius;
    let offsetY = next.offsetYNorm * viewport.radius;
    offsetX = Math.min(maxX, Math.max(-maxX, offsetX));
    offsetY = Math.min(maxY, Math.max(-maxY, offsetY));
    return {
      offsetXNorm: offsetX / viewport.radius,
      offsetYNorm: offsetY / viewport.radius,
      userScale: next.userScale,
    };
  }

  function profilePhotoCropStyle(cropOrProfile) {
    const viewport = profilePhotoViewport();
    const crop = normalizePhotoCrop(cropOrProfile);
    return (
      "transform: translate(calc(-50% + " +
      crop.offsetXNorm * viewport.radius +
      "px), calc(-50% + " +
      crop.offsetYNorm * viewport.radius +
      "px)) scale(" +
      crop.userScale +
      ");"
    );
  }

  function renderProfileCardHtml(profile, user) {
    const displayName =
      (profile.DisplayName && String(profile.DisplayName).trim()) ||
      t("account.profile.noName");
    const email = profile.Email || profile.AuthEmail || user?.email || "—";
    const accountType = profile.AccountType || "Freemium";
    const typeLabel =
      accountType === "Premium"
        ? t("account.profile.type.premium")
        : t("account.profile.type.freemium");
    const birth = formatDate(profile.BirthDate);
    const initials = escapeHtml(profileInitials(displayName, email));
    const photoUrls = profilePhotoUrls(profile, user);
    const photoAttr = photoUrls.length
      ? ` data-photo-urls="${escapeHtml(photoUrls.join("|"))}" data-photo-crop="${escapeHtml(profilePhotoCropStyle(profile))}"`
      : "";

    return `<article class="profile-card">
      <div class="profile-card__identity">
        <div class="profile-card__avatar" aria-hidden="true"${photoAttr}>
          <span class="profile-card__initials">${initials}</span>
        </div>
        <div class="profile-card__titles">
          <h2 class="profile-card__name">${escapeHtml(displayName)}</h2>
          <p class="profile-card__email">${escapeHtml(email)}</p>
        </div>
      </div>
      <div class="profile-card__divider" aria-hidden="true"></div>
      <dl class="profile-card__metrics">
        <div>
          <dt>${t("account.profile.type")}</dt>
          <dd class="profile-card__metric-accent">${escapeHtml(typeLabel.toUpperCase())}</dd>
        </div>
        <div>
          <dt>${t("account.profile.birthDate")}</dt>
          <dd class="profile-card__metric-date">${escapeHtml(birth)}</dd>
        </div>
      </dl>
      <div class="profile-card__actions">
        <button type="button" class="btn-primary" id="accountEditOpen" data-i18n="account.edit">Editar cuenta</button>
      </div>
    </article>`;
  }

  async function uploadProfilePhoto(user, jpegBlob) {
    if (!user?.uid) {
      throw new Error("NO_USER");
    }
    if (!jpegBlob || !jpegBlob.size) {
      throw new Error("PHOTO_REQUIRED");
    }
    if (jpegBlob.size >= 5 * 1024 * 1024) {
      throw new Error("PHOTO_TOO_LARGE");
    }

    const bucket = getStorageBucket();
    if (!bucket) {
      throw new Error("STORAGE_BUCKET_MISSING");
    }

    const token = await user.getIdToken();
    const objectName = "userPhotoOriginal_" + user.uid + ".jpg";
    const uploadUrl =
      "https://firebasestorage.googleapis.com/v0/b/" +
      encodeURIComponent(bucket) +
      "/o?uploadType=media&name=" +
      encodeURIComponent(objectName);

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "image/jpeg",
      },
      body: jpegBlob,
    });
    const responseText = await response.text();
    if (!response.ok) {
      const err = new Error("PHOTO_UPLOAD_FAILED");
      err.details = responseText;
      throw err;
    }

    let downloadToken = "";
    try {
      const parsed = JSON.parse(responseText);
      downloadToken = parsed.downloadTokens || "";
    } catch {
      downloadToken = "";
    }

    if (downloadToken) {
      return (
        "https://firebasestorage.googleapis.com/v0/b/" +
        encodeURIComponent(bucket) +
        "/o/" +
        encodeURIComponent(objectName) +
        "?alt=media&token=" +
        encodeURIComponent(downloadToken)
      );
    }

    return (
      "https://firebasestorage.googleapis.com/v0/b/" +
      encodeURIComponent(bucket) +
      "/o/" +
      encodeURIComponent(objectName) +
      "?alt=media"
    );
  }

  function fileToJpegBlob(file, maxEdge) {
    const edge = maxEdge || 2048;
    return new Promise(function (resolve, reject) {
      if (!file || !String(file.type || "").startsWith("image/")) {
        reject(new Error("PHOTO_INVALID"));
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        try {
          let width = img.naturalWidth || img.width;
          let height = img.naturalHeight || img.height;
          if (!width || !height) {
            reject(new Error("PHOTO_INVALID"));
            return;
          }
          const scale = Math.min(1, edge / Math.max(width, height));
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            function (blob) {
              URL.revokeObjectURL(objectUrl);
              if (!blob) {
                reject(new Error("PHOTO_INVALID"));
                return;
              }
              resolve(blob);
            },
            "image/jpeg",
            0.9
          );
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          reject(err);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("PHOTO_INVALID"));
      };
      img.src = objectUrl;
    });
  }

  async function saveProfile(user, fields) {
    const db = await authApi().getFirestore();
    const payload = {};
    const displayName = String(fields.displayName || "").trim();
    if (!displayName) {
      throw new Error("DISPLAY_NAME_REQUIRED");
    }
    payload.DisplayName = displayName;

    if (fields.birthDateEnabled && fields.birthDate) {
      const date = toDate(fields.birthDate);
      if (!date) {
        throw new Error("BIRTHDATE_INVALID");
      }
      payload.BirthDate = global.firebase.firestore.Timestamp.fromDate(date);
    } else {
      payload.BirthDate = global.firebase.firestore.FieldValue.delete();
    }

    if (fields.photoBlob) {
      const photoUrl = await uploadProfilePhoto(user, fields.photoBlob);
      payload.PhotoOriginalUrl = photoUrl;
    }

    if (fields.photoCrop) {
      const crop = clampPhotoCrop(
        fields.photoCrop,
        fields.photoNaturalWidth,
        fields.photoNaturalHeight
      );
      payload.PhotoCropOffsetXNorm = crop.offsetXNorm;
      payload.PhotoCropOffsetYNorm = crop.offsetYNorm;
      payload.PhotoCropUserScale = crop.userScale;
    } else if (fields.photoBlob) {
      payload.PhotoCropOffsetXNorm = 0;
      payload.PhotoCropOffsetYNorm = 0;
      payload.PhotoCropUserScale = 1;
    }

    await db.collection("Users").doc(user.uid).update(payload);
    await authApi().updateProfile(displayName);

    cache.profile = null;
    return fetchProfile(user);
  }

  global.TourAiAccountData = {
    t,
    fetchProfile,
    fetchPlans,
    fetchPayments,
    fetchPlansPage,
    fetchPaymentsPage,
    fetchActivePlan,
    fetchTokenUsage,
    fetchTokenUsagePage,
    getPlanById,
    saveProfile,
    fileToJpegBlob,
    formatBirthDateInput,
    profilePhotoUrls,
    profilePhotoCropStyle,
    normalizePhotoCrop,
    clampPhotoCrop,
    profilePhotoViewport,
    profileInitials,
    renderProfileCardHtml,
    renderActivePlanHtml,
    renderPlansHtml,
    renderPlanDetailHtml,
    renderPaymentsHtml,
    renderSkeletonHtml,
    enrichStripePaymentStatuses,
    reconcileAllPendingStripePayments,
    reconcileStripePayment,
    reconcileStripePaymentById,
    cancelStripePayment,
    cancelStripePaymentById,
    clearCache,
  };
})(window);


/* --- account.js --- */
(function () {
  if (!/account\.html/i.test(String(window.location.pathname || '') + String(window.location.href || ''))) {
    return;
  }

  const auth = window.TourAiAuth;
  const data = window.TourAiAccountData;
  const statusEl = document.getElementById("accountStatus");
  const signedInPanel = document.getElementById("accountSignedIn");
  const loadingPanel = document.getElementById("accountLoading");
  const profileMount = document.getElementById("accountProfileMount");
  const logoutBtn = document.getElementById("accountLogout");
  const deleteAccountBtn = document.getElementById("accountDeleteAccount");
  const editModal = document.getElementById("accountEditModal");
  const editForm = document.getElementById("accountEditForm");
  const editEmail = document.getElementById("editEmail");
  const editDisplayName = document.getElementById("editDisplayName");
  const editDisplayNameError = document.getElementById("editDisplayNameError");
  const editBirthDateEnabled = document.getElementById("editBirthDateEnabled");
  const editBirthDate = document.getElementById("editBirthDate");
  const editBirthDateError = document.getElementById("editBirthDateError");
  const editStatusEl = document.getElementById("accountEditStatus");
  const editSaveBtn = document.getElementById("accountEditSave");
  const editPhotoPreview = document.getElementById("editPhotoPreview");
  const editPhotoInitials = document.getElementById("editPhotoInitials");
  const editPhotoPick = document.getElementById("editPhotoPick");
  const editPhotoClear = document.getElementById("editPhotoClear");
  const editPhotoFile = document.getElementById("editPhotoFile");
  const editPhotoError = document.getElementById("editPhotoError");
  const passwordModal = document.getElementById("accountPasswordModal");
  const passwordForm = document.getElementById("accountPasswordForm");
  const pwdCurrent = document.getElementById("pwdCurrent");
  const pwdNew = document.getElementById("pwdNew");
  const pwdConfirm = document.getElementById("pwdConfirm");
  const pwdCurrentError = document.getElementById("pwdCurrentError");
  const pwdNewError = document.getElementById("pwdNewError");
  const pwdStrength = document.getElementById("pwdStrength");
  const pwdStrengthLabel = document.getElementById("pwdStrengthLabel");
  const passwordStatusEl = document.getElementById("accountPasswordStatus");
  const passwordSaveBtn = document.getElementById("accountPasswordSave");

  let currentUser = null;
  let currentProfile = null;
  let saveBusy = false;
  let passwordBusy = false;
  let pendingPhotoBlob = null;
  let pendingPhotoObjectUrl = null;
  let editPhotoCrop = { offsetXNorm: 0, offsetYNorm: 0, userScale: 1 };
  let editPhotoCropDirty = false;
  let editPhotoNatural = { width: 0, height: 0 };
  /** Baseline of the edit modal when opened (fields + photo crop). */
  let editBaseline = null;
  let photoPan = null;
  const PHOTO_PAN_SLOP_PX = 8;

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

  function setEditStatus(message, isError) {
    if (!editStatusEl) {
      return;
    }
    editStatusEl.textContent = message || "";
    editStatusEl.classList.toggle("error", !!isError);
  }

  function setPasswordStatus(message, isError) {
    if (!passwordStatusEl) {
      return;
    }
    passwordStatusEl.textContent = message || "";
    passwordStatusEl.classList.toggle("error", !!isError);
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
    target.searchParams.set("next", "account.html");
    window.location.replace(target.toString());
  }

  function hydrateProfileAvatar(root) {
    const avatar = root?.querySelector?.(".profile-card__avatar[data-photo-urls]");
    if (!avatar) {
      return;
    }
    const urls = String(avatar.getAttribute("data-photo-urls") || "")
      .split("|")
      .map(function (u) {
        return u.trim();
      })
      .filter(Boolean);
    if (!urls.length) {
      return;
    }
    const cropStyle = avatar.getAttribute("data-photo-crop") || "";

    let index = 0;
    function tryNext() {
      if (index >= urls.length) {
        return;
      }
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      if (cropStyle) {
        img.setAttribute("style", cropStyle);
      }
      img.addEventListener("load", function () {
        avatar.textContent = "";
        avatar.appendChild(img);
      });
      img.addEventListener("error", function () {
        index += 1;
        tryNext();
      });
      img.src = urls[index];
    }
    tryNext();
  }

  function getEditPhotoImg() {
    return editPhotoPreview?.querySelector?.("img") || null;
  }

  function applyEditPhotoCropStyle() {
    const img = getEditPhotoImg();
    if (!img) {
      return;
    }
    editPhotoCrop = data.clampPhotoCrop(
      editPhotoCrop,
      editPhotoNatural.width,
      editPhotoNatural.height
    );
    img.setAttribute("style", data.profilePhotoCropStyle(editPhotoCrop));
  }

  function setEditPhotoHasPhoto(hasPhoto) {
    if (!editPhotoPreview) {
      return;
    }
    editPhotoPreview.classList.toggle("has-photo", !!hasPhoto);
    editPhotoPreview.classList.remove("is-panning");
  }

  function setEditPhotoPreview(url, initials, crop) {
    if (!editPhotoPreview) {
      return;
    }
    editPhotoPreview.textContent = "";
    photoPan = null;
    if (url) {
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.draggable = false;
      img.referrerPolicy = "no-referrer";
      img.src = url;
      editPhotoCrop = data.normalizePhotoCrop(
        crop || { offsetXNorm: 0, offsetYNorm: 0, userScale: 1 }
      );
      img.addEventListener("load", function () {
        editPhotoNatural = {
          width: img.naturalWidth || 0,
          height: img.naturalHeight || 0,
        };
        applyEditPhotoCropStyle();
      });
      img.addEventListener("error", function () {
        editPhotoNatural = { width: 0, height: 0 };
        editPhotoPreview.textContent = "";
        setEditPhotoHasPhoto(false);
        const span = document.createElement("span");
        span.className = "account-edit-form__photo-initials";
        span.textContent = initials || "?";
        editPhotoPreview.appendChild(span);
      });
      editPhotoPreview.appendChild(img);
      setEditPhotoHasPhoto(true);
      if (img.complete && img.naturalWidth) {
        editPhotoNatural = {
          width: img.naturalWidth || 0,
          height: img.naturalHeight || 0,
        };
        applyEditPhotoCropStyle();
      }
      return;
    }
    editPhotoNatural = { width: 0, height: 0 };
    setEditPhotoHasPhoto(false);
    const span = document.createElement("span");
    span.className = "account-edit-form__photo-initials";
    span.id = "editPhotoInitials";
    span.textContent = initials || "?";
    editPhotoPreview.appendChild(span);
  }

  function loadCurrentPhotoIntoEditPreview() {
    const email = currentProfile?.Email || currentProfile?.AuthEmail || currentUser?.email || "";
    const name = currentProfile?.DisplayName || "";
    const initials = data.profileInitials(name, email);
    const urls = data.profilePhotoUrls(currentProfile || {}, currentUser);
    editPhotoCropDirty = false;
    if (!urls.length) {
      editPhotoCrop = { offsetXNorm: 0, offsetYNorm: 0, userScale: 1 };
      setEditPhotoPreview("", initials);
      return;
    }
    editPhotoCrop = data.normalizePhotoCrop(currentProfile || {});
    setEditPhotoPreview(urls[0], initials, editPhotoCrop);
  }

  function openPhotoPicker() {
    editPhotoFile?.click();
  }

  function onPhotoPointerDown(event) {
    if (!editPhotoPreview || !getEditPhotoImg()) {
      return;
    }
    if (event.button != null && event.button !== 0) {
      return;
    }
    event.preventDefault();
    const viewport = data.profilePhotoViewport();
    photoPan = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: editPhotoCrop.offsetXNorm * viewport.radius,
      startOffsetY: editPhotoCrop.offsetYNorm * viewport.radius,
      moved: false,
    };
    editPhotoPreview.classList.add("is-panning");
    try {
      editPhotoPreview.setPointerCapture(event.pointerId);
    } catch (_) {
      /* ignore */
    }
  }

  function onPhotoPointerMove(event) {
    if (!photoPan || photoPan.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - photoPan.startX;
    const dy = event.clientY - photoPan.startY;
    if (!photoPan.moved) {
      if (Math.hypot(dx, dy) < PHOTO_PAN_SLOP_PX) {
        return;
      }
      photoPan.moved = true;
    }
    event.preventDefault();
    const viewport = data.profilePhotoViewport();
    editPhotoCrop = data.clampPhotoCrop(
      {
        offsetXNorm: (photoPan.startOffsetX + dx) / viewport.radius,
        offsetYNorm: (photoPan.startOffsetY + dy) / viewport.radius,
        userScale: editPhotoCrop.userScale,
      },
      editPhotoNatural.width,
      editPhotoNatural.height
    );
    editPhotoCropDirty = true;
    applyEditPhotoCropStyle();
  }

  function onPhotoPointerUp(event) {
    if (!photoPan || photoPan.pointerId !== event.pointerId) {
      return;
    }
    const wasTap = !photoPan.moved;
    photoPan = null;
    editPhotoPreview?.classList.remove("is-panning");
    try {
      editPhotoPreview?.releasePointerCapture(event.pointerId);
    } catch (_) {
      /* ignore */
    }
    if (wasTap) {
      openPhotoPicker();
    }
  }

  function renderProfile() {
    if (!profileMount || !currentUser || !currentProfile) {
      return;
    }
    profileMount.innerHTML = data.renderProfileCardHtml(currentProfile, currentUser);
    hydrateProfileAvatar(profileMount);
    if (window.TourAiI18n?.applyTranslations && window.TourAiI18n?.getLocale) {
      window.TourAiI18n.applyTranslations(window.TourAiI18n.getLocale());
    }
  }

  function revokePendingPhotoPreview() {
    if (pendingPhotoObjectUrl) {
      URL.revokeObjectURL(pendingPhotoObjectUrl);
      pendingPhotoObjectUrl = null;
    }
  }

  function resetPendingPhoto() {
    pendingPhotoBlob = null;
    revokePendingPhotoPreview();
    photoPan = null;
    if (editPhotoFile) {
      editPhotoFile.value = "";
    }
    if (editPhotoClear) {
      editPhotoClear.hidden = true;
    }
    if (editPhotoError) {
      editPhotoError.hidden = true;
    }
  }

  function syncBirthDateEnabled() {
    if (!editBirthDate || !editBirthDateEnabled) {
      return;
    }
    const enabled = !!editBirthDateEnabled.checked;
    const birthBlock = editBirthDateEnabled.closest(".account-edit-form__birth");
    if (birthBlock) {
      birthBlock.classList.toggle("is-disabled", !enabled);
    }
    editBirthDate.disabled = !enabled;
    if (!enabled && editBirthDateError) {
      editBirthDateError.hidden = true;
    }
  }

  function updatePasswordStrengthUi() {
    const strength = window.TourAiPasswordStrength;
    if (!strength || !pwdNew || !pwdStrength || !pwdStrengthLabel) {
      return;
    }
    const password = pwdNew.value || "";
    const level = password ? strength.evaluate(password) : strength.Level.None;
    const strengthBars = pwdStrength.querySelectorAll(".auth-password-strength__bar");

    pwdStrength.hidden = level === strength.Level.None;
    strengthBars.forEach(function (bar) {
      bar.classList.remove("is-active", "is-weak", "is-medium", "is-strong");
    });
    pwdStrengthLabel.classList.remove("is-weak", "is-medium", "is-strong");

    if (level === strength.Level.Weak) {
      strengthBars[0]?.classList.add("is-active", "is-weak");
      pwdStrengthLabel.textContent = t("resetPassword.strength.weak");
      pwdStrengthLabel.classList.add("is-weak");
    } else if (level === strength.Level.Medium) {
      strengthBars[0]?.classList.add("is-active", "is-medium");
      strengthBars[1]?.classList.add("is-active", "is-medium");
      pwdStrengthLabel.textContent = t("resetPassword.strength.medium");
      pwdStrengthLabel.classList.add("is-medium");
    } else if (level === strength.Level.Strong) {
      strengthBars[0]?.classList.add("is-active", "is-strong");
      strengthBars[1]?.classList.add("is-active", "is-strong");
      strengthBars[2]?.classList.add("is-active", "is-strong");
      pwdStrengthLabel.textContent = t("resetPassword.strength.strong");
      pwdStrengthLabel.classList.add("is-strong");
    } else {
      pwdStrengthLabel.textContent = "";
    }
  }

  function getEditFormState() {
    return {
      displayName: (editDisplayName?.value || "").trim(),
      birthEnabled: !!editBirthDateEnabled?.checked,
      birthDate: editBirthDateEnabled?.checked
        ? String(editBirthDate?.value || "")
        : "",
    };
  }

  function captureEditBaseline() {
    editBaseline = {
      form: getEditFormState(),
    };
  }

  function hasEditChanges() {
    if (!editBaseline) {
      return false;
    }
    if (pendingPhotoBlob) {
      return true;
    }
    if (editPhotoCropDirty) {
      return true;
    }
    const form = getEditFormState();
    return (
      form.displayName !== editBaseline.form.displayName ||
      form.birthEnabled !== editBaseline.form.birthEnabled ||
      form.birthDate !== editBaseline.form.birthDate
    );
  }

  function openEditModal() {
    if (!editModal || !currentProfile || !currentUser) {
      return;
    }
    editEmail.value = currentProfile.Email || currentProfile.AuthEmail || currentUser.email || "";
    editDisplayName.value = currentProfile.DisplayName || "";
    editDisplayNameError.hidden = true;
    editBirthDateError.hidden = true;
    resetPendingPhoto();
    loadCurrentPhotoIntoEditPreview();

    editModal.hidden = false;
    editModal.classList.add("is-open");
    editModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    const birthValue = data.formatBirthDateInput(currentProfile.BirthDate);
    editBirthDateEnabled.checked = !!birthValue;
    if (editBirthDate) {
      editBirthDate.value = birthValue;
    }
    syncBirthDateEnabled();
    captureEditBaseline();

    setEditStatus("", false);
    editDisplayName.focus();
  }

  function closeEditModal() {
    if (!editModal) {
      return;
    }
    closePasswordModal();
    resetPendingPhoto();
    editBaseline = null;
    editModal.classList.remove("is-open");
    editModal.hidden = true;
    editModal.setAttribute("aria-hidden", "true");
    if (!passwordModal?.classList.contains("is-open")) {
      document.body.style.overflow = "";
    }
  }

  async function requestCloseEditModal() {
    if (!editModal?.classList.contains("is-open")) {
      return;
    }
    if (hasEditChanges()) {
      const ok = await (window.TourAiConfirm?.show
        ? window.TourAiConfirm.show({
            title: t("account.confirm.discardEdit.title"),
            message: t("account.confirm.discardEdit.body"),
            confirmLabel: t("account.confirm.discardEdit.confirm"),
            cancelLabel: t("account.confirm.cancel"),
            danger: true,
          })
        : Promise.resolve(
            window.confirm(
              t("account.confirm.discardEdit.title") +
                "\n\n" +
                t("account.confirm.discardEdit.body")
            )
          ));
      if (!ok) {
        return;
      }
    }
    closeEditModal();
  }

  function resetPasswordForm() {
    if (pwdCurrent) {
      pwdCurrent.value = "";
    }
    if (pwdNew) {
      pwdNew.value = "";
    }
    if (pwdConfirm) {
      pwdConfirm.value = "";
    }
    if (pwdCurrentError) {
      pwdCurrentError.hidden = true;
    }
    if (pwdNewError) {
      pwdNewError.hidden = true;
    }
    setPasswordStatus("", false);
    updatePasswordStrengthUi();
  }

  function openPasswordModal() {
    if (!passwordModal || !currentUser) {
      return;
    }
    resetPasswordForm();
    passwordModal.hidden = false;
    passwordModal.classList.add("is-open");
    passwordModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    pwdCurrent?.focus();
  }

  function closePasswordModal() {
    if (!passwordModal) {
      return;
    }
    resetPasswordForm();
    passwordModal.classList.remove("is-open");
    passwordModal.hidden = true;
    passwordModal.setAttribute("aria-hidden", "true");
    if (!editModal?.classList.contains("is-open")) {
      document.body.style.overflow = "";
    }
  }

  function validateEditForm() {
    let ok = true;
    const name = (editDisplayName.value || "").trim();
    if (!name) {
      editDisplayNameError.textContent = t("account.edit.error.displayName");
      editDisplayNameError.hidden = false;
      ok = false;
    } else {
      editDisplayNameError.hidden = true;
    }

    if (editBirthDateEnabled.checked) {
      if (!editBirthDate.value) {
        editBirthDateError.textContent = t("account.edit.error.birthDate");
        editBirthDateError.hidden = false;
        ok = false;
      } else {
        editBirthDateError.hidden = true;
      }
    } else {
      editBirthDateError.hidden = true;
    }

    return ok;
  }

  function validatePasswordForm() {
    let ok = true;
    const currentPassword = pwdCurrent?.value || "";
    const password = pwdNew?.value || "";
    const confirm = pwdConfirm?.value || "";

    if (pwdCurrentError) {
      pwdCurrentError.hidden = true;
    }
    if (pwdNewError) {
      pwdNewError.hidden = true;
    }

    if (!currentPassword) {
      if (pwdCurrentError) {
        pwdCurrentError.textContent = t("account.passwordChange.error.currentRequired");
        pwdCurrentError.hidden = false;
      }
      ok = false;
    }

    const strengthApi = window.TourAiPasswordStrength;
    const level = strengthApi ? strengthApi.evaluate(password) : 0;
    if (!password || !strengthApi || level < strengthApi.Level.Medium) {
      if (pwdNewError) {
        pwdNewError.textContent = t("account.passwordChange.error.weak");
        pwdNewError.hidden = false;
      }
      ok = false;
    } else if (password !== confirm) {
      if (pwdNewError) {
        pwdNewError.textContent = t("account.passwordChange.error.mismatch");
        pwdNewError.hidden = false;
      }
      ok = false;
    } else if (currentPassword && password === currentPassword) {
      if (pwdNewError) {
        pwdNewError.textContent = t("account.passwordChange.error.same");
        pwdNewError.hidden = false;
      }
      ok = false;
    }

    return ok;
  }

  async function loadProfile(user) {
    currentProfile = await data.fetchProfile(user);
    renderProfile();
  }

  auth
    .onAuthStateChanged(async function (user) {
      if (!user) {
        redirectToLogin();
        return;
      }

      currentUser = user;
      showSignedIn();
      setStatus(t("account.loadingData"), false);
      try {
        await loadProfile(user);
        setStatus("", false);
      } catch (err) {
        console.error(err);
        setStatus(
          auth.mapAuthError(err) ||
            t("account.error.load"),
          true
        );
      }
    })
    .catch(function (err) {
      console.error(err);
      redirectToLogin();
    });

  logoutBtn?.addEventListener("click", async function () {
    const ok = await (window.TourAiConfirm?.show
      ? window.TourAiConfirm.show({
          title: t("account.confirm.logout.title"),
          message: t("account.confirm.logout.body"),
          confirmLabel: t("account.confirm.logout.confirm"),
          cancelLabel: t("account.confirm.cancel"),
        })
      : Promise.resolve(
          window.confirm(
            t("account.confirm.logout.title") +
              "\n\n" +
              t("account.confirm.logout.body")
          )
        ));
    if (!ok) {
      return;
    }
    setStatus(t("account.status.signingOut"), false);
    try {
      data.clearCache();
      await auth.signOut();
      window.location.replace("login.html");
    } catch (err) {
      setStatus(auth.mapAuthError(err), true);
    }
  });

  deleteAccountBtn?.addEventListener("click", async function (event) {
    event.preventDefault();
    const href = deleteAccountBtn.getAttribute("href") || "delete-account.html";
    const ok = await (window.TourAiConfirm?.show
      ? window.TourAiConfirm.show({
          title: t("account.confirm.delete.title"),
          message: t("account.confirm.delete.body"),
          confirmLabel: t("account.confirm.delete.confirm"),
          cancelLabel: t("account.confirm.cancel"),
          danger: true,
        })
      : Promise.resolve(
          window.confirm(
            t("account.confirm.delete.title") +
              "\n\n" +
              t("account.confirm.delete.body")
          )
        ));
    if (!ok) {
      return;
    }
    window.location.href = href;
  });

  document.addEventListener("click", function (event) {
    if (event.target.closest("#accountEditOpen")) {
      openEditModal();
      return;
    }
    if (event.target.closest("#accountPasswordOpen")) {
      openPasswordModal();
      return;
    }
    if (event.target.closest("[data-close-account-password]") || event.target === passwordModal) {
      closePasswordModal();
      return;
    }
    if (event.target.closest("[data-close-account-edit]") || event.target === editModal) {
      requestCloseEditModal();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") {
      return;
    }
    if (passwordModal?.classList.contains("is-open")) {
      closePasswordModal();
      return;
    }
    if (editModal?.classList.contains("is-open")) {
      requestCloseEditModal();
    }
  });

  editBirthDateEnabled?.addEventListener("change", syncBirthDateEnabled);
  pwdNew?.addEventListener("input", updatePasswordStrengthUi);

  editPhotoPick?.addEventListener("click", openPhotoPicker);

  editPhotoPreview?.addEventListener("pointerdown", onPhotoPointerDown);
  editPhotoPreview?.addEventListener("pointermove", onPhotoPointerMove);
  editPhotoPreview?.addEventListener("pointerup", onPhotoPointerUp);
  editPhotoPreview?.addEventListener("pointercancel", onPhotoPointerUp);
  editPhotoPreview?.addEventListener("click", function (event) {
    if (getEditPhotoImg()) {
      // Tap-to-pick is handled in pointerup; avoid double-open.
      event.preventDefault();
      return;
    }
    openPhotoPicker();
  });
  editPhotoPreview?.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPhotoPicker();
    }
  });

  editPhotoClear?.addEventListener("click", function () {
    resetPendingPhoto();
    loadCurrentPhotoIntoEditPreview();
  });

  editPhotoFile?.addEventListener("change", async function () {
    const file = editPhotoFile.files && editPhotoFile.files[0];
    if (!file) {
      return;
    }
    if (editPhotoError) {
      editPhotoError.hidden = true;
    }
    try {
      if (file.size >= 5 * 1024 * 1024) {
        throw new Error("PHOTO_TOO_LARGE");
      }
      const jpegBlob = await data.fileToJpegBlob(file, 2048);
      if (jpegBlob.size >= 5 * 1024 * 1024) {
        throw new Error("PHOTO_TOO_LARGE");
      }
      revokePendingPhotoPreview();
      pendingPhotoBlob = jpegBlob;
      pendingPhotoObjectUrl = URL.createObjectURL(jpegBlob);
      editPhotoCrop = { offsetXNorm: 0, offsetYNorm: 0, userScale: 1 };
      editPhotoCropDirty = true;
      setEditPhotoPreview(pendingPhotoObjectUrl, "?", editPhotoCrop);
      if (editPhotoClear) {
        editPhotoClear.hidden = false;
      }
    } catch (err) {
      console.error(err);
      resetPendingPhoto();
      loadCurrentPhotoIntoEditPreview();
      if (editPhotoError) {
        editPhotoError.textContent =
          err?.message === "PHOTO_TOO_LARGE"
            ? t("account.edit.photo.error.tooLarge")
            : t("account.edit.photo.error.invalid");
        editPhotoError.hidden = false;
      }
    }
  });

  editForm?.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (saveBusy || !currentUser) {
      return;
    }
    if (!validateEditForm()) {
      return;
    }

    saveBusy = true;
    if (editSaveBtn) {
      editSaveBtn.disabled = true;
    }
    setEditStatus(t("account.edit.saving"), false);

    try {
      const shouldSaveCrop = !!(pendingPhotoBlob || editPhotoCropDirty);
      currentProfile = await data.saveProfile(currentUser, {
        displayName: editDisplayName.value,
        birthDateEnabled: !!editBirthDateEnabled.checked,
        birthDate: editBirthDateEnabled.checked ? editBirthDate.value : null,
        photoBlob: pendingPhotoBlob || null,
        photoCrop: shouldSaveCrop ? editPhotoCrop : null,
        photoNaturalWidth: editPhotoNatural.width,
        photoNaturalHeight: editPhotoNatural.height,
      });
      resetPendingPhoto();
      editPhotoCropDirty = false;
      renderProfile();
      if (typeof auth.enrichNavProfile === "function") {
        try {
          await auth.enrichNavProfile(currentUser);
        } catch (navErr) {
          console.warn("[TourAI account] nav enrich failed", navErr);
        }
      }
      setEditStatus(t("account.edit.saved"), false);
      setStatus(t("account.edit.saved"), false);
      setTimeout(closeEditModal, 600);
    } catch (err) {
      console.error(err);
      let message = auth.mapAuthError(err);
      if (err?.message === "DISPLAY_NAME_REQUIRED") {
        message = t("account.edit.error.displayName");
      } else if (err?.message === "BIRTHDATE_INVALID") {
        message = t("account.edit.error.birthDate");
      } else if (err?.message === "PHOTO_TOO_LARGE") {
        message = t("account.edit.photo.error.tooLarge");
      } else if (err?.message === "PHOTO_INVALID") {
        message = t("account.edit.photo.error.invalid");
      } else if (err?.message === "PHOTO_UPLOAD_FAILED" || err?.message === "STORAGE_BUCKET_MISSING") {
        message = t("account.edit.photo.error.upload");
      }
      setEditStatus(
        message || t("account.edit.error.save"),
        true
      );
    } finally {
      saveBusy = false;
      if (editSaveBtn) {
        editSaveBtn.disabled = false;
      }
    }
  });

  passwordForm?.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (passwordBusy || !currentUser) {
      return;
    }
    if (!validatePasswordForm()) {
      return;
    }

    passwordBusy = true;
    if (passwordSaveBtn) {
      passwordSaveBtn.disabled = true;
    }
    setPasswordStatus(t("account.passwordChange.saving"), false);

    const currentPassword = (pwdCurrent?.value || "").trim();
    const newPassword = (pwdNew?.value || "").trim();

    try {
      await auth.changePassword(currentPassword, newPassword);
      setPasswordStatus(t("account.passwordChange.saved"), false);
      setStatus(t("account.passwordChange.saved"), false);
      setTimeout(closePasswordModal, 600);
    } catch (err) {
      console.error(err);
      let message = auth.mapAuthError(err);
      if (err?.code === "auth/wrong-password" || err?.code === "auth/invalid-credential") {
        message = t("account.passwordChange.error.currentWrong");
        if (pwdCurrentError) {
          pwdCurrentError.textContent = message;
          pwdCurrentError.hidden = false;
        }
      } else if (err?.code === "auth/requires-recent-login") {
        message = t("account.passwordChange.error.recentLogin");
      } else if (err?.code === "auth/weak-password") {
        message = t("account.passwordChange.error.weak");
        if (pwdNewError) {
          pwdNewError.textContent = message;
          pwdNewError.hidden = false;
        }
      }
      setPasswordStatus(
        message || t("account.passwordChange.error.save"),
        true
      );
    } finally {
      passwordBusy = false;
      if (passwordSaveBtn) {
        passwordSaveBtn.disabled = false;
      }
    }
  });

  document.addEventListener("tourai:locale-changed", function () {
    renderProfile();
    updatePasswordStrengthUi();
  });
})();


/* --- dashboard.js --- */
(function () {
  if (!/dashboard\.html/i.test(String(window.location.pathname || '') + String(window.location.href || ''))) {
    return;
  }

  const auth = window.TourAiAuth;
  const data = window.TourAiAccountData;
  const signedInPanel = document.getElementById("dashboardSignedIn");
  const loadingPanel = document.getElementById("dashboardLoading");
  const logoutBtn = document.getElementById("dashboardLogout");
  const deleteAccountBtn = document.getElementById("dashboardDeleteAccount");
  const statusEl = document.getElementById("dashboardStatus");
  const planDetailModal = document.getElementById("planDetailModal");
  const planDetailBody = document.getElementById("planDetailBody");
  let currentUser = null;
  let planDetailBusy = false;

  const pagers = {
    plans: { items: [], cursor: null, hasMore: true, loading: false, observer: null },
    payments: { items: [], cursor: null, hasMore: true, loading: false, observer: null },
  };
  const buyState = { plans: [], busyPlanId: "", loading: false };
  const usagePager = {
    planId: null,
    items: [],
    cursor: null,
    hasMore: true,
    loading: false,
    observer: null,
    plan: null,
  };

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

  function disconnectObserver(observer) {
    if (observer) {
      observer.disconnect();
    }
    return null;
  }

  function observeSentinel(sentinel, onVisible) {
    if (!sentinel || typeof IntersectionObserver !== "function") {
      return null;
    }
    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            onVisible();
          }
        });
      },
      { root: null, rootMargin: "140px 0px", threshold: 0 }
    );
    observer.observe(sentinel);
    return observer;
  }

  function closePlanDetail() {
    if (!planDetailModal) {
      return;
    }
    usagePager.observer = disconnectObserver(usagePager.observer);
    usagePager.planId = null;
    usagePager.items = [];
    usagePager.cursor = null;
    usagePager.hasMore = true;
    usagePager.plan = null;
    planDetailModal.classList.remove("is-open");
    planDetailModal.hidden = true;
    planDetailModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (planDetailBody) {
      planDetailBody.innerHTML = "";
    }
  }

  function paintPlanDetail() {
    if (!planDetailBody || !usagePager.plan) {
      return;
    }
    usagePager.observer = disconnectObserver(usagePager.observer);
    planDetailBody.innerHTML = data.renderPlanDetailHtml(usagePager.plan, usagePager.items, {
      loading: usagePager.loading,
      hasMore: usagePager.hasMore,
    });
    const title = planDetailBody.querySelector(".plan-detail__title");
    if (title) {
      title.id = "planDetailTitle";
    }
    const sentinel = planDetailBody.querySelector("[data-usage-sentinel]");
    usagePager.observer = observeSentinel(sentinel, function () {
      loadUsagePage(false);
    });
  }

  async function loadUsagePage(reset) {
    if (!currentUser || !usagePager.planId || usagePager.loading) {
      return;
    }
    if (!reset && !usagePager.hasMore) {
      return;
    }
    usagePager.loading = true;
    const startedAt = Date.now();
    if (reset) {
      usagePager.items = [];
      usagePager.cursor = null;
      usagePager.hasMore = true;
    }
    paintPlanDetail();
    try {
      const page = await data.fetchTokenUsagePage(
        currentUser,
        usagePager.planId,
        reset ? null : usagePager.cursor
      );
      usagePager.items = reset ? page.items : usagePager.items.concat(page.items);
      usagePager.cursor = page.cursor;
      usagePager.hasMore = page.hasMore;
    } catch (err) {
      console.error("[TourAI dashboard] usage page", err);
      setStatus(
        auth.mapAuthError(err) ||
          t("account.plan.detail.error"),
        true
      );
    } finally {
      await window.TourAiLoading?.ensureMinMs?.(startedAt, 500);
      usagePager.loading = false;
      paintPlanDetail();
    }
  }

  async function openPlanDetail(planId) {
    if (!currentUser || !planId || planDetailBusy || !planDetailModal || !planDetailBody) {
      return;
    }

    const plan = data.getPlanById(planId);
    if (!plan) {
      setStatus(t("account.plan.detail.missing"), true);
      return;
    }

    planDetailBusy = true;
    usagePager.planId = planId;
    usagePager.plan = plan;
    usagePager.items = [];
    usagePager.cursor = null;
    usagePager.hasMore = true;
    planDetailBody.innerHTML = data.renderSkeletonHtml("usage");
    planDetailModal.hidden = false;
    planDetailModal.classList.add("is-open");
    planDetailModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    try {
      await loadUsagePage(true);
    } finally {
      planDetailBusy = false;
    }
  }

  function paintBuyPlansSection(section) {
    const checkout = window.TourAiCheckout;
    if (!checkout) {
      setSectionState(
        section,
        "error",
        `<p class="account-empty account-empty--error">${t("account.buy.error.config")}</p>`
      );
      return;
    }
    setSectionState(
      section,
      "loaded",
      checkout.renderCatalogHtml(buyState.plans, {
        busyPlanId: buyState.busyPlanId,
        disabled: !!buyState.busyPlanId,
      })
    );
  }

  async function loadBuyPlansSection(section) {
    if (!currentUser || buyState.loading) {
      return;
    }
    const checkout = window.TourAiCheckout;
    if (!checkout) {
      paintBuyPlansSection(section);
      return;
    }
    buyState.loading = true;
    const startedAt = Date.now();
    setSectionState(section, "loading", data.renderSkeletonHtml("plans"));
    try {
      buyState.plans = await checkout.fetchActiveCatalogPlans();
      await window.TourAiLoading?.ensureMinMs?.(startedAt, 500);
      paintBuyPlansSection(section);
    } catch (err) {
      console.error("[TourAI dashboard] buy plans", err);
      await window.TourAiLoading?.ensureMinMs?.(startedAt, 500);
      setSectionState(
        section,
        "error",
        `<p class="account-empty account-empty--error">${
          auth.mapAuthError(err) || t("account.buy.error.generic")
        }</p>`
      );
    } finally {
      buyState.loading = false;
    }
  }

  function showBuyAlert(title, message, confirmLabel) {
    if (window.TourAiConfirm?.show) {
      return window.TourAiConfirm.show({
        title: title,
        message: message,
        confirmLabel: confirmLabel || t("account.alert.ok"),
        alert: true,
      });
    }
    window.alert(message);
    return Promise.resolve(true);
  }

  async function handleBuyPlanClick(planId, section) {
    const checkout = window.TourAiCheckout;
    if (!checkout || !planId || buyState.busyPlanId) {
      return;
    }
    buyState.busyPlanId = planId;
    paintBuyPlansSection(section);
    window.TourAiLoading?.show?.(t("account.buy.preparing"));
    try {
      var wasFreemium = true;
      if (window.TourAiPlanActivation?.wasFreemiumAtPurchaseStart) {
        wasFreemium = await window.TourAiPlanActivation.wasFreemiumAtPurchaseStart(
          currentUser
        );
      } else {
        wasFreemium = !(await data.fetchActivePlan(currentUser));
      }
      await checkout.startCheckout(planId, {
        wasFreemiumAtPurchaseStart: wasFreemium,
        onProgress: function (step) {
          if (step === "redirecting") {
            const messageEl = document.querySelector(".tourai-loading-message");
            if (messageEl) {
              messageEl.textContent = t("account.buy.redirecting");
            }
          }
        },
      });
      // Redirect in progress: keep the spinner visible.
    } catch (err) {
      console.error("[TourAI dashboard] checkout", err);
      window.TourAiLoading?.hide?.();
      buyState.busyPlanId = "";
      paintBuyPlansSection(section);
      const message =
        checkout.mapCheckoutError(err?.message || err) || t("account.buy.error.generic");
      await showBuyAlert(t("account.buy.error.title"), message);
    }
  }

  function paintPlansSection(section) {
    const pager = pagers.plans;
    pager.observer = disconnectObserver(pager.observer);
    const html = data.renderPlansHtml(pager.items, {
      loading: pager.loading,
      hasMore: pager.hasMore,
    });
    setSectionState(section, "loaded", html);
    const sentinel = section.querySelector("[data-plans-sentinel]");
    pager.observer = observeSentinel(sentinel, function () {
      loadPlansPage(section, false);
    });
  }

  function paintPaymentsSection(section) {
    const pager = pagers.payments;
    pager.observer = disconnectObserver(pager.observer);
    let html = data.renderPaymentsHtml(pager.items, {
      loading: pager.loading,
      hasMore: pager.hasMore,
    });
    const note = t("account.payment.buyNote");
    html += `<p class="account-note">${note}</p>`;
    setSectionState(section, "loaded", html);
    const sentinel = section.querySelector("[data-payments-sentinel]");
    pager.observer = observeSentinel(sentinel, function () {
      loadPaymentsPage(section, false);
    });
  }

  async function tryReconcilePendingStripePayments() {
    if (!currentUser || !data.reconcileAllPendingStripePayments) {
      return;
    }

    try {
      await data.reconcileAllPendingStripePayments(currentUser);
    } catch (err) {
      console.error("[TourAI dashboard] reconcile pending payments", err);
    }
  }

  async function loadPlansPage(section, reset) {
    const pager = pagers.plans;
    if (!currentUser || pager.loading) {
      return;
    }
    if (!reset && !pager.hasMore) {
      return;
    }
    pager.loading = true;
    const startedAt = Date.now();
    if (reset) {
      pager.items = [];
      pager.cursor = null;
      pager.hasMore = true;
      setSectionState(section, "loading", data.renderSkeletonHtml("plans"));
    } else {
      paintPlansSection(section);
    }
    try {
      if (reset) {
        await tryReconcilePendingStripePayments();
      }
      const page = await data.fetchPlansPage(currentUser, reset ? null : pager.cursor);
      pager.items = reset ? page.items : pager.items.concat(page.items);
      pager.cursor = page.cursor;
      pager.hasMore = page.hasMore;
    } catch (err) {
      console.error("[TourAI dashboard] plans", err);
      await window.TourAiLoading?.ensureMinMs?.(startedAt, 500);
      setSectionState(
        section,
        "error",
        `<p class="account-empty account-empty--error">${
          auth.mapAuthError(err) || t("account.error.load")
        }</p>`
      );
      pager.loading = false;
      return;
    }
    await window.TourAiLoading?.ensureMinMs?.(startedAt, 500);
    pager.loading = false;
    paintPlansSection(section);
  }

  async function loadPaymentsPage(section, reset) {
    const pager = pagers.payments;
    if (!currentUser || pager.loading) {
      return;
    }
    if (!reset && !pager.hasMore) {
      return;
    }
    pager.loading = true;
    const startedAt = Date.now();
    if (reset) {
      pager.items = [];
      pager.cursor = null;
      pager.hasMore = true;
      setSectionState(section, "loading", data.renderSkeletonHtml("payments"));
    } else {
      paintPaymentsSection(section);
    }
    try {
      if (reset) {
        await tryReconcilePendingStripePayments();
      }
      const page = await data.fetchPaymentsPage(currentUser, reset ? null : pager.cursor);
      pager.items = reset ? page.items : pager.items.concat(page.items);
      pager.cursor = page.cursor;
      pager.hasMore = page.hasMore;
      if (!reset) {
        await data.enrichStripePaymentStatuses(currentUser, page.items);
      }
    } catch (err) {
      console.error("[TourAI dashboard] payments", err);
      await window.TourAiLoading?.ensureMinMs?.(startedAt, 500);
      setSectionState(
        section,
        "error",
        `<p class="account-empty account-empty--error">${
          auth.mapAuthError(err) || t("account.error.load")
        }</p>`
      );
      pager.loading = false;
      return;
    }
    await window.TourAiLoading?.ensureMinMs?.(startedAt, 500);
    pager.loading = false;
    paintPaymentsSection(section);
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

    if (key === "activePlan") {
      const startedAt = Date.now();
      setSectionState(section, "loading", data.renderSkeletonHtml("plans"));
      try {
        await tryReconcilePendingStripePayments();
        const active = await data.fetchActivePlan(currentUser);
        await window.TourAiLoading?.ensureMinMs?.(startedAt, 500);
        setSectionState(section, "loaded", data.renderActivePlanHtml(active));
      } catch (err) {
        console.error("[TourAI dashboard]", key, err);
        await window.TourAiLoading?.ensureMinMs?.(startedAt, 500);
        setSectionState(
          section,
          "error",
          `<p class="account-empty account-empty--error">${
            auth.mapAuthError(err) || t("account.error.load")
          }</p>`
        );
      }
      return;
    }

    if (key === "buyPlans") {
      await loadBuyPlansSection(section);
      return;
    }

    if (key === "plans") {
      await loadPlansPage(section, true);
      return;
    }

    if (key === "payments") {
      await loadPaymentsPage(section, true);
      return;
    }

    setSectionState(
      section,
      "loaded",
      `<p class="account-empty">${t("dashboard.section.unknown")}</p>`
    );
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
    if (willOpen) {
      panel.removeAttribute("hidden");
    } else {
      panel.hidden = true;
    }

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
    const buyBtn = event.target.closest?.("[data-buy-plan]");
    if (buyBtn) {
      const section = buyBtn.closest('[data-section="buyPlans"]');
      if (section) {
        event.preventDefault();
        handleBuyPlanClick(buyBtn.getAttribute("data-buy-plan"), section);
      }
      return;
    }

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

  function waitForBuyPlansSectionReady(section) {
    return new Promise(function (resolve) {
      const state = section.dataset.loadState;
      if (state === "loaded" || state === "error") {
        resolve();
        return;
      }
      const observer = new MutationObserver(function () {
        const next = section.dataset.loadState;
        if (next === "loaded" || next === "error") {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(section, {
        attributes: true,
        attributeFilter: ["data-load-state"],
      });
      window.setTimeout(function () {
        observer.disconnect();
        resolve();
      }, 15000);
    });
  }

  function stickyNavScrollOffsetPx() {
    const nav = document.querySelector("nav");
    if (!nav) {
      return 96;
    }
    return Math.ceil(nav.getBoundingClientRect().height) + 16;
  }

  function scrollBuyPlansIntoView(section) {
    const title =
      section.querySelector(".account-accordion__toggle") || section;
    const offset = stickyNavScrollOffsetPx();

    function doScroll() {
      const top = title.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({
        top: Math.max(0, top),
        behavior: "smooth",
      });
    }

    // Wait for accordion expand + catalog paint (first open shifts layout).
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(doScroll);
    });
  }

  function waitForDashboardReady() {
    if (currentUser && signedInPanel && !signedInPanel.hidden) {
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      let attempts = 0;
      const timer = window.setInterval(function () {
        attempts += 1;
        if (currentUser && signedInPanel && !signedInPanel.hidden) {
          window.clearInterval(timer);
          resolve();
          return;
        }
        if (attempts >= 120) {
          window.clearInterval(timer);
          resolve();
        }
      }, 50);
    });
  }

  let scrollToBuyPlansPromise = null;

  async function scrollToBuyPlansSection() {
    if (scrollToBuyPlansPromise) {
      return scrollToBuyPlansPromise;
    }

    scrollToBuyPlansPromise = (async function () {
      const section = document.getElementById("buy-plans-section");
      if (!section) {
        return;
      }

      await waitForDashboardReady();
      toggleSection(section, true);

      if (currentUser) {
        const state = section.dataset.loadState;
        if (state !== "loaded" && state !== "loading" && !buyState.loading) {
          await loadBuyPlansSection(section);
        } else if (state === "loading" || buyState.loading) {
          await waitForBuyPlansSectionReady(section);
        }
      }

      scrollBuyPlansIntoView(section);
    })().finally(function () {
      scrollToBuyPlansPromise = null;
    });

    return scrollToBuyPlansPromise;
  }

  function openBuyPlansFromHash() {
    const hash = String(window.location.hash || "").toLowerCase();
    if (hash !== "#buy-plans" && hash !== "#buy-plans-section") {
      return;
    }
    void scrollToBuyPlansSection();
  }

  window.TourAiDashboardScrollToBuyPlans = scrollToBuyPlansSection;

  document.addEventListener("click", function (event) {
    const link = event.target.closest?.(
      "a[data-buy-premium='true'], a[href*='#buy-plans']"
    );
    if (!link || !/\/dashboard\.html/i.test(String(window.location.pathname || ""))) {
      return;
    }
    event.preventDefault();
    const hash = String(window.location.hash || "").toLowerCase();
    if (hash !== "#buy-plans-section") {
      window.location.hash = "buy-plans-section";
    }
    void scrollToBuyPlansSection();
  });

  async function refreshDashboardPlans() {
    data.clearCache();
    pagers.plans = { items: [], cursor: null, hasMore: true, loading: false, observer: null };
    pagers.payments = {
      items: [],
      cursor: null,
      hasMore: true,
      loading: false,
      observer: null,
    };
    buyState.plans = [];
    buyState.busyPlanId = "";

    await Promise.all(
      Array.from(document.querySelectorAll("[data-section]")).map(async function (section) {
        const key = section.getAttribute("data-section");
        if (key !== "activePlan" && key !== "plans" && key !== "buyPlans") {
          return;
        }
        section.dataset.loadState = "idle";
        if (key === "activePlan") {
          toggleSection(section, true);
          return;
        }
        if (section.classList.contains("is-open")) {
          await loadSection(section);
        }
      })
    );
  }

  function hidePremiumAcquisitionPromos() {
    document.querySelectorAll(".plan-freemium-promo").forEach(function (el) {
      el.hidden = true;
    });
    window.TourAiSitePromo?.onPurchaseSuccess?.();
  }

  async function handleCheckoutReturnIfAny() {
    const checkoutReturn = window.TourAiCheckout?.consumeCheckoutQuery?.();
    if (!checkoutReturn) {
      return;
    }

    if (checkoutReturn.type === "success") {
      hidePremiumAcquisitionPromos();
      var purchaseContext = window.TourAiPlanActivation?.loadPurchaseContext?.();
      if (purchaseContext?.userPaymentId && data.reconcileStripePaymentById) {
        try {
          await data.reconcileStripePaymentById(currentUser, purchaseContext.userPaymentId);
        } catch (err) {
          console.error("[TourAI dashboard] checkout reconcile", err);
        }
      }
      data.clearCache();
      await showBuyAlert(
        t("account.buy.status.successPayment"),
        t("account.buy.status.successDetail"),
        t("account.buy.status.close")
      );
      if (window.TourAiPlanActivation?.tryAfterPaymentAsync && currentUser) {
        await window.TourAiPlanActivation.tryAfterPaymentAsync(currentUser);
      }
      await refreshDashboardPlans();
      return;
    }

    if (checkoutReturn.type === "cancel") {
      var cancelContext = window.TourAiPlanActivation?.loadPurchaseContext?.();
      if (cancelContext?.userPaymentId && data.cancelStripePaymentById) {
        try {
          await data.cancelStripePaymentById(currentUser, cancelContext.userPaymentId);
        } catch (err) {
          console.error("[TourAI dashboard] checkout cancel", err);
        }
      }
      data.clearCache();
      await refreshDashboardPlans();
    }

    if (checkoutReturn.message) {
      await showBuyAlert(
        checkoutReturn.title || t("account.buy.title"),
        checkoutReturn.message
      );
    }
  }

  window.addEventListener("hashchange", openBuyPlansFromHash);

  setStatus("");

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
      setStatus(statusEl?.textContent || "", false);
      await tryReconcilePendingStripePayments();
      await handleCheckoutReturnIfAny();
      openBuyPlansFromHash();
    })
    .catch(function (err) {
      console.error(err);
      redirectToLogin();
    });

  logoutBtn?.addEventListener("click", async function () {
    const ok = await (window.TourAiConfirm?.show
      ? window.TourAiConfirm.show({
          title: t("account.confirm.logout.title"),
          message: t("account.confirm.logout.body"),
          confirmLabel: t("account.confirm.logout.confirm"),
          cancelLabel: t("account.confirm.cancel"),
        })
      : Promise.resolve(
          window.confirm(
            t("account.confirm.logout.title") +
              "\n\n" +
              t("account.confirm.logout.body")
          )
        ));
    if (!ok) {
      return;
    }
    setStatus(t("account.status.signingOut"), false);
    try {
      data.clearCache();
      await auth.signOut();
      window.location.replace("login.html");
    } catch (err) {
      setStatus(auth.mapAuthError(err), true);
    }
  });

  deleteAccountBtn?.addEventListener("click", async function (event) {
    event.preventDefault();
    const href = deleteAccountBtn.getAttribute("href") || "delete-account.html";
    const ok = await (window.TourAiConfirm?.show
      ? window.TourAiConfirm.show({
          title: t("account.confirm.delete.title"),
          message: t("account.confirm.delete.body"),
          confirmLabel: t("account.confirm.delete.confirm"),
          cancelLabel: t("account.confirm.cancel"),
          danger: true,
        })
      : Promise.resolve(
          window.confirm(
            t("account.confirm.delete.title") +
              "\n\n" +
              t("account.confirm.delete.body")
          )
        ));
    if (!ok) {
      return;
    }
    window.location.href = href;
  });

  document.addEventListener("tourai:locale-changed", function () {
    document.querySelectorAll("[data-section].is-open").forEach(function (section) {
      const key = section.getAttribute("data-section");
      if (key === "plans" && pagers.plans.items.length) {
        paintPlansSection(section);
      } else if (key === "payments" && pagers.payments.items.length) {
        paintPaymentsSection(section);
      }
    });
  });
})();
