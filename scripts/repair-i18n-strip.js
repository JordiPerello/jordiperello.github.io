/**
 * Repair broken t()/tOr() calls left by aggressive fallback stripping,
 * and clear remaining HTML user copy outside locale tables.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function repairBrokenCalls(code) {
  let out = code;
  let n = 0;

  // tOr("key"\n        )  →  tOr("key")
  out = out.replace(
    /\b(t|tOr|tContact|tDelete)\(\s*(["'])([^"'\\]+)\2\s*\n\s*\)/g,
    (all, fn, q, key) => {
      n += 1;
      return `${fn}(${q}${key}${q})`;
    }
  );

  // tOr(\n  "key",\n  exprOrString\n) when 2nd arg is not needed → tOr("key")
  // Only when 2nd arg is string literal or `x ?? "Spanish"`
  out = out.replace(
    /\b(t|tOr|tContact|tDelete)\(\s*\n\s*(["'])([^"'\\]+)\2\s*,\s*\n\s*(?:["'](?:\\.|[^"'\\])*["']|[a-zA-Z_$][\w?.]*(?:\s*\?\?\s*["'](?:\\.|[^"'\\])*["'])?)\s*\n\s*\)/g,
    (all, fn, q, key) => {
      n += 1;
      return `${fn}(${q}${key}${q})`;
    }
  );

  // tOr("key", button?.textContent ?? "Spanish") → tOr("key")
  out = out.replace(
    /\b(t|tOr|tContact|tDelete)\(\s*(["'])([^"'\\]+)\2\s*,\s*[^)"']*\?\?\s*["'][^"']*["']\s*\)/g,
    (all, fn, q, key) => {
      n += 1;
      return `${fn}(${q}${key}${q})`;
    }
  );

  // rateLimitedMessage(result, 'key', 'Spanish fallback') → rateLimitedMessage(result, 'key')
  out = out.replace(
    /\.rateLimitedMessage\?\.\(\s*([^,]+),\s*(["'])([^"'\\]+)\2\s*,\s*(["'])(?:\\.|[^"'\\])*\4\s*\)/g,
    (all, a, q, key) => {
      n += 1;
      return `.rateLimitedMessage?.(${a}, ${q}${key}${q})`;
    }
  );
  out = out.replace(
    /\.rateLimitedMessage\(\s*([^,]+),\s*(["'])([^"'\\]+)\2\s*,\s*(["'])(?:\\.|[^"'\\])*\4\s*\)/g,
    (all, a, q, key) => {
      n += 1;
      return `.rateLimitedMessage(${a}, ${q}${key}${q})`;
    }
  );

  return { code: out, n };
}

function loadMessages(file, globalName) {
  const code = fs.readFileSync(path.join(root, file), "utf8");
  globalThis.window = globalThis;
  return Function(`${code}; return window.${globalName};`)();
}

function serializeMessages(globalName, header, obj) {
  const escapeJsString = (value) =>
    String(value)
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\$\{/g, "\\${");
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

const targets = [
  "js/forms.js",
  "js/site-ui.js",
  "js/account.js",
  "js/auth.js",
  "js/community.js",
  "js/reviews.js",
  "contact.html",
  "delete-account.html",
];

let total = 0;
for (const rel of targets) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const before = fs.readFileSync(full, "utf8");
  const { code, n } = repairBrokenCalls(before);
  if (n || code !== before) {
    fs.writeFileSync(full, code, "utf8");
    console.log("repaired", rel, n);
    total += n;
  }
}
console.log("repairs:", total);

// privacy.html: locale blob already includes sidebar — remove orphaned leftover cards
{
  const full = path.join(root, "privacy.html");
  let html = fs.readFileSync(full, "utf8");
  html = html.replace(
    /(<div data-i18n-html="page\.privacy\.content"[^>]*><\/div>)\s*[\s\S]*?<\/aside>\s*<\/div>\s*<\/div>/i,
    `$1
        </div>
    </div>`
  );
  fs.writeFileSync(full, html, "utf8");
  console.log("fixed privacy layout");
}

// reset-password aria empty
{
  const full = path.join(root, "reset-password.html");
  let html = fs.readFileSync(full, "utf8");
  html = html.replace(/aria-label="Mostrar contraseña"/g, 'aria-label=""');
  fs.writeFileSync(full, html, "utf8");
}

// Check similar orphans on terms/cookies
for (const file of ["terms.html", "cookies.html", "delete-account.html", "faq.html"]) {
  const full = path.join(root, file);
  let html = fs.readFileSync(full, "utf8");
  // orphan sidebar-card after emptied i18n-html
  if (/data-i18n-html="page\.[^"]+\.content"[\s\S]{0,200}<div class="sidebar-card"/.test(html)) {
    console.log("possible orphan sidebar in", file);
  }
}

// Ensure alt texts for logo use i18n if we add keys — optional brand alts OK in EN
const es = loadMessages("js/locales/es-ES.js", "TourAiEsESMessages");
const en = loadMessages("js/locales/en-GB.js", "TourAiEnGBMessages");
const extrasEs = {
  "img.logo.alt": "Icono TourAI",
  "img.logo.wordmark": "TourAI",
};
const extrasEn = {
  "img.logo.alt": "TourAI icon",
  "img.logo.wordmark": "TourAI",
};
for (const [k, v] of Object.entries(extrasEs)) if (!es[k]) es[k] = v;
for (const [k, v] of Object.entries(extrasEn)) if (!en[k]) en[k] = v;
for (const k of Object.keys(es)) if (en[k] == null) en[k] = es[k];
for (const k of Object.keys(en)) if (es[k] == null) es[k] = en[k];

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

console.log("done");
