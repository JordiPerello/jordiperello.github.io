const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const skip = new Set(["locales", "scripts", "node_modules", ".git"]);

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(js|html)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const files = [...walk(path.join(root, "js")), ...fs.readdirSync(root).filter((f) => f.endsWith(".html")).map((f) => path.join(root, f))];

// Multiline: tOr(\n  "key",\n  "fallback"
const multi = /\b(t|tOr|tContact|tDelete)\(\s*\n\s*(["'])([^"'\\]+)\2\s*,\s*\n\s*(["'])/g;
// Spanish-ish string literals in source (heuristic)
const spanishLit = /["'`][^"'`\n]{0,120}(?:sesión|contraseña|correo|cuenta|pago|guardar|cerrar|Introduce|demasiados|No se pudo|Debes |Hemos |Tu cuenta|¿|¡)[^"'`\n]{0,80}["'`]/gi;

let multiCount = 0;
const htmlIssues = [];
for (const f of files) {
  const c = fs.readFileSync(f, "utf8");
  let m;
  multi.lastIndex = 0;
  while ((m = multi.exec(c))) {
    multiCount += 1;
    console.log("multiline fallback", path.relative(root, f), m[3]);
  }
}

for (const f of fs.readdirSync(root).filter((x) => x.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(root, f), "utf8");
  // strip scripts for body scan
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  // attrs with Spanish
  const attrRe = /\b(aria-label|title|alt|placeholder|content)="([^"]*[ÁÉÍÓÚáéíóúñÑ¿¡�][^"]*)"/g;
  while ((m = attrRe.exec(body))) {
    htmlIssues.push(`${f} ${m[1]}=${JSON.stringify(m[2]).slice(0, 70)}`);
  }
  // visible text nodes
  const textRe = />([^<]{3,})</g;
  while ((m = textRe.exec(body))) {
    const t = m[1].trim();
    if (!t || t === "&times;" || t === "×" || t === "?" || /^[\d\s.,:;_\-–—+/|]+$/.test(t)) continue;
    if (/^(TourAI|Instagram|Facebook|info@tourai\.es|B|I|U|©)/i.test(t)) continue;
    if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/.test(t)) continue;
    // look at open tag
    const before = body.lastIndexOf("<", m.index);
    const tag = body.slice(before, m.index);
    if (/data-i18n|script|style|svg|path|<!--/.test(tag)) continue;
    if (/<[a-z]+\s[^>]*data-i18n/.test(tag)) continue;
    htmlIssues.push(`${f} TEXT ${JSON.stringify(t).slice(0, 80)} :: ${tag.slice(0, 50)}`);
  }
}

console.log("multiline fallbacks:", multiCount);
console.log("html leftover attrs/text:", htmlIssues.length);
htmlIssues.slice(0, 60).forEach((x) => console.log(x));
