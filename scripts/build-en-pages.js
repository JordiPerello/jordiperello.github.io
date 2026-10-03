/**
 * Generates /en/ from root HTML. Static copy: edit Spanish HTML, then run:
 *   node scripts/sync-static-site.js
 * (or build-en-pages.js only if templates still carry data-i18n — prefer sync-static-site.)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  loadLocaleMessages,
  bakeMessagesIntoHtml,
  stripI18nAttributes,
  setSingleLocaleScripts,
} = require("./i18n-html-bake-lib");

const ROOT = path.resolve(__dirname, "..");
const EN_DIR = path.join(ROOT, "en");
const SITE = "https://tourai.es";
const SKIP = /^google/i;

const PUBLIC_SITEMAP = [
  "index.html",
  "about.html",
  "community.html",
  "reviews.html",
  "contact.html",
  "faq.html",
  "whats-new.html",
  "cookies.html",
  "privacy.html",
  "terms.html",
];

const FILE_KEY = {
  "delete-account": "deleteAccount",
  "reset-password": "resetPassword",
  "whats-new": "whatsNew",
};

function messageKey(file) {
  const base = file.replace(/\.html$/i, "");
  return FILE_KEY[base] || base;
}

function urlsForFile(file) {
  if (file === "index.html") {
    return { es: `${SITE}/`, en: `${SITE}/en/` };
  }
  return { es: `${SITE}/${file}`, en: `${SITE}/en/${file}` };
}

function extractQuoted(src, key) {
  const re = new RegExp(
    `"${key.replace(/\./g, "\\.")}":\\s*(?:\`([^\`]*)\`|"((?:\\\\.|[^"\\\\])*)")`
  );
  const m = src.match(re);
  if (!m) {
    return "";
  }
  return (m[1] != null ? m[1] : m[2] || "").replace(/\\"/g, '"');
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}

function stripHreflang(html) {
  return html.replace(/\s*<link rel="alternate" hreflang="[^"]+" href="[^"]+"\s*>/g, "");
}

function hreflangBlock(esUrl, enUrl) {
  return [
    "",
    `    <link rel="alternate" hreflang="es-ES" href="${esUrl}">`,
    `    <link rel="alternate" hreflang="en-GB" href="${enUrl}">`,
    `    <link rel="alternate" hreflang="x-default" href="${esUrl}">`,
  ].join("\n");
}

function injectHreflang(html, esUrl, enUrl) {
  const cleaned = stripHreflang(html);
  if (!/<link rel="canonical" href="[^"]+"\s*>/.test(cleaned)) {
    return cleaned;
  }
  return cleaned.replace(
    /<link rel="canonical" href="[^"]+"\s*>/,
    (match) => match + hreflangBlock(esUrl, enUrl)
  );
}

function pagePath(file, english) {
  if (file === "index.html") {
    return english ? "/en/" : "/";
  }
  return english ? "/en/" + file : "/" + file;
}

function langSwitchHtml(file, englishPage) {
  const esHref = pagePath(file, false);
  const enHref = pagePath(file, true);
  const imgPrefix = englishPage ? "../" : "";
  const groupLabel = englishPage ? "Language" : "Idioma";
  const esLabel = englishPage ? "Spanish" : "Español";
  const enLabel = englishPage ? "English" : "Inglés";
  const esActive = englishPage ? "" : ' class="active" aria-current="page"';
  const enActive = englishPage ? ' class="active" aria-current="page"' : "";
  return `            <div class="lang-switch" role="group" aria-label="${groupLabel}">
                <a href="${esHref}" hreflang="es-ES" lang="es-ES"${esActive} title="${esLabel}" aria-label="${esLabel}">
                    <img src="${imgPrefix}img/lang/icon_spanish_flag.png" alt="" width="28" height="28" decoding="async">
                </a>
                <a href="${enHref}" hreflang="en-GB" lang="en-GB"${enActive} title="${enLabel}" aria-label="${enLabel}">
                    <img src="${imgPrefix}img/lang/icon_united_kingdom_flag.png" alt="" width="28" height="28" decoding="async">
                </a>
            </div>`;
}

function replaceLangSwitch(html, file, englishPage) {
  if (!/<div class="lang-switch"/.test(html)) {
    return html;
  }
  return html.replace(/<div class="lang-switch"[\s\S]*?<\/div>/, langSwitchHtml(file, englishPage));
}

function rewriteAssets(html) {
  return html.replace(/(href|src)="(?!https?:|mailto:|#)(css|js|img)\//g, '$1="../$2/');
}

function replaceAttrContent(html, attrNeedle, value) {
  if (!value) {
    return html;
  }
  const escaped = escapeAttr(value);
  const re = new RegExp(`(${attrNeedle}=")[^"]*(")`, "g");
  return html.replace(re, `$1${escaped}$2`);
}

function applyEnglishMeta(html, file, enGbSrc) {
  const key = messageKey(file);
  const title = extractQuoted(enGbSrc, `doc.title.${key}`);
  const desc = extractQuoted(enGbSrc, `doc.meta.${key}`);
  let out = html.replace(/<html lang="es-ES">/, '<html lang="en-GB">');
  if (title) {
    out = out.replace(/<title([^>]*)>[\s\S]*?<\/title>/, `<title$1>${title}</title>`);
    out = replaceAttrContent(out, 'property="og:title" content', title);
    out = replaceAttrContent(out, 'name="twitter:title" content', title);
  }
  if (desc) {
    out = replaceAttrContent(out, 'name="description" content', desc);
    out = replaceAttrContent(out, 'property="og:description" content', desc);
    out = replaceAttrContent(out, 'name="twitter:description" content', desc);
  }
  out = out.replace(
    /<meta property="og:locale" content="es_ES">/,
    '<meta property="og:locale" content="en_GB">'
  );
  out = out.replace(
    /<meta property="og:locale:alternate" content="en_GB">/,
    '<meta property="og:locale:alternate" content="es_ES">'
  );
  return out;
}

function applyEnglishShell(html, file) {
  const { es, en } = urlsForFile(file);
  let out = html;
  out = rewriteAssets(out);
  out = out.replace(
    /<link rel="canonical" href="https:\/\/tourai\.es\/[^"]*"\s*>/,
    `<link rel="canonical" href="${en}">`
  );
  out = out.replace(
    /<meta property="og:url" content="https:\/\/tourai\.es\/[^"]*"\s*>/,
    `<meta property="og:url" content="${en}">`
  );
  out = injectHreflang(out, es, en);
  out = replaceLangSwitch(out, file, true);
  out = stripI18nAttributes(out);
  out = setSingleLocaleScripts(out, "en-GB.js");
  return out;
}

/** First-time or legacy templates: translate body from data-i18n + en-GB table. */
function toEnglishPage(html, file, enGbSrc, messages) {
  let out = applyEnglishShell(html, file);
  out = out.replace(/<html lang="es-ES">/, '<html lang="en-GB">');
  out = applyEnglishMeta(out, file, enGbSrc);
  out = bakeMessagesIntoHtml(out, messages);
  out = stripI18nAttributes(out);
  out = setSingleLocaleScripts(out, "en-GB.js");
  if (!out.includes("Generated by scripts/build-en-pages.js")) {
    out = out.replace(
      "<!DOCTYPE html>",
      "<!DOCTYPE html>\n<!-- Generated by scripts/build-en-pages.js from the Spanish page. Do not edit by hand. -->"
    );
  }
  return out;
}

/** Baked English pages: refresh SEO shell only; body copy stays in en/*.html. */
function refreshEnglishPage(html, file) {
  let out = applyEnglishShell(html, file);
  if (!out.includes('lang="en-GB"')) {
    out = out.replace(/<html lang="[^"]*">/, '<html lang="en-GB">');
  }
  return out;
}

function writeUtf8(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: "utf8" });
}

function sitemapXml(files) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ];
  for (const file of files) {
    const { es, en } = urlsForFile(file);
    lines.push("  <url>");
    lines.push(`    <loc>${es}</loc>`);
    lines.push(`    <xhtml:link rel="alternate" hreflang="es-ES" href="${es}"/>`);
    lines.push(`    <xhtml:link rel="alternate" hreflang="en-GB" href="${en}"/>`);
    lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${es}"/>`);
    lines.push("  </url>");
    lines.push("  <url>");
    lines.push(`    <loc>${en}</loc>`);
    lines.push(`    <xhtml:link rel="alternate" hreflang="es-ES" href="${es}"/>`);
    lines.push(`    <xhtml:link rel="alternate" hreflang="en-GB" href="${en}"/>`);
    lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${es}"/>`);
    lines.push("  </url>");
  }
  lines.push("</urlset>");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const enGbPath = path.join(ROOT, "js", "locales", "en-GB.js");
  const enGbSrc = fs.readFileSync(enGbPath, "utf8");
  const messages = loadLocaleMessages(enGbPath);
  fs.mkdirSync(EN_DIR, { recursive: true });

  const htmlFiles = fs
    .readdirSync(ROOT)
    .filter((name) => name.endsWith(".html") && !SKIP.test(name))
    .sort();

  for (const file of htmlFiles) {
    const { es, en } = urlsForFile(file);
    let source = fs.readFileSync(path.join(ROOT, file), "utf8");
    source = injectHreflang(source, es, en);
    source = replaceLangSwitch(source, file, false);
    writeUtf8(path.join(ROOT, file), source);
    const enPath = path.join(EN_DIR, file);
    const hasBakedEnglish =
      fs.existsSync(enPath) &&
      !/data-i18n/.test(fs.readFileSync(enPath, "utf8"));
    const enOut = hasBakedEnglish
      ? refreshEnglishPage(fs.readFileSync(enPath, "utf8"), file)
      : toEnglishPage(source, file, enGbSrc, messages);
    writeUtf8(enPath, enOut);
  }

  writeUtf8(path.join(ROOT, "sitemap.xml"), sitemapXml(PUBLIC_SITEMAP));
  console.log(`Wrote ${htmlFiles.length} English pages under en/ and updated sitemap.xml`);
}

main();
