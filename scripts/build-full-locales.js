/**
 * Build js/locales/es-ES.js from:
 * - existing es-ES keys
 * - scripts/extracted-es-ES.json (HTML)
 * - Spanish string fallbacks in JS: t("key", "Espaùolù")
 * - any remaining en-GB keys (temporary copy from EN until hand-translated; logged)
 *
 * Also strips visible copy from HTML data-i18n* nodes (keeps structure/attrs).
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

function serializeMessages(obj) {
  const keys = Object.keys(obj).sort();
  const lines = keys.map((key) => {
    const val = obj[key];
    // Prefer template literals for multiline / HTML blobs
    if (typeof val === "string" && (val.includes("\n") || val.includes("'") || val.includes('"'))) {
      return `  ${JSON.stringify(key)}: \`${escapeJsString(val)}\`,`;
    }
    return `  ${JSON.stringify(key)}: ${JSON.stringify(val)},`;
  });
  return (
    "/**\n" +
    " * Spanish (es-ES) UI strings for TourAI web.\n" +
    " * Keep in parity with js/locales/en-GB.js.\n" +
    " */\n" +
    "window.TourAiEsESMessages = {\n" +
    lines.join("\n") +
    "\n};\n"
  );
}

function extractJsFallbacks() {
  const map = {};
  const jsRoots = [
    path.join(root, "js"),
  ];
  const re =
    /\.t(?:Or)?\(\s*["']([^"']+)["']\s*,\s*(?:null\s*,\s*)?(?:undefined\s*,\s*)?["']((?:\\.|[^"'\\])*)["']/g;
  const re2 =
    /\bt\(\s*["']([^"']+)["']\s*,\s*["']((?:\\.|[^"'\\])*)["']/g;

  function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        if (entry === "locales") continue;
        walk(full);
        continue;
      }
      if (!entry.endsWith(".js")) continue;
      const code = fs.readFileSync(full, "utf8");
      for (const reX of [re, re2]) {
        reX.lastIndex = 0;
        let m;
        while ((m = reX.exec(code))) {
          const key = m[1];
          let val = m[2]
            .replace(/\\'/g, "'")
            .replace(/\\"/g, '"')
            .replace(/\\n/g, "\n");
          // Skip if looks like English-only placeholder key echo
          if (!val || val === key) continue;
          // Prefer longer Spanish when duplicates
          if (!map[key] || String(val).length > String(map[key]).length) {
            map[key] = val;
          }
        }
      }
    }
  }
  walk(path.join(root, "js"));
  return map;
}

function stripHtmlCopy() {
  const files = fs.readdirSync(root).filter((f) => f.endsWith(".html"));
  let changed = 0;
  for (const file of files) {
    const full = path.join(root, file);
    let html = fs.readFileSync(full, "utf8");
    const original = html;

    // Empty text nodes for simple data-i18n elements (keep child elements if any complex)
    html = html.replace(
      /<(?<tag>[\w-]+)([^>]*\bdata-i18n="[^"]+"[^>]*)>([\s\S]*?)<\/\k<tag>>/gi,
      (all, tag, attrs, inner) => {
        // If inner has nested tags (except br), leave structure but clear text-only
        if (/<[a-z]/i.test(inner) && !/^(\s|<br\s*\/?>\s*)*$/i.test(inner)) {
          // For anchors that only wrap text, clear text
          if (/^(\s*)[^<]*(\s*)$/.test(inner) || !inner.includes("<")) {
            return `<${tag}${attrs}></${tag}>`;
          }
          return all;
        }
        return `<${tag}${attrs}></${tag}>`;
      }
    );

    html = html.replace(
      /(\bdata-i18n-placeholder="[^"]+"[^>]*\bplaceholder=")([^"]*)(")/gi,
      '$1$3'
    );
    html = html.replace(
      /(\bplaceholder=")([^"]*)("[^>]*\bdata-i18n-placeholder=")/gi,
      '$1$3'
    );

    html = html.replace(
      /(\bdata-i18n-title="[^"]+"[^>]*\btitle=")([^"]*)(")/gi,
      '$1$3'
    );
    html = html.replace(
      /(\btitle=")([^"]*)("[^>]*\bdata-i18n-title=")/gi,
      '$1$3'
    );

    html = html.replace(
      /(<title[^>]*data-i18n-doc-title="[^"]*"[^>]*>)([\s\S]*?)(<\/title>)/gi,
      "$1$3"
    );

    html = html.replace(
      /(<meta[^>]*data-i18n-meta="[^"]*"[^>]*\bcontent=")([^"]*)(")/gi,
      "$1$3"
    );

    // Clear data-i18n-html containers
    html = html.replace(
      /<(?<tag>[\w-]+)([^>]*\bdata-i18n-html="[^"]+"[^>]*)>[\s\S]*?<\/\k<tag>>/gi,
      (all, tag, attrs) => `<${tag}${attrs}></${tag}>`
    );

    if (html !== original) {
      fs.writeFileSync(full, html, "utf8");
      changed += 1;
      console.log("stripped", file);
    }
  }
  return changed;
}

function stripJsFallbacks() {
  // Conservative: only remove obvious second-arg Spanish string literals from t("key", "ù")
  // when the second arg contains Spanish characters or common Spanish words.
  // Safer approach for buy/checkout already done; do a broader pass on account/auth/forms.
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        if (entry === "locales") continue;
        walk(full);
        continue;
      }
      if (entry.endsWith(".js")) files.push(full);
    }
  }
  walk(path.join(root, "js"));

  let total = 0;
  const spanishHint = /[ùùùùùùùùùùù?ù]|sesiùn|contraseùa|correo|cuenta|pago|plan|error|guardar|cerrar|iniciar|introduce|demasiados|configuraciùn/i;

  for (const full of files) {
    let code = fs.readFileSync(full, "utf8");
    const original = code;
    // t("key", "fallback") or t('key', 'fallback') ? t("key")
    code = code.replace(
      /\b(t|this\.t|authApi\(\)\?\.t)\(\s*(["'])([^"']+)\2\s*,\s*(["'])((?:\\.|[^\\])*?)\4(\s*(?:,\s*[^)]*)?)\)/g,
      (all, fn, q1, key, q2, fb, rest) => {
        if (!spanishHint.test(fb) && !/[ùùùùù]/i.test(fb)) {
          // still strip if it's clearly a user string (long) used as fallback pattern
          if (fb.length < 8) return all;
        }
        total += 1;
        const r = rest && rest.trim().startsWith(",") ? rest : "";
        // If rest has vars object wrongly placed - our pattern shouldn't capture vars as string
        return `${fn}(${q1}${key}${q1}${r})`;
      }
    );
    if (code !== original) {
      fs.writeFileSync(full, code, "utf8");
      console.log("stripped fallbacks", path.relative(root, full));
    }
  }
  return total;
}

// --- main ---
const en = loadMessages("js/locales/en-GB.js", "TourAiEnGBMessages");
const existingEs = loadMessages("js/locales/es-ES.js", "TourAiEsESMessages");
const extracted = JSON.parse(
  fs.readFileSync(path.join(root, "scripts/extracted-es-ES.json"), "utf8")
);
const jsFallbacks = extractJsFallbacks();

const merged = {};
const fromEnFallback = [];

for (const key of Object.keys(en)) {
  if (existingEs[key] != null && existingEs[key] !== "") {
    merged[key] = existingEs[key];
  } else if (extracted[key] != null && extracted[key] !== "") {
    merged[key] = extracted[key];
  } else if (jsFallbacks[key] != null && jsFallbacks[key] !== "") {
    merged[key] = jsFallbacks[key];
  } else {
    merged[key] = en[key]; // temporary EN until Spanish provided
    fromEnFallback.push(key);
  }
}

// Keys only in extracted / existing / js but not in en ù add them (and warn)
for (const src of [existingEs, extracted, jsFallbacks]) {
  for (const key of Object.keys(src)) {
    if (merged[key] == null) {
      merged[key] = src[key];
    }
  }
}

// Extra non-i18n strings discovered ù add keys
const extras = {
  "lang.es": "Espaùol",
  "lang.en": "English",
  "ui.backToTop": "Volver arriba",
  "account.edit.photo.aria":
    "Foto de perfil. Arrastra para centrar; pulsa para cambiar.",
  "community.editor.textColor": "Color de texto",
  "community.editor.fontSize": "Tamaùo de letra",
  "community.editor.size": "Tamaùo",
  "cookie.accept": "Aceptar",
  "cookie.reject": "Rechazar",
};
for (const [k, v] of Object.entries(extras)) {
  if (!merged[k]) merged[k] = v;
}

fs.writeFileSync(path.join(root, "js/locales/es-ES.js"), serializeMessages(merged), "utf8");
console.log("Wrote es-ES.js keys:", Object.keys(merged).length);
console.log("Used EN as temporary Spanish:", fromEnFallback.length);
fs.writeFileSync(
  path.join(root, "scripts/es-ES-from-en-temporary.json"),
  JSON.stringify(fromEnFallback, null, 2),
  "utf8"
);

// Ensure en-GB has extras (append missing keys only; do not rewrite the whole file).
const enPath = path.join(root, "js/locales/en-GB.js");
let enCode = fs.readFileSync(enPath, "utf8");
const enExtras = {
  "lang.es": "Spanish",
  "lang.en": "English",
  "ui.backToTop": "Back to top",
  "account.edit.photo.aria":
    "Profile photo. Drag to centre; tap to change.",
  "community.editor.textColor": "Text colour",
  "community.editor.fontSize": "Font size",
  "community.editor.size": "Size",
  "cookie.accept": "Accept",
  "cookie.reject": "Reject",
};
const missingEnLines = [];
for (const [k, v] of Object.entries(enExtras)) {
  if (!en[k]) {
    missingEnLines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  }
}
if (missingEnLines.length) {
  enCode = enCode.replace(/\n\};\s*$/, "\n" + missingEnLines.join("\n") + "\n};\n");
  fs.writeFileSync(enPath, enCode, "utf8");
  console.log("Appended", missingEnLines.length, "keys to en-GB.js");
}

const strippedPages = stripHtmlCopy();
console.log("HTML files stripped:", strippedPages);
const strippedFb = stripJsFallbacks();
console.log("JS fallback removals (approx):", strippedFb);
