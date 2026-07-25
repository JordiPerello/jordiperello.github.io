/*
 * Reviews: star ratings + optional comments (moderated).
 * - Site widget in nav (average with half-stars) → reviews.html
 * - Page: public approved list, compose when signed in
 * - Admin approve/reject lives in TourAI Manager (Web Control), not on the public site
 */
(function () {
  const auth = window.TourAiAuth;
  if (!auth) {
    return;
  }

  const PAGE_SIZE = 15;
  const STATS_DOC = "summary";
  const TARGETS = ["web", "app"];
  const STAR_PATH =
    "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";

  function t(key, fallback) {
    return auth.t?.(key, fallback) ?? fallback;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function roundHalf(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      return 0;
    }
    return Math.round(n * 2) / 2;
  }

  function formatAverage(sum, count) {
    if (!count) {
      return null;
    }
    return roundHalf(sum / count);
  }

  function formatAverageLabel(avg) {
    if (avg == null) {
      return "—";
    }
    return avg.toFixed(1).replace(/\.0$/, ".0");
  }

  function starKind(index, rating) {
    if (rating >= index) {
      return "full";
    }
    if (rating >= index - 0.5) {
      return "half";
    }
    return "empty";
  }

  function starsHtml(rating, opts) {
    const size = opts?.size || 14;
    const uid = opts?.uid || "s";
    const rounded = roundHalf(rating || 0);
    let html = '<span class="site-rating__stars" aria-hidden="true">';
    for (let i = 1; i <= 5; i++) {
      const kind = starKind(i, rounded);
      const gid = uid + "-half-" + i;
      if (kind === "half") {
        html +=
          '<svg class="site-rating__star site-rating__star--half" width="' +
          size +
          '" height="' +
          size +
          '" viewBox="0 0 24 24" focusable="false">' +
          "<defs><linearGradient id=\"" +
          gid +
          '"><stop offset="50%" stop-color="currentColor"/><stop offset="50%" stop-color="transparent"/></linearGradient></defs>' +
          '<path class="site-rating__star-bg" d="' +
          STAR_PATH +
          '"/><path fill="url(#' +
          gid +
          ')" d="' +
          STAR_PATH +
          '"/></svg>';
      } else {
        html +=
          '<svg class="site-rating__star site-rating__star--' +
          kind +
          '" width="' +
          size +
          '" height="' +
          size +
          '" viewBox="0 0 24 24" focusable="false"><path d="' +
          STAR_PATH +
          '"/></svg>';
      }
    }
    html += "</span>";
    return html;
  }

  function formatWhen(value) {
    const date =
      value && typeof value.toDate === "function"
        ? value.toDate()
        : value instanceof Date
          ? value
          : null;
    if (!date || Number.isNaN(date.getTime())) {
      return "";
    }
    const locale = window.TourAiI18n?.getLocale?.() || "es-ES";
    try {
      return date.toLocaleString(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (_) {
      return date.toISOString().slice(0, 10);
    }
  }

  function authorLabel(user) {
    const name = String(user?.displayName || "").trim();
    if (name) {
      return name;
    }
    const email = String(user?.email || "").trim();
    if (email.includes("@")) {
      return email.split("@")[0];
    }
    return t("reviews.anonymous", "Usuario");
  }

  function targetLabel(target) {
    if (target === "app") {
      return t("reviews.target.app", "App");
    }
    return t("reviews.target.web", "Web");
  }

  function timestampNow() {
    const FieldValue = window.firebase?.firestore?.FieldValue;
    if (FieldValue?.serverTimestamp) {
      return FieldValue.serverTimestamp();
    }
    return new Date();
  }

  function mapReview(doc) {
    const data = doc.data() || {};
    return {
      id: doc.id,
      _doc: doc,
      stars: Number(data.stars) || 0,
      comment: String(data.comment || ""),
      target: data.target === "app" ? "app" : "web",
      authorUid: data.authorUid || "",
      authorName: data.authorName || "",
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
      hidden: data.hidden !== false,
    };
  }

  async function loadStats(firestore) {
    const snap = await firestore.collection("ReviewsStats").doc(STATS_DOC).get();
    const data = snap.exists ? snap.data() || {} : {};
    const sum = Number(data.sum) || 0;
    const count = Number(data.count) || 0;
    return {
      sum,
      count,
      average: formatAverage(sum, count),
      webSum: Number(data.webSum) || 0,
      webCount: Number(data.webCount) || 0,
      appSum: Number(data.appSum) || 0,
      appCount: Number(data.appCount) || 0,
    };
  }

  function renderWidgetContent(el, stats) {
    const avg = stats.average;
    const count = stats.count || 0;
    const label = formatAverageLabel(avg);
    const aria =
      count > 0
        ? t("reviews.widget.aria", "Valoración media {avg} de 5 ({n} reseñas)")
            .replace("{avg}", label)
            .replace("{n}", String(count))
        : t("reviews.widget.ariaEmpty", "Ver opiniones de TourAI");

    el.setAttribute("aria-label", aria);
    el.title = aria;
    el.innerHTML =
      starsHtml(avg || 0, { size: 14, uid: "nav" }) +
      '<span class="site-rating__value">' +
      escapeHtml(label) +
      "</span>" +
      (count
        ? '<span class="site-rating__count">(' + escapeHtml(String(count)) + ")</span>"
        : "");
  }

  let cachedStats = null;

  function ensureHeroWidget() {
    const hero =
      document.querySelector("header.page-hero") ||
      document.querySelector(".site-legal-page header") ||
      document.querySelector("body > header");
    if (!hero) {
      return null;
    }
    hero.classList.add("has-site-rating");

    let link = hero.querySelector("[data-site-rating]");
    if (link) {
      return link;
    }

    link = document.createElement("a");
    link.href = "reviews.html";
    link.className = "site-rating site-rating--hero";
    link.setAttribute("data-site-rating", "hero");
    link.setAttribute(
      "aria-label",
      t("reviews.widget.ariaEmpty", "Ver opiniones de TourAI")
    );
    link.innerHTML =
      starsHtml(0, { size: 16, uid: "hero" }) +
      '<span class="site-rating__value">—</span>';
    hero.appendChild(link);
    return link;
  }

  function paintHeroWidget(stats) {
    const link = ensureHeroWidget();
    if (!link || !stats) {
      return;
    }
    renderWidgetContent(link, stats);
  }

  async function bootSiteRatingWidget() {
    ensureHeroWidget();
    try {
      await auth.ensureFirebase();
      if (!window.firebase?.firestore) {
        return;
      }
      const firestore = await auth.getFirestore();
      cachedStats = await loadStats(firestore);
      // Re-query after i18n may have replaced header innerHTML (data-i18n-html).
      paintHeroWidget(cachedStats);
    } catch (err) {
      console.warn("[TourAI reviews] widget stats failed", err);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (cachedStats) {
      paintHeroWidget(cachedStats);
    } else {
      bootSiteRatingWidget();
    }
  });

  document.addEventListener("tourai:locale-changed", function () {
    if (cachedStats) {
      paintHeroWidget(cachedStats);
    } else {
      bootSiteRatingWidget();
    }
  });

  /* --- reviews.html page --- */
  function bootReviewsPage() {
    if (!/reviews\.html/i.test(String(window.location.pathname || "") + String(window.location.href || ""))) {
      return;
    }

    const statusEl = document.getElementById("reviewsStatus");
    const summaryEl = document.getElementById("reviewsSummary");
    const listEl = document.getElementById("reviewsList");
    const loginHint = document.getElementById("reviewsLoginHint");
    const composeBox = document.getElementById("reviewsCompose");
    const form = document.getElementById("reviewsForm");
    const starsInput = document.getElementById("reviewsStars");
    const starsUi = document.getElementById("reviewsStarsUi");
    const commentInput = document.getElementById("reviewsComment");
    const targetSelect = document.getElementById("reviewsTarget");
    const targetToggle = document.getElementById("reviewsTargetToggle");
    const submitBtn = document.getElementById("reviewsSubmit");
    const tabsEl = document.getElementById("reviewsTabs");

    let currentUser = null;
    let filterTarget = "all";
    let selectedStars = 0;
    let busy = false;

    let reviews = [];
    let cursor = null;
    let hasMore = true;
    let loading = false;
    let listObserver = null;
    let myReviews = { web: null, app: null };
    let stats = { sum: 0, count: 0, average: null };

    function setStatus(message, isError) {
      if (!statusEl) {
        return;
      }
      statusEl.textContent = message || "";
      statusEl.classList.toggle("error", !!isError);
    }

    function loginUrl(path) {
      const target = new URL(path || "login.html", window.location.href);
      target.searchParams.set("next", "reviews.html");
      return target.toString();
    }

    function registerUrl() {
      return loginUrl("register.html");
    }

    async function requireUser() {
      const user = currentUser || auth.currentUser?.() || null;
      if (!user?.uid) {
        throw new Error("NO_USER");
      }
      try {
        await user.getIdToken(true);
      } catch (_) {
        throw new Error("NO_USER");
      }
      currentUser = user;
      return user;
    }

    function syncAuthUi() {
      const signedIn = !!currentUser;
      if (composeBox) {
        composeBox.hidden = !signedIn;
      }
      if (loginHint) {
        loginHint.hidden = signedIn;
        const loginA = loginHint.querySelector("[data-reviews-login]");
        const regA = loginHint.querySelector("[data-reviews-register]");
        if (loginA) {
          loginA.href = loginUrl("login.html");
        }
        if (regA) {
          regA.href = registerUrl();
        }
      }
    }

    function renderSummary() {
      if (!summaryEl) {
        return;
      }
      const avg = stats.average;
      const label = formatAverageLabel(avg);
      const countLabel = t("reviews.summary.count", "{n} reseñas aprobadas").replace(
        "{n}",
        String(stats.count || 0)
      );
      summaryEl.innerHTML =
        '<div class="reviews-summary__main">' +
        starsHtml(avg || 0, { size: 28, uid: "sum" }) +
        '<div class="reviews-summary__text">' +
        '<p class="reviews-summary__avg">' +
        escapeHtml(label) +
        ' <span data-i18n-skip>/ 5</span></p>' +
        '<p class="reviews-summary__count">' +
        escapeHtml(countLabel) +
        "</p></div></div>";
    }

    function renderStarsPicker() {
      if (!starsUi) {
        return;
      }
      let html = "";
      for (let i = 1; i <= 5; i++) {
        const on = selectedStars >= i;
        html +=
          '<button type="button" class="reviews-star-btn' +
          (on ? " is-on" : "") +
          '" data-star="' +
          i +
          '" aria-label="' +
          escapeHtml(t("reviews.stars.pick", "{n} estrellas").replace("{n}", String(i))) +
          '">' +
          '<svg width="28" height="28" viewBox="0 0 24 24" focusable="false"><path d="' +
          STAR_PATH +
          '"/></svg></button>';
      }
      starsUi.innerHTML = html;
      if (starsInput) {
        starsInput.value = selectedStars ? String(selectedStars) : "";
      }
    }

    function skeletonHtml() {
      return (
        '<div class="community-skeleton" aria-hidden="true">' +
        '<div class="community-skeleton__card">' +
        '<div class="community-skeleton__line community-skeleton__line--sm"></div>' +
        '<div class="community-skeleton__line community-skeleton__line--lg"></div></div>' +
        '<div class="community-skeleton__card">' +
        '<div class="community-skeleton__line community-skeleton__line--sm"></div>' +
        '<div class="community-skeleton__line"></div></div></div>'
      );
    }

    function reviewCardHtml(review, opts) {
      const actions = opts?.actions || "";
      const comment = String(review.comment || "").trim();
      return (
        '<article class="reviews-card">' +
        '<div class="reviews-card__head">' +
        starsHtml(review.stars, { size: 16, uid: "r-" + review.id }) +
        '<span class="reviews-card__target">' +
        escapeHtml(targetLabel(review.target)) +
        "</span>" +
        '<span class="reviews-card__meta">' +
        escapeHtml(review.authorName || t("reviews.anonymous", "Usuario")) +
        " · " +
        escapeHtml(formatWhen(review.createdAt)) +
        "</span></div>" +
        (comment
          ? '<p class="reviews-card__comment">' + escapeHtml(comment) + "</p>"
          : '<p class="reviews-card__comment reviews-card__comment--empty">' +
            escapeHtml(t("reviews.noComment", "Sin comentario")) +
            "</p>") +
        actions +
        "</article>"
      );
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
        { root: null, rootMargin: "120px 0px", threshold: 0 }
      );
      observer.observe(sentinel);
      return observer;
    }

    function renderList() {
      if (!listEl) {
        return;
      }
      listObserver = disconnectObserver(listObserver);

      if (!reviews.length && !loading) {
        listEl.innerHTML =
          '<p class="community-empty">' +
          escapeHtml(t("reviews.empty", "Todavía no hay opiniones publicadas.")) +
          "</p>";
        return;
      }

      let html = reviews.map(function (review) {
        return reviewCardHtml(review);
      }).join("");

      if (loading) {
        html += skeletonHtml();
      } else if (hasMore) {
        html += '<div class="community-scroll-sentinel" data-reviews-sentinel aria-hidden="true"></div>';
      }

      listEl.innerHTML = html;
      const sentinel = listEl.querySelector("[data-reviews-sentinel]");
      listObserver = observeSentinel(sentinel, function () {
        loadReviewsPage(false);
      });
    }

    function markTabs() {
      if (!tabsEl) {
        return;
      }
      tabsEl.querySelectorAll("[data-target-filter]").forEach(function (btn) {
        btn.classList.toggle(
          "is-active",
          btn.getAttribute("data-target-filter") === filterTarget
        );
      });
    }

    async function loadReviewsPage(reset) {
      if (loading) {
        return;
      }
      if (!reset && !hasMore) {
        return;
      }
      loading = true;
      if (reset) {
        reviews = [];
        cursor = null;
        hasMore = true;
      }
      renderList();

      const started = Date.now();
      try {
        const firestore = await auth.getFirestore();
        let query = firestore
          .collection("Reviews")
          .where("hidden", "==", false)
          .orderBy("createdAt", "desc")
          .limit(PAGE_SIZE);

        if (filterTarget === "web" || filterTarget === "app") {
          query = firestore
            .collection("Reviews")
            .where("hidden", "==", false)
            .where("target", "==", filterTarget)
            .orderBy("createdAt", "desc")
            .limit(PAGE_SIZE);
        }

        if (cursor) {
          query = query.startAfter(cursor);
        }

        const snap = await query.get();
        const batch = snap.docs.map(mapReview);
        if (reset) {
          reviews = batch;
        } else {
          reviews = reviews.concat(batch);
        }
        cursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : cursor;
        hasMore = snap.docs.length >= PAGE_SIZE;
      } catch (err) {
        console.error("[TourAI reviews] list", err);
        setStatus(
          t("reviews.error.load", "No se pudieron cargar las opiniones. Inténtalo más tarde."),
          true
        );
        hasMore = false;
      } finally {
        if (window.TourAiLoading?.ensureMinMs) {
          await window.TourAiLoading.ensureMinMs(started, 500);
        }
        loading = false;
        renderList();
      }
    }

    async function loadMyReviews() {
      myReviews = { web: null, app: null };
      if (!currentUser?.uid) {
        return;
      }
      try {
        const firestore = await auth.getFirestore();
        await Promise.all(
          TARGETS.map(async function (target) {
            const id = currentUser.uid + "_" + target;
            const snap = await firestore.collection("Reviews").doc(id).get();
            if (snap.exists) {
              myReviews[target] = mapReview(snap);
            }
          })
        );
      } catch (err) {
        console.warn("[TourAI reviews] my reviews", err);
      }
      syncComposeFromMine();
    }

    function getSelectedTarget() {
      return targetSelect?.value === "app" ? "app" : "web";
    }

    function setSelectedTarget(target) {
      const next = target === "app" ? "app" : "web";
      if (targetSelect) {
        targetSelect.value = next;
      }
      if (targetToggle) {
        targetToggle.querySelectorAll("[data-reviews-target]").forEach(function (btn) {
          btn.classList.toggle(
            "is-active",
            btn.getAttribute("data-reviews-target") === next
          );
        });
      }
    }

    function isTargetControl(el) {
      return (
        el === targetSelect ||
        (el?.hasAttribute && el.hasAttribute("data-reviews-target"))
      );
    }

    function syncComposeFromMine() {
      if (!targetSelect) {
        return;
      }
      const target = getSelectedTarget();
      const mine = myReviews[target];
      if (mine) {
        selectedStars = mine.stars || 0;
        if (commentInput) {
          commentInput.value = mine.comment || "";
        }
        if (mine.hidden) {
          setStatus(
            t(
              "reviews.pending.yours",
              "Tu reseña está pendiente de moderación. Puedes editarla mientras no esté publicada."
            ),
            false
          );
        } else {
          setStatus(
            t(
              "reviews.alreadyPublished",
              "Ya tienes una reseña publicada para este destino. Gracias."
            ),
            false
          );
          if (form) {
            form.querySelectorAll("input, textarea, select, button").forEach(function (el) {
              if (isTargetControl(el)) {
                return;
              }
              el.disabled = true;
            });
          }
          renderStarsPicker();
          return;
        }
      } else {
        selectedStars = 0;
        if (commentInput) {
          commentInput.value = "";
        }
        setStatus("", false);
      }
      if (form) {
        form.querySelectorAll("input, textarea, select, button").forEach(function (el) {
          el.disabled = false;
        });
      }
      renderStarsPicker();
    }

    async function refreshStats() {
      try {
        const firestore = await auth.getFirestore();
        stats = await loadStats(firestore);
        cachedStats = stats;
        renderSummary();
        paintHeroWidget(stats);
      } catch (err) {
        console.warn("[TourAI reviews] stats", err);
      }
    }

    async function submitReview(event) {
      event.preventDefault();
      if (busy) {
        return;
      }
      const stars = selectedStars;
      if (!stars || stars < 1 || stars > 5) {
        setStatus(t("reviews.error.stars", "Elige una valoración de 1 a 5 estrellas."), true);
        return;
      }
      const target = getSelectedTarget();
      const comment = String(commentInput?.value || "").trim().slice(0, 2000);
      const existing = myReviews[target];
      if (existing && !existing.hidden) {
        setStatus(
          t(
            "reviews.alreadyPublished",
            "Ya tienes una reseña publicada para este destino. Gracias."
          ),
          true
        );
        return;
      }

      busy = true;
      if (submitBtn) {
        submitBtn.disabled = true;
      }
      setStatus(t("reviews.saving", "Enviando..."), false);

      try {
        const user = await requireUser();
        const firestore = await auth.getFirestore();
        const id = user.uid + "_" + target;
        const payload = {
          stars: Math.round(stars),
          comment: comment,
          target: target,
          authorUid: user.uid,
          authorName: authorLabel(user).slice(0, 80),
          hidden: true,
          updatedAt: timestampNow(),
        };
        if (!existing) {
          payload.createdAt = timestampNow();
        }
        await firestore.collection("Reviews").doc(id).set(payload, { merge: true });
        setStatus(
          t(
            "reviews.saved",
            "Gracias. Tu reseña se ha enviado y aparecerá cuando la moderemos."
          ),
          false
        );
        await loadMyReviews();
      } catch (err) {
        console.error("[TourAI reviews] save", err);
        if (String(err?.message) === "NO_USER") {
          window.location.href = loginUrl("login.html");
          return;
        }
        setStatus(
          t("reviews.error.save", "No se pudo enviar la reseña. Inténtalo más tarde."),
          true
        );
      } finally {
        busy = false;
        if (submitBtn) {
          submitBtn.disabled = false;
        }
      }
    }

    starsUi?.addEventListener("click", function (event) {
      const btn = event.target.closest("[data-star]");
      if (!btn || btn.disabled) {
        return;
      }
      selectedStars = Number(btn.getAttribute("data-star")) || 0;
      renderStarsPicker();
    });

    form?.addEventListener("submit", submitReview);

    targetToggle?.addEventListener("click", function (event) {
      const btn = event.target.closest("[data-reviews-target]");
      if (!btn || btn.disabled) {
        return;
      }
      setSelectedTarget(btn.getAttribute("data-reviews-target"));
      syncComposeFromMine();
    });

    setSelectedTarget(getSelectedTarget());
    tabsEl?.addEventListener("click", function (event) {
      const btn = event.target.closest("[data-target-filter]");
      if (!btn) {
        return;
      }
      filterTarget = btn.getAttribute("data-target-filter") || "all";
      markTabs();
      loadReviewsPage(true);
    });

    markTabs();
    renderStarsPicker();
    renderSummary();
    syncAuthUi();

    auth
      .ensureFirebase()
      .then(function () {
        return auth.onAuthStateChanged(async function (user) {
          currentUser = user || null;
          syncAuthUi();
          await refreshStats();
          await loadReviewsPage(true);
          if (currentUser) {
            await loadMyReviews();
          }
        });
      })
      .catch(function (err) {
        console.error("[TourAI reviews] init", err);
        setStatus(
          t("reviews.error.load", "No se pudieron cargar las opiniones. Inténtalo más tarde."),
          true
        );
      });
  }

  bootSiteRatingWidget();
  bootReviewsPage();
})();
