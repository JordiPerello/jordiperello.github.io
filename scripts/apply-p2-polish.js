const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const ARTICLE_FOOTER_BLOCK = `            <div class="footer-col"><h4 data-i18n="footer.legal">Legal</h4><a href="../privacy.html" data-i18n="footer.privacy">Privacidad</a><a href="../terms.html" data-i18n="footer.terms">Términos</a><a href="../cookies.html" data-i18n="footer.cookies">Cookies</a></div>
            <div class="footer-col"><h4 data-i18n="footer.help">Ayuda</h4><a href="../contact.html" data-i18n="nav.contact">Contacto</a><a href="../faq.html" data-i18n="footer.faq">Preguntas Frecuentes</a><a href="mailto:info@tourai.es" class="footer-email">info@tourai.es</a></div>`;

const LEGAL_PAGES = new Set([
  "privacy.html",
  "terms.html",
  "cookies.html",
  "faq.html",
  "guides.html",
  "targets.html",
  "contact.html",
]);

function walkHtml(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory() && ent.name !== "node_modules" && ent.name !== ".git") {
      walkHtml(full, acc);
    } else if (ent.isFile() && ent.name.endsWith(".html")) {
      acc.push(full);
    }
  }
  return acc;
}

function isArticle(filePath) {
  return filePath.includes(`${path.sep}articles${path.sep}`);
}

function fixLogo(html, filePath) {
  const article = isArticle(filePath);
  const home = article ? "../index.html" : "index.html";
  const imgPrefix = article ? "../img/" : "img/";

  if (html.includes(`href="${home}"><img src="${imgPrefix}tourai_logo_inline.png"`)) {
    return html;
  }

  return html.replace(
    /<div class="nav-logo-container">\s*<img src="((?:\.\.\/)?img\/tourai_logo_inline\.png)" alt="[^"]*">\s*<\/div>/g,
    `<div class="nav-logo-container"><a href="${home}"><img src="$1" alt="TourAI"></a></div>`
  );
}

function fixNavAbout(html, filePath) {
  const basename = path.basename(filePath);
  const article = isArticle(filePath);
  const aboutHref = article ? "../about.html" : "about.html";
  const contactHref = article ? "../contact.html" : "contact.html";

  const navBlock = html.match(/<div class="nav-links"[^>]*>[\s\S]*?<\/div>/);
  if (!navBlock) {
    return html;
  }

  if (navBlock[0].includes("footer.about") || navBlock[0].includes(aboutHref)) {
    return html;
  }

  if (basename === "about.html") {
    return html.replace(
      /(<div class="nav-links"[^>]*>[\s\S]*?)(<a href="contact\.html" data-i18n="nav\.contact">)/,
      `$1<a class="active" data-i18n="footer.about">Sobre nosotros</a>\n            $2`
    );
  }

  const escapedContact = contactHref.replace(/\./g, "\\.");
  const re = new RegExp(
    `(<a href="${escapedContact}" data-i18n="nav\\.contact">)`
  );
  return html.replace(
    re,
    `<a href="${aboutHref}" data-i18n="footer.about">Sobre nosotros</a>\n            $1`
  );
}

function fixArticleFooter(html, filePath) {
  if (!isArticle(filePath)) {
    return html;
  }

  return html.replace(
    /<div class="footer-col"><h4 data-i18n="footer\.legal">Legal<\/h4><a href="\.\.\/privacy\.html"[^>]*>[^<]*<\/a><a href="\.\.\/terms\.html"[^>]*>[^<]*<\/a><\/div>\s*<div class="footer-col"><h4 data-i18n="footer\.help">Ayuda<\/h4><a href="\.\.\/contact\.html"[^>]*>[^<]*<\/a><a href="mailto:info@tourai\.es"[^>]*>info@tourai\.es<\/a><\/div>/,
    ARTICLE_FOOTER_BLOCK
  );
}

function fixHeroImages(html) {
  return html;
}

function ensureLegalLayout(html, filePath) {
  const basename = path.basename(filePath);
  if (!LEGAL_PAGES.has(basename)) {
    return html;
  }

  if (!html.includes('class="site-legal-page"')) {
    html = html.replace(/<body([^>]*)>/, '<body class="site-legal-page"$1>');
  }

  if (!html.includes("legal-layout.css")) {
    html = html.replace(
      /<link rel="stylesheet" href="css\/site\.css">/,
      '<link rel="stylesheet" href="css/site.css">\n    <link rel="stylesheet" href="css/legal-layout.css">'
    );
  }

  return html;
}

function addAboutToMainFooters(html, filePath) {
  if (isArticle(filePath) || path.basename(filePath) === "about.html") {
    return html;
  }

  const exploreBlock = html.match(
    /<div class="footer-col">\s*<h4 data-i18n="footer\.help">[\s\S]*?<\/div>\s*<\/div>\s*<div class="legal-bottom">/
  );
  if (!exploreBlock) {
    return html;
  }

  const helpSection = html.match(
    /<div class="footer-col">\s*<h4 data-i18n="footer\.help">[\s\S]*?<\/div>/
  );
  if (!helpSection || helpSection[0].includes("footer.faq")) {
    return html;
  }

  return html.replace(
    /(<div class="footer-col">\s*<h4 data-i18n="footer\.help">[\s\S]*?<a href="contact\.html" data-i18n="nav\.contact">[^<]*<\/a>)/,
    `$1\n                <a href="faq.html" data-i18n="footer.faq">Preguntas Frecuentes</a>`
  );
}

for (const filePath of walkHtml(root)) {
  if (filePath.includes(`${path.sep}google`)) {
    continue;
  }

  let html = fs.readFileSync(filePath, "utf8");
  const original = html;

  html = fixLogo(html, filePath);
  html = fixNavAbout(html, filePath);
  html = fixArticleFooter(html, filePath);
  html = fixHeroImages(html);
  html = ensureLegalLayout(html, filePath);
  html = addAboutToMainFooters(html, filePath);

  if (html !== original) {
    fs.writeFileSync(filePath, html, "utf8");
    console.log("Updated", path.relative(root, filePath));
  }
}

// Update article footer template script
const wirePath = path.join(root, "scripts", "wire-articles-i18n.js");
let wire = fs.readFileSync(wirePath, "utf8");
const newFooter = `const footer = \`    <footer>
        <div class="footer-grid">
            <div class="footer-col"><h4 data-i18n="footer.explore">Explora</h4><a href="../index.html" data-i18n="nav.app">La App</a><a href="../blog.html" data-i18n="nav.blog">Blog</a><a href="../about.html" data-i18n="footer.about">Sobre nosotros</a></div>
            <div class="footer-col"><h4 data-i18n="footer.legal">Legal</h4><a href="../privacy.html" data-i18n="footer.privacy">Privacidad</a><a href="../terms.html" data-i18n="footer.terms">Términos</a><a href="../cookies.html" data-i18n="footer.cookies">Cookies</a></div>
            <div class="footer-col"><h4 data-i18n="footer.help">Ayuda</h4><a href="../contact.html" data-i18n="nav.contact">Contacto</a><a href="../faq.html" data-i18n="footer.faq">Preguntas Frecuentes</a><a href="mailto:info@tourai.es" class="footer-email">info@tourai.es</a></div>
        </div>
        <div class="legal-bottom">&copy; <span id="y"></span> TourAI App - <span data-i18n="footer.rights">Todos los derechos reservados.</span></div>
    </footer>
    <script>document.getElementById('y').textContent = new Date().getFullYear();</script>
    <script src="../js/site-config.js"></script>
    <script src="../js/locales/en-GB.js"></script>
    <script src="../js/i18n.js"></script>\`;`;

wire = wire.replace(/const footer = `[\s\S]*?`\;/, newFooter);
fs.writeFileSync(wirePath, wire, "utf8");
console.log("Updated scripts/wire-articles-i18n.js");
