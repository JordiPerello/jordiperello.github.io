const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const code = fs.readFileSync(path.join(root, "js/locales/en-GB.js"), "utf8");
globalThis.window = globalThis;
const msgs = Function(
  `${code}; return window.TourAiEnGBMessages;`
)();
const keys = new Set(Object.keys(msgs));

const missing = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
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
        if (!keys.has(match[1])) {
          missing.push({
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
console.log(`Keys in en-GB.js: ${keys.size}`);
console.log(`Missing references: ${missing.length}`);
missing.forEach((item) => console.log(item));
