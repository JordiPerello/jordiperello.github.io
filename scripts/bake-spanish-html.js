/**
 * Bakes es-ES copy into root HTML and removes data-i18n attributes.
 * Run before build-en-pages.js when Spanish templates change.
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
const SKIP = /^google/i;

function main() {
  const messages = loadLocaleMessages(path.join(ROOT, "js", "locales", "es-ES.js"));
  const files = fs
    .readdirSync(ROOT)
    .filter((name) => name.endsWith(".html") && !SKIP.test(name))
    .sort();

  for (const file of files) {
    let html = fs.readFileSync(path.join(ROOT, file), "utf8");
    html = bakeMessagesIntoHtml(html, messages);
    html = stripI18nAttributes(html);
    html = setSingleLocaleScripts(html, "es-ES.js");
    fs.writeFileSync(path.join(ROOT, file), html, { encoding: "utf8" });
  }

  console.log(`Baked static Spanish copy into ${files.length} HTML files.`);
}

main();
