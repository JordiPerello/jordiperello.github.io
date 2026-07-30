/*
 * Community page: topics + replies in Firestore.
 * Paged reads only (scroll to load more). Author delete is physical (doc.delete).
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
  const STATUS_PENDING = "Pending";
  const STATUS_APPROVED = "Approved";
  /** Auto-publish when the author has this many approved posts and zero rejections. */
  const AUTO_APPROVE_MIN = 5;
  /** Same threshold as Manager CommunityTopicsRepository.RejectBlockThreshold. */
  const REJECT_BLOCK_THRESHOLD = 3;

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
  const confirmModal = document.getElementById("communityConfirmModal");
  const confirmTitleEl = document.getElementById("communityConfirmTitle");
  const confirmMessageEl = document.getElementById("communityConfirmMessage");
  const confirmOkBtn = document.getElementById("communityConfirmOk");
  const confirmCancelBtn = document.getElementById("communityConfirmCancel");
  const replyToBanner = document.getElementById("communityReplyToBanner");
  const replyToLabelEl = document.getElementById("communityReplyToLabel");
  const replyToSnippetEl = document.getElementById("communityReplyToSnippet");
  const replyToClearBtn = document.getElementById("communityReplyToClear");

  let replyToTarget = null;
  let confirmResolver = null;
  /** @type {null | { kind: 'topic'|'reply', id: string, parentReplyId?: string }} */
  let editingTarget = null;

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
  let searchGen = 0;
  const authorCache = Object.create(null);
  let openAuthorUid = null;
  let hoverOpenTimer = null;
  let hoverCloseTimer = null;
  /** @type {string[]|null} */
  let forbiddenWordsCache = null;
  let forbiddenWordsLoading = null;

  const searchInput = document.getElementById("communitySearchInput");
  const searchSubmitBtn = document.getElementById("communitySearchSubmit");
  const searchClearBtn = document.getElementById("communitySearchClear");
  const userCardEl = document.getElementById("communityUserCard");
  const userCardAvatar = document.getElementById("communityUserCardAvatar");
  const userCardName = document.getElementById("communityUserCardName");
  const userCardMeta = document.getElementById("communityUserCardMeta");
  const userCardClose = document.getElementById("communityUserCardClose");
  const blockedBanner = document.getElementById("communityBlockedBanner");

  /** True when the signed-in user cannot create community posts. */
  let postingBlocked = false;

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

  function closeConfirmModal(result) {
    if (confirmModal) {
      confirmModal.hidden = true;
    }
    document.body.classList.remove("community-confirm-open");
    if (confirmOkBtn) {
      confirmOkBtn.classList.remove("btn-primary--danger");
    }
    confirmModal?.querySelector(".community-confirm-modal__dialog")?.classList.remove(
      "community-confirm-modal__dialog--danger"
    );
    const resolve = confirmResolver;
    confirmResolver = null;
    if (resolve) {
      resolve(!!result);
    }
  }

  function confirmAction(options) {
    const opts = options || {};
    if (!confirmModal || !confirmTitleEl || !confirmMessageEl || !confirmOkBtn) {
      return Promise.resolve(window.confirm(opts.message || opts.title || ""));
    }
    if (confirmResolver) {
      closeConfirmModal(false);
    }
    confirmTitleEl.textContent = opts.title || "";
    confirmMessageEl.textContent = opts.message || "";
    confirmOkBtn.textContent =
      opts.confirmLabel || t("community.confirm.ok", "Confirmar");
    if (confirmCancelBtn) {
      confirmCancelBtn.textContent =
        opts.cancelLabel || t("community.confirm.cancel", "Cancelar");
    }
    const dialog = confirmModal.querySelector(".community-confirm-modal__dialog");
    if (opts.danger) {
      confirmOkBtn.classList.add("btn-primary--danger");
      dialog?.classList.add("community-confirm-modal__dialog--danger");
    } else {
      confirmOkBtn.classList.remove("btn-primary--danger");
      dialog?.classList.remove("community-confirm-modal__dialog--danger");
    }
    confirmModal.hidden = false;
    document.body.classList.add("community-confirm-open");
    confirmOkBtn.focus();
    return new Promise(function (resolve) {
      confirmResolver = resolve;
    });
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
        let raw = bits.slice(1).join(":").trim().replace(/\s*!important$/i, "").trim();
        if (!raw || /expression|url\s*\(|javascript:|@import/i.test(raw)) {
          return;
        }
        if (prop === "color" || prop === "background-color") {
          if (
            /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+\s*[,/\s]+[\d.]+\s*[,/\s]+[\d.]+(?:\s*[,/]\s*[\d.]+)?\s*\)|hsla?\(\s*[\d.]+\s*[,/\s]+[\d.%]+\s*[,/\s]+[\d.%]+(?:\s*[,/]\s*[\d.]+)?\s*\)|[a-z]+)$/i.test(
              raw
            )
          ) {
            allowed.push(prop + ": " + raw);
          }
        } else if (prop === "font-size") {
          if (/^\d+(\.\d+)?(px|em|rem|%|pt)$/i.test(raw)) {
            allowed.push(prop + ": " + raw);
          }
        } else if (prop === "font-weight") {
          if (/^(normal|bold|bolder|lighter|[1-9]00)$/i.test(raw)) {
            allowed.push(prop + ": " + raw);
          }
        } else if (prop === "font-style") {
          if (/^(normal|italic|oblique)$/i.test(raw)) {
            allowed.push(prop + ": " + raw);
          }
        } else if (prop === "text-decoration" || prop === "text-decoration-line") {
          if (/^(none|underline|line-through)(\s+(none|underline|line-through))*$/i.test(raw)) {
            allowed.push(prop + ": " + raw);
          }
        }
      });
    return allowed.join("; ");
  }

  function extractClipboardHtml(raw) {
    let html = String(raw || "");
    if (!html) {
      return "";
    }
    const startMark = "<!--StartFragment-->";
    const endMark = "<!--EndFragment-->";
    const start = html.indexOf(startMark);
    const end = html.indexOf(endMark);
    let fragment = "";
    if (start !== -1 && end > start) {
      fragment = html.slice(start + startMark.length, end).trim();
    }
    let body = "";
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
      body = bodyMatch[1]
        .replace(/<!--StartFragment-->/gi, "")
        .replace(/<!--EndFragment-->/gi, "")
        .trim();
    }
    // Some apps put a poor/empty fragment; prefer the richer of fragment vs body vs raw.
    return pickRicherHtml(fragment, pickRicherHtml(body, html.trim()));
  }

  function formattingScore(html) {
    const s = String(html || "");
    if (!s) {
      return 0;
    }
    let score = Math.min(s.length, 200);
    if (/style\s*=/i.test(s)) {
      score += 120;
    }
    if (/\bcolor\s*:/i.test(s) || /\bcolor\s*=/i.test(s)) {
      score += 80;
    }
    if (/font-weight\s*:\s*(bold|[5-9]00)/i.test(s) || /<(b|strong)\b/i.test(s)) {
      score += 40;
    }
    if (/font-style\s*:\s*italic/i.test(s) || /<(i|em)\b/i.test(s)) {
      score += 30;
    }
    if (/text-decoration[^;]*underline/i.test(s) || /<u\b/i.test(s)) {
      score += 30;
    }
    if (/<font\b/i.test(s)) {
      score += 50;
    }
    if (/font-size\s*:/i.test(s) || /\bsize\s*=\s*["']?[1-7]/i.test(s)) {
      score += 25;
    }
    return score;
  }

  function pickRicherHtml(a, b) {
    return formattingScore(a) >= formattingScore(b) ? a : b;
  }

  function sanitizeCommunityHtml(raw, options) {
    const skipExtract = !!(options && options.skipExtract);
    const source = skipExtract ? String(raw || "") : extractClipboardHtml(raw) || String(raw || "");
    const template = document.createElement("template");
    template.innerHTML = source;
    const allowed = {
      B: true,
      STRONG: true,
      I: true,
      EM: true,
      U: true,
      S: true,
      STRIKE: true,
      BR: true,
      P: true,
      DIV: true,
      SPAN: true,
      FONT: true,
    };
    const styleTags = {
      B: true,
      STRONG: true,
      I: true,
      EM: true,
      U: true,
      S: true,
      STRIKE: true,
      SPAN: true,
      P: true,
      DIV: true,
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
        // Clean descendants first so unwrap keeps already-sanitized children.
        clean(child);
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
          if (styleTags[tag] && name === "style") {
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
      });
    }

    clean(template.content);
    // Contenteditable unwraps the first pasted block (p/div) and drops its attributes.
    // Move block styles onto an inner span so the first paragraph keeps color/weight/etc.
    moveBlockStylesInside(template.content);
    return template.innerHTML.trim();
  }

  function moveBlockStylesInside(root) {
    if (!root || !root.querySelectorAll) {
      return;
    }
    Array.from(root.querySelectorAll("p, div")).forEach(function (el) {
      const style = String(el.getAttribute("style") || "").trim();
      if (!style) {
        return;
      }
      // Already a single styled span wrapping everything — merge styles upward protection.
      if (
        el.childNodes.length === 1 &&
        el.firstChild.nodeType === Node.ELEMENT_NODE &&
        el.firstChild.tagName === "SPAN"
      ) {
        const inner = el.firstChild;
        const merged = sanitizeStyle(
          [inner.getAttribute("style") || "", style].filter(Boolean).join(";")
        );
        if (merged) {
          inner.setAttribute("style", merged);
        }
        el.removeAttribute("style");
        return;
      }
      const span = document.createElement("span");
      span.setAttribute("style", style);
      while (el.firstChild) {
        span.appendChild(el.firstChild);
      }
      el.appendChild(span);
      el.removeAttribute("style");
    });
  }

  function sanitizePasteHtml(raw) {
    const direct = sanitizeCommunityHtml(raw);
    // If extraction path lost formatting that the raw clipboard still had, retry without extract.
    if (formattingScore(raw) > formattingScore(direct) + 40) {
      const alt = sanitizeCommunityHtml(raw, { skipExtract: true });
      return pickRicherHtml(direct, alt);
    }
    return direct;
  }

  /** Range-only insert — execCommand('insertHTML') strips styles inconsistently in Chromium. */
  function insertHtmlAtSelection(editor, html) {
    if (!editor || !html) {
      return false;
    }
    editor.focus();
    const selection = window.getSelection();
    if (!selection) {
      return false;
    }
    let range = null;
    if (selection.rangeCount) {
      range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) {
        range = null;
      }
    }
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.deleteContents();
    const holder = document.createElement("div");
    // Wrapper so the browser's "merge first block" does not target a styled <p> directly.
    holder.innerHTML = '<div data-tourai-paste="1">' + html + "</div>";
    moveBlockStylesInside(holder);
    const frag = document.createDocumentFragment();
    let node;
    let last = null;
    while ((node = holder.firstChild)) {
      last = frag.appendChild(node);
    }
    range.insertNode(frag);
    // Unwrap paste carrier if it survived insertion.
    const wrap =
      (last && last.nodeType === Node.ELEMENT_NODE && last.getAttribute?.("data-tourai-paste") === "1"
        ? last
        : null) ||
      editor.querySelector("[data-tourai-paste='1']");
    if (wrap && wrap.parentNode) {
      const parent = wrap.parentNode;
      let child;
      while ((child = wrap.firstChild)) {
        last = parent.insertBefore(child, wrap);
      }
      parent.removeChild(wrap);
    }
    if (last) {
      range = document.createRange();
      range.setStartAfter(last);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return true;
  }

  function selectionHtmlInEditor(editor) {
    const selection = window.getSelection();
    if (!editor || !selection || selection.isCollapsed || !selection.rangeCount) {
      return null;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      return null;
    }
    const holder = document.createElement("div");
    holder.appendChild(range.cloneContents());
    return {
      html: sanitizeCommunityHtml(holder.innerHTML, { skipExtract: true }),
      text: String(holder.textContent || ""),
    };
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

  function normalizeForForbidden(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function containsWholeWord(haystack, needle) {
    if (!haystack || !needle) {
      return false;
    }
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(?:^|\\s)" + escaped + "(?:\\s|$)", "i").test(
      " " + haystack + " "
    );
  }

  /**
   * Firestore stores ConversationalRules Items as a JSON string (stringValue),
   * matching the app importer — not as a native map.
   */
  function coerceForbiddenItemsMap(raw) {
    if (!raw) {
      return null;
    }
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed;
        }
        if (Array.isArray(parsed)) {
          return { ALL: parsed };
        }
      } catch (err) {
        console.warn("[TourAI community] ForbiddenWords Items JSON parse failed", err);
      }
      return null;
    }
    if (Array.isArray(raw)) {
      return { ALL: raw };
    }
    if (typeof raw === "object") {
      return raw;
    }
    return null;
  }

  function flattenForbiddenItems(items) {
    const terms = [];
    const map = coerceForbiddenItemsMap(items);
    if (!map) {
      return terms;
    }
    Object.keys(map).forEach(function (key) {
      const list = map[key];
      if (!Array.isArray(list)) {
        return;
      }
      list.forEach(function (word) {
        const normalized = normalizeForForbidden(word);
        if (normalized) {
          terms.push(normalized);
        }
      });
    });
    return terms;
  }

  async function loadForbiddenWords() {
    if (forbiddenWordsCache !== null) {
      return forbiddenWordsCache;
    }
    if (forbiddenWordsLoading) {
      return forbiddenWordsLoading;
    }
    forbiddenWordsLoading = (async function () {
      const terms = [];
      let loadOk = false;
      try {
        const firestore = await auth.getFirestore();
        const locale = window.TourAiI18n?.getLocale?.() || "es-ES";
        const locales = [locale, "es-ES", "en-GB"].filter(function (value, index, arr) {
          return arr.indexOf(value) === index;
        });
        for (let i = 0; i < locales.length; i++) {
          try {
            const snap = await firestore
              .collection("ConversationalRules")
              .doc("ForbiddenWords_" + locales[i])
              .get();
            loadOk = true;
            if (snap.exists) {
              const data = snap.data() || {};
              terms.push.apply(
                terms,
                flattenForbiddenItems(data.Items || data.items)
              );
            }
          } catch (err) {
            console.warn(
              "[TourAI community] ForbiddenWords_" + locales[i] + " read failed",
              err
            );
          }
        }
      } catch (err) {
        console.error("[TourAI community] loadForbiddenWords", err);
      }
      const unique = Array.from(new Set(terms)).sort(function (a, b) {
        return b.length - a.length;
      });
      if (loadOk) {
        forbiddenWordsCache = unique;
      }
      return unique;
    })();
    try {
      return await forbiddenWordsLoading;
    } finally {
      forbiddenWordsLoading = null;
    }
  }

  async function textHasForbiddenWords(text) {
    const normalized = normalizeForForbidden(text);
    if (!normalized) {
      return false;
    }
    const terms = await loadForbiddenWords();
    for (let i = 0; i < terms.length; i++) {
      if (containsWholeWord(normalized, terms[i])) {
        return true;
      }
    }
    return false;
  }

  async function showCommunityPolicyBlocked() {
    const title = t("community.error.policy.title", "No se puede publicar");
    const message = t(
      "community.error.policy",
      "No se puede publicar: el contenido incumple la política de uso de la Comunidad. Revisa el texto e inténtalo de nuevo."
    );
    setStatus(message, true);
    if (window.TourAiFeedback?.show) {
      window.TourAiFeedback.show({
        type: "error",
        title: title,
        message: message,
      });
      return;
    }
    await confirmAction({
      title: title,
      message: message,
      confirmLabel: t("community.error.policy.ok", "Entendido"),
      danger: true,
    });
  }

  async function authorTrustSnapshot(uid) {
    const result = { approved: 0, rejected: 0, postingBlocked: false };
    if (!uid) {
      return result;
    }
    try {
      const firestore = await auth.getFirestore();
      const snap = await firestore.collection("Users").doc(uid).get();
      if (snap.exists) {
        const data = snap.data() || {};
        result.approved = Number(data.CommunityApprovedCount) || 0;
        result.rejected = Number(data.CommunityRejectedCount) || 0;
        result.postingBlocked =
          data.CommunityPostingBlocked === true ||
          result.rejected >= REJECT_BLOCK_THRESHOLD;
      }
    } catch (_) {
      // Owner-only Users read may fail for others; for self it should work.
    }
    return result;
  }

  async function refreshPostingBlockState(uid) {
    if (!uid) {
      postingBlocked = false;
      syncAuthUi();
      return;
    }
    const trust = await authorTrustSnapshot(uid);
    postingBlocked = !!trust.postingBlocked;
    syncAuthUi();
  }

  async function resolveModerationState(user, plainText) {
    const hasForbidden = await textHasForbiddenWords(plainText);
    let autoApprove = false;
    if (!hasForbidden && user?.uid) {
      const trust = await authorTrustSnapshot(user.uid);
      autoApprove = trust.approved >= AUTO_APPROVE_MIN && trust.rejected === 0;
    }
    return {
      hasForbiddenWords: hasForbidden,
      status: autoApprove ? STATUS_APPROVED : STATUS_PENDING,
      hidden: !autoApprove,
    };
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
    const root = editor.closest(".community-rte");
    if (root) {
      const colorInput = root.querySelector("[data-fore-color]");
      if (colorInput) {
        colorInput.value = "#0a2a43";
      }
      const sizeSelect = root.querySelector("[data-font-size]");
      if (sizeSelect) {
        sizeSelect.value = "3";
      }
      const emojiPanel = root.querySelector("[data-emoji-panel]");
      const emojiToggle = root.querySelector("[data-emoji-toggle]");
      if (emojiPanel) {
        emojiPanel.setAttribute("hidden", "");
      }
      if (emojiToggle) {
        emojiToggle.setAttribute("aria-expanded", "false");
      }
    }
    // Drop lingering bold/italic/color/size so the next keystrokes are plain.
    try {
      editor.focus();
      ["bold", "italic", "underline"].forEach(function (cmd) {
        if (document.queryCommandState?.(cmd)) {
          document.execCommand(cmd, false, null);
        }
      });
      document.execCommand("removeFormat", false, null);
      document.execCommand("foreColor", false, "#0a2a43");
      document.execCommand("fontSize", false, "3");
    } catch (_) {
      // Formatting commands are best-effort across browsers.
    }
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

  function selectionRangeInEditor(editor) {
    const selection = window.getSelection();
    if (!editor || !selection || !selection.rangeCount) {
      return null;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      return null;
    }
    return range.cloneRange();
  }

  function restoreEditorRange(editor, range) {
    if (!editor) {
      return;
    }
    editor.focus();
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    if (range) {
      try {
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      } catch (_) {
        // Fall through to end if the saved range is stale.
      }
    }
    focusEditorEnd(editor);
  }

  function insertEmoji(editor, emoji, savedRange) {
    if (!editor || !emoji) {
      return;
    }
    restoreEditorRange(editor, savedRange || selectionRangeInEditor(editor));
    try {
      if (document.execCommand("insertText", false, emoji)) {
        return;
      }
    } catch (_) {
      // Use Range API below.
    }
    const selection = window.getSelection();
    if (selection && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(emoji);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    editor.appendChild(document.createTextNode(emoji));
  }

  function bindRichEditor(root) {
    if (!root || root.getAttribute("data-rte-bound") === "1") {
      return;
    }
    root.setAttribute("data-rte-bound", "1");
    const editor = root.querySelector(".community-rte__editor");
    const emojiPanel = root.querySelector("[data-emoji-panel]");
    const emojiToggle = root.querySelector("[data-emoji-toggle]");
    let savedEditorRange = null;

    function rememberEditorSelection() {
      const range = selectionRangeInEditor(editor);
      if (range) {
        savedEditorRange = range;
      }
    }

    editor?.addEventListener("keyup", rememberEditorSelection);
    editor?.addEventListener("mouseup", rememberEditorSelection);
    editor?.addEventListener("blur", rememberEditorSelection);

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
        btn.addEventListener("mousedown", function (event) {
          event.preventDefault();
          rememberEditorSelection();
        });
        btn.addEventListener("click", function () {
          insertEmoji(editor, emoji, savedEditorRange);
          savedEditorRange = selectionRangeInEditor(editor);
        });
        emojiPanel.appendChild(btn);
      });
    }

    root.querySelectorAll("[data-cmd]").forEach(function (btn) {
      btn.addEventListener("mousedown", function (event) {
        event.preventDefault();
        rememberEditorSelection();
      });
      btn.addEventListener("click", function () {
        const cmd = btn.getAttribute("data-cmd");
        if (!editor || !cmd) {
          return;
        }
        restoreEditorRange(editor, savedEditorRange);
        document.execCommand(cmd, false, null);
        savedEditorRange = selectionRangeInEditor(editor);
      });
    });

    const colorInput = root.querySelector("[data-fore-color]");
    colorInput?.addEventListener("mousedown", function () {
      rememberEditorSelection();
    });
    colorInput?.addEventListener("input", function () {
      if (!editor) {
        return;
      }
      restoreEditorRange(editor, savedEditorRange);
      document.execCommand("foreColor", false, colorInput.value);
      savedEditorRange = selectionRangeInEditor(editor);
    });

    const sizeSelect = root.querySelector("[data-font-size]");
    sizeSelect?.addEventListener("mousedown", function () {
      rememberEditorSelection();
    });
    sizeSelect?.addEventListener("change", function () {
      if (!editor) {
        return;
      }
      restoreEditorRange(editor, savedEditorRange);
      document.execCommand("fontSize", false, sizeSelect.value);
      savedEditorRange = selectionRangeInEditor(editor);
    });

    emojiToggle?.addEventListener("mousedown", function (event) {
      event.preventDefault();
      rememberEditorSelection();
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
      restoreEditorRange(editor, savedEditorRange);
    });

    function writeSelectionToClipboard(event) {
      const packed = selectionHtmlInEditor(editor);
      if (!packed || (!packed.html && !packed.text)) {
        return;
      }
      event.clipboardData.setData("text/plain", packed.text);
      if (packed.html) {
        event.clipboardData.setData("text/html", packed.html);
      }
      event.preventDefault();
    }

    editor?.addEventListener("copy", writeSelectionToClipboard);
    editor?.addEventListener("cut", function (event) {
      writeSelectionToClipboard(event);
      if (event.defaultPrevented) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount) {
          selection.getRangeAt(0).deleteContents();
          savedEditorRange = selectionRangeInEditor(editor);
        }
      }
    });

    editor?.addEventListener("paste", function (event) {
      event.preventDefault();
      const clip = event.clipboardData;
      const htmlRaw = clip?.getData("text/html") || "";
      const plain = clip?.getData("text/plain") || "";
      let insertHtml = htmlRaw ? sanitizePasteHtml(htmlRaw) : "";
      if (!insertHtml && plain) {
        insertHtml = escapeHtml(plain).replace(/\r\n|\r|\n/g, "<br>");
      }
      if (!insertHtml) {
        return;
      }
      if (insertHtmlAtSelection(editor, insertHtml)) {
        savedEditorRange = selectionRangeInEditor(editor);
      }
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

  function authorPreviewFromNav(nav, fallbackName) {
    if (!nav || !nav.uid) {
      return null;
    }
    const urls = Array.isArray(nav.photoUrls)
      ? nav.photoUrls.filter(Boolean).slice()
      : [];
    if (!urls.length && nav.photoUrl) {
      urls.push(nav.photoUrl);
    }
    return {
      uid: nav.uid,
      displayName:
        nav.displayName ||
        fallbackName ||
        t("community.anonymous", "Usuario"),
      photoUrls: urls,
      photoCropOffsetXNorm: Number.isFinite(Number(nav.photoCropOffsetXNorm))
        ? Number(nav.photoCropOffsetXNorm)
        : 0,
      photoCropOffsetYNorm: Number.isFinite(Number(nav.photoCropOffsetYNorm))
        ? Number(nav.photoCropOffsetYNorm)
        : 0,
      photoCropUserScale:
        Number.isFinite(Number(nav.photoCropUserScale)) &&
        Number(nav.photoCropUserScale) > 0
          ? Number(nav.photoCropUserScale)
          : 1,
      createdAt: nav.createdAt || null,
    };
  }

  function selfAuthorPreview(uid, fallbackName) {
    const key = String(uid || "");
    const me = currentUser || auth.currentUser?.() || null;
    if (!key || !me || me.uid !== key) {
      return null;
    }
    const nav =
      typeof auth.getNavProfile === "function" ? auth.getNavProfile() : null;
    if (nav && nav.uid === key) {
      return authorPreviewFromNav(nav, fallbackName);
    }
    return null;
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
    // Own profile: reuse nav cache (already loaded for the avatar) — no Users read.
    const selfProfile = selfAuthorPreview(key, fallbackName);
    if (selfProfile) {
      authorCache[key] = selfProfile;
      return selfProfile;
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

  function paintAvatarElement(avatarEl, profile) {
    if (!avatarEl || !profile) {
      return;
    }
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
        avatarEl.textContent = "";
        avatarEl.appendChild(img);
        const size = avatarEl.offsetWidth || 40;
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

  function paintUserCardAvatar(profile) {
    if (!userCardAvatar) {
      return;
    }
    userCardAvatar.textContent = "";
    userCardAvatar.textContent = initialsFrom(profile.displayName);
    paintAvatarElement(userCardAvatar, profile);
  }

  function hydrateSelfAuthorAvatars(root) {
    const me = currentUser || auth.currentUser?.() || null;
    if (!root || !me) {
      return;
    }
    const profile =
      authorCache[me.uid] ||
      selfAuthorPreview(me.uid, me.displayName || "");
    if (!profile) {
      return;
    }
    authorCache[me.uid] = profile;
    root.querySelectorAll("[data-author-uid]").forEach(function (el) {
      if (el.getAttribute("data-author-uid") !== me.uid) {
        return;
      }
      if (
        !el.classList.contains("community-msg__avatar") &&
        !el.classList.contains("community-topic__avatar")
      ) {
        return;
      }
      if (el.querySelector("img")) {
        return;
      }
      paintAvatarElement(el, profile);
    });
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
      status: data.status || (data.hidden ? STATUS_PENDING : STATUS_APPROVED),
      hasForbiddenWords: !!data.hasForbiddenWords,
      replyCount: Number(data.replyCount) || 0,
    };
  }

  function mapReply(doc) {
    const data = doc.data() || {};
    const legacyReplyTo = String(data.replyToId || "").trim();
    let parentReplyId = String(data.parentReplyId || "").trim();
    // "root" (or empty) must fall through to replyToId — otherwise replicas
    // with a bad parentReplyId never resolve to their real parent.
    if (!parentReplyId || parentReplyId === PARENT_ROOT) {
      parentReplyId = legacyReplyTo || PARENT_ROOT;
    }
    if (!parentReplyId) {
      parentReplyId = PARENT_ROOT;
    }
    return {
      id: doc.id,
      _doc: doc,
      body: data.body || "",
      authorUid: data.authorUid || "",
      authorName: data.authorName || "",
      createdAt: data.createdAt || null,
      hidden: !!data.hidden,
      status: data.status || (data.hidden ? STATUS_PENDING : STATUS_APPROVED),
      hasForbiddenWords: !!data.hasForbiddenWords,
      parentReplyId: parentReplyId,
      replicaCount: Number(data.replicaCount) || 0,
      replyToAuthorName: data.replyToAuthorName || "",
      replyToSnippet: data.replyToSnippet || "",
    };
  }

  function resolveParentId(data) {
    const parent = String(data?.parentReplyId || "").trim();
    const replyTo = String(data?.replyToId || "").trim();
    if (parent && parent !== PARENT_ROOT) {
      return parent;
    }
    if (replyTo && replyTo !== PARENT_ROOT) {
      return replyTo;
    }
    return PARENT_ROOT;
  }

  function removeReplyFromLocalState(replyId) {
    const id = String(replyId || "");
    if (!id) {
      return;
    }
    replies = replies.filter(function (reply) {
      return reply.id !== id;
    });
    Object.keys(replicasByParent).forEach(function (parentId) {
      const state = replicasByParent[parentId];
      if (!state || !Array.isArray(state.items)) {
        return;
      }
      const before = state.items.length;
      state.items = state.items.filter(function (item) {
        return item.id !== id;
      });
      if (state.items.length < before) {
        const parent = replies.find(function (item) {
          return item.id === parentId;
        });
        if (parent && parent.replicaCount > 0) {
          parent.replicaCount -= 1;
        }
      }
    });
    delete replicasByParent[id];
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
    const code = String(err?.code || "");
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
    if (message === "FORBIDDEN" || code === "permission-denied") {
      return t(
        "community.error.forbidden",
        "No tienes permiso para esta acción. Si acabas de cambiar las reglas, espera un minuto e inténtalo de nuevo."
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
    const canPost = signedIn && !postingBlocked;
    if (blockedBanner) {
      blockedBanner.hidden = !signedIn || !postingBlocked;
      if (!blockedBanner.hidden) {
        blockedBanner.textContent = t(
          "community.blocked.banner",
          "Usuario bloqueado: puedes leer la comunidad, pero no publicar mensajes."
        );
      }
    }
    if (openComposerBtn) {
      openComposerBtn.hidden = !canPost || !listView || listView.hidden;
    }
    if (loginHint) {
      loginHint.hidden = signedIn || !listView || listView.hidden;
    }
    if (replyBox) {
      replyBox.hidden = !canPost || !currentTopicId;
    }
    if (!signedIn || postingBlocked) {
      closeComposerModal();
    }
  }

  function openComposerModal() {
    if (!composerModal || !currentUser || postingBlocked) {
      return;
    }
    closeUserCard();
    composerModal.hidden = false;
    document.body.classList.add("community-composer-open");
    window.setTimeout(function () {
      if (editingTarget && editingTarget.kind === "reply") {
        focusEditorEnd(topicBodyInput);
      } else {
        topicTitleInput?.focus();
      }
    }, 30);
  }

  function closeComposerModal() {
    if (!composerModal || composerModal.hidden) {
      return;
    }
    composerModal.hidden = true;
    document.body.classList.remove("community-composer-open");
    if (editingTarget) {
      resetComposerForNewTopic();
    }
  }

  function setComposerTitleFieldVisible(visible) {
    const titleInput = topicTitleInput;
    const titleLabel = titleInput
      ? document.querySelector('label[for="communityTopicTitle"]')
      : null;
    const titleWrap = document.getElementById("communityComposerTitleField");
    if (titleWrap) {
      titleWrap.hidden = !visible;
    }
    if (titleLabel) {
      titleLabel.hidden = !visible;
    }
    if (titleInput) {
      titleInput.hidden = !visible;
      if (visible) {
        titleInput.setAttribute("required", "");
      } else {
        titleInput.removeAttribute("required");
      }
    }
  }

  function resetComposerForNewTopic() {
    editingTarget = null;
    if (topicTitleInput) {
      topicTitleInput.value = "";
    }
    clearEditor(topicBodyInput);
    setComposerTitleFieldVisible(true);
    const titleEl = document.getElementById("communityComposerTitle");
    if (titleEl) {
      titleEl.textContent = t("community.newTopic", "Nuevo tema");
    }
  }

  function findReplyById(id) {
    if (!id) {
      return null;
    }
    const top = replies.find(function (item) {
      return item.id === id;
    });
    if (top) {
      return top;
    }
    const parentIds = Object.keys(replicasByParent);
    for (let i = 0; i < parentIds.length; i++) {
      const items = replicasByParent[parentIds[i]]?.items || [];
      const found = items.find(function (item) {
        return item.id === id;
      });
      if (found) {
        return found;
      }
    }
    return null;
  }

  function openComposerModalForEdit(target) {
    if (!composerModal || !currentUser || !target) {
      return;
    }
    editingTarget = target;
    const titleEl = document.getElementById("communityComposerTitle");
    if (target.kind === "topic") {
      setComposerTitleFieldVisible(true);
      if (titleEl) {
        titleEl.textContent = t("community.editTopic", "Editar tema");
      }
      if (topicTitleInput) {
        topicTitleInput.value = currentTopic?.title || "";
      }
      if (topicBodyInput) {
        topicBodyInput.innerHTML = currentTopic?.body || "";
      }
    } else {
      setComposerTitleFieldVisible(false);
      if (titleEl) {
        titleEl.textContent = t("community.editReply", "Editar mensaje");
      }
      const reply = findReplyById(target.id);
      if (topicTitleInput) {
        topicTitleInput.value = "";
      }
      if (topicBodyInput) {
        topicBodyInput.innerHTML = reply?.body || "";
      }
    }
    openComposerModal();
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

  function canEditOwn(authorUid) {
    return canDeleteOwn(authorUid);
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
    const parentId = resolveParentId(replyData);
    if (parentId === PARENT_ROOT) {
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
    if (opts.canEdit) {
      bits.push(
        '<button type="button" class="community-msg__edit" data-edit="' +
          escapeHtml(opts.hideAttr) +
          '" data-id="' +
          escapeHtml(opts.id) +
          '">' +
          escapeHtml(t("community.edit", "Editar")) +
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
        canEdit: opts.canEdit,
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
            canEdit: canEditOwn(replica.authorUid),
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
        canEdit: canEditOwn(reply.authorUid),
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
    hydrateSelfAuthorAvatars(topicsEl);
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
        canEdit: canEditOwn(currentTopic.authorUid),
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
    hydrateSelfAuthorAvatars(detailMount);
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
      const hasText = !!(
        String(searchInput?.value || "").trim() || String(searchQuery || "").trim()
      );
      searchClearBtn.hidden = !hasText;
    }
  }

  function commitSearch() {
    searchQuery = String(searchInput?.value || "").trim();
    syncSearchClear();
    runTopicSearch();
  }

  function clearSearch() {
    if (searchInput) {
      searchInput.value = "";
    }
    searchQuery = "";
    syncSearchClear();
    runTopicSearch();
  }

  function syncSearchSubmitLabel() {
    if (!searchSubmitBtn) {
      return;
    }
    const label = t("community.search.submit", "Buscar");
    searchSubmitBtn.setAttribute("aria-label", label);
    searchSubmitBtn.setAttribute("title", label);
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
    const bodyHtml = getEditorHtml(topicBodyInput);
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

    if (editingTarget) {
      const isTopicEdit = editingTarget.kind === "topic";
      let title = "";
      if (isTopicEdit) {
        title = String(topicTitleInput?.value || "").trim();
        if (!title || title.length > 120) {
          setStatus(t("community.error.title", "Escribe un título (máx. 120 caracteres)."), true);
          return;
        }
      }
      const ok = await confirmAction({
        title: t("community.confirm.saveEdit.title", "¿Guardar cambios?"),
        message: t(
          "community.confirm.saveEdit.body",
          "Se actualizará el contenido publicado."
        ),
        confirmLabel: t("community.confirm.ok", "Confirmar"),
      });
      if (!ok) {
        return;
      }
      busy = true;
      setStatus(t("community.savingEdit", "Guardando..."), false);
      try {
        const user = await requireUser();
        const firestore = await auth.getFirestore();
        if (isTopicEdit) {
          const ref = firestore.collection("CommunityTopics").doc(editingTarget.id);
          const doc = await ref.get();
          if (!doc.exists || doc.data()?.authorUid !== user.uid) {
            throw new Error("FORBIDDEN");
          }
          await ref.update({
            title: title,
            body: bodyHtml,
            bodyFormat: "html",
            updatedAt: timestampNow(),
          });
          if (currentTopic && currentTopic.id === editingTarget.id) {
            currentTopic.title = title;
            currentTopic.body = bodyHtml;
          }
        } else {
          if (!currentTopicId) {
            throw new Error("TOPIC_MISSING");
          }
          const ref = firestore
            .collection("CommunityTopics")
            .doc(currentTopicId)
            .collection("Replies")
            .doc(editingTarget.id);
          const doc = await ref.get();
          if (!doc.exists || doc.data()?.authorUid !== user.uid) {
            throw new Error("FORBIDDEN");
          }
          await ref.update({
            body: bodyHtml,
            bodyFormat: "html",
            updatedAt: timestampNow(),
          });
          const local = findReplyById(editingTarget.id);
          if (local) {
            local.body = bodyHtml;
          }
        }
        editingTarget = null;
        resetComposerForNewTopic();
        closeComposerModal();
        setStatus("", false);
        renderDetailThread();
      } catch (err) {
        console.error("[TourAI community] edit", err);
        setStatus(saveErrorMessage(err), true);
      } finally {
        busy = false;
      }
      return;
    }

    const title = String(topicTitleInput?.value || "").trim();
    if (!title || title.length > 120) {
      setStatus(t("community.error.title", "Escribe un título (máx. 120 caracteres)."), true);
      return;
    }
    if (postingBlocked) {
      setStatus(
        t(
          "community.blocked.banner",
          "Usuario bloqueado: puedes leer la comunidad, pero no publicar mensajes."
        ),
        true
      );
      return;
    }
    if (CATEGORIES.indexOf(currentCategory) < 0) {
      currentCategory = "help";
    }
    const plainForModeration = (title + " " + bodyText).trim();
    const user = await requireUser();
    const moderation = await resolveModerationState(user, plainForModeration);
    if (moderation.hasForbiddenWords) {
      await showCommunityPolicyBlocked();
      return;
    }
    const ok = await confirmAction({
      title: t("community.confirm.publishTopic.title", "¿Publicar este tema?"),
      message: moderation.hidden
        ? t(
            "community.confirm.publishTopic.pending",
            "Tu tema quedará pendiente de revisión antes de mostrarse en la comunidad."
          )
        : t(
            "community.confirm.publishTopic.body",
            "Tu tema será visible en esta sección de la comunidad."
          ),
      confirmLabel: t("community.publish", "Publicar"),
    });
    if (!ok) {
      return;
    }
    busy = true;
    setStatus(t("community.saving", "Publicando..."), false);
    try {
      const firestore = await auth.getFirestore();
      const ref = await firestore.collection("CommunityTopics").add({
        category: currentCategory,
        title: title,
        body: bodyHtml,
        bodyFormat: "html",
        authorUid: user.uid,
        authorName: authorLabel(user),
        createdAt: timestampNow(),
        status: moderation.status,
        hidden: moderation.hidden,
        hasForbiddenWords: moderation.hasForbiddenWords,
        replyCount: 0,
      });
      resetComposerForNewTopic();
      closeComposerModal();
      if (moderation.hidden) {
        setStatus(
          t(
            "community.pending.review",
            "Mensaje pendiente de revisión. Se publicará cuando un moderador lo apruebe."
          ),
          false
        );
      } else {
        setStatus("", false);
        showDetail(ref.id);
      }
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
    if (postingBlocked) {
      setStatus(
        t(
          "community.blocked.banner",
          "Usuario bloqueado: puedes leer la comunidad, pero no publicar mensajes."
        ),
        true
      );
      return;
    }
    const isReplica = !!(replyToTarget && replyToTarget.id);
    const user = await requireUser();
    const moderation = await resolveModerationState(user, bodyText);
    if (moderation.hasForbiddenWords) {
      await showCommunityPolicyBlocked();
      return;
    }
    const ok = await confirmAction({
      title: isReplica
        ? t("community.confirm.publishReplica.title", "¿Publicar esta réplica?")
        : t("community.confirm.publishReply.title", "¿Publicar esta respuesta?"),
      message: moderation.hidden
        ? t(
            "community.confirm.publishReply.pending",
            "Tu respuesta quedará pendiente de revisión antes de mostrarse en el hilo."
          )
        : isReplica
          ? t(
              "community.confirm.publishReplica.body",
              "Tu réplica aparecerá bajo la respuesta seleccionada."
            )
          : t(
              "community.confirm.publishReply.body",
              "Tu respuesta se añadirá a este hilo."
            ),
      confirmLabel: t("community.publish", "Publicar"),
    });
    if (!ok) {
      return;
    }
    busy = true;
    setStatus(t("community.saving", "Publicando..."), false);
    try {
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
        status: moderation.status,
        hidden: moderation.hidden,
        hasForbiddenWords: moderation.hasForbiddenWords,
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
      // Only public (Approved) replies affect visible counters.
      if (!moderation.hidden) {
        batch.update(topicRef, {
          replyCount: window.firebase.firestore.FieldValue.increment(1),
        });
        if (parentId !== PARENT_ROOT) {
          batch.update(topicRef.collection("Replies").doc(parentId), {
            replicaCount: window.firebase.firestore.FieldValue.increment(1),
          });
        }
      }
      await batch.commit();

      clearEditor(replyBodyInput);
      const savedParentId = parentId;
      const savedMeta = {
        replyToAuthorName: replyPayload.replyToAuthorName || "",
        replyToSnippet: replyPayload.replyToSnippet || "",
      };
      clearReplyToTarget();

      if (moderation.hidden) {
        setStatus(
          t(
            "community.pending.review",
            "Mensaje pendiente de revisión. Se publicará cuando un moderador lo apruebe."
          ),
          false
        );
        return;
      }

      const localReply = {
        id: replyRef.id,
        body: bodyHtml,
        authorUid: user.uid,
        authorName: authorLabel(user),
        createdAt: new Date(),
        hidden: false,
        status: STATUS_APPROVED,
        hasForbiddenWords: false,
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
    // Edit before delete handlers (avatar/name sit nearby).
    const editBtn = event.target.closest("[data-edit]");
    if (editBtn && detailMount.contains(editBtn)) {
      event.preventDefault();
      event.stopPropagation();
      if (!currentUser) {
        window.location.href = loginUrl();
        return;
      }
      const kind = editBtn.getAttribute("data-edit");
      const id = editBtn.getAttribute("data-id");
      if (kind === "topic") {
        if (!currentTopic || currentTopic.id !== id || !canEditOwn(currentTopic.authorUid)) {
          return;
        }
        openComposerModalForEdit({ kind: "topic", id: id });
        return;
      }
      if (kind === "reply") {
        const reply = findReplyById(id);
        if (!reply || !canEditOwn(reply.authorUid)) {
          return;
        }
        const parentReplyId = resolveParentId(reply);
        openComposerModalForEdit({
          kind: "reply",
          id: id,
          parentReplyId: parentReplyId !== PARENT_ROOT ? parentReplyId : undefined,
        });
      }
      return;
    }
    // Delete must win over author-card handlers (avatar/name sit nearby).
    const hideBtn = event.target.closest("[data-hide]");
    if (hideBtn && detailMount.contains(hideBtn)) {
      event.preventDefault();
      event.stopPropagation();
      if (!currentUser) {
        window.location.href = loginUrl();
        return;
      }
      const kind = hideBtn.getAttribute("data-hide");
      const id = hideBtn.getAttribute("data-id");
      let confirmOpts;
      if (kind === "topic") {
        confirmOpts = {
          title: t("community.confirm.deleteTopic.title", "¿Eliminar este tema?"),
          message: t(
            "community.confirm.deleteTopic.body",
            "Se eliminará de forma permanente. Esta acción no se puede deshacer."
          ),
          confirmLabel: t("community.delete", "Eliminar"),
          danger: true,
        };
      } else {
        let isReplica = false;
        Object.keys(replicasByParent).some(function (parentId) {
          const items = replicasByParent[parentId]?.items || [];
          return items.some(function (item) {
            if (item.id === id) {
              isReplica = true;
              return true;
            }
            return false;
          });
        });
        if (!isReplica) {
          const top = replies.find(function (item) {
            return item.id === id;
          });
          if (top && !isTopLevelReply(top)) {
            isReplica = true;
          }
        }
        confirmOpts = isReplica
          ? {
              title: t(
                "community.confirm.deleteReplica.title",
                "¿Eliminar esta réplica?"
              ),
              message: t(
                "community.confirm.deleteReplica.body",
                "Se eliminará de forma permanente. Esta acción no se puede deshacer."
              ),
              confirmLabel: t("community.delete", "Eliminar"),
              danger: true,
            }
          : {
              title: t(
                "community.confirm.deleteReply.title",
                "¿Eliminar esta respuesta?"
              ),
              message: t(
                "community.confirm.deleteReply.body",
                "Se eliminará de forma permanente. Esta acción no se puede deshacer."
              ),
              confirmLabel: t("community.delete", "Eliminar"),
              danger: true,
            };
      }
      const ok = await confirmAction(confirmOpts);
      if (!ok) {
        return;
      }
      try {
        const firestore = await auth.getFirestore();
        if (kind === "topic") {
          const ref = firestore.collection("CommunityTopics").doc(id);
          const doc = await ref.get();
          if (!doc.exists || doc.data()?.authorUid !== currentUser.uid) {
            throw new Error("FORBIDDEN");
          }
          await assertAuthorCanHideTopic(id, doc.data());
          await ref.delete();
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
          const parentId = resolveParentId(data);
          const wasPublic =
            data.hidden !== true &&
            String(data.status || STATUS_APPROVED) === STATUS_APPROVED;
          // Delete the reply first; then adjust counters (best-effort).
          await ref.delete();
          if (wasPublic) {
            try {
              await topicRef.update({
                replyCount: window.firebase.firestore.FieldValue.increment(-1),
              });
            } catch (countErr) {
              console.warn("[TourAI community] replyCount update after delete", countErr);
            }
            if (parentId && parentId !== PARENT_ROOT) {
              try {
                await topicRef.collection("Replies").doc(parentId).update({
                  replicaCount: window.firebase.firestore.FieldValue.increment(-1),
                });
              } catch (countErr) {
                console.warn("[TourAI community] replicaCount update after delete", countErr);
              }
            }
            removeReplyFromLocalState(id);
            if (currentTopic && currentTopic.replyCount > 0) {
              currentTopic.replyCount -= 1;
            }
          } else {
            removeReplyFromLocalState(id);
          }
          setStatus("", false);
          renderDetailThread();
        }
      } catch (err) {
        console.error("[TourAI community] delete", err);
        const msg = saveErrorMessage(err);
        setStatus(msg, true);
        if (window.TourAiFeedback?.show) {
          window.TourAiFeedback.show({
            type: "error",
            title: t("community.confirm.deleteFailed.title", "No se pudo eliminar"),
            message: msg,
          });
        }
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
      if (confirmModal && !confirmModal.hidden) {
        closeConfirmModal(false);
        return;
      }
      if (composerModal && !composerModal.hidden) {
        closeComposerModal();
        return;
      }
      closeUserCard();
    }
  });

  confirmOkBtn?.addEventListener("click", function () {
    closeConfirmModal(true);
  });
  confirmCancelBtn?.addEventListener("click", function () {
    closeConfirmModal(false);
  });
  confirmModal?.querySelectorAll("[data-confirm-cancel]").forEach(function (el) {
    el.addEventListener("click", function () {
      closeConfirmModal(false);
    });
  });

  openComposerBtn?.addEventListener("click", function () {
    resetComposerForNewTopic();
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
    syncSearchClear();
  });
  searchInput?.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitSearch();
    }
  });
  searchSubmitBtn?.addEventListener("click", function () {
    commitSearch();
  });
  searchClearBtn?.addEventListener("click", function () {
    clearSearch();
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
    syncAuthUi();
    markActiveTab();
    syncSearchSubmitLabel();
    if (currentTopic) {
      renderDetailThread();
    } else {
      renderTopicsList();
    }
  });

  syncSearchSubmitLabel();

  auth
    .onAuthStateChanged(function (user) {
      currentUser = user || null;
      if (!currentUser) {
        postingBlocked = false;
        syncAuthUi();
      } else {
        refreshPostingBlockState(currentUser.uid);
      }
      if (currentTopic) {
        renderDetailThread();
      } else if (topicsEl && topics.length) {
        hydrateSelfAuthorAvatars(topicsEl);
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
