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
    [ENGLISH_LOCALE]: window.TourAiEnGBMessages ?? {},
  };

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

  function t(key, locale, vars) {
    const normalized = normalizeLocale(locale);
    if (isSpanishLocale(normalized)) {
      return null;
    }
    const table = messages[ENGLISH_LOCALE] ?? {};
    let value = table[key];
    if (!value) {
      return null;
    }
    if (vars) {
      Object.keys(vars).forEach((name) => {
        value = value.replace(`{${name}}`, vars[name]);
      });
    }
    return value;
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
      if (!htmlDefaults.has(element)) {
        htmlDefaults.set(element, element.innerHTML);
      }
      if (isSpanishLocale(locale)) {
        element.innerHTML = htmlDefaults.get(element);
        return;
      }
      const key = element.getAttribute("data-i18n-html");
      const translated = t(key, locale);
      if (translated) {
        element.innerHTML = translated;
      }
    });
  }

  function applyTranslations(locale) {
    const normalized = normalizeLocale(locale);
    document.documentElement.lang = isSpanishLocale(normalized) ? SPANISH_LOCALE : ENGLISH_LOCALE;

    const titleKey = document.querySelector("title")?.getAttribute("data-i18n-doc-title");
    if (titleKey) {
      const translatedTitle = isSpanishLocale(normalized)
        ? document.querySelector("title")?.getAttribute("data-default-title") || document.title
        : t(titleKey, normalized);
      if (translatedTitle && normalized === ENGLISH_LOCALE) {
        if (!document.querySelector("title")?.getAttribute("data-default-title")) {
          document.querySelector("title")?.setAttribute("data-default-title", document.title);
        }
        document.title = translatedTitle;
      } else if (isSpanishLocale(normalized)) {
        const defaultTitle = document.querySelector("title")?.getAttribute("data-default-title");
        if (defaultTitle) {
          document.title = defaultTitle;
        }
      }
    }

    document.querySelectorAll("meta[data-i18n-meta]").forEach((meta) => {
      if (!meta.getAttribute("data-default-content")) {
        meta.setAttribute("data-default-content", meta.getAttribute("content") ?? "");
      }
      const key = meta.getAttribute("data-i18n-meta");
      if (isSpanishLocale(normalized)) {
        meta.setAttribute("content", meta.getAttribute("data-default-content") ?? "");
      } else {
        const translated = t(key, normalized);
        if (translated) {
          meta.setAttribute("content", translated);
        }
      }
    });

    document.querySelectorAll("[data-i18n]").forEach((element) => {
      if (!element.getAttribute("data-default-text")) {
        element.setAttribute("data-default-text", element.textContent ?? "");
      }
      const key = element.getAttribute("data-i18n");
      if (!key) {
        return;
      }
      if (isSpanishLocale(normalized)) {
        element.textContent = element.getAttribute("data-default-text") ?? "";
        return;
      }
      const platform = element.getAttribute("data-i18n-platform");
      const translated = t(key, normalized, platform ? { platform } : undefined);
      if (translated) {
        element.textContent = translated;
      }
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      if (!element.getAttribute("data-default-placeholder")) {
        element.setAttribute("data-default-placeholder", element.getAttribute("placeholder") ?? "");
      }
      const key = element.getAttribute("data-i18n-placeholder");
      if (!key) {
        return;
      }
      if (isSpanishLocale(normalized)) {
        element.setAttribute("placeholder", element.getAttribute("data-default-placeholder") ?? "");
        return;
      }
      const translated = t(key, normalized);
      if (translated) {
        element.setAttribute("placeholder", translated);
      }
    });

    document.querySelectorAll("[data-i18n-title]").forEach((element) => {
      if (!element.getAttribute("data-default-title-attr")) {
        element.setAttribute("data-default-title-attr", element.getAttribute("title") ?? "");
      }
      const key = element.getAttribute("data-i18n-title");
      if (!key) {
        return;
      }
      if (isSpanishLocale(normalized)) {
        element.setAttribute("title", element.getAttribute("data-default-title-attr") ?? "");
        return;
      }
      const translated = t(key, normalized);
      if (translated) {
        element.setAttribute("title", translated);
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
      const template = intro.getAttribute("data-default-text") ?? intro.textContent ?? "";
      if (locale === ENGLISH_LOCALE) {
        const translated = window.TourAiI18n.t("index.modal.text", locale, { platform });
        intro.textContent = (translated ?? template).replace("{platform}", platform);
      } else {
        intro.textContent = template.replace("{platform}", platform);
      }
    }
  });
})();
