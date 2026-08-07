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


  const BODY_MAX_CHARS = 2000;
  const BODY_MAX_HTML = 8000;
  const EMOJI_SET =
    "😀 🙂 😊 😁 😂 🤗 👍 👏 🙌 ❤️ 💙 ✨ 🌟 🔥 🎉 ✅ ❗ ❓ 💡 🗺️ 🧭 ✈️ 🌍 🏞️ 🏕️ 🎒 ☕ 🍽️ 🎧 📱 💬";

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
    return t("reviews.anonymous");
  }

  function targetLabel(target) {
    if (target === "app") {
      return t("reviews.target.app");
    }
    return t("reviews.target.web");
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
      commentFormat: data.commentFormat === "html" ? "html" : "text",
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
        ? t("reviews.widget.aria")
            .replace("{avg}", label)
            .replace("{n}", String(count))
        : t("reviews.widget.ariaEmpty");

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
      t("reviews.widget.ariaEmpty")
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
    const targetSelect = document.getElementById("reviewsTarget");
    const targetToggle = document.getElementById("reviewsTargetToggle");
    const submitBtn = document.getElementById("reviewsSubmit");
    const tabsEl = document.getElementById("reviewsTabs");
    const commentInvite = document.getElementById("reviewsCommentInvite");
    const commentInviteText = document.getElementById("reviewsCommentInviteText");
    const commentAddBtn = document.getElementById("reviewsCommentAddBtn");
    const commentEditBtn = document.getElementById("reviewsCommentEditBtn");
    const commentPreview = document.getElementById("reviewsCommentPreview");
    const commentModal = document.getElementById("reviewsCommentModal");
    const commentForm = document.getElementById("reviewsCommentForm");
    const commentEditor = document.getElementById("reviewsCommentEditor");
    const commentModalStatus = document.getElementById("reviewsCommentModalStatus");
    const commentSaveBtn = document.getElementById("reviewsCommentSaveBtn");

    let currentUser = null;
    let filterTarget = "all";
    let selectedStars = 0;
    let draftCommentHtml = "";
    let starsLocked = false;
    let busy = false;

    let reviews = [];
    let cursor = null;
    let hasMore = true;
    let loading = false;
    let listObserver = null;
    let myReviews = { web: null, app: null };
    let stats = { sum: 0, count: 0, average: null };

    function setCommentModalStatus(message, isError) {
      if (!commentModalStatus) {
        return;
      }
      commentModalStatus.textContent = message || "";
      commentModalStatus.classList.toggle("error", !!isError);
    }

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
      const countLabel = t("reviews.summary.count").replace(
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
          '"' +
          (starsLocked ? " disabled" : "") +
          ' aria-label="' +
          escapeHtml(t("reviews.stars.pick").replace("{n}", String(i))) +
          '">' +
          '<svg width="28" height="28" viewBox="0 0 24 24" focusable="false"><path d="' +
          STAR_PATH +
          '"/></svg></button>';
      }
      starsUi.innerHTML = html;
      if (starsInput) {
        starsInput.value = selectedStars ? String(selectedStars) : "";
      }
      if (submitBtn) {
        submitBtn.disabled = starsLocked || busy;
        submitBtn.hidden = starsLocked;
      }
    }

    function syncCommentUi() {
      const hasComment = !!plainTextFromHtml(draftCommentHtml);
      const target = getSelectedTarget();
      const mine = myReviews[target];
      if (commentEditBtn) {
        const editLabel = t("reviews.comment.edit");
        commentEditBtn.title = editLabel;
        commentEditBtn.setAttribute("aria-label", editLabel);
        commentEditBtn.hidden = !hasComment;
      }
      if (hasComment) {
        if (commentPreview) {
          commentPreview.innerHTML = formatBodyHtml(draftCommentHtml);
          commentPreview.hidden = false;
        }
        if (commentInvite) {
          commentInvite.hidden = true;
        }
      } else {
        if (commentPreview) {
          commentPreview.innerHTML = "";
          commentPreview.hidden = true;
        }
        if (commentInvite) {
          commentInvite.hidden = false;
        }
        if (commentInviteText) {
          commentInviteText.textContent = mine
            ? t("reviews.comment.inviteExisting")
            : t("reviews.comment.inviteNew");
        }
      }
    }

    function openCommentModal() {
      if (!commentModal || !currentUser) {
        return;
      }
      setCommentModalStatus("", false);
      if (commentEditor) {
        commentEditor.innerHTML = draftCommentHtml || "";
      }
      commentModal.hidden = false;
      document.body.classList.add("community-composer-open");
      window.setTimeout(function () {
        focusEditorEnd(commentEditor);
      }, 30);
    }

    function closeCommentModal() {
      if (!commentModal || commentModal.hidden) {
        return;
      }
      commentModal.hidden = true;
      document.body.classList.remove("community-composer-open");
      setCommentModalStatus("", false);
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
      let commentBlock;
      if (!comment) {
        commentBlock =
          '<p class="reviews-card__comment reviews-card__comment--empty">' +
          escapeHtml(t("reviews.noComment")) +
          "</p>";
      } else if (review.commentFormat === "html" || looksLikeHtml(comment)) {
        commentBlock =
          '<div class="reviews-card__comment community-msg__body">' +
          formatBodyHtml(comment) +
          "</div>";
      } else {
        commentBlock =
          '<p class="reviews-card__comment">' + escapeHtml(comment) + "</p>";
      }
      return (
        '<article class="reviews-card">' +
        '<div class="reviews-card__head">' +
        starsHtml(review.stars, { size: 16, uid: "r-" + review.id }) +
        '<span class="reviews-card__target">' +
        escapeHtml(targetLabel(review.target)) +
        "</span>" +
        '<span class="reviews-card__meta">' +
        escapeHtml(review.authorName || t("reviews.anonymous")) +
        " · " +
        escapeHtml(formatWhen(review.createdAt)) +
        "</span></div>" +
        commentBlock +
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
          escapeHtml(t("reviews.empty")) +
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
          t("reviews.error.load"),
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

    function syncComposeFromMine() {
      if (!targetSelect) {
        return;
      }
      const target = getSelectedTarget();
      const mine = myReviews[target];
      if (mine) {
        selectedStars = mine.stars || 0;
        draftCommentHtml = mine.comment || "";
        if (mine.hidden) {
          starsLocked = false;
          setStatus(
            t("reviews.pending.yours"),
            false
          );
        } else {
          starsLocked = true;
          setStatus(
            t("reviews.alreadyPublished"),
            false
          );
        }
      } else {
        selectedStars = 0;
        draftCommentHtml = "";
        starsLocked = false;
        setStatus("", false);
      }
      renderStarsPicker();
      syncCommentUi();
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

    async function persistReviewComment(commentHtml) {
      const target = getSelectedTarget();
      const existing = myReviews[target];
      const published = !!(existing && !existing.hidden);
      if (!existing && (!selectedStars || selectedStars < 1 || selectedStars > 5)) {
        throw new Error("NEED_STARS");
      }
      const user = await requireUser();
      const firestore = await auth.getFirestore();
      const id = user.uid + "_" + target;
      const payload = {
        comment: commentHtml || "",
        commentFormat: "html",
        updatedAt: timestampNow(),
      };
      if (published) {
        // Published: comment fields only (stars stay fixed).
        await firestore.collection("Reviews").doc(id).set(payload, { merge: true });
        return;
      }
      payload.stars = Math.round(
        selectedStars || (existing && existing.stars) || 0
      );
      payload.target = target;
      payload.authorUid = user.uid;
      payload.authorName = authorLabel(user).slice(0, 80);
      payload.hidden = true;
      if (!existing) {
        payload.createdAt = timestampNow();
      }
      await firestore.collection("Reviews").doc(id).set(payload, { merge: true });
    }

    async function submitReview(event) {
      event.preventDefault();
      if (busy || starsLocked) {
        return;
      }
      const stars = selectedStars;
      if (!stars || stars < 1 || stars > 5) {
        setStatus(t("reviews.error.stars"), true);
        return;
      }
      const target = getSelectedTarget();
      const comment = draftCommentHtml || "";
      const commentText = plainTextFromHtml(comment);
      if (commentText.length > BODY_MAX_CHARS || comment.length > BODY_MAX_HTML) {
        setStatus(
          t("reviews.error.commentLong"),
          true
        );
        return;
      }
      const existing = myReviews[target];
      if (existing && !existing.hidden) {
        setStatus(
          t("reviews.alreadyPublished"),
          true
        );
        return;
      }

      busy = true;
      if (submitBtn) {
        submitBtn.disabled = true;
      }
      setStatus(t("reviews.saving"), false);

      try {
        const user = await requireUser();
        const firestore = await auth.getFirestore();
        const id = user.uid + "_" + target;
        const payload = {
          stars: Math.round(stars),
          comment: comment,
          commentFormat: "html",
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
          t("reviews.saved"),
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
          t("reviews.error.save"),
          true
        );
      } finally {
        busy = false;
        if (submitBtn) {
          submitBtn.disabled = starsLocked;
        }
      }
    }

    async function submitCommentForm(event) {
      event.preventDefault();
      if (busy) {
        return;
      }
      const commentHtml = getEditorHtml(commentEditor);
      const commentText = plainTextFromHtml(commentHtml);
      if (commentText.length > BODY_MAX_CHARS || commentHtml.length > BODY_MAX_HTML) {
        setCommentModalStatus(
          t("reviews.error.commentLong"),
          true
        );
        return;
      }

      const target = getSelectedTarget();
      const existing = myReviews[target];
      const shouldPersist = !!(existing || selectedStars);

      if (!existing && !selectedStars) {
        setCommentModalStatus(
          t("reviews.comment.needStars"),
          true
        );
        return;
      }

      busy = true;
      if (commentSaveBtn) {
        commentSaveBtn.disabled = true;
      }
      setCommentModalStatus(t("reviews.saving"), false);

      try {
        draftCommentHtml = commentHtml;
        if (shouldPersist) {
          await persistReviewComment(commentHtml);
          setStatus(
            t("reviews.comment.saved"),
            false
          );
          await loadMyReviews();
        } else {
          syncCommentUi();
        }
        closeCommentModal();
      } catch (err) {
        console.error("[TourAI reviews] saveComment", err);
        if (String(err?.message) === "NO_USER") {
          window.location.href = loginUrl("login.html");
          return;
        }
        if (String(err?.message) === "NEED_STARS") {
          setCommentModalStatus(
            t("reviews.comment.needStars"),
            true
          );
        } else {
          setCommentModalStatus(
            t("reviews.error.save"),
            true
          );
        }
      } finally {
        busy = false;
        if (commentSaveBtn) {
          commentSaveBtn.disabled = false;
        }
      }
    }

    starsUi?.addEventListener("click", function (event) {
      const btn = event.target.closest("[data-star]");
      if (!btn || btn.disabled || starsLocked) {
        return;
      }
      selectedStars = Number(btn.getAttribute("data-star")) || 0;
      renderStarsPicker();
    });

    form?.addEventListener("submit", submitReview);
    commentForm?.addEventListener("submit", submitCommentForm);
    commentAddBtn?.addEventListener("click", function () {
      openCommentModal();
    });
    commentEditBtn?.addEventListener("click", function () {
      openCommentModal();
    });
    commentModal?.querySelectorAll("[data-close-reviews-comment]").forEach(function (el) {
      el.addEventListener("click", function () {
        closeCommentModal();
      });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && commentModal && !commentModal.hidden) {
        closeCommentModal();
      }
    });

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
    syncCommentUi();
    renderSummary();
    syncAuthUi();
    initRichEditors();
    document.addEventListener("tourai:locale-changed", function () {
      syncEditorPlaceholders();
      syncCommentUi();
      syncAuthUi();
      renderSummary();
      renderStarsPicker();
      renderList();
    });

    auth
      .ensureFirebase()
      .then(function () {
        return auth.onAuthStateChanged(async function (user) {
          currentUser = user || null;
          syncAuthUi();
          if (!currentUser) {
            closeCommentModal();
            draftCommentHtml = "";
            selectedStars = 0;
            starsLocked = false;
            syncCommentUi();
            renderStarsPicker();
          }
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
          t("reviews.error.load"),
          true
        );
      });
  }

  bootSiteRatingWidget();
  bootReviewsPage();
})();
