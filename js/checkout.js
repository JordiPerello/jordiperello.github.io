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

  var PLAN_CATALOG_TYPE_ORDER = {
    TourGuide: 0,
    TourGuideChatAI: 1,
    AudioGuide: 2,
    AudioGuideChatAI: 3,
    ChatAI: 4,
  };

  function getTypeSortOrder(type) {
    var key = String(type || "").trim();
    if (Object.prototype.hasOwnProperty.call(PLAN_CATALOG_TYPE_ORDER, key)) {
      return PLAN_CATALOG_TYPE_ORDER[key];
    }
    return 100;
  }

  function getTypeTitle(type) {
    var key = String(type || "").trim();
    var i18nKey = "account.buy.catalogType." + key;
    var label = t(i18nKey);
    return label === i18nKey ? key : label;
  }

  function getTypeSubtitle(type) {
    var key = String(type || "").trim();
    var i18nKey = "account.buy.catalogTypeSubtitle." + key;
    var label = t(i18nKey);
    return label === i18nKey ? "" : label;
  }

  function groupPlansByType(plans) {
    var map = {};
    plans.forEach(function (plan) {
      var type = String(plan.Type || "").trim();
      if (!map[type]) {
        map[type] = [];
      }
      map[type].push(plan);
    });
    return Object.keys(map)
      .sort(function (left, right) {
        var orderCompare = getTypeSortOrder(left) - getTypeSortOrder(right);
        if (orderCompare !== 0) {
          return orderCompare;
        }
        return left.localeCompare(right);
      })
      .map(function (type) {
        return {
          type: type,
          plans: map[type].slice().sort(function (left, right) {
            return (
              left.PriceCents - right.PriceCents ||
              left.DurationDays - right.DurationDays
            );
          }),
        };
      });
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
        Type: String(data.Type || "").trim(),
        PriceCents: priceCents,
        Currency: data.Currency || "eur",
        DurationDays: Number(data.DurationDays) || 0,
        TokensIncluded: Number(data.TokensIncluded) || 0,
      });
    });
    return plans;
  }

  function renderPlanBuyCard(plan, options) {
    var duration =
      plan.DurationDays > 0
        ? t("account.buy.durationDays", { n: String(plan.DurationDays) })
        : "";
    var tokens =
      plan.TokensIncluded > 0
        ? t("account.buy.tokens", { n: String(plan.TokensIncluded) })
        : "";
    var meta = [duration, tokens].filter(Boolean).join(" · ");
    var busyId = options.busyPlanId || "";
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
        ? '<p class="plan-buy-card__body">' + escapeHtml(plan.Description) + "</p>"
        : "") +
      (meta ? '<p class="plan-buy-card__meta">' + escapeHtml(meta) + "</p>" : "") +
      '<p class="plan-buy-card__price">' +
      escapeHtml(formatPrice(plan.PriceCents, plan.Currency)) +
      "</p>" +
      "</div>" +
      '<p class="plan-buy-card__actions">' +
      '<button type="button" class="btn-primary" data-buy-plan="' +
      escapeHtml(plan.Id) +
      '"' +
      (isBusy || options.disabled ? " disabled" : "") +
      (isBusy ? ' aria-busy="true"' : "") +
      ">" +
      escapeHtml(t("account.buy.cta")) +
      "</button>" +
      "</p>" +
      "</article>"
    );
  }

  function togglePlanTypeAccordion(section, forceOpen) {
    var toggle = section.querySelector(".account-accordion__toggle");
    var panel = section.querySelector(".account-accordion__panel");
    if (!toggle || !panel) {
      return false;
    }

    var willOpen =
      forceOpen === true
        ? true
        : forceOpen === false
          ? false
          : !section.classList.contains("is-open");
    section.classList.toggle("is-open", willOpen);
    toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
    if (willOpen) {
      panel.removeAttribute("hidden");
    } else {
      panel.hidden = true;
    }
    return willOpen;
  }

  function collapseSiblingPlanTypeAccordions(openedSection) {
    var host = openedSection.closest(".plan-type-accordions");
    if (!host) {
      return;
    }
    host.querySelectorAll(".plan-type-accordion.is-open").forEach(function (section) {
      if (section !== openedSection) {
        togglePlanTypeAccordion(section, false);
      }
    });
  }

  function wirePlanTypeAccordions(root) {
    if (!root) {
      return;
    }
    root.querySelectorAll(".plan-type-accordion").forEach(function (section) {
      var toggle = section.querySelector(".account-accordion__toggle");
      if (!toggle || toggle.dataset.planTypeAccordionWired === "true") {
        return;
      }
      toggle.dataset.planTypeAccordionWired = "true";
      toggle.addEventListener("click", function () {
        var wasOpen = section.classList.contains("is-open");
        if (!wasOpen) {
          collapseSiblingPlanTypeAccordions(section);
        }
        togglePlanTypeAccordion(section);
      });
    });
  }

  function renderCatalogHtml(plans, options) {
    options = options || {};
    if (!plans || !plans.length) {
      return (
        '<p class="account-empty">' + escapeHtml(t("account.buy.empty")) + "</p>"
      );
    }

    var groups = groupPlansByType(plans);
    var sections = groups
      .map(function (group) {
        var title = getTypeTitle(group.type);
        var subtitle = getTypeSubtitle(group.type);
        var cards = group.plans
          .map(function (plan) {
            return renderPlanBuyCard(plan, options);
          })
          .join("");
        return (
          '<section class="plan-type-accordion account-accordion" data-plan-type="' +
          escapeHtml(group.type) +
          '">' +
          '<button type="button" class="account-accordion__toggle plan-type-accordion__toggle" aria-expanded="false">' +
          '<span class="plan-type-accordion__heading">' +
          '<span class="plan-type-accordion__title">' +
          escapeHtml(title) +
          "</span>" +
          (subtitle
            ? '<span class="plan-type-accordion__subtitle">' +
              escapeHtml(subtitle) +
              "</span>"
            : "") +
          "</span>" +
          '<span class="account-accordion__chevron" aria-hidden="true"></span>' +
          "</button>" +
          '<div class="account-accordion__panel" hidden>' +
          '<div class="plan-buy-list">' +
          cards +
          "</div>" +
          "</div>" +
          "</section>"
        );
      })
      .join("");

    return (
      '<div class="plan-buy-catalog" id="buy-plans-list">' +
      '<div class="plan-type-accordions">' +
      sections +
      "</div>" +
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

  function setLoadingMessage(message) {
    var messageEl = global.document?.querySelector?.(".tourai-loading-message");
    if (messageEl && message) {
      messageEl.textContent = message;
    }
  }

  async function startCheckout(planId, options) {
    options = options || {};
    var url = checkoutUrl();
    if (!url) {
      throw new Error("CONFIG_MISSING");
    }

    var user = authApi().currentUser();
    if (!user) {
      throw new Error("NOT_SIGNED_IN");
    }

    if (typeof options.onProgress === "function") {
      options.onProgress("preparing");
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

    if (body.userPlanId && global.TourAiPlanActivation?.savePurchaseContext) {
      global.TourAiPlanActivation.savePurchaseContext({
        userPlanId: body.userPlanId,
        userPaymentId: body.userPaymentId || "",
        noActivePlanAtPurchaseStart: options.noActivePlanAtPurchaseStart === true,
      });
    }

    if (typeof options.onProgress === "function") {
      options.onProgress("redirecting");
    }
    setLoadingMessage(t("account.buy.redirecting"));
    global.location.assign(body.checkoutUrl);
    return body;
  }

  function consumeCheckoutQuery() {
    try {
      var params = new URLSearchParams(global.location.search || "");
      var checkout = params.get("checkout");
      if (!checkout) {
        return null;
      }
      var sessionId = String(params.get("session_id") || "").trim();
      var planId = params.get("planId");
      params.delete("checkout");
      params.delete("session_id");
      params.delete("planId");
      var next =
        global.location.pathname +
        (params.toString() ? "?" + params.toString() : "") +
        (global.location.hash || "");
      global.history.replaceState({}, "", next);

      if (checkout === "success") {
        return {
          type: "success",
          sessionId: sessionId,
          planId: String(planId || "").trim(),
          title: t("account.buy.status.successTitle"),
          message: t("account.buy.status.success"),
        };
      }
      if (checkout === "cancel") {
        return {
          type: "cancel",
          title: t("account.buy.status.cancelTitle"),
          message: t("account.buy.status.cancel"),
        };
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  global.TourAiCheckout = {
    fetchActiveCatalogPlans: fetchActiveCatalogPlans,
    renderCatalogHtml: renderCatalogHtml,
    wirePlanTypeAccordions: wirePlanTypeAccordions,
    startCheckout: startCheckout,
    mapCheckoutError: mapCheckoutError,
    consumeCheckoutQuery: consumeCheckoutQuery,
    formatPrice: formatPrice,
  };
})(window);
