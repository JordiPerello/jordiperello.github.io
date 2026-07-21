# TourAI — Official website

Static site for **tourai.es** (GitHub Pages): product landing, support pages, and authenticated account area.

## Pages

- `index.html` — App landing and launch waitlist
- `about.html`, `contact.html`, `faq.html` — Product info and support
- `login.html` / `account.html` — Account sign-in and private zone (Firebase Auth)
- `privacy.html`, `terms.html`, `cookies.html` — Legal
- `delete-account.html`, `reset-password.html` — Account self-service

## Deploy

GitHub Actions deploys on push to `main`. Firebase client config is injected from the repository secret `TOURAI_SITE_CONFIG_SECRETS` (see `docs-touraiweb`).

Live site: https://tourai.es

## Local secrets

Copy `D:\Proyectos\Documents\docs-touraiweb\Secrets\site-config.secrets.js` to `js/site-config.secrets.js` (gitignored) before testing login locally.

## Notes

- The website does **not** show advertising (AdMob is app-only).
- App freemium ads use AdMob in the mobile app only.
- Forum / community features are planned for a later phase.

---
© TourAI. All rights reserved.
