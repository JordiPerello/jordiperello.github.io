(function () {
  const SPANISH_LOCALE = "es-ES";
  const ENGLISH_LOCALE = "en-GB";
  const messages = {
    [SPANISH_LOCALE]: {},
    [ENGLISH_LOCALE]: {},
  };

  const legalHtmlCache = Object.create(null);

  function syncLocaleMessages() {
    if (window.TourAiEsESMessages && typeof window.TourAiEsESMessages === "object") {
      messages[SPANISH_LOCALE] = window.TourAiEsESMessages;
    }
    if (window.TourAiEnGBMessages && typeof window.TourAiEnGBMessages === "object") {
      messages[ENGLISH_LOCALE] = window.TourAiEnGBMessages;
    }
  }

  syncLocaleMessages();

  function isSpanishLocale(locale) {
    return locale === SPANISH_LOCALE || locale === "es";
  }

  function normalizeLocale(locale) {
    if (locale === "es") {
      return SPANISH_LOCALE;
    }
    return locale;
  }

  function isEnglishPath(pathname) {
    const path = String(pathname || "").replace(/\\/g, "/");
    return /(?:^|\/)en(?:\/|$)/.test(path);
  }

  function getLocale() {
    if (typeof location !== "undefined" && isEnglishPath(location.pathname)) {
      return ENGLISH_LOCALE;
    }
    return SPANISH_LOCALE;
  }

  function applyVars(value, vars) {
    if (!vars || value == null) {
      return value;
    }
    let out = String(value);
    Object.keys(vars).forEach((name) => {
      out = out.split(`{${name}}`).join(String(vars[name]));
    });
    return out;
  }

  function t(key, locale, vars) {
    syncLocaleMessages();
    const normalized = normalizeLocale(locale) || getLocale();
    const table = messages[normalized] ?? {};
    const value = table[key];
    if (value == null || value === "" || value === key) {
      return null;
    }
    return applyVars(value, vars);
  }

  function tOr(key, locale, vars, fallback) {
    return t(key, locale, vars) ?? fallback ?? "";
  }

  function extractLegalMainHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const main =
      doc.querySelector("main.legal-content") ||
      doc.querySelector("main.container.legal-content") ||
      doc.querySelector(".legal-content main") ||
      doc.querySelector("main");
    if (!main) {
      return "";
    }
    return main.innerHTML;
  }

  function legalPageUrl(kind, locale) {
    const english = !isSpanishLocale(normalizeLocale(locale));
    const file =
      kind === "terms" ? "terms.html" : kind === "privacy" ? "privacy.html" : kind === "cookies" ? "cookies.html" : "";
    if (!file) {
      return "";
    }
    return english ? `/en/${file}` : `/${file}`;
  }

  async function fetchLegalPageInnerHtml(kind, locale) {
    const normalized = normalizeLocale(locale || getLocale());
    const cacheKey = `${kind}:${normalized}`;
    if (legalHtmlCache[cacheKey]) {
      return legalHtmlCache[cacheKey];
    }
    const url = legalPageUrl(kind, normalized);
    if (!url) {
      return null;
    }
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error("LEGAL_FETCH_FAILED");
    }
    const html = await response.text();
    const inner = extractLegalMainHtml(html);
    if (!inner) {
      throw new Error("LEGAL_PARSE_FAILED");
    }
    legalHtmlCache[cacheKey] = inner;
    return inner;
  }

  window.TourAiI18n = {
    t,
    tOr,
    getLocale,
    fetchLegalPageInnerHtml,
    isEnglishPath,
    SPANISH_LOCALE,
    ENGLISH_LOCALE,
  };
})();
