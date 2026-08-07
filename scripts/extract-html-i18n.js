const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "extracted-es-ES.json");

const HTML_FILES = fs
  .readdirSync(ROOT)
  .filter((f) => f.toLowerCase().endsWith(".html"))
  .map((f) => path.join(ROOT, f))
  .sort();

const SPANISH_CHAR_RE = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]/;
const SPANISH_WORD_RE =
  /\b(el|la|los|las|de|del|y|o|en|un|una|por|para|con|sin|que|como|más|mas|también|tambien|este|esta|estos|estas|nuestro|nuestra|tus|su|sus|sí|si|no|aquí|aqui|ahora|gracias|cuenta|iniciar|sesión|sesion|contraseña|contrasena|privacidad|términos|terminos|cookies|contacto|comunidad|reseñas|resenas|sobre|ayuda|menú|menu|cerrar|enviar|guardar|eliminar|cancelar|aceptar|continuar|volver|siguiente|anterior|buscar|filtrar|descargar|registrarse|acceso|usuario|correo|teléfono|telefono|dirección|direccion|política|politica|aviso|legal|condiciones|uso|datos|personales|versión|version|novedades|preguntas|frecuentes|opiniones|reseña|resena|inicio|planes|precio|gratis|pro|premium|nombre|apellido|mensaje|asunto|obligatorio|opcional|idioma|español|ingles|inglés)\b/i;

function looksSpanish(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t || t.length < 2) return false;
  if (/^https?:\/\//i.test(t)) return false;
  if (/^[\w.+-]+@[\w.-]+$/.test(t)) return false;
  if (/^[\d\s.,€$%+-]+$/.test(t)) return false;
  if (/^[A-Za-z0-9._/-]+$/.test(t) && !SPANISH_CHAR_RE.test(t)) return false;
  return SPANISH_CHAR_RE.test(t) || SPANISH_WORD_RE.test(t);
}

/** Read HTML as UTF-8; fall back to Windows-1252/Latin-1 when file has invalid UTF-8. */
function readHtmlFile(filePath) {
  const buf = fs.readFileSync(filePath);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (_) {
    // Common in this repo: Spanish saved as Windows-1252 (é = 0xE9)
    try {
      return new TextDecoder("windows-1252").decode(buf);
    } catch (__) {
      return buf.toString("latin1");
    }
  }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
}

function stripTags(html) {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function getAttr(tag, name) {
  const re = new RegExp(
    "\\b" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
    "i"
  );
  const m = tag.match(re);
  if (!m) return null;
  return m[2] != null ? m[2] : m[3] != null ? m[3] : m[4];
}

function findMatchingClose(html, openEnd, tagName) {
  const openRe = new RegExp("<" + tagName + "\\b[^>]*>", "gi");
  const closeRe = new RegExp("</" + tagName + "\\s*>", "gi");
  let depth = 1;
  let i = openEnd;
  while (i < html.length && depth > 0) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return -1;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      i = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) return nextClose.index;
      i = nextClose.index + nextClose[0].length;
    }
  }
  return -1;
}

function extractElementInner(html, tagStartMatch) {
  const fullOpen = tagStartMatch[0];
  const tagName = (fullOpen.match(/^<\s*([a-z0-9]+)/i) || [])[1];
  if (!tagName) return { innerHTML: "", textContent: "" };
  if (/\/>\s*$/.test(fullOpen)) {
    return { innerHTML: "", textContent: "" };
  }
  const openEnd = tagStartMatch.index + fullOpen.length;
  const closeIdx = findMatchingClose(html, openEnd, tagName);
  if (closeIdx < 0) {
    const closeRe = new RegExp("</" + tagName + "\\s*>", "i");
    const m = html.slice(openEnd).match(closeRe);
    if (!m) return { innerHTML: "", textContent: "" };
    const inner = html.slice(openEnd, openEnd + m.index);
    return { innerHTML: inner, textContent: stripTags(inner) };
  }
  const inner = html.slice(openEnd, closeIdx);
  return { innerHTML: inner, textContent: stripTags(inner) };
}

function qualityScore(s) {
  // Prefer valid Spanish accents; penalize replacement chars / mojibake
  let score = String(s).length;
  if (/\uFFFD/.test(s)) score -= 10000;
  if (/Ã.|Â.|â.|ð./.test(s)) score -= 5000; // classic UTF-8-as-Latin1 mojibake
  if (SPANISH_CHAR_RE.test(s)) score += 50;
  return score;
}

const map = Object.create(null);
const keySources = Object.create(null);
const conflicts = [];
const nonI18n = [];
const encodingNotes = [];

function setKey(key, value, file, kind) {
  if (!key) return;
  const v = String(value == null ? "" : value);
  const normalized =
    kind === "html" ? v.replace(/^\s+|\s+$/g, "") : v.replace(/\s+/g, " ").trim();
  if (!normalized) return;

  const entry = { file: path.basename(file), kind, value: normalized };
  if (!keySources[key]) keySources[key] = [];
  keySources[key].push(entry);

  if (!(key in map)) {
    map[key] = normalized;
    return;
  }
  if (map[key] === normalized) return;

  const prev = map[key];
  const prefer =
    qualityScore(normalized) > qualityScore(prev) ? normalized : prev;
  if (prefer !== prev) {
    map[key] = prefer;
  }
  conflicts.push({
    key,
    kept: prefer,
    discarded: prefer === prev ? normalized : prev,
    files: keySources[key].map((e) => e.file + ":" + e.kind),
  });
}

function processFile(filePath) {
  const html = readHtmlFile(filePath);
  if (html.includes("\uFFFD")) {
    encodingNotes.push(path.basename(filePath) + ": still has U+FFFD after decode");
  }

  {
    const re = /<title\b([^>]*)>([\s\S]*?)<\/title>/gi;
    let m;
    while ((m = re.exec(html))) {
      const attrs = m[1] || "";
      const key =
        getAttr(attrs, "data-i18n-doc-title") || getAttr(attrs, "data-i18n");
      if (key) {
        setKey(key, decodeEntities(m[2].trim()), filePath, "doc-title");
      }
    }
  }

  {
    const re = /<meta\b([^>]*)\/?>/gi;
    let m;
    while ((m = re.exec(html))) {
      const attrs = m[1] || "";
      const key = getAttr(attrs, "data-i18n-meta");
      if (key) {
        const content = getAttr(attrs, "content") || "";
        setKey(key, decodeEntities(content), filePath, "meta");
      }
    }
  }

  {
    const re = /<([a-z0-9]+)\b([^>]*\bdata-i18n-placeholder\s*=[^>]*)>/gi;
    let m;
    while ((m = re.exec(html))) {
      const attrs = m[2];
      const key = getAttr(attrs, "data-i18n-placeholder");
      const ph = getAttr(attrs, "placeholder") || "";
      if (key) setKey(key, decodeEntities(ph), filePath, "placeholder");
    }
  }

  {
    const re = /<([a-z0-9]+)\b([^>]*\bdata-i18n-title\s*=[^>]*)>/gi;
    let m;
    while ((m = re.exec(html))) {
      const attrs = m[2];
      const key = getAttr(attrs, "data-i18n-title");
      const title = getAttr(attrs, "title") || "";
      if (key) setKey(key, decodeEntities(title), filePath, "title");
    }
  }

  {
    const re = /<([a-z0-9]+)\b([^>]*\bdata-i18n-html\s*=[^>]*)>/gi;
    let m;
    while ((m = re.exec(html))) {
      const attrs = m[2];
      const key = getAttr(attrs, "data-i18n-html");
      if (!key) continue;
      const { innerHTML } = extractElementInner(html, m);
      setKey(key, innerHTML, filePath, "html");
    }
  }

  {
    const re = /<([a-z0-9]+)\b([^>]*\bdata-i18n\s*=[^>]*)>/gi;
    let m;
    while ((m = re.exec(html))) {
      const attrs = m[2];
      if (/\bdata-i18n-html\s*=/i.test(attrs)) continue;
      if (/\bdata-i18n-doc-title\s*=/i.test(attrs) && /^title$/i.test(m[1]))
        continue;
      const key = getAttr(attrs, "data-i18n");
      if (!key) continue;
      const aria = getAttr(attrs, "aria-label");
      const { textContent } = extractElementInner(html, m);
      let value = textContent;
      if (!value && aria) value = decodeEntities(aria);
      if (!value) {
        const t = getAttr(attrs, "title");
        if (t) value = decodeEntities(t);
      }
      setKey(key, value, filePath, "text");
    }
  }

  collectNonI18n(html, path.basename(filePath));
}

function tagHasI18n(attrs) {
  return /\bdata-i18n(-[a-z]+)?\s*=/i.test(attrs || "");
}

function maskI18nRegions(html) {
  // Blank out elements that already have data-i18n / data-i18n-html so nested
  // Spanish is not reported as "missing" (it is covered by the parent key).
  let out = html;
  const re = /<([a-z0-9]+)\b([^>]*\bdata-i18n(?:-html)?\s*=[^>]*)>/gi;
  const hits = [];
  let m;
  while ((m = re.exec(html))) hits.push(m);
  // Process from the end so indexes stay valid
  for (let i = hits.length - 1; i >= 0; i--) {
    const hit = hits[i];
    const tagName = hit[1];
    const fullOpen = hit[0];
    const openEnd = hit.index + fullOpen.length;
    if (/\/>\s*$/.test(fullOpen)) {
      out =
        out.slice(0, hit.index) +
        " ".repeat(fullOpen.length) +
        out.slice(openEnd);
      continue;
    }
    const closeIdx = findMatchingClose(html, openEnd, tagName);
    const end =
      closeIdx < 0
        ? openEnd
        : closeIdx + ("</" + tagName + ">").length;
    const len = Math.max(0, end - hit.index);
    out = out.slice(0, hit.index) + " ".repeat(len) + out.slice(end);
  }
  return out;
}

function collectNonI18n(html, base) {
  let cleaned = maskI18nRegions(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const re =
    /<(p|h[1-6]|li|label|button|a|span|td|th|option|legend|figcaption|strong|em|small|div)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  let m;
  let guard = 0;
  while ((m = re.exec(cleaned)) && guard < 8000) {
    guard++;
    const tag = m[1];
    const attrs = m[2] || "";
    const inner = m[3] || "";
    if (tagHasI18n(attrs)) continue;
    const hasChildBlocks =
      /<(p|h[1-6]|li|div|section|ul|ol|table|form|article)\b/i.test(inner);
    if (hasChildBlocks && /^(div)$/i.test(tag)) continue;

    const text = stripTags(inner);
    if (!looksSpanish(text)) continue;
    const snippet = text.length > 160 ? text.slice(0, 157) + "..." : text;
    const key = base + "|" + snippet.slice(0, 80);
    if (nonI18n.some((x) => x._k === key)) continue;
    nonI18n.push({ _k: key, file: base, tag, snippet });
  }

  const attrRe = /<([a-z0-9]+)\b([^>]*)>/gi;
  let am;
  while ((am = attrRe.exec(cleaned))) {
    const attrs = am[2] || "";
    if (tagHasI18n(attrs)) continue;
    for (const name of ["placeholder", "title", "aria-label", "alt", "value"]) {
      const v = getAttr(attrs, name);
      if (!v || !looksSpanish(v)) continue;
      const snippet = decodeEntities(v).replace(/\s+/g, " ").trim();
      if (snippet.length > 160) continue;
      const k = base + "|@" + name + "|" + snippet.slice(0, 80);
      if (nonI18n.some((x) => x._k === k)) continue;
      nonI18n.push({
        _k: k,
        file: base,
        tag: am[1] + "[" + name + "]",
        snippet,
      });
    }
  }
}

for (const f of HTML_FILES) {
  processFile(f);
}

const conflictUnique = [];
const seenC = new Set();
for (const c of conflicts) {
  const id = c.key + "||" + c.kept + "||" + c.discarded;
  if (seenC.has(id)) continue;
  seenC.add(id);
  conflictUnique.push(c);
}

const keys = Object.keys(map).sort();
const sorted = {};
for (const k of keys) sorted[k] = map[k];

fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2), "utf8");

const byKind = {};
for (const k of keys) {
  const kinds = (keySources[k] || []).map((e) => e.kind);
  const kind = kinds.includes("html")
    ? "html"
    : kinds.includes("doc-title")
      ? "doc-title"
      : kinds.includes("meta")
        ? "meta"
        : kinds.includes("placeholder")
          ? "placeholder"
          : kinds.includes("title")
            ? "title"
            : "text";
  byKind[kind] = (byKind[kind] || 0) + 1;
}

console.log("=== extract-html-i18n ===");
console.log("HTML files scanned:", HTML_FILES.length);
console.log(
  "Files:",
  HTML_FILES.map((f) => path.basename(f)).join(", ")
);
console.log("Keys extracted:", keys.length);
console.log("By kind:", JSON.stringify(byKind));
console.log("Conflicts:", conflictUnique.length);
console.log("Non-i18n Spanish candidates:", nonI18n.length);
console.log("Output:", OUT);
if (encodingNotes.length) {
  console.log("Encoding notes:", encodingNotes.join("; "));
}

if (conflictUnique.length) {
  console.log("\n--- CONFLICTS ---");
  for (const c of conflictUnique) {
    console.log(
      JSON.stringify({
        key: c.key,
        keptLen: c.kept.length,
        discardedLen: c.discarded.length,
        keptPreview: c.kept.slice(0, 120),
        discardedPreview: c.discarded.slice(0, 120),
        files: [...new Set(c.files)],
      })
    );
  }
}

console.log("\n--- NON-I18N SPANISH (top 30) ---");
nonI18n.slice(0, 30).forEach((x, i) => {
  console.log(
    (i + 1) + ". " + x.file + " <" + x.tag + ">: " + JSON.stringify(x.snippet)
  );
});

const reportPath = path.join(__dirname, "extracted-es-ES.report.json");
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      keys: keys.length,
      byKind,
      conflicts: conflictUnique,
      nonI18n: nonI18n.map(({ file, tag, snippet }) => ({ file, tag, snippet })),
      encodingNotes,
      output: OUT,
    },
    null,
    2
  ),
  "utf8"
);
console.log("\nReport:", reportPath);