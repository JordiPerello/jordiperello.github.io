/**
 * Safely strip Spanish string fallbacks from JS, preserving vars objects.
 * Transforms:
 *   tOr("key", "fb", {x}) → tOr("key", {x})
 *   tOr("key", "fb") → tOr("key")
 *   t("key", "fb") → t("key")
 * Also upgrades local tOr(key, fallback, vars) helpers to accept vars as 2nd arg.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function stripFile(code) {
  let n = 0;

  // Multiline: tOr(\n "key",\n "fb",\n {vars}\n) or tOr("key",\n "fb",\n {vars})
  code = code.replace(
    /\b(t|tOr|tContact|tDelete)\(\s*(["'])([^"'\\]+)\2\s*,\s*(["'])((?:\\.|[^"'\\])*)\4\s*,\s*(\{[\s\S]*?\}|[a-zA-Z_$][\w.]*)\s*\)/g,
    (all, fn, q1, key, _q2, _fb, vars) => {
      n += 1;
      return `${fn}(${q1}${key}${q1}, ${vars})`;
    }
  );

  // Multiline with key on its own line already handled by above if commas match.
  // tOr(\n  "key",\n  "fb",\n  { platform }\n)
  code = code.replace(
    /\b(t|tOr|tContact|tDelete)\(\s*\n\s*(["'])([^"'\\]+)\2\s*,\s*\n\s*(["'])((?:\\.|[^"'\\])*)\4\s*,\s*\n\s*(\{[\s\S]*?\}|[a-zA-Z_$][\w.]*)\s*\n\s*\)/g,
    (all, fn, q1, key, _q2, _fb, vars) => {
      n += 1;
      return `${fn}(${q1}${key}${q1}, ${vars})`;
    }
  );

  // Two-arg string fallback only (no third arg). Single-line or wrapped.
  code = code.replace(
    /\b(t|tOr|tContact|tDelete)\(\s*(["'])([^"'\\]+)\2\s*,\s*(["'])((?:\\.|[^"'\\])*)\4\s*\)/g,
    (all, fn, q1, key) => {
      n += 1;
      return `${fn}(${q1}${key}${q1})`;
    }
  );

  code = code.replace(
    /\b(t|tOr|tContact|tDelete)\(\s*\n\s*(["'])([^"'\\]+)\2\s*,\s*\n\s*(["'])((?:\\.|[^"'\\])*)\4\s*\n\s*\)/g,
    (all, fn, q1, key) => {
      n += 1;
      return `${fn}(${q1}${key}${q1})`;
    }
  );

  // rateLimitedMessage(result, "key", "fb") → rateLimitedMessage(result, "key")
  code = code.replace(
    /(\.rateLimitedMessage\??\()\s*([^,]+),\s*(["'])([^"'\\]+)\3\s*,\s*(["'])(?:\\.|[^"'\\])*\5\s*\)/g,
    (all, head, a, q, key) => {
      n += 1;
      return `${head}${a}, ${q}${key}${q})`;
    }
  );

  // tOr("key", button?.textContent ?? "Spanish") → tOr("key")
  code = code.replace(
    /\b(t|tOr|tContact|tDelete)\(\s*(["'])([^"'\\]+)\2\s*,\s*[^,)]+\?\?\s*(["'])(?:\\.|[^"'\\])*\4\s*\)/g,
    (all, fn, q1, key) => {
      n += 1;
      return `${fn}(${q1}${key}${q1})`;
    }
  );

  // Upgrade local helper: function tOr(key, fallback, vars) {
  code = code.replace(
    /function tOr\(key, fallback, vars\) \{\s*\n\s*const locale = ([^;]+);\s*\n\s*let result = window\.TourAiI18n\?\.tOr\(key, locale, vars, fallback\) \?\? fallback;/g,
    `function tOr(key, fallbackOrVars, maybeVars) {
    const locale = $1;
    const vars =
      fallbackOrVars && typeof fallbackOrVars === "object" && !Array.isArray(fallbackOrVars)
        ? fallbackOrVars
        : maybeVars;
    const fallback = typeof fallbackOrVars === "string" ? fallbackOrVars : undefined;
    let result = window.TourAiI18n?.tOr(key, locale, vars, fallback) ?? fallback;`
  );

  // Two-arg only helpers: function tOr(key, fallback) {
  code = code.replace(
    /function tOr\(key, fallback\) \{\s*\n\s*const locale = ([^;]+);\s*\n\s*return window\.TourAiI18n\?\.tOr\?\.\(key, locale, null, fallback\) \?\? fallback;/g,
    `function tOr(key, fallbackOrVars, maybeVars) {
    const locale = $1;
    const vars =
      fallbackOrVars && typeof fallbackOrVars === "object" && !Array.isArray(fallbackOrVars)
        ? fallbackOrVars
        : maybeVars;
    const fallback = typeof fallbackOrVars === "string" ? fallbackOrVars : undefined;
    return window.TourAiI18n?.tOr?.(key, locale, vars, fallback) ?? fallback ?? "";`
  );

  // tOrVerification(key, fallback) leftover Spanish in forms
  code = code.replace(
    /\b(tOrVerification)\(\s*(["'])([^"'\\]+)\2\s*,\s*(["'])((?:\\.|[^"'\\])*)\4\s*\)/g,
    (all, fn, q1, key) => {
      n += 1;
      return `${fn}(${q1}${key}${q1})`;
    }
  );

  return { code, n };
}

const files = [
  "js/forms.js",
  "js/site-ui.js",
  "js/account.js",
  "js/auth.js",
  "js/community.js",
  "js/reviews.js",
  "js/freemium-promo.js",
  "js/checkout.js",
  "js/whats-new.js",
  "contact.html",
  "delete-account.html",
];

for (const rel of files) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const before = fs.readFileSync(full, "utf8");
  const { code, n } = stripFile(before);
  if (code !== before) {
    fs.writeFileSync(full, code, "utf8");
    console.log(rel, "stripped", n);
  } else {
    console.log(rel, "unchanged");
  }
}

// forms.js openPlatformModal: prefer locale only
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

console.log("done");
