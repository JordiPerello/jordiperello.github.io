const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      if (entry === "scripts" || entry === "node_modules") continue;
      walk(full);
      continue;
    }
    if (!entry.endsWith(".html")) continue;
    let html = fs.readFileSync(full, "utf8");
    const before = html;
    html = html.replace(/<html lang="es">/g, '<html lang="es-ES">');
    html = html.replace(/data-set-locale="es"/g, 'data-set-locale="es-ES"');
    html = html.replace(/\?\? 'es'/g, "?? 'es-ES'");
    if (html !== before) {
      fs.writeFileSync(full, html, "utf8");
      console.log("Updated", path.relative(root, full));
    }
  }
}

walk(root);
