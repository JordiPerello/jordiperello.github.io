/* TourAI What's New — loads PublicConfig/WhatsNew from Firestore (newest first). */
(function (global) {
  const LOCALE_ES = "es-ES";
  const LOCALE_EN = "en-GB";

  function t(key, fallback) {
    const locale = global.TourAiI18n?.getLocale?.();
    return global.TourAiI18n?.tOr?.(key, locale, null, fallback) ?? fallback;
  }

  function currentLocale() {
    return global.TourAiI18n?.getLocale?.() || LOCALE_ES;
  }

  function pickHighlights(entry, locale) {
    const map = entry?.Highlights || entry?.highlights || {};
    const requested = (locale || LOCALE_ES).trim();
    if (Array.isArray(map[requested]) && map[requested].length) {
      return map[requested];
    }
    const lang = requested.split("-")[0];
    for (const key of Object.keys(map)) {
      if (key.toLowerCase().startsWith(lang.toLowerCase()) && Array.isArray(map[key]) && map[key].length) {
        return map[key];
      }
    }
    if (Array.isArray(map[LOCALE_ES]) && map[LOCALE_ES].length) {
      return map[LOCALE_ES];
    }
    if (Array.isArray(map[LOCALE_EN]) && map[LOCALE_EN].length) {
      return map[LOCALE_EN];
    }
    for (const key of Object.keys(map)) {
      if (Array.isArray(map[key]) && map[key].length) {
        return map[key];
      }
    }
    return [];
  }

  function parseEntries(raw) {
    if (!raw) {
      return [];
    }
    if (Array.isArray(raw)) {
      return raw;
    }
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  function renderStatus(host, message) {
    host.innerHTML = "";
    const p = document.createElement("p");
    p.className = "whats-new-status";
    p.textContent = message;
    host.appendChild(p);
  }

  function renderEntries(host, entries, locale) {
    host.innerHTML = "";
    const list = document.createElement("ol");
    list.className = "whats-new-timeline";
    list.setAttribute("aria-label", t("whatsNew.timelineLabel"));

    let rendered = 0;
    entries.forEach((entry, index) => {
      const version = (entry?.Version || entry?.version || "").trim();
      if (!version) {
        return;
      }
      const highlights = pickHighlights(entry, locale).filter((h) => typeof h === "string" && h.trim());
      if (!highlights.length) {
        return;
      }

      const li = document.createElement("li");
      li.className = "whats-new-entry" + (rendered === 0 ? " whats-new-entry--latest" : "");

      const header = document.createElement("div");
      header.className = "whats-new-entry__header";

      const badge = document.createElement("span");
      badge.className = "whats-new-entry__version";
      badge.textContent = t("whatsNew.versionLabel").replace("{0}", version);
      header.appendChild(badge);

      const releasedAt = (entry?.ReleasedAt || entry?.releasedAt || "").trim();
      if (releasedAt) {
        const date = document.createElement("time");
        date.className = "whats-new-entry__date";
        date.dateTime = releasedAt;
        date.textContent = releasedAt;
        header.appendChild(date);
      }

      const ul = document.createElement("ul");
      ul.className = "whats-new-entry__items";
      highlights.forEach((text) => {
        const item = document.createElement("li");
        item.textContent = text.trim();
        ul.appendChild(item);
      });

      li.appendChild(header);
      li.appendChild(ul);
      list.appendChild(li);
      rendered += 1;
    });

    if (!rendered) {
      renderStatus(host, t("whatsNew.empty"));
      return;
    }

    host.appendChild(list);
  }

  async function loadWhatsNew() {
    const host = document.getElementById("whats-new-root");
    if (!host) {
      return;
    }

    renderStatus(host, t("whatsNew.loading"));

    try {
      if (!global.TourAiAuth?.ensureFirebase) {
        throw new Error("AUTH_HELPER_MISSING");
      }
      await global.TourAiAuth.ensureFirebase();
      const db = global.firebase.firestore();
      const snap = await db.collection("PublicConfig").doc("WhatsNew").get();
      if (!snap.exists) {
        renderStatus(host, t("whatsNew.empty"));
        return;
      }
      const data = snap.data() || {};
      const entries = parseEntries(data.EntriesJson || data.entriesJson);
      renderEntries(host, entries, currentLocale());
    } catch {
      renderStatus(
        host,
        t("whatsNew.error")
      );
    }
  }

  function boot() {
    loadWhatsNew();
    document.addEventListener("tourai:locale-changed", loadWhatsNew);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
