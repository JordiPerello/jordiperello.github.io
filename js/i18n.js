(function () {
  const STORAGE_KEY = "tourai-locale";
  const SPANISH_LOCALE = "es-ES";
  const ENGLISH_LOCALE = "en-GB";
  const config = window.TourAiSite?.config ?? {
    defaultLocale: SPANISH_LOCALE,
    supportedLocales: [SPANISH_LOCALE, ENGLISH_LOCALE],
  };
  const htmlDefaults = new WeakMap();

  const messages = {
    [SPANISH_LOCALE]: {},
    [ENGLISH_LOCALE]: {},
  };

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

  function getLocale() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "es") {
      localStorage.setItem(STORAGE_KEY, SPANISH_LOCALE);
      return SPANISH_LOCALE;
    }
    if (stored && config.supportedLocales.includes(stored)) {
      return stored;
    }
    const browser = navigator.language?.toLowerCase() ?? "";
    if (browser.startsWith("en")) {
      return ENGLISH_LOCALE;
    }
    return config.defaultLocale;
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

  /**
   * Lookup copy for a locale table. Returns null if the key is missing.
   * Both es-ES and en-GB must define keys used from JS.
   */
  function t(key, locale, vars) {
    syncLocaleMessages();
    const normalized = normalizeLocale(locale) || getLocale();
    const locales = [
      normalized,
      ...config.supportedLocales.filter((code) => code !== normalized),
    ];

    for (const code of locales) {
      const table = messages[code] ?? {};
      const value = table[key];
      if (value == null || value === "" || value === key) {
        continue;
      }
      return applyVars(value, vars);
    }

    return null;
  }

  function tOr(key, locale, vars, fallback) {
    return t(key, locale, vars) ?? fallback ?? "";
  }

  function applyStoreBadges(locale) {
    const badges = config.storeBadges;
    if (!badges) {
      return;
    }
    const normalized = normalizeLocale(locale);
    const localeKey = isSpanishLocale(normalized) ? SPANISH_LOCALE : ENGLISH_LOCALE;
    document.querySelectorAll("[data-store-badge]").forEach((img) => {
      const store = img.getAttribute("data-store-badge");
      const src = badges[store]?.[localeKey];
      if (src) {
        img.setAttribute("src", src);
      }
    });
  }

  function applyHtmlTranslations(locale) {
    document.querySelectorAll("[data-i18n-html]").forEach((element) => {
      const key = element.getAttribute("data-i18n-html");
      const translated = t(key, locale);
      if (translated) {
        element.innerHTML = translated;
      }
    });
  }

  function applyTranslations(locale) {
    syncLocaleMessages();
    const normalized = normalizeLocale(locale);
    document.documentElement.lang = isSpanishLocale(normalized) ? SPANISH_LOCALE : ENGLISH_LOCALE;

    const titleEl = document.querySelector("title");
    const titleKey = titleEl?.getAttribute("data-i18n-doc-title");
    if (titleEl && titleKey) {
      const translatedTitle = t(titleKey, normalized);
      if (translatedTitle) {
        titleEl.textContent = translatedTitle;
      }
    }

    document.querySelectorAll("meta[data-i18n-meta]").forEach((meta) => {
      const key = meta.getAttribute("data-i18n-meta");
      const translated = t(key, normalized);
      if (translated) {
        meta.setAttribute("content", translated);
      }
    });

    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.getAttribute("data-i18n");
      if (!key) {
        return;
      }
      const platform = element.getAttribute("data-i18n-platform");
      const translated = t(key, normalized, platform ? { platform } : undefined);
      if (translated) {
        element.textContent = translated;
      }
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      const key = element.getAttribute("data-i18n-placeholder");
      if (!key) {
        return;
      }
      const translated = t(key, normalized);
      if (translated) {
        element.setAttribute("placeholder", translated);
      }
    });

    document.querySelectorAll("[data-i18n-title]").forEach((element) => {
      const key = element.getAttribute("data-i18n-title");
      if (!key) {
        return;
      }
      const translated = t(key, normalized);
      if (translated) {
        element.setAttribute("title", translated);
      }
    });

    document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      const key = element.getAttribute("data-i18n-aria-label");
      if (!key) {
        return;
      }
      const translated = t(key, normalized);
      if (translated) {
        element.setAttribute("aria-label", translated);
      }
    });

    applyHtmlTranslations(normalized);
    applyStoreBadges(normalized);

    document.querySelectorAll("[data-set-locale]").forEach((button) => {
      const code = normalizeLocale(button.getAttribute("data-set-locale") ?? "");
      button.classList.toggle("active", code === normalized);
      button.setAttribute("aria-pressed", code === normalized ? "true" : "false");
    });
  }

  function setLocale(locale) {
    const normalized = normalizeLocale(locale);
    if (!config.supportedLocales.includes(normalized)) {
      return;
    }
    localStorage.setItem(STORAGE_KEY, normalized);
    applyTranslations(normalized);
    document.dispatchEvent(new CustomEvent("tourai:locale-changed", { detail: { locale: normalized } }));
  }

  function initLanguageSwitcher() {
    document.querySelectorAll("[data-set-locale]").forEach((button) => {
      button.addEventListener("click", () => {
        setLocale(button.getAttribute("data-set-locale"));
      });
    });
  }

  window.TourAiI18n = {
    t,
    tOr,
    getLocale,
    setLocale,
    applyTranslations,
    SPANISH_LOCALE,
    ENGLISH_LOCALE,
  };

  document.addEventListener("DOMContentLoaded", () => {
    initLanguageSwitcher();
    applyTranslations(getLocale());
  });

  document.addEventListener("tourai:locale-changed", (event) => {
    const platform = document.getElementById("platform")?.innerText;
    const intro = document.getElementById("modalIntro");
    if (intro && platform && window.TourAiI18n) {
      const locale = event.detail?.locale ?? window.TourAiI18n.getLocale();
      const translated = window.TourAiI18n.t("index.modal.text", locale, { platform });
      if (translated) {
        intro.textContent = translated;
      }
    }
  });
})();
