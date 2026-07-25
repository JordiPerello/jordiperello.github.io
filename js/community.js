/*
 * Community page: topics + replies in Firestore.
 * Paged reads only (scroll to load more). Soft-hide for author/admin.
 */
(function () {
  const auth = window.TourAiAuth;
  if (!auth) {
    return;
  }

  const CATEGORIES = ["news", "help", "ideas", "travel"];
  const TOPICS_PAGE = 15;
  const REPLIES_PAGE = 15;

  const statusEl = document.getElementById("communityStatus");
  const tabsEl = document.getElementById("communityTabs");
  const listView = document.getElementById("communityListView");
  const detailView = document.getElementById("communityDetailView");
  const topicsEl = document.getElementById("communityTopics");
  const newTopicBox = document.getElementById("communityNewTopic");
  const newTopicForm = document.getElementById("communityNewTopicForm");
  const topicTitleInput = document.getElementById("communityTopicTitle");
  const topicBodyInput = document.getElementById("communityTopicBody");
  const loginHint = document.getElementById("communityLoginHint");
  const detailMount = document.getElementById("communityDetailMount");
  const replyBox = document.getElementById("communityReplyBox");
  const replyForm = document.getElementById("communityReplyForm");
  const replyBodyInput = document.getElementById("communityReplyBody");
  const backBtn = document.getElementById("communityBack");

  let currentUser = null;
  let currentCategory = "help";
  let currentTopicId = null;
  let currentTopic = null;
  let busy = false;

  let topics = [];
  let topicsCursor = null;
  let topicsHasMore = true;
  let topicsLoading = false;

  let replies = [];
  let repliesCursor = null;
  let repliesHasMore = true;
  let repliesLoading = false;

  let topicsObserver = null;
  let repliesObserver = null;

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
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return date.toISOString();
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
    return t("community.anonymous", "Usuario");
  }

  function mapTopic(doc) {
    const data = doc.data() || {};
    return {
      id: doc.id,
      _doc: doc,
      category: data.category || "help",
      title: data.title || "",
      body: data.body || "",
      authorUid: data.authorUid || "",
      authorName: data.authorName || "",
      createdAt: data.createdAt || null,
      hidden: !!data.hidden,
      replyCount: Number(data.replyCount) || 0,
    };
  }

  function mapReply(doc) {
    const data = doc.data() || {};
    return {
      id: doc.id,
      _doc: doc,
      body: data.body || "",
      authorUid: data.authorUid || "",
      authorName: data.authorName || "",
      createdAt: data.createdAt || null,
      hidden: !!data.hidden,
    };
  }

  function setStatus(message, isError) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", !!isError);
  }

  function loadErrorMessage(err) {
    const message = String(err?.message || "");
    if (message === "TOPIC_MISSING") {
      return t("community.error.missing", "Este tema no existe o fue eliminado.");
    }
    if (message === "NO_USER") {
      return t("community.error.auth", "Tu sesión ha caducado. Vuelve a iniciar sesión.");
    }
    return t("community.error.load", "No se pudo cargar la comunidad. Inténtalo más tarde.");
  }

  function saveErrorMessage(err) {
    const message = String(err?.message || "");
    if (message === "NO_USER") {
      return t("community.error.auth", "Tu sesión ha caducado. Vuelve a iniciar sesión.");
    }
    if (message === "TOPIC_MISSING") {
      return t("community.error.missing", "Este tema no existe o fue eliminado.");
    }
    if (message === "THREAD_LOCKED") {
      return t(
        "community.error.threadLocked",
        "No se puede eliminar: ya hay respuestas posteriores en el hilo."
      );
    }
    return t("community.error.save", "No se pudo publicar. Inténtalo más tarde.");
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

  function timestampNow() {
    const FieldValue = window.firebase?.firestore?.FieldValue;
    if (FieldValue?.serverTimestamp) {
      return FieldValue.serverTimestamp();
    }
    return new Date();
  }

  function setUrl(category, topicId) {
    const next = new URL(window.location.href);
    next.searchParams.set("c", category);
    if (topicId) {
      next.searchParams.set("t", topicId);
    } else {
      next.searchParams.delete("t");
    }
    window.history.replaceState({}, "", next.toString());
  }

  function loginUrl() {
    const target = new URL("login.html", window.location.href);
    target.searchParams.set("next", "community.html?c=" + encodeURIComponent(currentCategory));
    return target.toString();
  }

  function syncAuthUi() {
    const signedIn = !!currentUser;
    if (newTopicBox) {
      newTopicBox.hidden = !signedIn;
    }
    if (loginHint) {
      loginHint.hidden = signedIn;
    }
    if (replyBox) {
      replyBox.hidden = !signedIn || !currentTopicId;
    }
  }

  function markActiveTab() {
    if (!tabsEl) {
      return;
    }
    tabsEl.querySelectorAll("[data-category]").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-category") === currentCategory);
    });
  }

  function initialsFrom(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) {
      return "?";
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function canDeleteOwn(authorUid) {
    return !!(currentUser && authorUid && currentUser.uid === authorUid);
  }

  /** Authors may only remove leaf messages (no later replies). */
  function canDeleteTopic() {
    if (!currentTopic || !canDeleteOwn(currentTopic.authorUid)) {
      return false;
    }
    return (Number(currentTopic.replyCount) || 0) === 0 && replies.length === 0;
  }

  function canDeleteReply(reply) {
    if (!reply || !canDeleteOwn(reply.authorUid)) {
      return false;
    }
    // Only the chronologically last visible reply; wait until the thread is fully loaded.
    if (repliesHasMore || !replies.length) {
      return false;
    }
    return replies[replies.length - 1].id === reply.id;
  }

  async function assertAuthorCanHideTopic(topicId, topicData) {
    const count = Number(topicData?.replyCount) || 0;
    if (count > 0) {
      throw new Error("THREAD_LOCKED");
    }
    const firestore = await auth.getFirestore();
    const snap = await firestore
      .collection("CommunityTopics")
      .doc(topicId)
      .collection("Replies")
      .where("hidden", "==", false)
      .limit(1)
      .get();
    if (!snap.empty) {
      throw new Error("THREAD_LOCKED");
    }
  }

  async function assertAuthorCanHideReply(topicId, replyId) {
    const firestore = await auth.getFirestore();
    const replyRef = firestore
      .collection("CommunityTopics")
      .doc(topicId)
      .collection("Replies")
      .doc(replyId);
    const replyDoc = await replyRef.get();
    const createdAt = replyDoc.data()?.createdAt;
    if (!createdAt) {
      throw new Error("THREAD_LOCKED");
    }
    const later = await firestore
      .collection("CommunityTopics")
      .doc(topicId)
      .collection("Replies")
      .where("hidden", "==", false)
      .where("createdAt", ">", createdAt)
      .orderBy("createdAt", "asc")
      .limit(1)
      .get();
    if (!later.empty) {
      throw new Error("THREAD_LOCKED");
    }
  }

  function skeletonHtml(kind) {
    if (kind === "thread") {
      return (
        '<div class="community-skeleton community-skeleton--thread" aria-hidden="true">' +
        '<div class="community-skeleton__msg">' +
        '<div class="community-skeleton__avatar"></div>' +
        '<div class="community-skeleton__stack">' +
        '<div class="community-skeleton__line community-skeleton__line--sm"></div>' +
        '<div class="community-skeleton__line community-skeleton__line--lg"></div>' +
        '<div class="community-skeleton__line"></div>' +
        '<div class="community-skeleton__line community-skeleton__line--md"></div>' +
        "</div></div>" +
        '<div class="community-skeleton__msg">' +
        '<div class="community-skeleton__avatar"></div>' +
        '<div class="community-skeleton__stack">' +
        '<div class="community-skeleton__line community-skeleton__line--sm"></div>' +
        '<div class="community-skeleton__line"></div>' +
        '<div class="community-skeleton__line community-skeleton__line--md"></div>' +
        "</div></div></div>"
      );
    }
    return (
      '<div class="community-skeleton" aria-hidden="true">' +
      '<div class="community-skeleton__card">' +
      '<div class="community-skeleton__line community-skeleton__line--lg"></div>' +
      '<div class="community-skeleton__line community-skeleton__line--sm"></div></div>' +
      '<div class="community-skeleton__card">' +
      '<div class="community-skeleton__line community-skeleton__line--lg"></div>' +
      '<div class="community-skeleton__line community-skeleton__line--sm"></div></div>' +
      '<div class="community-skeleton__card">' +
      '<div class="community-skeleton__line community-skeleton__line--lg"></div>' +
      '<div class="community-skeleton__line community-skeleton__line--sm"></div></div></div>'
    );
  }

  function actionButtons(opts) {
    if (!opts.canDelete) {
      return "";
    }
    return (
      '<div class="community-msg__actions">' +
      '<button type="button" class="community-msg__delete" data-hide="' +
      escapeHtml(opts.hideAttr) +
      '" data-id="' +
      escapeHtml(opts.id) +
      '">' +
      escapeHtml(t("community.delete", "Eliminar")) +
      "</button></div>"
    );
  }

  function renderMessage(opts) {
    const cls = "community-msg" + (opts.isOp ? " community-msg--op" : "");
    return (
      '<article class="' +
      cls +
      '">' +
      '<div class="community-msg__avatar" aria-hidden="true">' +
      escapeHtml(initialsFrom(opts.authorName)) +
      "</div>" +
      '<div class="community-msg__main">' +
      '<div class="community-msg__head">' +
      '<span class="community-msg__name">' +
      escapeHtml(opts.authorName) +
      "</span>" +
      '<span class="community-msg__time">' +
      escapeHtml(formatWhen(opts.createdAt)) +
      "</span></div>" +
      (opts.title
        ? '<h2 class="community-msg__title">' + escapeHtml(opts.title) + "</h2>"
        : "") +
      '<p class="community-msg__body">' +
      escapeHtml(opts.body) +
      "</p>" +
      actionButtons({
        canDelete: opts.canDelete,
        hideAttr: opts.hideAttr,
        id: opts.id,
      }) +
      "</div></article>"
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

  function renderTopicsList() {
    if (!topicsEl) {
      return;
    }
    topicsObserver = disconnectObserver(topicsObserver);

    if (!topics.length && !topicsLoading) {
      topicsEl.innerHTML =
        '<p class="community-empty">' +
        escapeHtml(t("community.empty", "Todavía no hay temas en esta sección.")) +
        "</p>";
      return;
    }

    let html = topics
      .map(function (topic) {
        return (
          '<a class="community-topic" href="community.html?c=' +
          encodeURIComponent(topic.category) +
          "&t=" +
          encodeURIComponent(topic.id) +
          '">' +
          '<span class="community-topic__title">' +
          escapeHtml(topic.title) +
          "</span>" +
          '<span class="community-topic__meta">' +
          escapeHtml(topic.authorName) +
          " · " +
          escapeHtml(formatWhen(topic.createdAt)) +
          " · " +
          escapeHtml(
            t("community.repliesCount", "{n} respuestas").replace(
              "{n}",
              String(topic.replyCount || 0)
            )
          ) +
          "</span></a>"
        );
      })
      .join("");

    if (topicsLoading) {
      html += skeletonHtml("list");
    } else if (topicsHasMore) {
      html += '<div class="community-scroll-sentinel" data-topics-sentinel aria-hidden="true"></div>';
    }

    topicsEl.innerHTML = html;
    const sentinel = topicsEl.querySelector("[data-topics-sentinel]");
    topicsObserver = observeSentinel(sentinel, function () {
      loadTopicsPage(false);
    });
  }

  function renderDetailThread() {
    if (!detailMount || !currentTopic) {
      return;
    }
    repliesObserver = disconnectObserver(repliesObserver);

    const countLabel = t("community.repliesCount", "{n} respuestas").replace(
      "{n}",
      String(currentTopic.replyCount || replies.length)
    );

    let repliesHtml = "";
    if (!replies.length && !repliesLoading) {
      repliesHtml =
        '<p class="community-empty" style="padding:12px 14px">' +
        escapeHtml(t("community.noReplies", "Sé el primero en responder.")) +
        "</p>";
    } else {
      repliesHtml = replies
        .map(function (reply) {
          return renderMessage({
            isOp: false,
            authorName: reply.authorName,
            createdAt: reply.createdAt,
            body: reply.body,
            canDelete: canDeleteReply(reply),
            hideAttr: "reply",
            id: reply.id,
          });
        })
        .join("");
    }

    if (repliesLoading) {
      repliesHtml += skeletonHtml("thread");
    } else if (repliesHasMore) {
      repliesHtml +=
        '<div class="community-scroll-sentinel" data-replies-sentinel aria-hidden="true"></div>';
    }

    detailMount.innerHTML =
      '<div class="community-thread">' +
      renderMessage({
        isOp: true,
        authorName: currentTopic.authorName,
        createdAt: currentTopic.createdAt,
        title: currentTopic.title,
        body: currentTopic.body,
        canDelete: canDeleteTopic(),
        hideAttr: "topic",
        id: currentTopic.id,
      }) +
      '<p class="community-thread__count">' +
      escapeHtml(countLabel) +
      "</p>" +
      repliesHtml +
      "</div>";

    const sentinel = detailMount.querySelector("[data-replies-sentinel]");
    repliesObserver = observeSentinel(sentinel, function () {
      loadRepliesPage(false);
    });
  }

  async function fetchTopicsPage(category, cursor) {
    const firestore = await auth.getFirestore();
    let query = firestore
      .collection("CommunityTopics")
      .where("hidden", "==", false)
      .where("category", "==", category)
      .orderBy("createdAt", "desc")
      .limit(TOPICS_PAGE);
    if (cursor) {
      query = query.startAfter(cursor);
    }
    const snap = await query.get();
    return {
      items: snap.docs.map(mapTopic),
      cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
      hasMore: snap.docs.length >= TOPICS_PAGE,
    };
  }

  async function fetchRepliesPage(topicId, cursor) {
    const firestore = await auth.getFirestore();
    let query = firestore
      .collection("CommunityTopics")
      .doc(topicId)
      .collection("Replies")
      .where("hidden", "==", false)
      .orderBy("createdAt", "asc")
      .limit(REPLIES_PAGE);
    if (cursor) {
      query = query.startAfter(cursor);
    }
    const snap = await query.get();
    return {
      items: snap.docs.map(mapReply),
      cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
      hasMore: snap.docs.length >= REPLIES_PAGE,
    };
  }

  async function getTopic(topicId) {
    const firestore = await auth.getFirestore();
    const doc = await firestore.collection("CommunityTopics").doc(topicId).get();
    if (!doc.exists || doc.data()?.hidden) {
      return null;
    }
    return mapTopic(doc);
  }

  async function loadTopicsPage(reset) {
    if (topicsLoading) {
      return;
    }
    if (!reset && !topicsHasMore) {
      return;
    }
    topicsLoading = true;
    const startedAt = Date.now();
    if (reset) {
      topics = [];
      topicsCursor = null;
      topicsHasMore = true;
      if (topicsEl) {
        topicsEl.innerHTML = skeletonHtml("list");
      }
    } else {
      renderTopicsList();
    }
    try {
      const page = await fetchTopicsPage(currentCategory, reset ? null : topicsCursor);
      topics = reset ? page.items : topics.concat(page.items);
      topicsCursor = page.cursor;
      topicsHasMore = page.hasMore;
      setStatus("", false);
    } catch (err) {
      console.error("[TourAI community] loadTopicsPage", err);
      setStatus(loadErrorMessage(err), true);
      if (reset && topicsEl) {
        topicsEl.innerHTML = "";
      }
    } finally {
      await window.TourAiLoading?.ensureMinMs?.(startedAt, 500);
      topicsLoading = false;
      renderTopicsList();
    }
  }

  async function loadRepliesPage(reset) {
    if (!currentTopicId || repliesLoading) {
      return;
    }
    if (!reset && !repliesHasMore) {
      return;
    }
    repliesLoading = true;
    const startedAt = Date.now();
    if (reset) {
      replies = [];
      repliesCursor = null;
      repliesHasMore = true;
    }
    renderDetailThread();
    try {
      const page = await fetchRepliesPage(currentTopicId, reset ? null : repliesCursor);
      replies = reset ? page.items : replies.concat(page.items);
      repliesCursor = page.cursor;
      repliesHasMore = page.hasMore;
      setStatus("", false);
    } catch (err) {
      console.error("[TourAI community] loadRepliesPage", err);
      setStatus(loadErrorMessage(err), true);
    } finally {
      await window.TourAiLoading?.ensureMinMs?.(startedAt, 500);
      repliesLoading = false;
      renderDetailThread();
    }
  }

  async function loadList() {
    if (listView) {
      listView.hidden = false;
    }
    if (detailView) {
      detailView.hidden = true;
    }
    currentTopicId = null;
    currentTopic = null;
    replies = [];
    repliesObserver = disconnectObserver(repliesObserver);
    syncAuthUi();
    setStatus("", false);
    await loadTopicsPage(true);
  }

  async function loadDetail(topicId) {
    currentTopicId = topicId;
    if (listView) {
      listView.hidden = true;
    }
    if (detailView) {
      detailView.hidden = false;
    }
    syncAuthUi();
    setStatus("", false);
    if (detailMount) {
      detailMount.innerHTML = skeletonHtml("thread");
    }
    try {
      const topic = await getTopic(topicId);
      if (!topic) {
        setStatus(t("community.error.missing", "Este tema no existe o fue eliminado."), true);
        if (detailMount) {
          detailMount.innerHTML = "";
        }
        return;
      }
      currentTopic = topic;
      currentCategory = topic.category || currentCategory;
      markActiveTab();
      renderDetailThread();
      await loadRepliesPage(true);
    } catch (err) {
      console.error("[TourAI community] loadDetail", err);
      setStatus(loadErrorMessage(err), true);
    }
  }

  function showList(category) {
    currentCategory = category || currentCategory;
    setUrl(currentCategory, null);
    markActiveTab();
    loadList();
  }

  function showDetail(topicId) {
    setUrl(currentCategory, topicId);
    loadDetail(topicId);
  }

  tabsEl?.addEventListener("click", function (event) {
    const btn = event.target.closest("[data-category]");
    if (!btn) {
      return;
    }
    showList(btn.getAttribute("data-category"));
  });

  backBtn?.addEventListener("click", function () {
    showList(currentCategory);
  });

  newTopicForm?.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (busy) {
      return;
    }
    const title = String(topicTitleInput?.value || "").trim();
    const body = String(topicBodyInput?.value || "").trim();
    if (!title || title.length > 120) {
      setStatus(t("community.error.title", "Escribe un título (máx. 120 caracteres)."), true);
      return;
    }
    if (!body) {
      setStatus(t("community.error.body", "Escribe un mensaje."), true);
      return;
    }
    if (CATEGORIES.indexOf(currentCategory) < 0) {
      currentCategory = "help";
    }
    busy = true;
    setStatus(t("community.saving", "Publicando..."), false);
    try {
      const user = await requireUser();
      const firestore = await auth.getFirestore();
      const ref = await firestore.collection("CommunityTopics").add({
        category: currentCategory,
        title: title,
        body: body,
        authorUid: user.uid,
        authorName: authorLabel(user),
        createdAt: timestampNow(),
        hidden: false,
        replyCount: 0,
      });
      if (topicTitleInput) {
        topicTitleInput.value = "";
      }
      if (topicBodyInput) {
        topicBodyInput.value = "";
      }
      setStatus("", false);
      showDetail(ref.id);
    } catch (err) {
      console.error("[TourAI community] createTopic", err);
      setStatus(saveErrorMessage(err), true);
    } finally {
      busy = false;
    }
  });

  replyForm?.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (busy || !currentTopicId || !currentTopic) {
      return;
    }
    const body = String(replyBodyInput?.value || "").trim();
    if (!body) {
      setStatus(t("community.error.body", "Escribe un mensaje."), true);
      return;
    }
    busy = true;
    setStatus(t("community.saving", "Publicando..."), false);
    try {
      const user = await requireUser();
      const firestore = await auth.getFirestore();
      const topicRef = firestore.collection("CommunityTopics").doc(currentTopicId);
      const topicDoc = await topicRef.get();
      if (!topicDoc.exists || topicDoc.data()?.hidden) {
        throw new Error("TOPIC_MISSING");
      }
      const replyRef = await topicRef.collection("Replies").add({
        body: body,
        authorUid: user.uid,
        authorName: authorLabel(user),
        createdAt: timestampNow(),
        hidden: false,
      });
      await topicRef.update({
        replyCount: window.firebase.firestore.FieldValue.increment(1),
      });
      if (replyBodyInput) {
        replyBodyInput.value = "";
      }
      // Append locally — no full replies re-read.
      if (!repliesHasMore) {
        replies.push({
          id: replyRef.id,
          body: body,
          authorUid: user.uid,
          authorName: authorLabel(user),
          createdAt: new Date(),
          hidden: false,
        });
        repliesCursor = null;
      }
      currentTopic.replyCount = (currentTopic.replyCount || 0) + 1;
      setStatus("", false);
      renderDetailThread();
      if (repliesHasMore) {
        // Still pages pending: jump to end by loading remaining is heavy;
        // keep count updated; user can scroll for older blocks.
      }
    } catch (err) {
      console.error("[TourAI community] createReply", err);
      setStatus(saveErrorMessage(err), true);
    } finally {
      busy = false;
    }
  });

  detailMount?.addEventListener("click", async function (event) {
    const hideBtn = event.target.closest("[data-hide]");
    if (!hideBtn) {
      return;
    }
    if (!currentUser) {
      window.location.href = loginUrl();
      return;
    }
    const kind = hideBtn.getAttribute("data-hide");
    const id = hideBtn.getAttribute("data-id");
    try {
      const firestore = await auth.getFirestore();
      if (kind === "topic") {
        const ref = firestore.collection("CommunityTopics").doc(id);
        const doc = await ref.get();
        if (!doc.exists || doc.data()?.authorUid !== currentUser.uid) {
          throw new Error("FORBIDDEN");
        }
        await assertAuthorCanHideTopic(id, doc.data());
        await ref.update({ hidden: true });
        showList(currentCategory);
        return;
      }
      if (kind === "reply" && currentTopicId) {
        const topicRef = firestore.collection("CommunityTopics").doc(currentTopicId);
        const ref = topicRef.collection("Replies").doc(id);
        const doc = await ref.get();
        if (!doc.exists || doc.data()?.authorUid !== currentUser.uid) {
          throw new Error("FORBIDDEN");
        }
        await assertAuthorCanHideReply(currentTopicId, id);
        const batch = firestore.batch();
        batch.update(ref, { hidden: true });
        batch.update(topicRef, {
          replyCount: window.firebase.firestore.FieldValue.increment(-1),
        });
        await batch.commit();
        replies = replies.filter(function (reply) {
          return reply.id !== id;
        });
        if (currentTopic && currentTopic.replyCount > 0) {
          currentTopic.replyCount -= 1;
        }
        renderDetailThread();
      }
    } catch (err) {
      console.error(err);
      setStatus(saveErrorMessage(err), true);
    }
  });

  document.getElementById("communityLoginLink")?.addEventListener("click", function (event) {
    event.preventDefault();
    window.location.href = loginUrl();
  });

  const initial = new URLSearchParams(window.location.search);
  currentCategory = initial.get("c") || "help";
  if (CATEGORIES.indexOf(currentCategory) < 0) {
    currentCategory = "help";
  }
  markActiveTab();

  auth
    .onAuthStateChanged(function (user) {
      currentUser = user || null;
      syncAuthUi();
      if (currentTopic) {
        renderDetailThread();
      }
    })
    .catch(function (err) {
      console.warn("[TourAI community] auth unavailable", err);
    });

  const topicId = initial.get("t");
  if (topicId) {
    loadDetail(topicId);
  } else {
    loadList();
  }
})();
