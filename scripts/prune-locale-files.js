/**
 * Keeps only i18n keys referenced from js/*.js (dynamic UI messages).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const JS_DIR = path.join(ROOT, "js");

const EXTRA_KEYS = new Set([
  "index.modal.text",
]);

function collectKeysFromJs() {
  const keys = new Set(EXTRA_KEYS);
  const files = fs.readdirSync(JS_DIR).filter((f) => f.endsWith(".js"));
  const patterns = [
    /\btOr\s*\(\s*["']([^"']+)["']/g,
    /\bt\s*\(\s*["']([^"']+)["']/g,
    /TourAiI18n\.tOr\s*\(\s*["']([^"']+)["']/g,
    /TourAiI18n\.t\s*\(\s*["']([^"']+)["']/g,
  ];

  for (const file of files) {
    const src = fs.readFileSync(path.join(JS_DIR, file), "utf8");
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        const key = m[1];
        if (/^[a-zA-Z][a-zA-Z0-9_.-]*\.[a-zA-Z0-9_.-]+$/.test(key)) {
          keys.add(key);
        }
      }
    }
  }

  return keys;
}

function loadMessages(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox);
  return {
    src,
    messages:
      sandbox.window.TourAiEsESMessages || sandbox.window.TourAiEnGBMessages || {},
    globalName: sandbox.window.TourAiEsESMessages
      ? "TourAiEsESMessages"
      : "TourAiEnGBMessages",
  };
}

function writeLocaleFile(outPath, globalName, headerComment, messages, usedKeys) {
  const kept = {};
  const missing = [];
  for (const key of [...usedKeys].sort()) {
    if (messages[key] != null) {
      kept[key] = messages[key];
    } else {
      missing.push(key);
    }
  }

  const sortedKeys = Object.keys(kept).sort();
  const body = sortedKeys
    .map((key) => {
      const value = kept[key];
      if (typeof value === "string" && (value.includes("\n") || value.includes("`"))) {
        const escaped = value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
        return `  "${key}": \`${escaped}\`,`;
      }
      const json = JSON.stringify(value);
      return `  "${key}": ${json},`;
    })
    .join("\n");

  const content = `${headerComment}
window.${globalName} = {
${body}
};
`;
  fs.writeFileSync(outPath, content, { encoding: "utf8" });
  return { kept: sortedKeys.length, missing };
}

function main() {
  const usedKeys = collectKeysFromJs();
  const esPath = path.join(ROOT, "js", "locales", "es-ES.js");
  const enPath = path.join(ROOT, "js", "locales", "en-GB.js");
  const es = loadMessages(esPath);
  const en = loadMessages(enPath);

  const esHeader = `/**
 * Spanish (es-ES) dynamic UI strings for TourAI web (runtime messages only).
 * Static page copy lives in HTML. Regenerate with: node scripts/prune-locale-files.js
 */`;
  const enHeader = `/**
 * English (en-GB) dynamic UI strings for TourAI web (runtime messages only).
 * Static page copy lives in en/*.html. Regenerate with: node scripts/prune-locale-files.js
 */`;

  const esResult = writeLocaleFile(esPath, "TourAiEsESMessages", esHeader, es.messages, usedKeys);
  const enResult = writeLocaleFile(enPath, "TourAiEnGBMessages", enHeader, en.messages, usedKeys);

  console.log(
    `Pruned locales: ${esResult.kept} es-ES keys, ${enResult.kept} en-GB keys (${usedKeys.size} referenced).`
  );
  if (esResult.missing.length || enResult.missing.length) {
    const allMissing = [...new Set([...esResult.missing, ...enResult.missing])].sort();
    console.warn("Missing keys in locale tables:", allMissing.join(", "));
  }
}

main();
