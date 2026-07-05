# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `CONTEXT.md` first** — it is the rolling architecture + changelog document and MUST be updated after every code change.

## What this app is

**Registre Carnaval** — public registration + supply-ordering app for carnival groups ("colles"). A participant enters a 6-character colla code, fills a personal-data form (name, surname, DNI/NIE, email, phone), confirms, scroll-reads the Terms & Conditions, and accepts — only then is the registration written to Firestore (single write, `tcAccepted: true`). Caps de colla log in to manage their colla's registrations and place supply orders (Comandes) from an admin-managed catalog; admins manage caps, colles, the catalog, and see all registrations and orders.

UI language is **Catalan only** (no i18n system — strings are hardcoded in HTML/JS).

## Hosting & deployment

Git is the source of truth for everything.

- **Frontend**: GitHub Pages from `main` of https://github.com/ScaredMeeseks/Registres-Carnaval — **pushing to `main` deploys the site**. No build step. **No cache control**: browsers may serve stale JS for a while after a deploy (a cap hit rules errors on 2026-07-05 because cached old JS queried fields the new rules reject) — after deploying breaking changes, expect users to need a hard refresh. Moving to Firebase Hosting (no-cache headers, private repo possible) was considered and deferred.
- **Firestore/Storage rules**: deployed from the repo via Cloud Shell using the guard script:
  ```bash
  cd ~/Registres-Carnaval && ./deploy.sh
  # (first time: git clone https://github.com/ScaredMeeseks/Registres-Carnaval.git ~/Registres-Carnaval)
  ```
  `deploy.sh` verifies the git remote and `.firebaserc`, pulls, and deploys with an explicit `--project registre-carnaval` — because on 2026-07-05 a bare `firebase deploy` from this folder landed on `mundial2026-ec8e7` (the CLI's remembered active project overrode `.firebaserc`) and wiped that project's rules. Never deploy with a bare `firebase deploy`; always the script, and still read the `=== Deploying to '...'` header. The `(project)` in the Cloud Shell prompt is gcloud's, not the Firebase CLI's.
  `firebase.json` deliberately configures **only rules** — no hosting (GitHub Pages does that) and no indexes file (indexes are managed in the console; composite indexes that must exist: registrations `(collaId asc, timestamp desc)` and orders `(collaId asc, createdAt desc)`).
- **Firebase project**: `registre-carnaval` (config in `js/firebase-config.js`). Firestore + Auth + Storage.
- Never edit rules directly in the Firebase Console — change the repo files and deploy.
- One-off data scripts (migrations, cleanups, password sets) run from Cloud Shell `~` with the Admin SDK (`npm install firebase-admin --no-save`, ADC credentials are automatic).

There is no test suite, no npm on the frontend, no local server script. After editing `js/app.js`, run `node --check js/app.js` — it's the only safety net; a syntax error breaks the whole app.

## Architecture

Three files do everything:

- `index.html` — all 8 views as sibling `<div class="view">` blocks, toggled with the `hidden` attribute by `showView(id)` in `app.js`. Views: landing (code entry) → register → confirm → terms → success, plus login, cap dashboard, admin dashboard.
- `js/firebase-config.js` — initializes Firebase compat SDK (v10 compat, loaded from CDN in index.html); exposes `auth`, `db`, `storage` as globals.
- `js/app.js` — single IIFE containing all logic. State is module-level `let` variables (`currentUser`, `currentRole`, `pendingRegistration`, `capColles`…). No framework.

External CDN deps in `index.html`: Firebase compat SDKs, SheetJS (`XLSX`) for Excel export, Google Fonts (Oswald).

### Firestore collections (flat, no tenancy)

| Collection | Doc shape | Notes |
|---|---|---|
| `admins/{email}` | `{ email }` | Doc ID = email. Created manually (no seeding code) |
| `caps/{email}` | `{ email, name, createdAt }` | **Doc ID = email** (rules depend on this). No passwords stored |
| `colles/{autoId}` | `{ name, code, capEmails: [], pdfUrl?, pdfName?, createdAt }` | `code` is unique 6-char (no ambiguous chars). `capEmails` array links caps |
| `registrations/{autoId}` | `{ name, surname, idNumber, email, phone, collaCode, collaName, collaId, tcAccepted, timestamp }` | Written once, after T&C acceptance; `collaId` is what rules and cap-dashboard queries key on |
| `services/{autoId}` | `{ name, price: number, unit, category, imageUrl?, imagePath?, link?, createdAt }` | Orderable catalog, admin-managed; images in Storage `services/`. Legacy docs may lack `imagePath` (delete falls back to `refFromURL`) |
| `orders/{autoId}` | `{ collaId, collaCode, collaName, capEmail, items: [{serviceId, serviceName, unitPrice, unit, category, quantity}], total, createdAt, updatedAt }` | Multiple per colla; items snapshot the price at order time. Rules scope by `collaId` like registrations |
| `meta/{docId}` | `{ v, ranAt }` | Migration markers (admin-only) |

### Roles & security model

- **Admin**: emails hardcoded in `firestore.rules`/`storage.rules` (`isAdmin()`): `marna96@gmail.com`, `said@magmamedia.cat`. No credentials in client code. Admin dashboard: manage caps, colles, all registrations, the services catalog, and all orders.
- **Cap de colla**: has a `caps/{email}` doc. Sees only colles where `colles.capEmails` contains their email. Rules enforce per-colla access to registrations server-side via `capOwnsColla()`: `request.auth.token.email in get(/colles/$(resource.data.collaId)).data.capEmails`. This works for queries **only because** the cap dashboard filters with `where('collaId','==',…)` — an equality filter the rules engine can bind. Don't change those queries to other fields without rethinking the rules.
- **Anonymous**: public read of `colles` (landing code check) and validated create of `registrations` (must have exactly the known keys, `tcAccepted == true`, and an existing `collaId`). No anonymous updates or deletes anywhere.
- Routing happens in `onAuthStateChanged` (`initAuthListener`): checks `admins/{email}` doc, then `caps/{email}` doc, else signs out.

### Key mechanisms

- **Cap onboarding (no stored passwords)**: admin form creates the Auth account via the Identity Toolkit REST API (`accounts:signUp`, throwaway random password — doesn't disturb the admin's session), then `sendPasswordResetEmail` so the cap sets their own password. The caps table has a "🔁 Correu contrasenya" resend button.
- **T&C gating**: checkbox stays disabled until the iframe container is scrolled to bottom (20px tolerance). Per-colla custom PDF (`colles.pdfUrl`, uploaded to Storage `terms/{collaId}/`) overrides the default `docs/terms.html`. Listener setup is one-time (`initTerms()`); per-entry reset is `resetTermsView()` — **do not re-attach listeners per registration** (stacked handlers would create duplicate docs).
- **Migrations**: `runMigrations()` runs on admin login, guarded by the `meta/migrations` marker. v1 re-keyed caps by email (dropping `plainPassword`) and backfilled `collaId` on registrations. Bump `v` for future one-time migrations.
- **Registrations queries** use `where('collaId','==',…).orderBy('timestamp','desc')` — requires the composite index noted above.
- **Comandes (orders)**: cap dashboard has a Registres/Comandes sub-nav. Caps build an order from the services catalog (`servicesCache`, loaded once per session, sorted client-side — no index) and submit; own-colla history queries `where('collaId','==',…).orderBy('createdAt','desc')` (composite index). Admin manages the catalog (Serveis tab; images uploaded to Storage `services/` with `imagePath` stored for deletion) and sees all orders + aggregated shopping-list totals with a two-sheet Excel export (Comandes tab).

## Conventions

- Plain DOM manipulation with `$`/`$$` helpers; event delegation on table bodies for row buttons.
- Always render user data through `escapeHtml()`; timestamps through `formatTimestamp()` (ca-ES locale).
- All UI text in Catalan.
- Errors: inline `.error-msg` divs on auth/forms, `toast(msg, type)` elsewhere.

## History notes

- Before 2026-07-05 the repo was maintained via GitHub web uploads, admin passwords were hardcoded in `app.js`, and cap passwords were stored in plaintext. All fixed; the old admin password is still in git history, so those Auth accounts were given new passwords.

## Session handoff

When the user says the session is finished, update `HANDOFF.md` (rolling doc, overwritten each session — current state, session summary, pending items).
