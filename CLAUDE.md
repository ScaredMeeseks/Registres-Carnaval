# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `CONTEXT.md` first** — it is the rolling architecture + changelog document and MUST be updated after every code change.

## What this app is

**Registre Carnaval** — account-based registration + colla-page app for carnival groups ("colles"). The app opens on a login page; first-timers register with a 6-character colla code + personal data + password, confirm, scroll-accept the colla's T&C — only then are the Auth account, the `registrations` doc and the `users/{email}` profile written (if the colla has no published T&C, the terms screen is skipped and the member is prompted to accept at a later login). Members see their colla page: cap-published posts (pinned/images/YouTube) and forms to answer, plus member names. Caps de colla manage registrations (Pagament + T&C status), publish posts, build forms with response summaries/Excel, and place supply orders (Comandes); admins manage caps, colles, the services catalog, and see all registrations and orders.

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
  `firebase.json` deliberately configures **only rules** — no hosting (GitHub Pages does that) and no indexes file (indexes are managed in the console; composite indexes that must exist: registrations `(collaId asc, timestamp desc)`, orders `(collaId asc, createdAt desc)` and posts `(collaId asc, createdAt desc)`).
- **Pages deploy gotcha**: the "pages build and deployment" Actions run can fail transiently on the deploy step (happened 2026-07-05) — the site then silently serves old code. If a push doesn't show up live, check the Actions tab and retrigger (empty commit) if needed.
- **Firebase project**: `registre-carnaval` (config in `js/firebase-config.js`). Firestore + Auth + Storage.
- Never edit rules directly in the Firebase Console — change the repo files and deploy.
- One-off data scripts (migrations, cleanups, password sets) run from Cloud Shell `~` with the Admin SDK (`npm install firebase-admin --no-save`, ADC credentials are automatic).

There is no test suite, no npm on the frontend, no local server script. After editing `js/app.js`, run `node --check js/app.js` — it's the only safety net; a syntax error breaks the whole app.

## Architecture

Three files do everything:

- `index.html` — all 9 views as sibling `<div class="view">` blocks, toggled with the `hidden` attribute by `showView(id)` in `app.js`. Views: **login (initial)**, register flow (landing = colla-code step → register → confirm → terms → success), user (member) dashboard, cap dashboard (sub-nav: Registres / Comandes / Publicacions / Formularis), admin dashboard (sidebar tabs).
- `js/firebase-config.js` — initializes Firebase compat SDK (v10 compat, loaded from CDN in index.html); exposes `auth`, `db`, `storage` as globals.
- `js/app.js` — single IIFE containing all logic. State is module-level `let` variables (`currentUser`, `currentRole`, `currentUserProfile`, `pendingRegistration`/`pendingPassword`, `registrationInProgress`, `termsMode`, `capColles`, `capFormsCache`, `userFormsCache`…). No framework.

External CDN deps in `index.html`: Firebase compat SDKs, SheetJS (`XLSX`) for Excel export, Google Fonts (Oswald).

### Firestore collections (flat, no tenancy)

| Collection | Doc shape | Notes |
|---|---|---|
| `admins/{email}` | `{ email }` | Doc ID = email. Created manually (no seeding code) |
| `caps/{email}` | `{ email, name, createdAt }` | **Doc ID = email** (rules depend on this). No passwords stored |
| `users/{email}` | `{ email, name, surname, collaId, collaCode, collaName, regId, createdAt, tcPending? }` | **Doc ID = email.** Member profile: role routing, member-name lists, account→registration link (`regId`). `tcPending` = must accept T&C at login |
| `colles/{autoId}` | `{ name, code, capEmails: [], pdfUrl?, pdfName?, createdAt }` | `code` is unique 6-char (no ambiguous chars). `capEmails` array links caps |
| `registrations/{autoId}` | `{ name, surname, idNumber, email, phone, collaCode, collaName, collaId, tcAccepted, timestamp, paid? }` | Created by the member's own account (email must match); `tcAccepted:false` allowed only while the colla has no `pdfUrl`; `paid` = cap's Pagament checkbox. Members can never read these |
| `posts/{autoId}` | `{ collaId, title, body?, url?, imageUrl?, imagePath?, pinned?, authorEmail, createdAt }` | Cap-published colla-page content; images in Storage `posts/{collaId}/`; YouTube urls render embedded |
| `forms/{autoId}` | `{ collaId, title, description?, questions[], authorEmail, createdAt }` | Cap-built questionnaires; **immutable once created** (question index = answer key). Questions: `{text, type:'single'\|'multi', options[], allowOther, required}` |
| `forms/{id}/responses/{email}` | `{ email, name, answers[], submittedAt }` | **Doc ID = email**, one response per member, **immutable** (no update rule) |
| `services/{autoId}` | `{ name, price: number, unit, category, imageUrl?, imagePath?, link?, createdAt }` | Orderable catalog, admin-managed; images in Storage `services/`. Legacy docs may lack `imagePath` (delete falls back to `refFromURL`) |
| `orders/{autoId}` | `{ collaId, collaCode, collaName, capEmail, items: [{serviceId, serviceName, unitPrice, unit, category, quantity}], total, createdAt, updatedAt }` | Multiple per colla; items snapshot the price at order time. Rules scope by `collaId` like registrations |
| `meta/{docId}` | `{ v, ranAt }` | Migration markers (admin-only) |

### Roles & security model

- **Admin**: emails hardcoded in `firestore.rules`/`storage.rules` (`isAdmin()`): `marna96@gmail.com`, `said@magmamedia.cat`. No credentials in client code. Admin dashboard: manage caps, colles, all registrations, the services catalog, and all orders.
- **Cap de colla**: has a `caps/{email}` doc. Sees only colles where `colles.capEmails` contains their email. Rules enforce per-colla access server-side via `capOwnsColla()`: `request.auth.token.email in get(/colles/$(resource.data.collaId)).data.capEmails`.
- **Member (user)**: has a `users/{email}` profile. Scoped by `isMemberOfColla()`: `get(/users/$(auth.email)).data.collaId == collaId`. Sees the colla page (posts, forms, member names); can never read `registrations` (DNI/phone stay cap/admin-only) or other members' form responses.
- Both scoping helpers work for list queries **only because** clients filter with `where('collaId','==',…)` — an equality filter the rules engine can bind. Don't change those queries to other fields without rethinking the rules.
- **Anonymous**: public read of `colles` (register-code check) only. Registrations are created by the participant's own account (`email` must match the auth token); no anonymous writes anywhere.
- Routing happens in `routeUser()` (called from `onAuthStateChanged`): `admins/{email}` → admin, `caps/{email}` → cap, `users/{email}` → member, else sign-out. The `registrationInProgress` flag suppresses routing mid-signup.

### Key mechanisms

- **Registration/signup**: colla code → personal data + password → confirm → T&C. `completeRegistration(reg, accepted)` creates the Auth account and writes registration + profile **only at acceptance**. If the colla has no `pdfUrl`, the terms screen is skipped (`tcAccepted:false`, profile `tcPending:true`) and `maybePromptPendingTerms()` shows the terms view in `termsMode='acceptance'` at a later login. A profile with a `regId` (legacy backfill) makes signup **link** to the existing registration instead of duplicating.
- **Cap onboarding (no stored passwords)**: admin form creates the Auth account via the Identity Toolkit REST API (`accounts:signUp`, throwaway random password — doesn't disturb the admin's session), then `sendPasswordResetEmail` so the cap sets their own password. The caps table has a "🔁 Correu contrasenya" resend button; the login page has a self-service "Has oblidat la contrasenya?" link.
- **T&C gating**: checkbox stays disabled until the iframe container is scrolled to bottom (20px tolerance). Per-colla PDF in `colles.pdfUrl` (Storage `terms/{collaId}/`); `docs/terms.html` is only a leftover default, no longer shown for no-PDF colles. Listener setup is one-time (`initTerms()`); per-entry reset is `resetTermsView()` — **do not re-attach listeners per registration**.
- **Migrations**: `runMigrations()` runs on admin login, guarded by the `meta/migrations` marker (versioned steps). v1 re-keyed caps by email + backfilled `collaId`; v2 backfilled `users/{email}` profiles from legacy registrations. Bump `v` for future one-time migrations.
- **Registrations queries** use `where('collaId','==',…).orderBy('timestamp','desc')` — composite index. Cap table has Pagament checkboxes (`paid`) with 👥/💰 counters and a T&C ✅/⏳ column.
- **Publicacions (posts)**: cap sub-nav tab; title/body/link/image, pin toggle. Rendering shared via `buildPostCard()`; member feed merges posts + forms. Posts query needs the `posts(collaId, createdAt)` index.
- **Formularis (forms)**: cap sub-nav tab — builder (single/multi questions, options one-per-line, "Altres", required), per-form participation X/Y (%), per-option CSS bar summaries, two-sheet Excel, delete cascades responses client-side. Members answer once from the feed (unanswered = highlighted, on top); responses immutable. Forms query has no orderBy (client-side sort) → no index.
- **Comandes (orders)**: caps build an order from the services catalog (`servicesCache`, loaded once per session, sorted client-side — no index) and submit; own-colla history queries `where('collaId','==',…).orderBy('createdAt','desc')` (composite index). Admin manages the catalog (Serveis tab) and sees all orders + aggregated shopping-list totals with a two-sheet Excel export (Comandes tab).

## Conventions

- Plain DOM manipulation with `$`/`$$` helpers; event delegation on table bodies for row buttons.
- Always render user data through `escapeHtml()`; timestamps through `formatTimestamp()` (ca-ES locale).
- All UI text in Catalan.
- Errors: inline `.error-msg` divs on auth/forms, `toast(msg, type)` elsewhere.

## History notes

- Before 2026-07-05 the repo was maintained via GitHub web uploads, admin passwords were hardcoded in `app.js`, and cap passwords were stored in plaintext. All fixed; the old admin password is still in git history, so those Auth accounts were given new passwords.

## Session handoff

When the user says the session is finished, update `HANDOFF.md` (rolling doc, overwritten each session — current state, session summary, pending items).
