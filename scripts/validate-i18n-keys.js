const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function loadMessages(file, globalName) {
  const code = fs.readFileSync(path.join(root, file), "utf8");
  globalThis.window = globalThis;
  return Function(`${code}; return window.${globalName};`)();
}

const en = loadMessages("js/locales/en-GB.js", "TourAiEnGBMessages");
const es = loadMessages("js/locales/es-ES.js", "TourAiEsESMessages");
const enKeys = new Set(Object.keys(en));
const esKeys = new Set(Object.keys(es));

const missingInEn = [...esKeys].filter((k) => !enKeys.has(k)).sort();
const missingInEs = [...enKeys].filter((k) => !esKeys.has(k)).sort();

console.log(`en-GB keys: ${enKeys.size}`);
console.log(`es-ES keys: ${esKeys.size}`);
console.log(`In es-ES but missing in en-GB: ${missingInEn.length}`);
missingInEn.forEach((k) => console.log("  EN missing:", k));
console.log(
  `In en-GB but missing in es-ES (OK while migrating HTML-sourced keys): ${missingInEs.length}`
);

const missingHtml = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".git") {
        continue;
      }
      walk(full);
      continue;
    }
    if (!entry.endsWith(".html")) {
      continue;
    }
    const html = fs.readFileSync(full, "utf8");
    for (const attr of [
      "data-i18n",
      "data-i18n-html",
      "data-i18n-doc-title",
      "data-i18n-meta",
      "data-i18n-placeholder",
    ]) {
      const re = new RegExp(`${attr}="([^"]+)"`, "g");
      let match;
      while ((match = re.exec(html))) {
        if (!enKeys.has(match[1])) {
          missingHtml.push({
            file: path.relative(root, full),
            key: match[1],
            attr,
          });
        }
      }
    }
  }
}

walk(root);
console.log(`HTML keys missing from en-GB.js: ${missingHtml.length}`);
missingHtml.forEach((item) => console.log(item));

if (missingInEn.length) {
  process.exitCode = 1;
}
