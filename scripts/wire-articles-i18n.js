const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "articles");
const slugs = [
  "what-is-tourai",
  "plan-trip-with-ai",
  "audio-guides-vs-group-tours",
  "kyoto-7-days",
  "visit-monuments-without-crowds",
  "mobile-travel-gps-privacy",
  "lisbon-algarve-spring",
];

const footer = `    <footer>
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
    <script src="../js/i18n.js"></script>`;

for (const slug of slugs) {
  const file = path.join(dir, `${slug}.html`);
  let html = fs.readFileSync(file, "utf8");

  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="" data-i18n-meta="doc.meta.${slug}">`
  );

  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const titleText = titleMatch ? titleMatch[1] : slug;
  html = html.replace(
    /<title>[^<]*<\/title>/,
    `<title data-i18n-doc-title="doc.title.${slug}">${titleText}</title>`
  );

  html = html.replace(
    /<header class="article-header">[\s\S]*?<\/header>/,
    (block) => {
      const metaMatch = block.match(/<p class="article-meta">([\s\S]*?)<\/p>/);
      const meta = metaMatch ? metaMatch[1].trim() : "";
      const h1Match = block.match(/<h1>([^<]*)<\/h1>/);
      const h1 = h1Match ? h1Match[1] : slug;
      return `<header class="article-header">
        <p class="article-meta" data-i18n-html="article.${slug}.meta">${meta}</p>
        <h1 data-i18n="article.${slug}.title">${h1}</h1>
    </header>`;
    }
  );

  html = html.replace(
    /<main class="article-body">/,
    `<main class="article-body" data-i18n-html="article.${slug}.content">`
  );

  html = html.replace(/<footer>[\s\S]*?<\/html>/, `${footer}\n</body>\n</html>`);

  fs.writeFileSync(file, html, "utf8");
  console.log("Updated", slug);
}
