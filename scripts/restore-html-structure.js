/**
 * Restore structural attributes (href, onclick, class, id, …) from last committed HTML
 * while keeping data-i18n* element bodies empty (copy lives in locale files).
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");

function decodeHtmlBuffer(buf) {
  let text = buf.toString("utf8");
  if (text.includes("�")) {
    text = buf.toString("latin1");
  }
  return text;
}

function emptyI18nBodies(html) {
  html = html.replace(
    /<([a-z0-9]+)([^>]*\bdata-i18n="[^"]+"[^>]*)>([\s\S]*?)<\/\1>/gi,
    (all, tag, attrs, inner) => {
      if (/<[a-z]/i.test(inner) && !/^(\s|<br\s*\/?>\s*)*$/i.test(inner)) {
        return all;
      }
      return `<${tag}${attrs}></${tag}>`;
    }
  );
  html = html.replace(
    /(<([a-z0-9]+)[^>]*\bdata-i18n-html="[^"]+"[^>]*)>[\s\S]*?<\/\2>/gi,
    "$1></$2>"
  );
  html = html.replace(
    /(\bdata-i18n-placeholder="[^"]+"[^>]*\bplaceholder=")([^"]*)(")/gi,
    "$1$3"
  );
  html = html.replace(
    /(\bplaceholder=")([^"]*)("[^>]*\bdata-i18n-placeholder=")/gi,
    "$1$3"
  );
  html = html.replace(
    /(<title[^>]*data-i18n-doc-title="[^"]*"[^>]*>)[\s\S]*?(<\/title>)/gi,
    "$1$2"
  );
  html = html.replace(
    /(<meta[^>]*data-i18n-meta="[^"]*"[^>]*\bcontent=")([^"]*)(")/gi,
    "$1$3"
  );
  return html;
}

function applyLangAndUiAttrs(html) {
  html = html.replace(
    /data-set-locale="es-ES" aria-label="[^"]*" title="[^"]*"/g,
    'data-set-locale="es-ES" data-i18n-aria-label="lang.es" data-i18n-title="lang.es" aria-label="" title=""'
  );
  html = html.replace(
    /data-set-locale="en-GB" aria-label="[^"]*" title="[^"]*"/g,
    'data-set-locale="en-GB" data-i18n-aria-label="lang.en" data-i18n-title="lang.en" aria-label="" title=""'
  );
  html = html.replace(
    /class="floating-logo" onclick="window.scrollTo\(0,0\)" title="[^"]*"/g,
    'class="floating-logo" onclick="window.scrollTo(0,0)" data-i18n-title="ui.backToTop" title=""'
  );
  html = html.replace(
    /title="Color de texto"/g,
    'data-i18n-title="community.editor.textColor" title=""'
  );
  html = html.replace(/title="Tamaño"/g, 'data-i18n-title="community.editor.size" title=""');
  html = html.replace(
    /aria-label="Tamaño de letra"/g,
    'data-i18n-aria-label="community.editor.fontSize" aria-label=""'
  );
  html = html.replace(
    /aria-label="Foto de perfil[^"]*"/g,
    'data-i18n-aria-label="account.edit.photo.aria" aria-label=""'
  );
  // Close buttons
  html = html.replace(
    /aria-label="Cerrar"/g,
    'data-i18n-aria-label="account.edit.cancel" aria-label=""'
  );
  return html;
}

const files = execSync("git ls-files *.html", { cwd: root, encoding: "utf8" })
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);

for (const file of files) {
  const buf = execSync(`git show HEAD:${file}`, {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 20 * 1024 * 1024,
  });
  let html = decodeHtmlBuffer(buf);

  // Ensure es-ES locale script exists (may not be in HEAD)
  if (!html.includes("js/locales/es-ES.js") && html.includes("js/locales/en-GB.js")) {
    html = html.replace(
      '<script src="js/locales/en-GB.js"></script>',
      '<script src="js/locales/es-ES.js"></script>\n    <script src="js/locales/en-GB.js"></script>'
    );
  }

  html = emptyI18nBodies(html);
  html = applyLangAndUiAttrs(html);

  // Clear corrupted modalIntro leftover text if present
  html = html.replace(
    /(<p id="modalIntro"[^>]*>)[\s\S]*?(<\/p>)/i,
    '$1</p>'
  );

  fs.writeFileSync(path.join(root, file), html, "utf8");
  console.log("restored+stripped", file);
}
