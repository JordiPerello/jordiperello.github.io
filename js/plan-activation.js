/* Post-purchase plan activation (aligned with TourAI app PaymentPurchasedPlanActivationService). */
(function (global) {
  "use strict";

  var STORAGE_USER_PLAN_ID = "tourai-purchase-user-plan-id";
  var STORAGE_USER_PAYMENT_ID = "tourai-purchase-user-payment-id";
  var STORAGE_WAS_FREEMIUM = "tourai-was-freemium-at-purchase-start";

  function authApi() {
    return global.TourAiAuth;
  }

  function dataApi() {
    return global.TourAiAccountData;
  }

  function t(key, vars) {
    return authApi()?.t?.(key, vars) ?? key;
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
    var parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function savePurchaseContext(context) {
    try {
      if (!context?.userPlanId) {
        return;
      }
      global.sessionStorage.setItem(STORAGE_USER_PLAN_ID, String(context.userPlanId));
      if (context.userPaymentId) {
        global.sessionStorage.setItem(
          STORAGE_USER_PAYMENT_ID,
          String(context.userPaymentId)
        );
      }
      global.sessionStorage.setItem(
        STORAGE_WAS_FREEMIUM,
        context.wasFreemiumAtPurchaseStart ? "1" : "0"
      );
    } catch (_e) {
      /* ignore */
    }
  }

  function loadPurchaseContext() {
    try {
      var userPlanId = String(global.sessionStorage.getItem(STORAGE_USER_PLAN_ID) || "").trim();
      if (!userPlanId) {
        return null;
      }
      return {
        userPlanId: userPlanId,
        userPaymentId: String(
          global.sessionStorage.getItem(STORAGE_USER_PAYMENT_ID) || ""
        ).trim(),
        wasFreemiumAtPurchaseStart:
          global.sessionStorage.getItem(STORAGE_WAS_FREEMIUM) === "1",
      };
    } catch (_e2) {
      return null;
    }
  }

  function clearPurchaseContext() {
    try {
      global.sessionStorage.removeItem(STORAGE_USER_PLAN_ID);
      global.sessionStorage.removeItem(STORAGE_USER_PAYMENT_ID);
      global.sessionStorage.removeItem(STORAGE_WAS_FREEMIUM);
    } catch (_e) {
      /* ignore */
    }
  }

  async function wasFreemiumAtPurchaseStart(user) {
    if (!user || !dataApi()?.fetchActivePlan) {
      return true;
    }
    var active = await dataApi().fetchActivePlan(user);
    return !active;
  }

  async function fetchUserPlan(user, userPlanId) {
    var db = await authApi().getFirestore();
    var snap = await db
      .collection("Users")
      .doc(user.uid)
      .collection("UserPlans")
      .doc(userPlanId)
      .get();
    if (!snap.exists) {
      return null;
    }
    return { Id: snap.id, _doc: snap, ...snap.data() };
  }

  async function waitForUserPlanPaid(user, userPlanId, maxMs) {
    var deadline = Date.now() + (maxMs || 45000);
    while (Date.now() < deadline) {
      var plan = await fetchUserPlan(user, userPlanId);
      if (plan && String(plan.PaymentStatus || "") === "Paid") {
        return plan;
      }
      await new Promise(function (resolve) {
        global.setTimeout(resolve, 1000);
      });
    }
    return null;
  }

  function isPlanInUse(plan) {
    var now = Date.now();
    var start = toDate(plan.StartDate);
    var end = toDate(plan.EndDate);
    var included = Number(plan.TokensIncluded) || 0;
    var consumed = Number(plan.TokensConsumed) || 0;
    if (!start || !end) {
      return false;
    }
    if (now < start.getTime() || now > end.getTime()) {
      return false;
    }
    return included <= 0 || consumed < included;
  }

  function shouldPromptPlanActivation(wasFreemium, purchasedPlan, activePlan) {
    if (activePlan && String(activePlan.Id) === String(purchasedPlan.Id)) {
      return false;
    }
    if (isPlanInUse(purchasedPlan)) {
      return false;
    }
    return wasFreemium || !activePlan;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildActivatePlanConfirmHtml(planName) {
    var name = escapeHtml(String(planName || "").trim() || "—");
    return (
      '<div class="plan-activate-confirm">' +
      '<div class="plan-activate-confirm__intro">' +
      '<p class="plan-activate-confirm__line1">' +
      escapeHtml(t("account.plan.activate.line1")) +
      "</p>" +
      '<p class="plan-activate-confirm__plan-name">' +
      name +
      "</p>" +
      "</div>" +
      '<div class="plan-activate-confirm__body">' +
      '<div class="plan-activate-confirm__benefit">' +
      '<span class="plan-activate-confirm__check" aria-hidden="true">✅</span>' +
      '<p class="plan-activate-confirm__line2">' +
      escapeHtml(t("account.plan.activate.line2")) +
      "</p>" +
      "</div>" +
      '<p class="plan-activate-confirm__line3">' +
      escapeHtml(t("account.plan.activate.line3")) +
      "</p>" +
      "</div>" +
      "</div>"
    );
  }

  async function showActivatePlanConfirm(planName) {
    if (global.TourAiConfirm?.show) {
      return global.TourAiConfirm.show({
        title: t("account.plan.activate.title"),
        icon: "🔁",
        layout: "app",
        messageHtml: buildActivatePlanConfirmHtml(planName),
        confirmLabel: t("account.confirm.ok"),
        cancelLabel: t("account.confirm.cancel"),
      });
    }
    return global.confirm(
      t("account.plan.activate.line1") +
        "\n" +
        String(planName || "").trim() +
        "\n\n✅ " +
        t("account.plan.activate.line2") +
        "\n\n" +
        t("account.plan.activate.line3")
    );
  }

  async function setUserPlanAsActive(user, plan) {
    var db = await authApi().getFirestore();
    var ref = db.collection("Users").doc(user.uid).collection("UserPlans").doc(plan.Id);
    var now = new Date();
    var startDate = toDate(plan.StartDate) || now;
    var durationDays = Number(plan.DurationDays) || 0;
    var endDate =
      toDate(plan.EndDate) ||
      new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
    var version = (Number(plan.Version) || 0) + 1;

    await ref.update({
      DateOfSelection: now,
      StartDate: startDate,
      EndDate: endDate,
      Version: version,
    });
  }

  async function tryAfterPaymentAsync(user, options) {
    options = options || {};
    var context = loadPurchaseContext();
    if (!context?.userPlanId || !user) {
      clearPurchaseContext();
      return false;
    }

    if (context.userPaymentId && dataApi()?.reconcileStripePaymentById) {
      await dataApi().reconcileStripePaymentById(user, context.userPaymentId);
    }

    dataApi()?.clearCache?.();

    var purchasedPlan = await fetchUserPlan(user, context.userPlanId);
    if (!purchasedPlan || String(purchasedPlan.PaymentStatus || "") !== "Paid") {
      clearPurchaseContext();
      return false;
    }

    var activePlan = dataApi()?.fetchActivePlan
      ? await dataApi().fetchActivePlan(user)
      : null;

    if (
      !shouldPromptPlanActivation(
        context.wasFreemiumAtPurchaseStart,
        purchasedPlan,
        activePlan
      )
    ) {
      clearPurchaseContext();
      return false;
    }

    var planName =
      purchasedPlan.PlanName || purchasedPlan.PlanId || purchasedPlan.Id || "";
    var confirmed = await showActivatePlanConfirm(planName);
    if (confirmed) {
      try {
        await setUserPlanAsActive(user, purchasedPlan);
        dataApi()?.clearCache?.();
        if (global.TourAiSitePromo?.onPlanActivated) {
          await global.TourAiSitePromo.onPlanActivated(user);
        }
      } catch (err) {
        console.error("[TourAI plan activation]", err);
        if (global.TourAiConfirm?.show) {
          await global.TourAiConfirm.show({
            title: t("account.plan.activate.title"),
            message: t("account.plan.activate.error.generic"),
            confirmLabel: t("account.alert.ok"),
            alert: true,
          });
        }
      }
    }

    clearPurchaseContext();
    return confirmed;
  }

  global.TourAiPlanActivation = {
    wasFreemiumAtPurchaseStart: wasFreemiumAtPurchaseStart,
    savePurchaseContext: savePurchaseContext,
    loadPurchaseContext: loadPurchaseContext,
    clearPurchaseContext: clearPurchaseContext,
    tryAfterPaymentAsync: tryAfterPaymentAsync,
    setUserPlanAsActive: setUserPlanAsActive,
  };
})(window);
