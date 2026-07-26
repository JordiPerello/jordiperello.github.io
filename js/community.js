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
  const TOPICS_PAGE = 10;
  const REPLIES_PAGE = 10;
  /** Max topic docs scanned for client-side search (keeps Firestore reads bounded). */
  const SEARCH_SCAN_LIMIT = 40;
  /** Max replicas loaded per parent when expanded (on demand only). */
  const REPLICAS_LIMIT = 40;

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
  const openComposerBtn = document.getElementById("communityOpenComposer");
  const composerModal = document.getElementById("communityComposerModal");
  const replyToBanner = document.getElementById("communityReplyToBanner");
  const replyToLabelEl = document.getElementById("communityReplyToLabel");
  const replyToSnippetEl = document.getElementById("communityReplyToSnippet");
  const replyToClearBtn = document.getElementById("communityReplyToClear");

  let replyToTarget = null;

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
  /** False after parentReplyId+createdAt query fails (missing index); avoid retrying each page. */
  let repliesRootQueryOk = true;
  /** @type {Record<string, { expanded: boolean, loading: boolean, loaded: boolean, items: any[] }>} */
  let replicasByParent = Object.create(null);

  const PARENT_ROOT = "root";

  let topicsObserver = null;
  let repliesObserver = null;

  let searchQuery = "";
  let searchBusy = false;
  let searchTimer = null;
  let searchGen = 0;
  const authorCache = Object.create(null);
  let openAuthorUid = null;
  let hoverOpenTimer = null;
  let hoverCloseTimer = null;

  const searchInput = document.getElementById("communitySearchInput");
  const searchClearBtn = document.getElementById("communitySearchClear");
  const userCardEl = document.getElementById("communityUserCard");
  const userCardAvatar = document.getElementById("communityUserCardAvatar");
  const userCardName = document.getElementById("communityUserCardName");
  const userCardMeta = document.getElementById("communityUserCardMeta");
  const userCardClose = document.getElementById("communityUserCardClose");

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

  const BODY_MAX_CHARS = 5000;
  const BODY_MAX_HTML = 16000;
  const EMOJI_SET =
    "😀 🙂 😊 😁 😂 🤗 👍 👏 🙌 ❤️ 💙 ✨ 🌟 🔥 🎉 ✅ ❗ ❓ 💡 🗺️ 🧭 ✈️ 🌍 🏞️ 📷 🎒 ☕ 🍽️ 🎧 📱 💬";

  const CATEGORY_BLURBS = {
    news: ["community.blurb.news", "Novedades del producto, lanzamientos y avisos del equipo TourAI."],
    help: ["community.blurb.help", "Resuelve dudas y echa una mano a quien empieza con TourAI."],
    ideas: ["community.blurb.ideas", "Propón mejoras y vota ideas con la comunidad."],
    travel: ["community.blurb.travel", "Cuenta rutas, rincones y tips de tus viajes con audioguía."],
  };

  function sanitizeStyle(value) {
    const allowed = [];
    String(value || "")
      .split(";")
      .forEach(function (part) {
        const bits = part.split(":");
        if (bits.length < 2) {
          return;
        }
        const prop = bits[0].trim().toLowerCase();
        const raw = bits.slice(1).join(":").trim();
        if (!raw || /expression|url\s*\(|javascript:|@import/i.test(raw)) {
          return;
        }
        if (prop === "color" || prop === "background-color") {
          if (/^(#[0-9a-f]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|[a-z]+)$/i.test(raw)) {
            allowed.push(prop + ": " + raw);
          }
        } else if (prop === "font-size") {
          if (/^\d+(\.\d+)?(px|em|rem|%)$/i.test(raw)) {
            allowed.push(prop + ": " + raw);
          }
        }
      });
    return allowed.join("; ");
  }

  function sanitizeCommunityHtml(raw) {
    const template = document.createElement("template");
    template.innerHTML = String(raw || "");
    const allowed = {
      B: true,
      STRONG: true,
      I: true,
      EM: true,
      U: true,
      BR: true,
      P: true,
      DIV: true,
      SPAN: true,
      FONT: true,
    };

    function clean(node) {
      Array.from(node.childNodes).forEach(function (child) {
        if (child.nodeType === Node.TEXT_NODE) {
          return;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) {
          child.remove();
          return;
        }
        const tag = child.tagName;
        if (!allowed[tag]) {
          while (child.firstChild) {
            node.insertBefore(child.firstChild, child);
          }
          child.remove();
          return;
        }
        Array.from(child.attributes).forEach(function (attr) {
          const name = attr.name.toLowerCase();
          if ((tag === "SPAN" || tag === "P" || tag === "DIV" || tag === "FONT") && name === "style") {
            const style = sanitizeStyle(attr.value);
            if (style) {
              child.setAttribute("style", style);
            } else {
              child.removeAttribute(attr.name);
            }
            return;
          }
          if (tag === "FONT" && (name === "color" || name === "size")) {
            if (name === "size" && !/^[1-7]$/.test(String(attr.value || "").trim())) {
              child.removeAttribute(attr.name);
            }
            return;
          }
          child.removeAttribute(attr.name);
        });
        clean(child);
      });
    }

    clean(template.content);
    return template.innerHTML.trim();
  }

  function looksLikeHtml(value) {
    return /<\/?[a-z][\s\S]*>/i.test(String(value || ""));
  }

  function formatBodyHtml(body) {
    const raw = String(body || "");
    if (!raw) {
      return "";
    }
    if (looksLikeHtml(raw)) {
      return sanitizeCommunityHtml(raw);
    }
    return escapeHtml(raw).replace(/\n/g, "<br>");
  }

  function plainTextFromHtml(html) {
    const box = document.createElement("div");
    box.innerHTML = String(html || "");
    return String(box.textContent || "")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function previewFromBody(body, maxLen) {
    const text = plainTextFromHtml(body).replace(/\s+/g, " ");
    if (text.length <= maxLen) {
      return text;
    }
    return text.slice(0, maxLen - 1) + "…";
  }

  function getEditorHtml(editor) {
    if (!editor) {
      return "";
    }
    return sanitizeCommunityHtml(editor.innerHTML || "");
  }

  function clearEditor(editor) {
    if (!editor) {
      return;
    }
    editor.innerHTML = "";
  }

  function syncEditorPlaceholders() {
    document.querySelectorAll(".community-rte__editor[data-i18n-placeholder]").forEach(function (el) {
      const key = el.getAttribute("data-i18n-placeholder");
      const fallback = el.getAttribute("data-placeholder") || "";
      el.setAttribute("data-placeholder", t(key, fallback));
    });
  }

  function focusEditorEnd(editor) {
    if (!editor) {
      return;
    }
    editor.focus();
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertEmoji(editor, emoji) {
    if (!editor) {
      return;
    }
    focusEditorEnd(editor);
    try {
      document.execCommand("insertText", false, emoji);
    } catch (_) {
      editor.appendChild(document.createTextNode(emoji));
    }
  }

  function bindRichEditor(root) {
    if (!root || root.getAttribute("data-rte-bound") === "1") {
      return;
    }
    root.setAttribute("data-rte-bound", "1");
    const editor = root.querySelector(".community-rte__editor");
    const emojiPanel = root.querySelector("[data-emoji-panel]");
    const emojiToggle = root.querySelector("[data-emoji-toggle]");

    if (emojiPanel && !emojiPanel.childElementCount) {
      EMOJI_SET.split(/\s+/).forEach(function (emoji) {
        if (!emoji) {
          return;
        }
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "community-rte__emoji-btn";
        btn.textContent = emoji;
        btn.setAttribute("aria-label", emoji);
        btn.addEventListener("click", function () {
          insertEmoji(editor, emoji);
        });
        emojiPanel.appendChild(btn);
      });
    }

    root.querySelectorAll("[data-cmd]").forEach(function (btn) {
      btn.addEventListener("mousedown", function (event) {
        event.preventDefault();
      });
      btn.addEventListener("click", function () {
        const cmd = btn.getAttribute("data-cmd");
        if (!editor || !cmd) {
          return;
        }
        editor.focus();
        document.execCommand(cmd, false, null);
      });
    });

    const colorInput = root.querySelector("[data-fore-color]");
    colorInput?.addEventListener("input", function () {
      if (!editor) {
        return;
      }
      editor.focus();
      document.execCommand("foreColor", false, colorInput.value);
    });

    const sizeSelect = root.querySelector("[data-font-size]");
    sizeSelect?.addEventListener("change", function () {
      if (!editor) {
        return;
      }
      editor.focus();
      document.execCommand("fontSize", false, sizeSelect.value);
    });

    emojiToggle?.addEventListener("click", function () {
      if (!emojiPanel) {
        return;
      }
      const open = emojiPanel.hasAttribute("hidden");
      if (open) {
        emojiPanel.removeAttribute("hidden");
      } else {
        emojiPanel.setAttribute("hidden", "");
      }
      emojiToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    editor?.addEventListener("paste", function (event) {
      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain") || "";
      document.execCommand("insertText", false, text);
    });
  }

  function initRichEditors() {
    document.querySelectorAll(".community-rte").forEach(bindRichEditor);
    syncEditorPlaceholders();
  }

  function updateCategoryBlurb() {
    const blurbEl = document.getElementById("communityCatBlurb");
    if (!blurbEl) {
      return;
    }
    const entry = CATEGORY_BLURBS[currentCategory] || CATEGORY_BLURBS.help;
    blurbEl.textContent = t(entry[0], entry[1]);
  }

  function getStorageBucket() {
    const cfg = window.TourAiSite?.config?.firebaseAuth;
    if (cfg?.storageBucket) {
      return String(cfg.storageBucket).trim();
    }
    if (cfg?.projectId) {
      return String(cfg.projectId).trim() + ".firebasestorage.app";
    }
    return "";
  }

  function buildAuthorPhotoUrl(uid) {
    const bucket = getStorageBucket();
    if (!bucket || !uid) {
      return "";
    }
    return (
      "https://firebasestorage.googleapis.com/v0/b/" +
      encodeURIComponent(bucket) +
      "/o/" +
      encodeURIComponent("userPhotoOriginal_" + uid + ".jpg") +
      "?alt=media"
    );
  }

  function authorCropStyle(profile, avatarSize) {
    // Same math as TourAiAuth nav avatars (120px / radius 58), scaled to circle size.
    const size = Number(avatarSize) > 0 ? Number(avatarSize) : 64;
    const sizeRatio = size / 120;
    const radius = 58 * sizeRatio;
    const x = Number.isFinite(profile.photoCropOffsetXNorm) ? profile.photoCropOffsetXNorm : 0;
    const y = Number.isFinite(profile.photoCropOffsetYNorm) ? profile.photoCropOffsetYNorm : 0;
    const userScale =
      Number.isFinite(profile.photoCropUserScale) && profile.photoCropUserScale > 0
        ? profile.photoCropUserScale
        : 1;
    return (
      "transform: translate(calc(-50% + " +
      x * radius +
      "px), calc(-50% + " +
      y * radius +
      "px)) scale(" +
      userScale * sizeRatio +
      ");"
    );
  }

  async function loadAuthorPreview(uid, fallbackName) {
    const key = String(uid || "");
    if (!key) {
      return {
        uid: "",
        displayName: fallbackName || t("community.anonymous", "Usuario"),
        photoUrls: [],
        photoCropOffsetXNorm: 0,
        photoCropOffsetYNorm: 0,
        photoCropUserScale: 1,
        createdAt: null,
      };
    }
    if (authorCache[key]) {
      return authorCache[key];
    }
    const profile = {
      uid: key,
      displayName: fallbackName || t("community.anonymous", "Usuario"),
      photoUrls: [],
      photoCropOffsetXNorm: 0,
      photoCropOffsetYNorm: 0,
      photoCropUserScale: 1,
      createdAt: null,
    };
    const guessed = buildAuthorPhotoUrl(key);
    if (guessed) {
      profile.photoUrls.push(guessed);
    }
    try {
      const firestore = await auth.getFirestore();
      const snap = await firestore.collection("Users").doc(key).get();
      if (snap.exists) {
        const data = snap.data() || {};
        const name = String(data.DisplayName || "").trim();
        if (name) {
          profile.displayName = name;
        }
        const photo = String(data.PhotoOriginalUrl || "").trim();
        if (photo) {
          profile.photoUrls = [photo].concat(profile.photoUrls);
        }
        const ox = Number(data.PhotoCropOffsetXNorm);
        const oy = Number(data.PhotoCropOffsetYNorm);
        const sc = Number(data.PhotoCropUserScale);
        if (Number.isFinite(ox)) {
          profile.photoCropOffsetXNorm = ox;
        }
        if (Number.isFinite(oy)) {
          profile.photoCropOffsetYNorm = oy;
        }
        if (Number.isFinite(sc) && sc > 0) {
          profile.photoCropUserScale = sc;
        }
        profile.createdAt = data.CreatedAt || data.createdAt || null;
      }
    } catch (_) {
      // Public Users reads may be restricted; keep name + guessed photo URL.
    }
    authorCache[key] = profile;
    return profile;
  }

  function paintUserCardAvatar(profile) {
    if (!userCardAvatar) {
      return;
    }
    userCardAvatar.textContent = "";
    userCardAvatar.textContent = initialsFrom(profile.displayName);
    const urls = (profile.photoUrls || []).filter(Boolean);
    if (!urls.length) {
      return;
    }
    let index = 0;
    const tryNext = function () {
      if (index >= urls.length) {
        return;
      }
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.onload = function () {
        userCardAvatar.textContent = "";
        userCardAvatar.appendChild(img);
        const size = userCardAvatar.offsetWidth || 64;
        img.setAttribute("style", authorCropStyle(profile, size));
      };
      img.onerror = function () {
        index += 1;
        tryNext();
      };
      img.src = urls[index];
    };
    tryNext();
  }

  function positionUserCard(anchor) {
    if (!userCardEl || !anchor) {
      return;
    }
    userCardEl.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const cardW = userCardEl.offsetWidth || 280;
    const cardH = userCardEl.offsetHeight || 100;
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + cardW > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - cardW - 12);
    }
    if (top + cardH > window.innerHeight - 12) {
      top = Math.max(12, rect.top - cardH - 8);
    }
    userCardEl.style.left = Math.round(left) + "px";
    userCardEl.style.top = Math.round(top) + "px";
  }

  function closeUserCard() {
    openAuthorUid = null;
    if (hoverOpenTimer) {
      clearTimeout(hoverOpenTimer);
      hoverOpenTimer = null;
    }
    if (hoverCloseTimer) {
      clearTimeout(hoverCloseTimer);
      hoverCloseTimer = null;
    }
    if (userCardEl) {
      userCardEl.hidden = true;
    }
  }

  async function openUserCard(anchor, uid, fallbackName) {
    if (!userCardEl || !uid) {
      return;
    }
    openAuthorUid = uid;
    if (userCardName) {
      userCardName.textContent = fallbackName || t("community.anonymous", "Usuario");
    }
    if (userCardMeta) {
      userCardMeta.textContent = t("community.user.loading", "Cargando perfil...");
    }
    if (userCardAvatar) {
      userCardAvatar.textContent = initialsFrom(fallbackName);
    }
    positionUserCard(anchor);
    const profile = await loadAuthorPreview(uid, fallbackName);
    if (openAuthorUid !== uid) {
      return;
    }
    if (userCardName) {
      userCardName.textContent = profile.displayName;
    }
    if (userCardMeta) {
      const since = formatMemberSince(profile.createdAt);
      userCardMeta.textContent = since
        ? t("community.user.memberSince", "Miembro desde {date}").replace("{date}", since)
        : t("community.user.member", "Miembro de la comunidad TourAI");
    }
    paintUserCardAvatar(profile);
    positionUserCard(anchor);
  }

  function topicMatchesQuery(topic, query) {
    const q = String(query || "")
      .trim()
      .toLowerCase();
    if (!q) {
      return true;
    }
    const hay = [
      topic.title || "",
      topic.authorName || "",
      plainTextFromHtml(topic.body || ""),
    ]
      .join("\n")
      .toLowerCase();
    return hay.indexOf(q) >= 0;
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

  function formatMemberSince(value) {
    const date =
      value && typeof value.toDate === "function"
        ? value.toDate()
        : value instanceof Date
          ? value
          : value
            ? new Date(value)
            : null;
    if (!date || Number.isNaN(date.getTime())) {
      return "";
    }
    const locale = window.TourAiI18n?.getLocale?.() || "es-ES";
    try {
      return date.toLocaleDateString(locale, {
        year: "numeric",
        month: "long",
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
    const legacyReplyTo = String(data.replyToId || "").trim();
    const parentReplyId = String(data.parentReplyId || legacyReplyTo || PARENT_ROOT).trim() || PARENT_ROOT;
    return {
      id: doc.id,
      _doc: doc,
      body: data.body || "",
      authorUid: data.authorUid || "",
      authorName: data.authorName || "",
      createdAt: data.createdAt || null,
      hidden: !!data.hidden,
      parentReplyId: parentReplyId,
      replicaCount: Number(data.replicaCount) || 0,
      replyToAuthorName: data.replyToAuthorName || "",
      replyToSnippet: data.replyToSnippet || "",
    };
  }

  function isTopLevelReply(reply) {
    return !reply?.parentReplyId || reply.parentReplyId === PARENT_ROOT;
  }

  function makeReplySnippet(body) {
    const text = plainTextFromHtml(body || "").replace(/\s+/g, " ").trim();
    if (!text) {
      return "";
    }
    if (text.length <= 140) {
      return text;
    }
    return text.slice(0, 139) + "…";
  }

  function clearReplyToTarget() {
    replyToTarget = null;
    syncReplyToBanner();
  }

  function setReplyToTarget(reply) {
    if (!reply?.id || !isTopLevelReply(reply)) {
      clearReplyToTarget();
      return;
    }
    replyToTarget = {
      id: reply.id,
      authorName: reply.authorName || t("community.anonymous", "Usuario"),
      snippet: makeReplySnippet(reply.body),
    };
    syncReplyToBanner();
    if (replyBox && !replyBox.hidden) {
      replyBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    focusEditorEnd(replyBodyInput);
  }

  function syncReplyToBanner() {
    if (!replyToBanner) {
      return;
    }
    if (!replyToTarget) {
      replyToBanner.hidden = true;
      if (replyToLabelEl) {
        replyToLabelEl.textContent = "";
      }
      if (replyToSnippetEl) {
        replyToSnippetEl.textContent = "";
      }
      return;
    }
    replyToBanner.hidden = false;
    if (replyToLabelEl) {
      replyToLabelEl.textContent = t(
        "community.replica.label",
        "Réplica a {name}"
      ).replace("{name}", replyToTarget.authorName);
    }
    if (replyToSnippetEl) {
      replyToSnippetEl.textContent = replyToTarget.snippet
        ? " — " + replyToTarget.snippet
        : "";
    }
  }

  function resetReplicasState() {
    replicasByParent = Object.create(null);
  }

  function replicasState(parentId) {
    if (!replicasByParent[parentId]) {
      replicasByParent[parentId] = {
        expanded: false,
        loading: false,
        loaded: false,
        items: [],
      };
    }
    return replicasByParent[parentId];
  }

  function setStatus(message, isError) {
    const targets = [statusEl, document.getElementById("communityComposerStatus")];
    targets.forEach(function (el) {
      if (!el) {
        return;
      }
      el.textContent = message || "";
      el.classList.toggle("error", !!isError);
    });
  }

  function loadErrorMessage(err) {
    const message = String(err?.message || "");
    const code = String(err?.code || "");
    if (message === "TOPIC_MISSING") {
      return t("community.error.missing", "Este tema no existe o fue eliminado.");
    }
    if (message === "NO_USER") {
      return t("community.error.auth", "Tu sesión ha caducado. Vuelve a iniciar sesión.");
    }
    if (code === "permission-denied" || /permission/i.test(message)) {
      return t(
        "community.error.permission",
        "No tienes permiso para ver este contenido."
      );
    }
    if (code === "failed-precondition" || /index/i.test(message)) {
      return t(
        "community.error.index",
        "Falta un índice en la base de datos. Inténtalo en unos minutos."
      );
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
        "No se puede eliminar: esta respuesta tiene réplicas."
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
    if (openComposerBtn) {
      openComposerBtn.hidden = !signedIn || !listView || listView.hidden;
    }
    if (loginHint) {
      loginHint.hidden = signedIn || !listView || listView.hidden;
    }
    if (replyBox) {
      replyBox.hidden = !signedIn || !currentTopicId;
    }
    if (!signedIn) {
      closeComposerModal();
    }
  }

  function openComposerModal() {
    if (!composerModal || !currentUser) {
      return;
    }
    closeUserCard();
    composerModal.hidden = false;
    document.body.classList.add("community-composer-open");
    window.setTimeout(function () {
      topicTitleInput?.focus();
    }, 30);
  }

  function closeComposerModal() {
    if (!composerModal || composerModal.hidden) {
      return;
    }
    composerModal.hidden = true;
    document.body.classList.remove("community-composer-open");
  }

  function markActiveTab() {
    if (!tabsEl) {
      return;
    }
    tabsEl.querySelectorAll("[data-category]").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-category") === currentCategory);
    });
    updateCategoryBlurb();
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

  /** Authors may only remove top-level replies with no replicas. */
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
    if (isTopLevelReply(reply)) {
      return (Number(reply.replicaCount) || 0) === 0;
    }
    return true;
  }

  async function assertAuthorCanHideTopic(_topicId, topicData) {
    const count = Number(topicData?.replyCount) || 0;
    if (count > 0) {
      throw new Error("THREAD_LOCKED");
    }
  }

  async function assertAuthorCanHideReply(_topicId, _replyId, replyData) {
    const parentId = String(replyData?.parentReplyId || replyData?.replyToId || PARENT_ROOT);
    if (parentId === PARENT_ROOT || !parentId) {
      if ((Number(replyData?.replicaCount) || 0) > 0) {
        throw new Error("THREAD_LOCKED");
      }
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
    const bits = [];
    if (opts.canReply) {
      bits.push(
        '<button type="button" class="community-msg__reply" data-reply-to="' +
          escapeHtml(opts.id) +
          '">' +
          escapeHtml(t("community.replyTo.action", "Responder")) +
          "</button>"
      );
    }
    if (opts.canDelete) {
      bits.push(
        '<button type="button" class="community-msg__delete" data-hide="' +
          escapeHtml(opts.hideAttr) +
          '" data-id="' +
          escapeHtml(opts.id) +
          '">' +
          escapeHtml(t("community.delete", "Eliminar")) +
          "</button>"
      );
    }
    if (!bits.length) {
      return "";
    }
    return '<div class="community-msg__actions">' + bits.join("") + "</div>";
  }

  function renderMessage(opts) {
    const cls =
      "community-msg" +
      (opts.isOp ? " community-msg--op" : "") +
      (opts.isReplica ? " community-msg--replica" : "");
    const uid = opts.authorUid || "";
    const name = opts.authorName || "";
    return (
      '<article class="' +
      cls +
      '" data-msg-id="' +
      escapeHtml(opts.id || "") +
      '">' +
      '<button type="button" class="community-msg__avatar" data-author-uid="' +
      escapeHtml(uid) +
      '" data-author-name="' +
      escapeHtml(name) +
      '" aria-label="' +
      escapeHtml(
        t("community.user.open", "Ver perfil de {name}").replace(
          "{name}",
          name || t("community.anonymous", "Usuario")
        )
      ) +
      '">' +
      escapeHtml(initialsFrom(name)) +
      "</button>" +
      '<div class="community-msg__main">' +
      '<div class="community-msg__head">' +
      '<button type="button" class="community-msg__name-btn" data-author-uid="' +
      escapeHtml(uid) +
      '" data-author-name="' +
      escapeHtml(name) +
      '">' +
      escapeHtml(name) +
      "</button>" +
      '<span class="community-msg__time">' +
      escapeHtml(formatWhen(opts.createdAt)) +
      "</span></div>" +
      (opts.title
        ? '<h2 class="community-msg__title">' + escapeHtml(opts.title) + "</h2>"
        : "") +
      '<div class="community-msg__body">' +
      formatBodyHtml(opts.body) +
      "</div>" +
      actionButtons({
        canReply: opts.canReply,
        canDelete: opts.canDelete,
        hideAttr: opts.hideAttr,
        id: opts.id,
      }) +
      "</div></article>"
    );
  }

  function replicasToggleHtml(reply) {
    const count = Number(reply.replicaCount) || 0;
    const state = replicasByParent[reply.id];
    const expanded = !!(state && state.expanded);
    if (count <= 0 && state && state.loaded && !state.items.length) {
      return "";
    }
    const shown = count || (state && state.items ? state.items.length : 0);
    let label;
    if (expanded) {
      label = t("community.replica.hide", "Ocultar réplicas");
    } else if (shown === 1) {
      label = t("community.replica.showOne", "Mostrar 1 réplica");
    } else if (shown > 1) {
      label = t("community.replica.show", "Mostrar {n} réplicas").replace(
        "{n}",
        String(shown)
      );
    } else {
      label = t("community.replica.check", "Ver réplicas");
    }
    return (
      '<button type="button" class="community-replica-toggle" data-toggle-replicas="' +
      escapeHtml(reply.id) +
      '" aria-expanded="' +
      (expanded ? "true" : "false") +
      '">' +
      escapeHtml(label) +
      "</button>"
    );
  }

  function renderReplicasPanel(parentId) {
    const state = replicasState(parentId);
    if (!state.expanded) {
      return "";
    }
    let inner = "";
    if (state.loading && !state.items.length) {
      inner = skeletonHtml("thread");
    } else if (!state.items.length) {
      inner =
        '<p class="community-empty community-empty--replicas">' +
        escapeHtml(t("community.replica.empty", "No hay réplicas todavía.")) +
        "</p>";
    } else {
      inner = state.items
        .map(function (replica) {
          return renderMessage({
            isOp: false,
            isReplica: true,
            authorUid: replica.authorUid,
            authorName: replica.authorName,
            createdAt: replica.createdAt,
            body: replica.body,
            canReply: false,
            canDelete: canDeleteReply(replica),
            hideAttr: "reply",
            id: replica.id,
          });
        })
        .join("");
      if (state.loading) {
        inner += skeletonHtml("thread");
      }
    }
    return '<div class="community-replicas">' + inner + "</div>";
  }

  function renderTopLevelReplyBlock(reply) {
    return (
      '<div class="community-reply-block" data-reply-block="' +
      escapeHtml(reply.id) +
      '">' +
      renderMessage({
        isOp: false,
        isReplica: false,
        authorUid: reply.authorUid,
        authorName: reply.authorName,
        createdAt: reply.createdAt,
        body: reply.body,
        canReply: !!currentUser,
        canDelete: canDeleteReply(reply),
        hideAttr: "reply",
        id: reply.id,
      }) +
      replicasToggleHtml(reply) +
      renderReplicasPanel(reply.id) +
      "</div>"
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
        '<div class="community-empty">' +
        '<span class="community-empty__title">' +
        escapeHtml(
          searchQuery
            ? t("community.search.emptyTitle", "Sin resultados")
            : t("community.emptyTitle", "Esta sección espera tu primer hilo")
        ) +
        "</span>" +
        escapeHtml(
          searchQuery
            ? t(
                "community.search.empty",
                "No hay temas que coincidan con tu búsqueda en esta sección."
              )
            : t(
                "community.empty",
                "Todavía no hay temas aquí. Sé quien abra la conversación."
              )
        ) +
        "</div>";
      return;
    }

    let html = topics
      .map(function (topic, index) {
        const preview = previewFromBody(topic.body, 140);
        const repliesLabel =
          Number(topic.replyCount) === 1
            ? t("community.repliesCountOne", "1 respuesta")
            : t("community.repliesCount", "{n} respuestas").replace(
                "{n}",
                String(topic.replyCount || 0)
              );
        return (
          '<a class="community-topic" data-category="' +
          escapeHtml(topic.category) +
          '" href="community.html?c=' +
          encodeURIComponent(topic.category) +
          "&t=" +
          encodeURIComponent(topic.id) +
          '" style="animation-delay:' +
          Math.min(index, 8) * 40 +
          'ms">' +
          '<button type="button" class="community-topic__avatar" data-author-uid="' +
          escapeHtml(topic.authorUid || "") +
          '" data-author-name="' +
          escapeHtml(topic.authorName || "") +
          '" aria-label="' +
          escapeHtml(
            t("community.user.open", "Ver perfil de {name}").replace(
              "{name}",
              topic.authorName || t("community.anonymous", "Usuario")
            )
          ) +
          '">' +
          escapeHtml(initialsFrom(topic.authorName)) +
          "</button>" +
          '<span class="community-topic__title">' +
          escapeHtml(topic.title) +
          "</span>" +
          (preview
            ? '<p class="community-topic__preview">' + escapeHtml(preview) + "</p>"
            : "") +
          '<span class="community-topic__meta">' +
          '<button type="button" class="community-topic__author" data-author-uid="' +
          escapeHtml(topic.authorUid || "") +
          '" data-author-name="' +
          escapeHtml(topic.authorName || "") +
          '">' +
          escapeHtml(topic.authorName) +
          "</button>" +
          " · " +
          escapeHtml(formatWhen(topic.createdAt)) +
          "</span>" +
          '<span class="community-topic__badge" title="' +
          escapeHtml(repliesLabel) +
          '">' +
          escapeHtml(repliesLabel) +
          "</span></a>"
        );
      })
      .join("");

    if (topicsLoading) {
      html += skeletonHtml("list");
    } else if (topicsHasMore && !searchQuery && topics.length > 0) {
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

    const replyTotal = Number(currentTopic.replyCount) || 0;
    const countLabel =
      replyTotal === 1
        ? t("community.repliesCountOne", "1 respuesta")
        : t("community.repliesCount", "{n} respuestas").replace(
            "{n}",
            String(replyTotal)
          );

    let repliesHtml = "";
    if (!replies.length && !repliesLoading) {
      repliesHtml =
        '<p class="community-empty" style="padding:12px 14px">' +
        escapeHtml(t("community.noReplies", "Sé el primero en responder.")) +
        "</p>";
    } else {
      repliesHtml = replies.map(renderTopLevelReplyBlock).join("");
    }

    if (repliesLoading) {
      repliesHtml += skeletonHtml("thread");
    } else if (repliesHasMore && replies.length > 0) {
      // Never attach the infinite-scroll sentinel on an empty thread: it stays
      // in view and re-triggers loadRepliesPage in a flicker loop.
      repliesHtml +=
        '<div class="community-scroll-sentinel" data-replies-sentinel aria-hidden="true"></div>';
    }

    detailMount.innerHTML =
      '<div class="community-thread">' +
      renderMessage({
        isOp: true,
        authorUid: currentTopic.authorUid,
        authorName: currentTopic.authorName,
        createdAt: currentTopic.createdAt,
        title: currentTopic.title,
        body: currentTopic.body,
        canReply: false,
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

  function createdAtMillis(value) {
    if (!value) {
      return 0;
    }
    if (typeof value.toDate === "function") {
      return value.toDate().getTime();
    }
    if (value instanceof Date) {
      return value.getTime();
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }

  async function fetchRepliesPage(topicId, cursor) {
    const firestore = await auth.getFirestore();
    const col = firestore
      .collection("CommunityTopics")
      .doc(topicId)
      .collection("Replies");

    // One page per call (no overscan loops). Prefer server filter on parentReplyId
    // so replicas are not billed as top-level page reads.
    async function runQuery(filterRoot) {
      let query = filterRoot
        ? col.where("parentReplyId", "==", PARENT_ROOT).orderBy("createdAt", "desc")
        : col.orderBy("createdAt", "desc");
      query = query.limit(REPLIES_PAGE);
      if (cursor) {
        query = query.startAfter(cursor);
      }
      return query.get();
    }

    let snap;
    let filteredRoot = false;
    if (repliesRootQueryOk) {
      try {
        snap = await runQuery(true);
        filteredRoot = true;
      } catch (err) {
        // Missing composite index (parentReplyId + createdAt) → single-field orderBy once.
        console.warn("[TourAI community] fetchRepliesPage root filter fallback", err);
        repliesRootQueryOk = false;
        snap = await runQuery(false);
      }
    } else {
      snap = await runQuery(false);
    }

    if (!snap.docs.length) {
      return { items: [], cursor: null, hasMore: false };
    }

    const items = [];
    snap.docs.forEach(function (doc) {
      const reply = mapReply(doc);
      if (reply.hidden) {
        return;
      }
      if (filteredRoot || isTopLevelReply(reply)) {
        items.push(reply);
      }
    });

    return {
      items: items,
      cursor: snap.docs[snap.docs.length - 1],
      hasMore: snap.docs.length >= REPLIES_PAGE,
    };
  }

  async function fetchReplicasForParent(topicId, parentId) {
    const firestore = await auth.getFirestore();
    const col = firestore
      .collection("CommunityTopics")
      .doc(topicId)
      .collection("Replies");
    const byId = Object.create(null);

    async function collect(field, value) {
      try {
        // Equality + limit only (no orderBy → no composite index). Sort in memory.
        const snap = await col.where(field, "==", value).limit(REPLICAS_LIMIT).get();
        snap.docs.forEach(function (doc) {
          const reply = mapReply(doc);
          if (!reply.hidden && !isTopLevelReply(reply)) {
            byId[reply.id] = reply;
          }
        });
      } catch (err) {
        console.warn("[TourAI community] fetchReplicas", field, err);
      }
    }

    // Primary field written by this app; replyToId only for legacy docs if needed.
    await collect("parentReplyId", parentId);
    if (!Object.keys(byId).length) {
      await collect("replyToId", parentId);
    }

    return Object.keys(byId)
      .map(function (id) {
        return byId[id];
      })
      .sort(function (a, b) {
        return createdAtMillis(a.createdAt) - createdAtMillis(b.createdAt);
      });
  }

  async function toggleReplicas(parentId) {
    if (!currentTopicId || !parentId) {
      return;
    }
    const state = replicasState(parentId);
    if (state.expanded) {
      state.expanded = false;
      renderDetailThread();
      return;
    }
    state.expanded = true;
    if (!state.loaded) {
      state.loading = true;
      renderDetailThread();
      try {
        state.items = await fetchReplicasForParent(currentTopicId, parentId);
        state.loaded = true;
      } catch (err) {
        console.error("[TourAI community] toggleReplicas", err);
        setStatus(loadErrorMessage(err), true);
        state.expanded = false;
      } finally {
        state.loading = false;
        renderDetailThread();
      }
      return;
    }
    renderDetailThread();
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

  async function searchTopicsInCategory(category, query) {
    const firestore = await auth.getFirestore();
    let cursor = null;
    const matched = [];
    let scanned = 0;
    while (scanned < SEARCH_SCAN_LIMIT) {
      let pageQuery = firestore
        .collection("CommunityTopics")
        .where("hidden", "==", false)
        .where("category", "==", category)
        .orderBy("createdAt", "desc")
        .limit(TOPICS_PAGE);
      if (cursor) {
        pageQuery = pageQuery.startAfter(cursor);
      }
      const snap = await pageQuery.get();
      if (!snap.docs.length) {
        break;
      }
      snap.docs.forEach(function (doc) {
        scanned += 1;
        const topic = mapTopic(doc);
        if (topicMatchesQuery(topic, query)) {
          matched.push(topic);
        }
      });
      cursor = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < TOPICS_PAGE) {
        break;
      }
    }
    return matched;
  }

  async function runTopicSearch() {
    const query = String(searchQuery || "").trim();
    const gen = ++searchGen;
    if (!query) {
      topicsHasMore = true;
      await loadTopicsPage(true);
      return;
    }
    searchBusy = true;
    topicsLoading = true;
    topicsHasMore = false;
    topicsCursor = null;
    topicsObserver = disconnectObserver(topicsObserver);
    if (topicsEl) {
      topicsEl.innerHTML = skeletonHtml("list");
    }
    setStatus(t("community.search.searching", "Buscando..."), false);
    try {
      const matched = await searchTopicsInCategory(currentCategory, query);
      if (gen !== searchGen) {
        return;
      }
      topics = matched;
      setStatus(
        topics.length
          ? t("community.search.results", "{n} resultados").replace(
              "{n}",
              String(topics.length)
            )
          : "",
        false
      );
    } catch (err) {
      if (gen !== searchGen) {
        return;
      }
      console.error("[TourAI community] search", err);
      topics = [];
      setStatus(loadErrorMessage(err), true);
    } finally {
      if (gen === searchGen) {
        topicsLoading = false;
        searchBusy = false;
        renderTopicsList();
      }
    }
  }

  function syncSearchClear() {
    if (searchClearBtn) {
      searchClearBtn.hidden = !String(searchQuery || "").trim();
    }
  }

  function scheduleSearch(raw) {
    searchQuery = String(raw || "").trim();
    syncSearchClear();
    if (searchTimer) {
      clearTimeout(searchTimer);
    }
    searchTimer = setTimeout(function () {
      runTopicSearch();
    }, 280);
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
    if (searchQuery) {
      return;
    }
    if (topicsLoading) {
      return;
    }
    if (!reset && !topicsHasMore) {
      return;
    }
    topicsLoading = true;
    topicsObserver = disconnectObserver(topicsObserver);
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
      const previousCount = topics.length;
      topics = reset ? page.items : topics.concat(page.items);
      topicsCursor = page.cursor;
      topicsHasMore = !!page.hasMore && (reset || topics.length > previousCount);
      if (!currentTopicId) {
        setStatus("", false);
      }
    } catch (err) {
      console.error("[TourAI community] loadTopicsPage", err);
      topicsHasMore = false;
      if (!currentTopicId) {
        setStatus(loadErrorMessage(err), true);
      }
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
    if (!currentTopicId) {
      return;
    }
    // Allow reset to take over a stuck/in-flight load; block only duplicate "load more".
    if (repliesLoading && !reset) {
      return;
    }
    if (!reset && !repliesHasMore) {
      return;
    }
    repliesLoading = true;
    repliesObserver = disconnectObserver(repliesObserver);
    const startedAt = Date.now();
    if (reset) {
      replies = [];
      repliesCursor = null;
      repliesHasMore = true;
      resetReplicasState();
    }
    try {
      renderDetailThread();
    } catch (renderErr) {
      console.error("[TourAI community] renderDetailThread", renderErr);
    }
    try {
      const page = await fetchRepliesPage(currentTopicId, reset ? null : repliesCursor);
      const previousCount = replies.length;
      replies = reset ? page.items : replies.concat(page.items);
      repliesCursor = page.cursor;
      // Stop if Firestore says no more OR this page added nothing (stuck cursor / filters).
      repliesHasMore = !!page.hasMore && (reset || replies.length > previousCount);
      setStatus("", false);
    } catch (err) {
      console.error("[TourAI community] loadRepliesPage", err);
      repliesHasMore = false;
      setStatus(
        t(
          "community.error.replies",
          "El tema se ha abierto, pero no se pudieron cargar las respuestas."
        ),
        true
      );
    } finally {
      await window.TourAiLoading?.ensureMinMs?.(startedAt, 500);
      repliesLoading = false;
      try {
        renderDetailThread();
      } catch (renderErr) {
        console.error("[TourAI community] renderDetailThread", renderErr);
      }
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
    resetReplicasState();
    clearReplyToTarget();
    syncAuthUi();
    closeUserCard();
    setStatus("", false);
    if (searchQuery) {
      await runTopicSearch();
    } else {
      await loadTopicsPage(true);
    }
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
    closeUserCard();
    clearReplyToTarget();
    resetReplicasState();
    replies = [];
    repliesCursor = null;
    repliesHasMore = false;
    repliesLoading = false;
    repliesObserver = disconnectObserver(repliesObserver);
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
      await loadRepliesPage(true);
    } catch (err) {
      console.error("[TourAI community] loadDetail", err);
      repliesLoading = false;
      setStatus(loadErrorMessage(err), true);
      if (currentTopic) {
        renderDetailThread();
      }
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
    const bodyHtml = getEditorHtml(topicBodyInput);
    const bodyText = plainTextFromHtml(bodyHtml);
    if (!title || title.length > 120) {
      setStatus(t("community.error.title", "Escribe un título (máx. 120 caracteres)."), true);
      return;
    }
    if (!bodyText) {
      setStatus(t("community.error.body", "Escribe un mensaje."), true);
      return;
    }
    if (bodyText.length > BODY_MAX_CHARS || bodyHtml.length > BODY_MAX_HTML) {
      setStatus(
        t("community.error.bodyLong", "El mensaje es demasiado largo. Acórtalo un poco."),
        true
      );
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
        body: bodyHtml,
        bodyFormat: "html",
        authorUid: user.uid,
        authorName: authorLabel(user),
        createdAt: timestampNow(),
        hidden: false,
        replyCount: 0,
      });
      if (topicTitleInput) {
        topicTitleInput.value = "";
      }
      clearEditor(topicBodyInput);
      closeComposerModal();
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
    const bodyHtml = getEditorHtml(replyBodyInput);
    const bodyText = plainTextFromHtml(bodyHtml);
    if (!bodyText) {
      setStatus(t("community.error.body", "Escribe un mensaje."), true);
      return;
    }
    if (bodyText.length > BODY_MAX_CHARS || bodyHtml.length > BODY_MAX_HTML) {
      setStatus(
        t("community.error.bodyLong", "El mensaje es demasiado largo. Acórtalo un poco."),
        true
      );
      return;
    }
    busy = true;
    setStatus(t("community.saving", "Publicando..."), false);
    try {
      const user = await requireUser();
      const firestore = await auth.getFirestore();
      const topicRef = firestore.collection("CommunityTopics").doc(currentTopicId);
      // Avoid an extra topic read when we already have it in memory.
      if (!currentTopic || currentTopic.id !== currentTopicId) {
        const topicDoc = await topicRef.get();
        if (!topicDoc.exists || topicDoc.data()?.hidden) {
          throw new Error("TOPIC_MISSING");
        }
      }
      const parentId = replyToTarget?.id || PARENT_ROOT;
      const parentReply = parentId !== PARENT_ROOT
        ? replies.find(function (item) {
            return item.id === parentId;
          })
        : null;
      if (parentId !== PARENT_ROOT && (!parentReply || !isTopLevelReply(parentReply))) {
        throw new Error("TOPIC_MISSING");
      }

      const replyPayload = {
        body: bodyHtml,
        bodyFormat: "html",
        authorUid: user.uid,
        authorName: authorLabel(user),
        createdAt: timestampNow(),
        hidden: false,
        parentReplyId: parentId,
        replicaCount: 0,
      };
      if (parentId !== PARENT_ROOT) {
        replyPayload.replyToId = parentId;
        replyPayload.replyToAuthorName = replyToTarget.authorName || "";
        replyPayload.replyToSnippet = replyToTarget.snippet || "";
      } else {
        replyPayload.replyToId = "";
      }

      const batch = firestore.batch();
      const replyRef = topicRef.collection("Replies").doc();
      batch.set(replyRef, replyPayload);
      batch.update(topicRef, {
        replyCount: window.firebase.firestore.FieldValue.increment(1),
      });
      if (parentId !== PARENT_ROOT) {
        batch.update(topicRef.collection("Replies").doc(parentId), {
          replicaCount: window.firebase.firestore.FieldValue.increment(1),
        });
      }
      await batch.commit();

      clearEditor(replyBodyInput);
      const savedParentId = parentId;
      const savedMeta = {
        replyToAuthorName: replyPayload.replyToAuthorName || "",
        replyToSnippet: replyPayload.replyToSnippet || "",
      };
      clearReplyToTarget();

      const localReply = {
        id: replyRef.id,
        body: bodyHtml,
        authorUid: user.uid,
        authorName: authorLabel(user),
        createdAt: new Date(),
        hidden: false,
        parentReplyId: savedParentId,
        replicaCount: 0,
        replyToAuthorName: savedMeta.replyToAuthorName,
        replyToSnippet: savedMeta.replyToSnippet,
      };

      if (savedParentId === PARENT_ROOT) {
        replies = [localReply].concat(replies);
      } else {
        const parent = replies.find(function (item) {
          return item.id === savedParentId;
        });
        if (parent) {
          parent.replicaCount = (Number(parent.replicaCount) || 0) + 1;
        }
        const state = replicasState(savedParentId);
        state.items = state.items.concat([localReply]);
        state.loaded = true;
        state.expanded = true;
      }
      currentTopic.replyCount = (currentTopic.replyCount || 0) + 1;
      setStatus("", false);
      renderDetailThread();
    } catch (err) {
      console.error("[TourAI community] createReply", err);
      setStatus(saveErrorMessage(err), true);
    } finally {
      busy = false;
    }
  });

  detailMount?.addEventListener("click", async function (event) {
    const toggleBtn = event.target.closest("[data-toggle-replicas]");
    if (toggleBtn && detailMount.contains(toggleBtn)) {
      event.preventDefault();
      toggleReplicas(toggleBtn.getAttribute("data-toggle-replicas"));
      return;
    }
    const replyBtn = event.target.closest("[data-reply-to]");
    if (replyBtn && detailMount.contains(replyBtn)) {
      event.preventDefault();
      if (!currentUser) {
        window.location.href = loginUrl();
        return;
      }
      const replyId = replyBtn.getAttribute("data-reply-to");
      const reply = replies.find(function (item) {
        return item.id === replyId;
      });
      if (reply && isTopLevelReply(reply)) {
        setReplyToTarget(reply);
      }
      return;
    }
    const authorEl = event.target.closest("[data-author-uid]");
    if (authorEl && detailMount.contains(authorEl)) {
      event.preventDefault();
      openUserCard(
        authorEl,
        authorEl.getAttribute("data-author-uid"),
        authorEl.getAttribute("data-author-name")
      );
      return;
    }
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
        const data = doc.data() || {};
        await assertAuthorCanHideReply(currentTopicId, id, data);
        const parentId = String(data.parentReplyId || data.replyToId || PARENT_ROOT);
        const batch = firestore.batch();
        batch.update(ref, { hidden: true });
        batch.update(topicRef, {
          replyCount: window.firebase.firestore.FieldValue.increment(-1),
        });
        if (parentId && parentId !== PARENT_ROOT) {
          batch.update(topicRef.collection("Replies").doc(parentId), {
            replicaCount: window.firebase.firestore.FieldValue.increment(-1),
          });
        }
        await batch.commit();

        if (parentId && parentId !== PARENT_ROOT) {
          const state = replicasState(parentId);
          state.items = state.items.filter(function (item) {
            return item.id !== id;
          });
          const parent = replies.find(function (item) {
            return item.id === parentId;
          });
          if (parent && parent.replicaCount > 0) {
            parent.replicaCount -= 1;
          }
        } else {
          replies = replies.filter(function (reply) {
            return reply.id !== id;
          });
          delete replicasByParent[id];
        }
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

  topicsEl?.addEventListener("click", function (event) {
    const authorEl = event.target.closest("[data-author-uid]");
    if (!authorEl || !topicsEl.contains(authorEl)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openUserCard(
      authorEl,
      authorEl.getAttribute("data-author-uid"),
      authorEl.getAttribute("data-author-name")
    );
  });

  function bindAuthorHover(root) {
    if (!root) {
      return;
    }
    root.addEventListener("mouseover", function (event) {
      const authorEl = event.target.closest("[data-author-uid]");
      if (!authorEl || !root.contains(authorEl)) {
        return;
      }
      if (hoverCloseTimer) {
        clearTimeout(hoverCloseTimer);
        hoverCloseTimer = null;
      }
      if (hoverOpenTimer) {
        clearTimeout(hoverOpenTimer);
      }
      hoverOpenTimer = setTimeout(function () {
        openUserCard(
          authorEl,
          authorEl.getAttribute("data-author-uid"),
          authorEl.getAttribute("data-author-name")
        );
      }, 260);
    });
    root.addEventListener("mouseout", function (event) {
      const authorEl = event.target.closest("[data-author-uid]");
      if (!authorEl || !root.contains(authorEl)) {
        return;
      }
      const related = event.relatedTarget;
      if (related && (authorEl.contains(related) || userCardEl?.contains(related))) {
        return;
      }
      if (hoverOpenTimer) {
        clearTimeout(hoverOpenTimer);
        hoverOpenTimer = null;
      }
      hoverCloseTimer = setTimeout(function () {
        if (userCardEl && userCardEl.matches(":hover")) {
          return;
        }
        closeUserCard();
      }, 180);
    });
  }

  bindAuthorHover(topicsEl);
  bindAuthorHover(detailMount);

  userCardEl?.addEventListener("mouseenter", function () {
    if (hoverCloseTimer) {
      clearTimeout(hoverCloseTimer);
      hoverCloseTimer = null;
    }
  });
  userCardEl?.addEventListener("mouseleave", function () {
    closeUserCard();
  });
  userCardClose?.addEventListener("click", function () {
    closeUserCard();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (composerModal && !composerModal.hidden) {
        closeComposerModal();
        return;
      }
      closeUserCard();
    }
  });

  openComposerBtn?.addEventListener("click", function () {
    openComposerModal();
  });
  composerModal?.querySelectorAll("[data-close-composer]").forEach(function (el) {
    el.addEventListener("click", function () {
      closeComposerModal();
    });
  });

  document.addEventListener("click", function (event) {
    if (!userCardEl || userCardEl.hidden) {
      return;
    }
    if (userCardEl.contains(event.target)) {
      return;
    }
    if (event.target.closest && event.target.closest("[data-author-uid]")) {
      return;
    }
    closeUserCard();
  });

  searchInput?.addEventListener("input", function () {
    scheduleSearch(searchInput.value);
  });
  searchClearBtn?.addEventListener("click", function () {
    if (searchInput) {
      searchInput.value = "";
    }
    scheduleSearch("");
  });
  replyToClearBtn?.addEventListener("click", function () {
    clearReplyToTarget();
  });

  const initial = new URLSearchParams(window.location.search);
  currentCategory = initial.get("c") || "help";
  if (CATEGORIES.indexOf(currentCategory) < 0) {
    currentCategory = "help";
  }
  markActiveTab();
  initRichEditors();
  document.addEventListener("tourai:locale-changed", function () {
    syncEditorPlaceholders();
    updateCategoryBlurb();
  });

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
