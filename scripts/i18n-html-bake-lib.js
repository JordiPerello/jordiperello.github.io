"use strict";

const fs = require("fs");
const vm = require("vm");

function loadLocaleMessages(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox);
  return (
    sandbox.window.TourAiEnGBMessages ||
    sandbox.window.TourAiEsESMessages ||
    {}
  );
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}

function fillKeyedElements(html, attrName, messages) {
  const re = new RegExp(
    `<(?<tag>[a-zA-Z][\\w:-]*)(?<attrs>[^>]*\\s${attrName}="(?<key>[^"]+)"[^>]*)>(?<inner>[\\s\\S]*?)<\\/\\k<tag>>`,
    "g"
  );
  return html.replace(re, (match, tag, attrs, key, inner) => {
    if (attrName === "data-i18n" && /<[a-zA-Z]/.test(inner || "")) {
      return match;
    }
    if (attrName === "data-i18n-html" && inner && inner.trim() && inner.includes("</")) {
      /* Replace whole block (avoids duplicating nested markup from the shell). */
    }
    const value = messages[key];
    if (value == null || value === "") {
      return match;
    }
    return `<${tag}${attrs}>${value}</${tag}>`;
  });
}

function fillKeyedAttributes(html, dataAttr, htmlAttr, messages) {
  return html.replace(
    new RegExp(`${dataAttr}="([^"]+)"([^>]*?)${htmlAttr}="[^"]*"`, "g"),
    (match, key, middle) => {
      const value = messages[key];
      if (value == null || value === "") {
        return match;
      }
      return `${dataAttr}="${key}"${middle}${htmlAttr}="${escapeAttr(value)}"`;
    }
  );
}

function bakeMessagesIntoHtml(html, messages) {
  let out = fillKeyedElements(html, "data-i18n-html", messages);
  out = fillKeyedElements(out, "data-i18n", messages);
  out = fillKeyedAttributes(out, "data-i18n-placeholder", "placeholder", messages);
  out = fillKeyedAttributes(out, "data-i18n-title", "title", messages);
  out = fillKeyedAttributes(out, "data-i18n-aria-label", "aria-label", messages);
  out = fillKeyedAttributes(out, "data-i18n-meta", "content", messages);
  out = out.replace(
    /<title([^>]*)\sdata-i18n-doc-title="([^"]+)"([^>]*)>[\s\S]*?<\/title>/g,
    (match, a, key, b) => {
      const value = messages[key];
      if (!value) {
        return match;
      }
      return `<title${a}${b}>${value}</title>`;
    }
  );
  return out;
}

function stripI18nAttributes(html) {
  return html
    .replace(/\s*data-i18n-html="[^"]*"/g, "")
    .replace(/\s*data-i18n="[^"]*"/g, "")
    .replace(/\s*data-i18n-placeholder="[^"]*"/g, "")
    .replace(/\s*data-i18n-title="[^"]*"/g, "")
    .replace(/\s*data-i18n-aria-label="[^"]*"/g, "")
    .replace(/\s*data-i18n-meta="[^"]*"/g, "")
    .replace(/\s*data-i18n-doc-title="[^"]*"/g, "")
    .replace(/\s*data-i18n-platform="[^"]*"/g, "");
}

function setSingleLocaleScripts(html, localeFileName) {
  const prefixMatch = html.match(/<script src="(\.\.\/)?js\/locales\/es-ES\.js"><\/script>/);
  const prefix = prefixMatch && prefixMatch[1] ? prefixMatch[1] : "";
  const block =
    `<script src="${prefix}js/locales/${localeFileName}"></script>\n    <script src="${prefix}js/i18n.js"></script>`;
  return html.replace(
    /<script src="(?:\.\.\/)?js\/locales\/es-ES\.js"><\/script>\s*\n?\s*<script src="(?:\.\.\/)?js\/locales\/en-GB\.js"><\/script>\s*\n?\s*<script src="(?:\.\.\/)?js\/i18n\.js"><\/script>/,
    block
  );
}

module.exports = {
  loadLocaleMessages,
  bakeMessagesIntoHtml,
  stripI18nAttributes,
  setSingleLocaleScripts,
  fillKeyedElements,
  fillKeyedAttributes,
  escapeAttr,
};
