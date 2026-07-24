# TourAI — Official website

Static site for **tourai.es** (GitHub Pages): product landing, support pages, and authenticated account area.

## Pages

- `index.html` — App landing and launch waitlist
- `about.html`, `contact.html`, `faq.html` — Product info and support
- `login.html` / `account.html` — Account sign-in and private zone (Firebase Auth)
- `community.html` — Public community (topics/replies in Firestore; see `firestore.community.rules.example`)
- `dashboard.html` — Lazy-loaded plans / payments panel
- `privacy.html`, `terms.html`, `cookies.html` — Legal
- `delete-account.html`, `reset-password.html` — Account self-service

## Deploy

GitHub Actions deploys on push to `main`. Firebase client config is injected from the repository secret `TOURAI_SITE_CONFIG_SECRETS` (see `docs-touraiweb`).

Live site: https://tourai.es

## Local secrets

Copy `D:\Proyectos\Documents\docs-touraiweb\Secrets\site-config.secrets.js` to `js/site-config.secrets.js` (gitignored) before testing login locally.

```powershell
Copy-Item "D:\Proyectos\Documents\docs-touraiweb\Secrets\site-config.secrets.js" `
  "D:\Proyectos\TourAIWeb\jordiperello.github.io\js\site-config.secrets.js"
```

## Run locally with Node (no npm)

Do **not** open the HTML files with `file://` — Firebase Auth will not work. Serve the folder over HTTP with Node only (no `npm` / `npx`):

```powershell
cd D:\Proyectos\TourAIWeb\jordiperello.github.io
node -e "const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');const root=process.cwd();const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.ico':'image/x-icon'};http.createServer((req,res)=>{let p=decodeURIComponent(url.parse(req.url).pathname);if(p==='/')p='/index.html';const file=path.join(root,p);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);}).listen(8080,()=>console.log('http://127.0.0.1:8080/login.html'));"
```

Then open: http://127.0.0.1:8080/login.html

If sign-in fails on localhost, add `localhost` / `127.0.0.1` under Firebase Authentication → Authorized domains, and (if the API key has HTTP referrer restrictions) allow `http://127.0.0.1:8080/*` and `http://localhost:8080/*`.

## Notes

- The website does **not** show advertising (AdMob is app-only).
- App freemium ads use AdMob in the mobile app only.
- Front-end JS is intentionally few modules: `site-ui.js`, `auth.js`, `forms.js`, `account.js`, `community.js` (+ config / i18n).

---
© TourAI. All rights reserved.
