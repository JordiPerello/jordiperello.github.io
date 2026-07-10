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
    file: "blog.html",
    canonical: "https://tourai.es/blog.html",
    metaDescription:
      "Blog de TourAI: guías de viaje, consejos de turismo inteligente, destinos y novedades sobre nuestra app con inteligencia artificial.",
    i18nMeta: "doc.meta.blog",
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
      "Política de cookies de TourAI: tipos de cookies, publicidad responsable, Google AdSense y cómo gestionar tu consentimiento.",
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
    file: "guides.html",
    canonical: "https://tourai.es/guides.html",
    metaDescription:
      "Audioguías inteligentes de TourAI: narraciones por GPS, contenido curado e inteligencia artificial para explorar ciudades.",
    i18nMeta: "doc.meta.guides",
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
  {
    file: "targets.html",
    canonical: "https://tourai.es/targets.html",
    metaDescription:
      "Destinos TourAI 2026: rutas recomendadas y tendencias de viaje para planificar tu próximo viaje.",
    i18nMeta: "doc.meta.targets",
  },
  {
    file: "articles/what-is-tourai.html",
    canonical: "https://tourai.es/articles/what-is-tourai.html",
    metaDescription:
      "Descubre qué es TourAI, cómo funciona su guía turística con IA y qué la diferencia de una app de mapas convencional.",
    i18nMeta: "doc.meta.what-is-tourai",
  },
  {
    file: "articles/plan-trip-with-ai.html",
    canonical: "https://tourai.es/articles/plan-trip-with-ai.html",
    metaDescription:
      "Guía práctica para planificar un viaje con inteligencia artificial: itinerarios, presupuesto, documentación y consejos.",
    i18nMeta: "doc.meta.plan-trip-with-ai",
  },
  {
    file: "articles/audio-guides-vs-group-tours.html",
    canonical: "https://tourai.es/articles/audio-guides-vs-group-tours.html",
    metaDescription:
      "Comparativa entre audioguías móviles y tours en grupo: libertad, precio, profundidad cultural y cuándo elegir cada opción.",
    i18nMeta: "doc.meta.audio-guides-vs-group-tours",
  },
  {
    file: "articles/kyoto-7-days.html",
    canonical: "https://tourai.es/articles/kyoto-7-days.html",
    metaDescription:
      "Itinerario de 7 días en Kioto para viajeros independientes: templos, Gion, Arashiyama, Nara y consejos de temporada.",
    i18nMeta: "doc.meta.kyoto-7-days",
  },
  {
    file: "articles/visit-monuments-without-crowds.html",
    canonical: "https://tourai.es/articles/visit-monuments-without-crowds.html",
    metaDescription:
      "Consejos prácticos para visitar monumentos y museos sin aglomeraciones: horarios, reservas, rutas alternativas y tecnología.",
    i18nMeta: "doc.meta.visit-monuments-without-crowds",
  },
  {
    file: "articles/mobile-travel-gps-privacy.html",
    canonical: "https://tourai.es/articles/mobile-travel-gps-privacy.html",
    metaDescription:
      "Guía para viajar con el móvil: datos, GPS, eSIM, ahorro de batería y privacidad de ubicación en el extranjero.",
    i18nMeta: "doc.meta.mobile-travel-gps-privacy",
  },
  {
    file: "articles/lisbon-algarve-spring.html",
    canonical: "https://tourai.es/articles/lisbon-algarve-spring.html",
    metaDescription:
      "Escapada de primavera a Lisboa y el Algarve: barrios, playas, gastronomía y ruta de cinco días por Portugal.",
    i18nMeta: "doc.meta.lisbon-algarve-spring",
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
            <p class="site-cookie-banner__text"><span data-i18n="cookie.text">Utilizamos cookies para mejorar tu experiencia.</span> <a href="${prefix}cookies.html" data-i18n="cookie.more">Más info</a>.</p>
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
