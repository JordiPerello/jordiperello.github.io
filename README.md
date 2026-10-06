# TourAI — Official website

Static site for **tourai.es** (GitHub Pages): product landing, support pages, and authenticated account area.

## Languages and URLs

- **Spanish (Spain):** pages at the site root (`/`, `/faq.html`, …).
- **English (United Kingdom):** the same pages under **`/en/`** (`/en/`, `/en/faq.html`, …).
- Copy is **baked into each HTML file** (crawlers and users do not depend on client-side translation).
- The header language switcher uses normal links to the equivalent page in the other language.
- `js/locales/es-ES.js` and `js/locales/en-GB.js` hold **runtime UI strings only** (account panel, forms, community, auth messages). Each public page loads **one** locale file matching its language.

## Pages

| Spanish (root) | English (`/en/`) | Notes |
|----------------|------------------|--------|
| `index.html` | `en/index.html` | Landing, launch waitlist |
| `about.html`, `contact.html`, `faq.html` | `en/…` | Product info and support |
| `privacy.html`, `terms.html`, `cookies.html` | `en/…` | Legal (Spanish is reference for web terms) |
| `community.html`, `reviews.html`, `whats-new.html` | `en/…` | Public UGC / release notes |
| `login.html`, `register.html`, `account.html`, `dashboard.html` | `en/…` | Firebase Auth; account/dashboard `noindex` |
| `delete-account.html`, `reset-password.html` | `en/…` | Account self-service |

Public SEO URLs are listed in `sitemap.xml` (10 pages × 2 languages). Auth-only pages are omitted from the sitemap.

## Deploy

GitHub Actions deploys on push to `main`. Firebase client config is injected from the repository secret `TOURAI_SITE_CONFIG_SECRETS` (see `docs-touraiweb`).

Live site: https://tourai.es

## Local secrets

**Never commit secrets.** The real file lives outside this repo:

`D:\Proyectos\Documents\docs-touraiweb\Secrets\site-config.secrets.js`

For local login / checkout, copy it to gitignored `js/site-config.secrets.js` so the browser can load it (agents may read the canonical path directly; do not put secrets in tracked files).

```powershell
Copy-Item "D:\Proyectos\Documents\docs-touraiweb\Secrets\site-config.secrets.js" `
  "D:\Proyectos\TourAIWeb\jordiperello.github.io\js\site-config.secrets.js"
```

Web plan checkout (`createCheckoutSessionWeb`) also needs:

- `firebaseAuth.appId` (Firebase web app id)
- `appCheckRecaptchaSiteKey` (reCAPTCHA v3 site key registered in Firebase App Check)
- optional `appCheckDebug: true` on localhost (then register the browser debug token in App Check)

Deploy the Cloud Function from `D:\Proyectos\TourAI\firebase` (`createCheckoutSessionWeb`). Fulfillment reuses `stripeWebhook` on the **Production** Firebase project.

Stripe is in **Test mode** for both Firebase environments until go-live: use `sk_test_...` and a **Test mode** webhook pointing to `https://europe-west1-tourai-production-7dabf.cloudfunctions.net/stripeWebhook` (see `TourAI/firebase/README.md`).

## Editing copy and SEO shell

1. **Spanish body/head copy:** edit `*.html` in the repo root.
2. **English body/head copy:** edit `en/*.html` directly (do not expect auto-translation from Spanish).
3. **Dynamic JS messages:** add keys to `js/locales/es-ES.js` and `en-GB.js`, then run `node scripts/prune-locale-files.js`.
4. **Hreflang, sitemap, language switcher paths:** `node scripts/sync-static-site.js` (runs `build-en-pages.js`, optional Spanish bake if templates still had `data-i18n`, then prune). After migration, routine legal/marketing edits are usually **manual HTML in both languages**; use sync when adding a new public page or changing URL structure.

Scripts live in `scripts/` (`build-en-pages.js`, `bake-spanish-html.js`, `i18n-html-bake-lib.js`, `prune-locale-files.js`, `sync-static-site.js`).

## Run locally

Do **not** open the HTML files with `file://` — Firebase Auth will not work. Serve the folder over HTTP, for example:

```powershell
cd D:\Proyectos\TourAIWeb\jordiperello.github.io
npx --yes serve -l 8080 .
```

Then open http://127.0.0.1:8080/ or http://127.0.0.1:8080/en/ (same as production). The repo includes `serve.json` so **`npx serve`** rewrites `/en` and `/en/` to `en/index.html`. If you use another static server and get **404** on `/en/`, open http://127.0.0.1:8080/en/index.html or switch to `npx serve` from the repo root.

If sign-in fails on localhost, add `localhost` / `127.0.0.1` under Firebase Authentication → Authorized domains, and (if the API key has HTTP referrer restrictions) allow `http://127.0.0.1:8080/*` and `http://localhost:8080/*`.

## Notes

- Front-end JS modules: `site-ui.js`, `site-promo.js`, `auth.js`, `forms.js`, `account.js`, `community.js`, `reviews.js`, `whats-new.js`, `i18n.js`, config.
- Lawyer PDF export reads published Spanish legal HTML from this repo (`legal-export` tooling); see `D:\Proyectos\Documents\legal-export\README.md`.

---
© TourAI. All rights reserved.
