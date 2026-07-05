# CONTEXT.md — Registres Carnaval

Rolling architecture + changelog document. **Update after every code change.** Conventions and guardrails live in `CLAUDE.md`; session state in `HANDOFF.md`.

## What this app is

Public registration + supply-ordering app for carnival groups ("colles"), Catalan UI only.

- **Participants** (anonymous): enter a 6-char colla code → personal-data form (nom, cognoms, DNI/NIE, correu, telèfon) → confirm → scroll-read T&C → accept. The registration is written to Firestore **only at acceptance** (single `create` with `tcAccepted: true`).
- **Caps de colla** (email/password login): per-colla dashboard — registered people (view/delete/Excel), per-colla T&C PDF upload, and **Comandes**: order supplies (gel, menjar, beguda…) from the admin-managed catalog, with order history.
- **Admins** (`marna96@gmail.com`, `said@magmamedia.cat`, hardcoded in rules): manage caps (creation sends a set-password email; no passwords stored anywhere), colles (6-char code generation, cap assignment), all registrations, the services catalog, and all orders with aggregated shopping-list totals + two-sheet Excel export.

## Architecture

No build step, no framework, no tests. Three files:

- `index.html` — all views as sibling `<div class="view">` blocks toggled by `showView(id)`; admin dashboard uses sidebar `data-admin-tab` switching; cap dashboard has a Registres/Comandes sub-nav.
- `js/firebase-config.js` — Firebase compat SDK init (`auth`, `db`, `storage` globals). Project `registre-carnaval`.
- `js/app.js` — one IIFE. Module-level state: `currentUser/currentRole`, `pendingRegistration`, `capColles`, `capActiveCollaId`, `servicesCache`, `adminOrdersCache`, `editingServiceId`. Role routing in `onAuthStateChanged`: `admins/{email}` doc → admin; `caps/{email}` doc → cap; else sign out.

CDN deps: Firebase 10 compat, SheetJS (Excel), Google Fonts (Oswald). After editing app.js: `node --check js/app.js` is the only safety net.

## Firestore collections

| Collection | Shape | Access (rules) |
|---|---|---|
| `admins/{email}` | `{ email }` | read: own/admin · write: admin |
| `caps/{email}` | `{ email, name, createdAt }` — **doc ID = email** (rules depend on it) | read: own/admin · write: admin |
| `colles/{autoId}` | `{ name, code, capEmails[], pdfUrl?, pdfName?, createdAt }` | read: public (landing code check) · create/delete: admin · update: admin, or assigned cap touching only `pdfUrl`/`pdfName` |
| `registrations/{autoId}` | `{ name, surname, idNumber, email, phone, collaCode, collaName, collaId, tcAccepted, timestamp }` | create: public but validated (exact keys, `tcAccepted==true`, colla exists) · read/update/delete: admin or owning-colla cap |
| `services/{autoId}` | `{ name, price:number, unit, category, imageUrl?, imagePath?, link?, createdAt }` | read: any authed · write: admin |
| `orders/{autoId}` | `{ collaId, collaCode, collaName, capEmail, items[{serviceId, serviceName, unitPrice, unit, category, quantity}], total, createdAt, updatedAt }` — items snapshot prices | create: owning cap (capEmail must match) or admin, exact keys · read/delete: admin or owning cap · update: same + `collaId` immutable |
| `meta/{docId}` | migration markers (`migrations: {v}`) | admin only |

**Cap scoping mechanism**: `capOwnsColla(collaId)` in rules does `auth.email in get(/colles/$(collaId)).data.capEmails`. This works for list queries **only** because cap queries filter `where('collaId','==', …)` — an equality filter the rules engine can bind. Composite indexes required: `registrations(collaId ASC, timestamp DESC)`, `orders(collaId ASC, createdAt DESC)`.

**Storage**: `terms/{collaId}/…` (T&C PDFs; public read, cap/admin write via cross-service Firestore check) and `services/…` (catalog images; public read, admin write, ≤5 MB image/*).

## Deployment

Git is the source of truth for everything.

- **Frontend**: push to `main` → GitHub Pages (https://scaredmeeseks.github.io/Registres-Carnaval/). No cache-bump mechanism; browsers may serve stale JS for a while.
- **Rules**: Cloud Shell → `cd ~/Registres-Carnaval && ./deploy.sh`. The guard script verifies git remote + `.firebaserc`, pulls, and deploys with explicit `--project registre-carnaval` (see CLAUDE.md for the 2026-07-05 wrong-project incident that motivated it). Never bare `firebase deploy`.
- **Indexes**: managed in the console, deliberately not in the repo.
- Admin SDK one-off scripts (migrations, cleanups, password sets) run from Cloud Shell `~` with `firebase-admin` + built-in credentials.

## Known issues / accepted trade-offs

- `colles` is publicly readable (needed for landing code validation) → colla names + cap emails are enumerable.
- Anonymous `registrations` create is open (validated shape only) — App Check would be the next step if spam appears.
- Old registrations whose colla was deleted have no `collaId` → invisible to caps, admin-only.
- Existing caps kept their pre-overhaul Auth passwords; recovery path is the admin "🔁 Correu contrasenya" button.
- Legacy composite index `registrations(collaCode, timestamp)` still exists in console; delete after a few days (stale cached frontends).

## Changelog

### 2026-07-05 (later) — Comandes feature rebuilt (`4bf2c66`, `b4fcd1c`)
- Rebuilt the lost orders feature from surviving Firestore data (`services` + `orders` collections; original code was never committed).
- Cap dashboard: Registres/Comandes sub-nav; catalog grouped by category with live total; per-colla order history with delete. Orders snapshot item prices; `total` stored rounded to cents.
- Admin: Serveis tab (CRUD, image upload to Storage `services/` storing `imagePath` for deletion, legacy docs fall back to `refFromURL`); Comandes tab (all orders, colla filter, expandable detail rows, aggregated totals, two-sheet Excel export).
- Rules for `services`/`orders` + Storage `services/` block; `deploy.sh` guard script added.
- Data cleanup (Cloud Shell): deleted test order, stripped joke `link`s, `price` strings → numbers.

### 2026-07-05 — Git workflow + security overhaul (`2dd82ae`)
- Repo moved to git-as-source-of-truth (was GitHub web uploads + console-pasted rules). Added `firebase.json`, `.firebaserc`, `storage.rules`, CLAUDE/HANDOFF docs.
- Removed hardcoded admin credentials + page-load seeding from `app.js` (old password is in public git history → both admin accounts re-passworded).
- Cap onboarding switched to password-reset email; `plainPassword` removed from Firestore; caps re-keyed to email doc IDs (migration v1, run via Admin SDK after the in-app run was missed).
- Registration flow: single write after T&C acceptance (was create-then-anonymous-update); terms listeners made one-time to prevent duplicate-doc stacking.
- Rules rewritten: per-colla server-side scoping via `collaId`, no anonymous update/delete anywhere, colla updates by caps limited to PDF fields.
- **Incident**: first rules deploy landed on `mundial2026-ec8e7` (Firebase CLI remembered project overrode `.firebaserc`); Mundial rules restored from its repo. Guards documented in both projects, later automated by `deploy.sh`.

### Pre-2026-07-05 (historical)
- App built via GitHub web uploads (last: 2026-04-06). An orders/services version existed ~2026-05-01 but was never uploaded; its code is lost (data survived).
