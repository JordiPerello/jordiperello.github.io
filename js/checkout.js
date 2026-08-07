/* TourAI web Stripe checkout (createCheckoutSessionWeb).
 * Requires signed-in Firebase user + App Check. No CF API key / HMAC in the browser.
 * User-facing copy lives in js/locales/es-ES.js and js/locales/en-GB.js only.
 */
(function (global) {
  "use strict";

  function authApi() {
    return global.TourAiAuth;
  }

  function t(key, vars) {
    return authApi()?.t?.(key, vars) ?? key;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function checkoutUrl() {
    return String(global.TourAiSite?.config?.createCheckoutSessionWebUrl || "").trim();
  }

  function formatPrice(priceCents, currency) {
    var cents = Number(priceCents) || 0;
    var code = String(currency || "eur").toUpperCase();
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
      }).format(cents / 100);
    } catch (err) {
      return (cents / 100).toFixed(2) + " " + code;
    }
  }

  async function fetchActiveCatalogPlans() {
    var db = await authApi().getFirestore();
    var snap = await db.collection("Plans").get();
    var plans = [];
    snap.forEach(function (doc) {
      var data = doc.data() || {};
      var id = data.Id || doc.id;
      if (data.IsActive !== true) {
        return;
      }
      var priceCents = Number(data.PriceCents) || 0;
      if (priceCents <= 0) {
        return;
      }
      plans.push({
        Id: id,
        Name: data.Name || id,
        Description: data.Description || "",
        PriceCents: priceCents,
        Currency: data.Currency || "eur",
        DurationDays: Number(data.DurationDays) || 0,
        TokensIncluded: Number(data.TokensIncluded) || 0,
      });
    });
    plans.sort(function (a, b) {
      return a.PriceCents - b.PriceCents || a.DurationDays - b.DurationDays;
    });
    return plans;
  }

  function renderCatalogHtml(plans, options) {
    options = options || {};
    if (!plans || !plans.length) {
      return (
        '<p class="account-empty">' + escapeHtml(t("account.buy.empty")) + "</p>"
      );
    }

    var busyId = options.busyPlanId || "";
    var cards = plans
      .map(function (plan) {
        var duration =
          plan.DurationDays > 0
            ? t("account.buy.durationDays", { n: String(plan.DurationDays) })
            : "";
        var tokens =
          plan.TokensIncluded > 0
            ? t("account.buy.tokens", { n: String(plan.TokensIncluded) })
            : "";
        var meta = [duration, tokens].filter(Boolean).join(" · ");
        var isBusy = busyId && busyId === plan.Id;
        return (
          '<article class="plan-buy-card" data-plan-id="' +
          escapeHtml(plan.Id) +
          '">' +
          '<div class="plan-buy-card__copy">' +
          '<h3 class="plan-buy-card__title">' +
          escapeHtml(plan.Name) +
          "</h3>" +
          (plan.Description
            ? '<p class="plan-buy-card__body">' +
              escapeHtml(plan.Description) +
              "</p>"
            : "") +
          (meta
            ? '<p class="plan-buy-card__meta">' + escapeHtml(meta) + "</p>"
            : "") +
          '<p class="plan-buy-card__price">' +
          escapeHtml(formatPrice(plan.PriceCents, plan.Currency)) +
          "</p>" +
          "</div>" +
          '<p class="plan-buy-card__actions">' +
          '<button type="button" class="btn-primary" data-buy-plan="' +
          escapeHtml(plan.Id) +
          '"' +
          (isBusy || options.disabled ? " disabled" : "") +
          ">" +
          escapeHtml(
            isBusy ? t("account.buy.redirecting") : t("account.buy.cta")
          ) +
          "</button>" +
          "</p>" +
          "</article>"
        );
      })
      .join("");

    return (
      '<div class="plan-buy-list" id="buy-plans">' +
      cards +
      '<p class="account-note">' +
      escapeHtml(t("account.buy.note")) +
      "</p></div>"
    );
  }

  function mapCheckoutError(code) {
    switch (String(code || "")) {
      case "plan_not_found":
      case "plan_inactive":
      case "plan_invalid_price":
        return t("account.buy.error.plan");
      case "too_many_pending_checkouts":
        return t("account.buy.error.rateLimit");
      case "APP_CHECK_CONFIG_MISSING":
      case "APP_CHECK_SDK_MISSING":
      case "APP_CHECK_TOKEN_MISSING":
        return t("account.buy.error.appCheck");
      case "CONFIG_MISSING":
        return t("account.buy.error.config");
      default:
        return t("account.buy.error.generic");
    }
  }

  async function startCheckout(planId) {
    var url = checkoutUrl();
    if (!url) {
      throw new Error("CONFIG_MISSING");
    }

    var user = authApi().currentUser();
    if (!user) {
      throw new Error("NOT_SIGNED_IN");
    }

    var idToken = await user.getIdToken();
    var appCheckToken = await global.TourAiAppCheck.getToken(false);

    var response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + idToken,
        "X-Firebase-AppCheck": appCheckToken,
      },
      body: JSON.stringify({
        userId: user.uid,
        planId: planId,
      }),
    });

    var body = null;
    try {
      body = await response.json();
    } catch (err) {
      body = null;
    }

    if (!response.ok || !body?.success || !body?.checkoutUrl) {
      throw new Error(body?.error || "checkout_failed");
    }

    global.location.assign(body.checkoutUrl);
    return body;
  }

  function consumeCheckoutQuery(statusEl) {
    try {
      var params = new URLSearchParams(global.location.search || "");
      var checkout = params.get("checkout");
      if (!checkout) {
        return null;
      }
      params.delete("checkout");
      params.delete("session_id");
      params.delete("planId");
      var next =
        global.location.pathname +
        (params.toString() ? "?" + params.toString() : "") +
        (global.location.hash || "");
      global.history.replaceState({}, "", next);

      var result = null;
      if (checkout === "success") {
        result = {
          type: "success",
          title: t("account.buy.status.successTitle"),
          message: t("account.buy.status.success"),
        };
      } else if (checkout === "cancel") {
        result = {
          type: "cancel",
          title: t("account.buy.status.cancelTitle"),
          message: t("account.buy.status.cancel"),
        };
      }

      if (result && statusEl) {
        statusEl.textContent = result.message;
        statusEl.classList.remove("error");
      }
      return result;
    } catch (err) {
      return null;
    }
  }

  global.TourAiCheckout = {
    fetchActiveCatalogPlans: fetchActiveCatalogPlans,
    renderCatalogHtml: renderCatalogHtml,
    startCheckout: startCheckout,
    mapCheckoutError: mapCheckoutError,
    consumeCheckoutQuery: consumeCheckoutQuery,
    formatPrice: formatPrice,
  };
})(window);
