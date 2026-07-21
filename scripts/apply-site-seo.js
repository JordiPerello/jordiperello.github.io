const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const pages = [
  {
    file: "index.html",
    canonical: "https://tourai.es/",
    metaDescription:
      "TourAI: guía turística con inteligencia artificial. Chat, voz, mapas y audioguías para viajar a tu ritmo con la app TourAI.",
    i18nMeta: "doc.meta.index",
  },
  {
    file: "about.html",
    canonical: "https://tourai.es/about.html",
    metaDescription:
      "Conoce quién está detrás de TourAI, la aplicación de turismo inteligente con guías personalizadas e inteligencia artificial.",
    i18nMeta: "doc.meta.about",
  },
  {
    file: "contact.html",
    canonical: "https://tourai.es/contact.html",
    metaDescription:
      "Contacta con el equipo de TourAI para soporte técnico, consultas comerciales o información sobre la app de turismo inteligente.",
    i18nMeta: "doc.meta.contact",
  },
  {
    file: "cookies.html",
    canonical: "https://tourai.es/cookies.html",
    metaDescription:
      "Política de cookies de TourAI: cookies técnicas de la web y publicidad AdMob en la app.",
    i18nMeta: "doc.meta.cookies",
  },
  {
    file: "faq.html",
    canonical: "https://tourai.es/faq.html",
    metaDescription:
      "Preguntas frecuentes sobre TourAI: descarga, alertas de lanzamiento, privacidad, funciones de la app y soporte.",
    i18nMeta: "doc.meta.faq",
  },
  {
    file: "login.html",
    canonical: "https://tourai.es/login.html",
    metaDescription:
      "Inicia sesión en TourAI para acceder a tu cuenta, planes y zona privada en la web.",
    i18nMeta: "doc.meta.login",
  },
  {
    file: "privacy.html",
    canonical: "https://tourai.es/privacy.html",
    metaDescription:
      "Política de privacidad de TourAI: tratamiento de datos, geolocalización, publicidad, derechos GDPR y contacto.",
    i18nMeta: "doc.meta.privacy",
  },
  {
    file: "terms.html",
    canonical: "https://tourai.es/terms.html",
    metaDescription:
      "Términos y condiciones de uso de TourAI para la web y la aplicación móvil de turismo inteligente.",
    i18nMeta: "doc.meta.terms",
  },
];

function depthFor(file) {
  return file.split("/").length - 1;
}

function assetPrefix(depth) {
  return depth === 0 ? "" : "../".repeat(depth);
}

function cookieBannerMarkup(depth) {
  const prefix = assetPrefix(depth);
  return `
    <div id="cookie-banner" class="site-cookie-banner" hidden aria-live="polite">
        <div class="site-cookie-banner__inner">
            <p class="site-cookie-banner__text"><span data-i18n="cookie.text">Utilizamos cookies técnicas necesarias para el sitio (idioma y preferencias). Esta web no muestra publicidad.</span> <a href="${prefix}cookies.html" data-i18n="cookie.more">Más info</a>.</p>
            <div class="site-cookie-banner__actions">
                <button type="button" class="site-cookie-banner__reject" data-cookie-reject data-i18n="cookie.reject">Rechazar</button>
                <button type="button" class="site-cookie-banner__accept" data-cookie-accept data-i18n="cookie.accept">Aceptar</button>
            </div>
        </div>
    </div>
    <script src="${prefix}js/cookie-consent.js"></script>`;
}

function removeInlineConsentScript(content) {
  return content.replace(
    /\s*<script>\s*window\.dataLayer[\s\S]*?<\/script>\s*/i,
    "\n    "
  );
}

function removeLegacyCookieBanner(content) {
  let updated = content.replace(
    /\s*<div id="cookie-banner"[\s\S]*?<\/div>\s*(?=<script|<\/body>)/gi,
    "\n"
  );
  updated = updated.replace(
    /\s*<script>\s*const banner = document\.getElementById\('cookie-banner'\);[\s\S]*?<\/script>\s*/gi,
    "\n"
  );
  updated = updated.replace(
    /\s*<script>\s*const banner = document\.getElementById\("cookie-banner"\);[\s\S]*?<\/script>\s*/gi,
    "\n"
  );
  return updated;
}

function buildSeoExtras(page) {
  const description = page.metaDescription;
  const canonical = page.canonical;
  const isHome = page.file === "index.html";

  const organizationJson = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "TourAI",
    url: "https://tourai.es",
    logo: "https://tourai.es/img/tourai_logo.png",
    email: "info@tourai.es",
    founder: { "@type": "Person", name: "Jordi Perelló" },
    address: { "@type": "PostalAddress", addressCountry: "ES" },
  };

  const schemas = [organizationJson];
  if (isHome) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "TourAI",
      url: "https://tourai.es",
      inLanguage: ["es-ES", "en-GB"],
      publisher: { "@type": "Organization", name: "TourAI" },
    });
  }

  const jsonLd = schemas
    .map((entry) => `<script type="application/ld+json">${JSON.stringify(entry)}</script>`)
    .join("\n    ");

  return `
    <link rel="alternate" hreflang="es-ES" href="${canonical}">
    <link rel="alternate" hreflang="en-GB" href="${canonical}">
    <link rel="alternate" hreflang="x-default" href="${canonical}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="TourAI">
    <meta property="og:title" content="TourAI">
    <meta property="og:description" content="${description}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="https://tourai.es/img/tourai_logo.png">
    <meta property="og:locale" content="es_ES">
    <meta property="og:locale:alternate" content="en_GB">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="TourAI">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="https://tourai.es/img/tourai_logo.png">
    ${jsonLd}`;
}

function ensureHead(content, page) {
  const prefix = assetPrefix(depthFor(page.file));
  let updated = removeInlineConsentScript(content);

  if (!updated.includes("cookie-consent-init.js")) {
    updated = updated.replace(
      /<link rel="stylesheet" href="[^"]*site\.css">\s*/i,
      (match) =>
        `${match}    <script src="${prefix}js/cookie-consent-init.js"></script>\n`
    );
  }

  if (!updated.includes('rel="canonical"')) {
    updated = updated.replace(
      /<meta name="viewport"[^>]*>\s*/i,
      (match) => `${match}    <link rel="canonical" href="${page.canonical}">\n`
    );
  } else {
    updated = updated.replace(
      /<link rel="canonical" href="[^"]*">/i,
      `<link rel="canonical" href="${page.canonical}">`
    );
  }

  if (page.i18nMeta) {
    if (updated.includes('name="description"')) {
      updated = updated.replace(
        /<meta name="description" content="[^"]*"([^>]*)>/i,
        `<meta name="description" content="${page.metaDescription}"$1>`
      );
    } else {
      updated = updated.replace(
        /<meta name="viewport"[^>]*>\s*/i,
        (match) =>
          `${match}    <meta name="description" content="${page.metaDescription}" data-i18n-meta="${page.i18nMeta}">\n`
      );
    }
  }

  if (!updated.includes('hreflang="es-ES"')) {
    updated = updated.replace(
      /<link rel="canonical" href="[^"]*">\s*/i,
      (match) => `${match}${buildSeoExtras(page)}\n`
    );
  }

  return updated;
}

function ensureFooterScripts(content, page) {
  let updated = removeLegacyCookieBanner(content);
  const prefix = assetPrefix(depthFor(page.file));

  if (!updated.includes("js/cookie-consent.js")) {
    updated = updated.replace(
      /<\/body>/i,
      `${cookieBannerMarkup(depthFor(page.file))}\n</body>`
    );
  }

  if (!updated.includes("cookie-consent-init.js") && updated.includes("<head")) {
    updated = ensureHead(updated, page);
  }

  return updated;
}

for (const page of pages) {
  const filePath = path.join(root, page.file);
  let content = fs.readFileSync(filePath, "utf8");
  content = ensureHead(content, page);
  content = ensureFooterScripts(content, page);
  fs.writeFileSync(filePath, content, "utf8");
  console.log("Updated", page.file);
}
