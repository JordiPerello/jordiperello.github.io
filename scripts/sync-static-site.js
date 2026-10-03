/**
 * Refreshes hreflang/sitemap/lang-switcher, bakes Spanish if templates still use data-i18n,
 * prunes dynamic locale JS.
 *
 * Copy workflow after migration:
 * - Spanish: edit *.html in the site root.
 * - English: edit en/*.html (same structure).
 * - Dynamic JS messages: js/locales/*.js (node scripts/prune-locale-files.js after adding t() keys).
 */
"use strict";

const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function run(script) {
  execSync(`node "${path.join(ROOT, "scripts", script)}"`, {
    stdio: "inherit",
    cwd: ROOT,
  });
}

run("build-en-pages.js");
run("bake-spanish-html.js");
run("prune-locale-files.js");
