/* TourAI first-party site promo (not third-party ads).
 * - Guests: encourage installing / launch alert for the app.
 * - Signed-in freemium: encourage a Premium plan.
 * - Premium: hidden.
 */
(function (global) {
  "use strict";

  var MODAL_INTERVAL_MS = 12 * 60 * 1000;
  var BANNER_DISMISS_DAYS = 7;
  var BANNER_DISMISS_KEY_PREFIX = "tourai-site-promo-banner-dismissed-until:";
  var LAST_MODAL_KEY_PREFIX = "tourai-site-promo-last-modal:";
  var ROOT_ID = "tourai-site-promo-root";

  var state = {
    user: null,
    audience: null,
    checking: false,
    pendingUser: undefined,
    root: null,
    modalTimer: null,
    firstModalTimer: null,
  };

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

  function toDate(value) {
    if (!value) {
      return null;
    }
    if (typeof value.toDate === "function") {
      return value.toDate();
    }
    if (value instanceof Date) {
      return value;
    }
    var parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function planIsActive(plan) {
    if (!plan || String(plan.AccountType || "") === "Freemium") {
      return false;
    }
    var now = Date.now();
    var start = toDate(plan.StartDate);
    var end = toDate(plan.EndDate);
    var included = Number(plan.TokensIncluded) || 0;
    var consumed = Number(plan.TokensConsumed) || 0;
    var remaining = included - consumed;
    var consumedOut = included > 0 && remaining <= 0;
    return !!(
      start &&
      end &&
      now >= start.getTime() &&
      now <= end.getTime() &&
      !consumedOut
    );
  }

  async function resolveAudience(user) {
    if (!user) {
      return "guest";
    }
    try {
      if (global.TourAiAccountData && typeof global.TourAiAccountData.fetchActivePlan === "function") {
        var active = await global.TourAiAccountData.fetchActivePlan(user);
        return active ? null : "freemium";
      }

      var db = await authApi().getFirestore();
      var snap = await db
        .collection("Users")
        .doc(user.uid)
        .collection("UserPlans")
        .orderBy("CreatedAt", "desc")
        .limit(12)
        .get();

      for (var i = 0; i < snap.docs.length; i += 1) {
        if (planIsActive(snap.docs[i].data() || {})) {
          return null;
        }
      }
      return "freemium";
    } catch (err) {
      return null;
    }
  }

  function copyForAudience(audience) {
    if (audience === "guest") {
      return {
        title: t("site.promo.guest.title"),
        body: t("site.promo.guest.body"),
        cta: t("site.promo.guest.cta"),
        dismiss: t("site.promo.dismiss"),
        railLabel: t("site.promo.guest.railLabel"),
        modalLead: t("site.promo.guest.modalLead"),
        href: "index.html#waitlist",
      };
    }

    // Signed-in freemium: send them to web Premium checkout (not the launch waitlist).
    return {
      title: t("site.promo.freemium.title"),
      body: t("site.promo.freemium.body"),
      cta: t("site.promo.freemium.cta"),
      dismiss: t("site.promo.dismiss"),
      railLabel: t("site.promo.freemium.railLabel"),
      modalLead: t("site.promo.freemium.modalLead"),
      href: "dashboard.html#buy-plans",
    };
  }

  function bannerDismissKey(audience) {
    return BANNER_DISMISS_KEY_PREFIX + (audience || "guest");
  }

  function lastModalKey(audience) {
    return LAST_MODAL_KEY_PREFIX + (audience || "guest");
  }

  function bannerDismissed(audience) {
    try {
      var until = Number(localStorage.getItem(bannerDismissKey(audience)) || 0);
      return until > Date.now();
    } catch (err) {
      return false;
    }
  }

  function dismissBanner() {
    var audience = state.audience || "guest";
    try {
      var until = Date.now() + BANNER_DISMISS_DAYS * 24 * 60 * 60 * 1000;
      localStorage.setItem(bannerDismissKey(audience), String(until));
    } catch (err) {
      /* ignore */
    }
    var banner = state.root && state.root.querySelector("[data-promo-banner]");
    if (banner) {
      banner.hidden = true;
    }
    var rail = state.root && state.root.querySelector("[data-promo-rail]");
    if (rail) {
      rail.hidden = true;
    }
    document.documentElement.classList.remove("has-site-promo-banner");
  }

  function lastModalAt(audience) {
    try {
      return Number(localStorage.getItem(lastModalKey(audience)) || 0);
    } catch (err) {
      return 0;
    }
  }

  function markModalShown(audience) {
    try {
      localStorage.setItem(lastModalKey(audience || state.audience || "guest"), String(Date.now()));
    } catch (err) {
      /* ignore */
    }
  }

  function cookieBannerVisible() {
    var cookie = document.querySelector(".site-cookie-banner");
    return !!(cookie && !cookie.hidden && cookie.offsetParent !== null);
  }

  function otherModalOpen() {
    return !!document.querySelector(
      ".modal:not([hidden]), .site-modal:not([hidden]), [data-modal-open='true'], dialog[open]"
    );
  }

  function applyCopy(root, audience) {
    var copy = copyForAudience(audience);
    var title = escapeHtml(copy.title);
    var body = escapeHtml(copy.body);
    var cta = escapeHtml(copy.cta);
    var dismiss = escapeHtml(copy.dismiss);
    var railLabel = escapeHtml(copy.railLabel);
    var modalLead = escapeHtml(copy.modalLead);
    var href = escapeHtml(copy.href);

    root.setAttribute("data-promo-audience", audience);

    var setText = function (selector, text) {
      var el = root.querySelector(selector);
      if (el) {
        el.textContent = text;
      }
    };

    setText("[data-promo-rail-eyebrow]", copy.railLabel);
    setText("[data-promo-rail-title]", copy.title);
    setText("[data-promo-rail-body]", copy.body);
    setText("[data-promo-banner-title]", copy.title);
    setText("[data-promo-banner-body]", copy.body);
    setText("[data-promo-modal-title]", copy.title);
    setText("[data-promo-modal-lead]", copy.modalLead);
    setText("[data-promo-modal-body]", copy.body);

    root.querySelectorAll("[data-promo-cta]").forEach(function (el) {
      var hasCta = !!(copy.href && copy.cta);
      el.hidden = !hasCta;
      if (!hasCta) {
        return;
      }
      el.textContent = copy.cta;
      if (el.tagName === "A") {
        el.setAttribute("href", copy.href);
      }
    });
    root.querySelectorAll("[data-promo-dismiss-label]").forEach(function (el) {
      el.textContent = copy.dismiss;
    });

    var rail = root.querySelector("[data-promo-rail]");
    if (rail) {
      rail.setAttribute("aria-label", railLabel);
    }
    var banner = root.querySelector("[data-promo-banner]");
    if (banner) {
      banner.setAttribute("aria-label", title);
    }

    // Keep escaped vars referenced so StyleCop-like unused checks in editors stay quiet.
    void body;
    void cta;
    void dismiss;
    void modalLead;
    void href;
  }

  function ensureRoot(audience) {
    if (state.root && document.body.contains(state.root)) {
      applyCopy(state.root, audience);
      return state.root;
    }
    var existing = document.getElementById(ROOT_ID);
    if (existing) {
      state.root = existing;
      applyCopy(existing, audience);
      return existing;
    }

    var root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "site-promo";
    root.setAttribute("data-site-promo", "1");
    root.hidden = true;
    root.innerHTML =
      '<aside class="site-promo__rail" data-promo-rail hidden>' +
      '<p class="site-promo__rail-eyebrow" data-promo-rail-eyebrow></p>' +
      '<p class="site-promo__rail-title" data-promo-rail-title></p>' +
      '<p class="site-promo__rail-body" data-promo-rail-body></p>' +
      '<a class="btn-primary site-promo__rail-cta" data-promo-cta href="index.html#waitlist"></a>' +
      "</aside>" +
      '<div class="site-promo__banner" data-promo-banner hidden role="region">' +
      '<div class="site-promo__banner-inner">' +
      '<div class="site-promo__banner-copy">' +
      '<strong class="site-promo__banner-title" data-promo-banner-title></strong>' +
      '<span class="site-promo__banner-body" data-promo-banner-body></span>' +
      "</div>" +
      '<div class="site-promo__banner-actions">' +
      '<a class="btn-primary" data-promo-cta href="index.html#waitlist"></a>' +
      '<button type="button" class="btn-secondary" data-promo-dismiss data-promo-dismiss-label></button>' +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="site-promo__modal" data-promo-modal hidden role="dialog" aria-modal="true" aria-labelledby="tourai-site-promo-modal-title">' +
      '<div class="site-promo__modal-backdrop" data-promo-modal-close></div>' +
      '<div class="site-promo__modal-card">' +
      '<div class="site-promo__spot" aria-hidden="true">' +
      '<span class="site-promo__spot-brand">TourAI</span>' +
      '<span class="site-promo__spot-pulse"></span>' +
      "</div>" +
      '<h2 id="tourai-site-promo-modal-title" class="site-promo__modal-title" data-promo-modal-title></h2>' +
      '<p class="site-promo__modal-lead" data-promo-modal-lead></p>' +
      '<p class="site-promo__modal-body" data-promo-modal-body></p>' +
      '<div class="site-promo__modal-actions">' +
      '<a class="btn-primary" data-promo-cta href="index.html#waitlist"></a>' +
      '<button type="button" class="btn-secondary" data-promo-modal-close data-promo-dismiss-label></button>' +
      "</div>" +
      "</div>" +
      "</div>";

    document.body.appendChild(root);
    root.addEventListener("click", function (event) {
      var target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest("[data-promo-dismiss]")) {
        dismissBanner();
        return;
      }
      if (target.closest("[data-promo-modal-close]")) {
        hideModal();
      }
    });

    state.root = root;
    applyCopy(root, audience);
    return root;
  }

  function showSurfaces(audience) {
    var root = ensureRoot(audience);
    root.hidden = false;
    var dismissed = bannerDismissed(audience);
    var banner = root.querySelector("[data-promo-banner]");
    var rail = root.querySelector("[data-promo-rail]");
    if (banner) {
      banner.hidden = dismissed;
    }
    if (rail) {
      rail.hidden = dismissed;
    }
    document.documentElement.classList.toggle("has-site-promo-banner", !dismissed);
    scheduleModal(audience);
  }

  function hideSurfaces() {
    if (state.modalTimer) {
      clearInterval(state.modalTimer);
      state.modalTimer = null;
    }
    if (state.firstModalTimer) {
      clearTimeout(state.firstModalTimer);
      state.firstModalTimer = null;
    }
    hideModal();
    if (state.root) {
      state.root.hidden = true;
    }
    document.documentElement.classList.remove("has-site-promo-banner");
  }

  function hideModal() {
    var modal = state.root && state.root.querySelector("[data-promo-modal]");
    if (modal) {
      modal.hidden = true;
    }
  }

  function showModalIfDue() {
    if (!state.audience) {
      return;
    }
    if (cookieBannerVisible() || otherModalOpen()) {
      return;
    }
    var elapsed = Date.now() - lastModalAt(state.audience);
    if (elapsed < MODAL_INTERVAL_MS && lastModalAt(state.audience) > 0) {
      return;
    }
    var modal = state.root && state.root.querySelector("[data-promo-modal]");
    if (!modal) {
      return;
    }
    modal.hidden = false;
    markModalShown(state.audience);
  }

  function scheduleModal(audience) {
    if (state.modalTimer) {
      clearInterval(state.modalTimer);
    }
    if (state.firstModalTimer) {
      clearTimeout(state.firstModalTimer);
    }
    // Guests see the spot sooner; freemium can wait a bit longer.
    var firstDelayMs = audience === "guest" ? 8000 : 20000;
    state.firstModalTimer = setTimeout(function () {
      if (state.audience) {
        showModalIfDue();
      }
    }, firstDelayMs);
    state.modalTimer = setInterval(function () {
      if (state.audience) {
        showModalIfDue();
      }
    }, Math.min(MODAL_INTERVAL_MS, 60000));
  }

  async function refreshForUser(user) {
    state.user = user || null;
    if (state.checking) {
      state.pendingUser = user;
      return;
    }
    state.checking = true;
    try {
      do {
        state.pendingUser = undefined;
        var nextUser = state.user;
        state.audience = await resolveAudience(nextUser);
        if (state.audience) {
          showSurfaces(state.audience);
        } else {
          hideSurfaces();
        }
        if (state.pendingUser !== undefined) {
          state.user = state.pendingUser;
        }
      } while (state.pendingUser !== undefined);
    } finally {
      state.checking = false;
    }
  }

  function boot() {
    // Guests do not need Firebase: show install promo immediately.
    state.audience = "guest";
    showSurfaces("guest");

    var auth = authApi();
    if (!auth || typeof auth.onAuthStateChanged !== "function") {
      return;
    }
    auth.onAuthStateChanged(function (user) {
      refreshForUser(user);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  global.TourAiSitePromo = {
    refresh: function () {
      return refreshForUser(authApi()?.currentUser?.() || null);
    },
    dismissBanner: dismissBanner,
    showModal: showModalIfDue,
  };
  // Keep legacy alias used while the file was freemium-only.
  global.TourAiFreemiumPromo = global.TourAiSitePromo;
})(window);
