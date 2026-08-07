/**
 * Finish i18n migration:
 * - Clear remaining user-facing copy from HTML (meta/og/twitter, aria, titles, modalIntro)
 * - Wire data-i18n-* attrs where missing
 * - Harvest JS string fallbacks into locale tables, then strip them from source
 * - Keep structural attrs and dashboard checkout markup intact (operates on working tree)
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function loadMessages(file, globalName) {
  const code = fs.readFileSync(path.join(root, file), "utf8");
  globalThis.window = globalThis;
  return Function(`${code}; return window.${globalName};`)();
}

function escapeJsString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

function serializeMessages(globalName, header, obj) {
  const keys = Object.keys(obj).sort();
  const lines = keys.map((key) => {
    const val = obj[key];
    if (typeof val === "string" && (val.includes("\n") || val.includes("'") || val.includes('"'))) {
      return `  ${JSON.stringify(key)}: \`${escapeJsString(val)}\`,`;
    }
    return `  ${JSON.stringify(key)}: ${JSON.stringify(val)},`;
  });
  return `${header}\nwindow.${globalName} = {\n${lines.join("\n")}\n};\n`;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function looksCorrupted(s) {
  return /�/.test(s) || /versi.?n \{platform\}/.test(s);
}

/** Extract t("key","fallback") pairs from JS (and inline HTML scripts). */
function harvestFallbacks(code) {
  const map = {};
  const patterns = [
    /\b(?:t|tOr|tContact|tDelete)\(\s*(["'])([^"'\\]+)\1\s*,\s*(["'])((?:\\.|[^\\])*?)\3/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(code))) {
      const key = m[2];
      let val = m[4]
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n");
      if (!val || val === key) continue;
      if (looksCorrupted(val)) continue;
      if (!map[key] || val.length > map[key].length) map[key] = val;
    }
  }
  return map;
}

function stripFallbacks(code) {
  let count = 0;
  // t("key", "fallback") → t("key")
  // t("key", "fallback", vars) → t("key", vars)  — rare; auth wrappers use (key, fallback, vars)
  // Safer: only strip when 2nd arg is string literal and there is no 3rd arg, OR 3rd is object via separate pass

  code = code.replace(
    /\b(t|tOr|tContact|tDelete)\(\s*(["'])([^"'\\]+)\2\s*,\s*(["'])((?:\\.|[^\\])*?)\4(\s*\))/g,
    (all, fn, q1, key, _q2, _fb, close) => {
      count += 1;
      return `${fn}(${q1}${key}${q1}${close}`;
    }
  );

  // t(key, "fallback", varsObj) → t(key, varsObj) when third arg is identifier/object start
  code = code.replace(
    /\b(t|tOr|tContact|tDelete)\(\s*(["'])([^"'\\]+)\2\s*,\s*(["'])((?:\\.|[^\\])*?)\4\s*,\s*(?=\{|[a-zA-Z_$])/g,
    (all, fn, q1, key) => {
      count += 1;
      return `${fn}(${q1}${key}${q1}, `;
    }
  );

  // tOr("key", "fallback", vars) same
  return { code, count };
}

const EXTRA_ES = {
  "ui.close": "Cerrar",
  "lang.switcher": "Idioma",
  "community.tabs.aria": "Secciones",
  "community.toolbar.format": "Formato",
  "community.rte.bold": "Negrita",
  "community.rte.italic": "Cursiva",
  "community.rte.underline": "Subrayado",
  "community.rte.emoji": "Emoticonos",
  "community.search.submit": "Buscar",
  "community.search.placeholder": "Buscar por título, autor o texto...",
  "community.editor.size": "Tamaño",
  "community.editor.fontSize": "Tamaño de letra",
  "community.editor.textColor": "Color de texto",
  "account.subnav.aria": "Cuenta",
  "reviews.stars.aria": "Estrellas",
  "reviews.comment.edit": "Editar comentario",
  "loading.processing": "Procesando...",
};

const EXTRA_EN = {
  "ui.close": "Close",
  "lang.switcher": "Language",
  "community.tabs.aria": "Sections",
  "community.toolbar.format": "Formatting",
  "community.rte.bold": "Bold",
  "community.rte.italic": "Italic",
  "community.rte.underline": "Underline",
  "community.rte.emoji": "Emoji",
  "community.search.submit": "Search",
  "community.editor.size": "Size",
  "community.editor.fontSize": "Font size",
  "community.editor.textColor": "Text colour",
  "account.subnav.aria": "Account",
  "reviews.stars.aria": "Stars",
  "reviews.comment.edit": "Edit comment",
  "loading.processing": "Processing...",
};

function cleanHtml(html, file) {
  let out = html;

  // Empty meta[data-i18n-meta] content
  out = out.replace(
    /(<meta[^>]*\bdata-i18n-meta="([^"]+)"[^>]*\bcontent=")([^"]*)(")/gi,
    "$1$4"
  );
  out = out.replace(
    /(<meta[^>]*\bcontent=")([^"]*)("[^>]*\bdata-i18n-meta="([^"]+)"[^>]*)/gi,
    "$1$3"
  );

  // Wire og/twitter description to same doc.meta key when description meta exists
  const metaMatch = out.match(/data-i18n-meta="(doc\.meta\.[^"]+)"/);
  const titleMatch = out.match(/data-i18n-doc-title="(doc\.title\.[^"]+)"/);
  const metaKey = metaMatch?.[1];
  const titleKey = titleMatch?.[1];

  if (metaKey) {
    out = out.replace(
      /(<meta\s+property="og:description"\s+content=")([^"]*)(")/gi,
      `$1$3 data-i18n-meta="${metaKey}"`
    );
    out = out.replace(
      /(<meta\s+name="twitter:description"\s+content=")([^"]*)(")/gi,
      `$1$3 data-i18n-meta="${metaKey}"`
    );
  }
  if (titleKey) {
    out = out.replace(
      /(<meta\s+property="og:title"\s+content=")([^"]*)(")/gi,
      (all, a, content, c) => {
        if (content === "TourAI") return all; // brand-only titles stay
        return `${a}${c} data-i18n-meta="${titleKey}"`;
      }
    );
    out = out.replace(
      /(<meta\s+name="twitter:title"\s+content=")([^"]*)(")/gi,
      (all, a, content, c) => {
        if (content === "TourAI") return all;
        return `${a}${c} data-i18n-meta="${titleKey}"`;
      }
    );
  }

  // Clear remaining Spanish og/twitter when no key wired yet (empty content)
  out = out.replace(
    /(<meta\s+property="og:description"\s+content=")([^"]+)(")/gi,
    (all, a, content, c) => {
      if (content === "TourAI" || !/[A-Za-záéíóúñÁÉÍÓÚÑ¿¡�]/.test(content)) return all;
      if (/data-i18n-meta=/.test(all)) return `${a}${c}`;
      return `${a}${c}`;
    }
  );
  out = out.replace(
    /(<meta\s+name="twitter:description"\s+content=")([^"]+)(")/gi,
    (all, a, content, c) => `${a}${c}`
  );
  out = out.replace(
    /(<meta\s+property="og:title"\s+content=")((?!TourAI")[^"]+)(")/gi,
    (all, a, content, c) => {
      if (/data-i18n-meta=/.test(all)) return `${a}${c}`;
      if (titleKey) return `${a}${c} data-i18n-meta="${titleKey}"`;
      return `${a}${c}`;
    }
  );
  out = out.replace(
    /(<meta\s+name="twitter:title"\s+content=")((?!TourAI")[^"]+)(")/gi,
    (all, a, content, c) => {
      if (/data-i18n-meta=/.test(all)) return `${a}${c}`;
      if (titleKey) return `${a}${c} data-i18n-meta="${titleKey}"`;
      return `${a}${c}`;
    }
  );

  // modalIntro: no default Spanish
  out = out.replace(
    /<p id="modalIntro"[^>]*>[\s\S]*?<\/p>/gi,
    '<p id="modalIntro"></p>'
  );

  // lang switcher group
  out = out.replace(
    /role="group" aria-label="Language"/g,
    'role="group" data-i18n-aria-label="lang.switcher" aria-label=""'
  );

  // Generic close buttons
  out = out.replace(
    /aria-label="Cerrar"/g,
    'data-i18n-aria-label="ui.close" aria-label=""'
  );
  out = out.replace(
    /class="close" role="button" aria-label="[^"]*"/g,
    'class="close" role="button" data-i18n-aria-label="ui.close" aria-label=""'
  );

  // Account
  out = out.replace(
    /role="tablist" aria-label="Cuenta"/g,
    'role="tablist" data-i18n-aria-label="account.subnav.aria" aria-label=""'
  );

  // Community / reviews editor chrome
  out = out.replace(
    /role="tablist" aria-label="Secciones"/g,
    'role="tablist" data-i18n-aria-label="community.tabs.aria" aria-label=""'
  );
  out = out.replace(
    /role="toolbar" aria-label="Formato"/g,
    'role="toolbar" data-i18n-aria-label="community.toolbar.format" aria-label=""'
  );
  out = out.replace(
    /title="Negrita" aria-label="Negrita"/g,
    'data-i18n-title="community.rte.bold" data-i18n-aria-label="community.rte.bold" title="" aria-label=""'
  );
  out = out.replace(
    /title="Cursiva" aria-label="Cursiva"/g,
    'data-i18n-title="community.rte.italic" data-i18n-aria-label="community.rte.italic" title="" aria-label=""'
  );
  out = out.replace(
    /title="Subrayado" aria-label="Subrayado"/g,
    'data-i18n-title="community.rte.underline" data-i18n-aria-label="community.rte.underline" title="" aria-label=""'
  );
  out = out.replace(
    /title="Emoticonos" aria-label="Emoticonos"/g,
    'data-i18n-title="community.rte.emoji" data-i18n-aria-label="community.rte.emoji" title="" aria-label=""'
  );
  out = out.replace(
    / title="Tama[^"]*" aria-label="Tama[^"]*"/gi,
    ' data-i18n-title="community.editor.size" data-i18n-aria-label="community.editor.fontSize" title="" aria-label=""'
  );
  // corrupted encoding variants (Tama�o)
  out = out.replace(
    / title="Tama.o" aria-label="Tama.o de letra"/gi,
    ' data-i18n-title="community.editor.size" data-i18n-aria-label="community.editor.fontSize" title="" aria-label=""'
  );
  out = out.replace(
    /aria-label="Buscar"/g,
    'data-i18n-aria-label="community.search.submit" aria-label=""'
  );
  out = out.replace(
    /role="group" aria-label="Estrellas"/g,
    'role="group" data-i18n-aria-label="reviews.stars.aria" aria-label=""'
  );
  out = out.replace(
    /title="Editar comentario" aria-label="Editar comentario"/g,
    'data-i18n-title="reviews.comment.edit" data-i18n-aria-label="reviews.comment.edit" title="" aria-label=""'
  );

  // Empty data-i18n-meta content again after wiring
  out = out.replace(
    /(<meta[^>]*\bdata-i18n-meta="[^"]+"[^>]*\bcontent=")([^"]*)(")/gi,
    "$1$3"
  );
  out = out.replace(
    /(<meta[^>]*\bcontent=")([^"]*)("[^>]*\bdata-i18n-meta="[^"]+"[^>]*)/gi,
    "$1$3"
  );

  // Empty titles with data-i18n-doc-title
  out = out.replace(
    /(<title[^>]*data-i18n-doc-title="[^"]*"[^>]*>)[\s\S]*?(<\/title>)/gi,
    "$1$2"
  );

  // Empty simple data-i18n bodies (text-only)
  out = out.replace(
    /<([a-z0-9]+)([^>]*\bdata-i18n="[^"]+"[^>]*)>([\s\S]*?)<\/\1>/gi,
    (all, tag, attrs, inner) => {
      if (/<[a-z]/i.test(inner) && !/^(\s|<br\s*\/?>\s*)*$/i.test(inner)) return all;
      return `<${tag}${attrs}></${tag}>`;
    }
  );
  out = out.replace(
    /<([a-z0-9]+)([^>]*\bdata-i18n-html="[^"]+"[^>]*)>[\s\S]*?<\/\1>/gi,
    "<$1$2></$1>"
  );
  out = out.replace(
    /(\bdata-i18n-placeholder="[^"]+"[^>]*\bplaceholder=")([^"]*)(")/gi,
    "$1$3"
  );
  out = out.replace(
    /(\bplaceholder=")([^"]*)("[^>]*\bdata-i18n-placeholder=")/gi,
    "$1$3"
  );

  return out;
}

function walkJsFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "locales") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJsFiles(full, acc);
    else if (entry.name.endsWith(".js")) acc.push(full);
  }
  return acc;
}

// --- main ---
const es = loadMessages("js/locales/es-ES.js", "TourAiEsESMessages");
const en = loadMessages("js/locales/en-GB.js", "TourAiEnGBMessages");

const harvested = {};
const jsFiles = walkJsFiles(path.join(root, "js"));
const htmlFiles = fs.readdirSync(root).filter((f) => f.endsWith(".html"));

for (const file of [...jsFiles, ...htmlFiles.map((f) => path.join(root, f))]) {
  const code = fs.readFileSync(file, "utf8");
  Object.assign(harvested, harvestFallbacks(code));
}

let addedEs = 0;
let addedEn = 0;
for (const [k, v] of Object.entries(EXTRA_ES)) {
  if (!es[k] || es[k] === k || looksCorrupted(es[k]) || (en[k] && es[k] === en[k] && v !== en[k])) {
    es[k] = v;
    addedEs += 1;
  }
}
for (const [k, v] of Object.entries(EXTRA_EN)) {
  if (!en[k]) {
    en[k] = v;
    addedEn += 1;
  }
}
for (const [k, v] of Object.entries(harvested)) {
  if (!es[k] || es[k] === en[k]) {
    // Prefer harvested Spanish when es was EN-copy or missing
    if (!es[k] || (en[k] && es[k] === en[k] && v !== en[k])) {
      if (!looksCorrupted(v)) {
        es[k] = v;
        addedEs += 1;
      }
    }
  }
  if (!en[k]) {
    // If we only have Spanish, leave a marker — copy ES temporarily so parity holds
    en[k] = v;
    addedEn += 1;
  }
}

// Ensure key parity
for (const k of Object.keys(es)) {
  if (en[k] == null) en[k] = es[k];
}
for (const k of Object.keys(en)) {
  if (es[k] == null) es[k] = en[k];
}

fs.writeFileSync(
  path.join(root, "js/locales/es-ES.js"),
  serializeMessages(
    "TourAiEsESMessages",
    "/**\n * Spanish (es-ES) UI strings for TourAI web.\n * Keep in parity with js/locales/en-GB.js.\n */",
    es
  ),
  "utf8"
);
fs.writeFileSync(
  path.join(root, "js/locales/en-GB.js"),
  serializeMessages(
    "TourAiEnGBMessages",
    "/**\n * British English (en-GB) UI strings for TourAI web.\n * Keep in parity with js/locales/es-ES.js.\n */",
    en
  ),
  "utf8"
);
console.log("Locale keys:", Object.keys(es).length, "addedEs~", addedEs, "addedEn~", addedEn);

let htmlChanged = 0;
for (const file of htmlFiles) {
  const full = path.join(root, file);
  const before = fs.readFileSync(full, "utf8");
  const after = cleanHtml(before, file);
  if (after !== before) {
    fs.writeFileSync(full, after, "utf8");
    htmlChanged += 1;
    console.log("cleaned", file);
  }
}
console.log("HTML files cleaned:", htmlChanged);

let fbTotal = 0;
for (const full of [...jsFiles, ...htmlFiles.map((f) => path.join(root, f))]) {
  const before = fs.readFileSync(full, "utf8");
  const { code, count } = stripFallbacks(before);
  if (count && code !== before) {
    fs.writeFileSync(full, code, "utf8");
    fbTotal += count;
    console.log("stripped fallbacks", path.relative(root, full), count);
  }
}
console.log("Fallback removals:", fbTotal);

// site-ui loading overlay: prefer i18n key, empty defaults
{
  const full = path.join(root, "js/site-ui.js");
  let code = fs.readFileSync(full, "utf8");
  code = code.replace(
    /data-default-text="Procesando\.\.\.">Procesando\.\.\./g,
    'data-default-text="" data-i18n="loading.processing">'
  );
  code = code.replace(
    /const fallback = messageEl\.getAttribute\("data-default-text"\) \?\? "Procesando\.\.\.";/,
    'const fallback = window.TourAiI18n?.t?.("loading.processing", window.TourAiI18n.getLocale()) ?? messageEl.getAttribute("data-default-text") ?? "";'
  );
  fs.writeFileSync(full, code, "utf8");
}

// forms.js: drop Spanish default-text dependency for modal intro
{
  const full = path.join(root, "js/forms.js");
  let code = fs.readFileSync(full, "utf8");
  code = code.replace(
    /const template = intro\.getAttribute\("data-default-text"\) \?\? intro\.textContent \?\? "";\s*const translated = window\.TourAiI18n\.t\("index\.modal\.text", locale, \{ platform \}\);\s*intro\.textContent = \(translated \?\? template\)\.replace\("\{platform\}", platform\);/,
    `const translated = window.TourAiI18n.t("index.modal.text", locale, { platform });
      if (translated) {
        intro.textContent = translated;
      }`
  );
  fs.writeFileSync(full, code, "utf8");
}

// i18n.js: drop data-default-text Spanish fallback for modalIntro
{
  const full = path.join(root, "js/i18n.js");
  let code = fs.readFileSync(full, "utf8");
  code = code.replace(
    /const translated = window\.TourAiI18n\.t\("index\.modal\.text", locale, \{ platform \}\);\s*if \(translated\) \{\s*intro\.textContent = translated;\s*return;\s*\}\s*const template = intro\.getAttribute\("data-default-text"\) \?\? intro\.textContent \?\? "";\s*intro\.textContent = template\.replace\("\{platform\}", platform\);/,
    `const translated = window.TourAiI18n.t("index.modal.text", locale, { platform });
      if (translated) {
        intro.textContent = translated;
      }`
  );
  fs.writeFileSync(full, code, "utf8");
}

console.log("Done.");
