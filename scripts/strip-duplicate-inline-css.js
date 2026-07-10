const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const LEGAL_LAYOUT_PAGES = [
  "privacy.html",
  "terms.html",
  "cookies.html",
  "faq.html",
  "guides.html",
  "targets.html",
  "contact.html",
];

function stripStyleBlock(html) {
  return html.replace(/\s*<style>[\s\S]*?<\/style>\s*/i, "\n");
}

for (const file of LEGAL_LAYOUT_PAGES) {
  const filePath = path.join(root, file);
  const original = fs.readFileSync(filePath, "utf8");
  const updated = stripStyleBlock(original);
  if (updated !== original) {
    fs.writeFileSync(filePath, updated, "utf8");
    console.log("Stripped inline CSS:", file);
  }
}

const indexPath = path.join(root, "index.html");
let indexHtml = fs.readFileSync(indexPath, "utf8");
const indexOriginal = indexHtml;
indexHtml = stripStyleBlock(indexHtml);
if (indexHtml !== indexOriginal) {
  fs.writeFileSync(indexPath, indexHtml, "utf8");
  console.log("Stripped inline CSS: index.html");
}
