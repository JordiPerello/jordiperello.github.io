/**
 * Re-harvest Spanish fallbacks from last committed JS (before strip),
 * and fill keys that currently equal English in es-ES.js.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

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
    if (typeof val === "string" && (val.includes("\n") || val.includes("'") || val.includes('"'))) {
      return `  ${JSON.stringify(key)}: \`${escapeJsString(val)}\`,`;
    }
    return `  ${JSON.stringify(key)}: ${JSON.stringify(val)},`;
  });
  return (
    "/**\n * Spanish (es-ES) UI strings for TourAI web.\n * Keep in parity with js/locales/en-GB.js.\n */\n" +
    "window.TourAiEsESMessages = {\n" +
    lines.join("\n") +
    "\n};\n"
  );
}

function extractFromCode(code) {
  const map = {};
  const patterns = [
    /\.t(?:Or)?\(\s*["']([^"']+)["']\s*,\s*(?:null\s*,\s*)?["']((?:\\.|[^"'\\])*)["']/g,
    /\bt\(\s*["']([^"']+)["']\s*,\s*["']((?:\\.|[^"'\\])*)["']/g,
    /tOr\(\s*["']([^"']+)["']\s*,\s*["']((?:\\.|[^"'\\])*)["']/g,
  ];
  for (const re of patterns) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(code))) {
      const key = m[1];
      const val = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, "\n");
      if (!val || val === key) continue;
      if (!map[key] || val.length > map[key].length) map[key] = val;
    }
  }
  return map;
}

const files = [
  "js/account.js",
  "js/auth.js",
  "js/forms.js",
  "js/community.js",
  "js/reviews.js",
  "js/whats-new.js",
  "js/freemium-promo.js",
  "js/site-ui.js",
  "js/checkout.js",
];

const harvested = {};
for (const file of files) {
  let code = "";
  try {
    code = execSync(`git show HEAD:${file}`, { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  } catch {
    if (fs.existsSync(path.join(root, file))) {
      code = fs.readFileSync(path.join(root, file), "utf8");
    }
  }
  Object.assign(harvested, extractFromCode(code));
}

// Also from working tree (may still have some)
for (const file of files) {
  const full = path.join(root, file);
  if (fs.existsSync(full)) {
    Object.assign(harvested, extractFromCode(fs.readFileSync(full, "utf8")));
  }
}

const extracted = JSON.parse(
  fs.readFileSync(path.join(root, "scripts/extracted-es-ES.json"), "utf8")
);
Object.assign(harvested, extracted);

const en = loadMessages("js/locales/en-GB.js", "TourAiEnGBMessages");
const es = loadMessages("js/locales/es-ES.js", "TourAiEsESMessages");

let filled = 0;
const stillEn = [];
for (const key of Object.keys(en)) {
  const current = es[key];
  const eng = en[key];
  if (harvested[key] && harvested[key] !== eng) {
    if (current === eng || current == null || current === "") {
      es[key] = harvested[key];
      filled += 1;
    }
  }
  if (es[key] === en[key]) {
    stillEn.push(key);
  }
}

// Keys only in harvested
for (const [k, v] of Object.entries(harvested)) {
  if (es[k] == null) es[k] = v;
}

fs.writeFileSync(path.join(root, "js/locales/es-ES.js"), serializeMessages(es), "utf8");
fs.writeFileSync(
  path.join(root, "scripts/es-ES-still-english.json"),
  JSON.stringify(stillEn, null, 2),
  "utf8"
);
console.log("Harvested fallback keys:", Object.keys(harvested).length);
console.log("Filled from harvest:", filled);
console.log("Still identical to EN:", stillEn.length);
console.log(stillEn.slice(0, 50).join("\n"));
