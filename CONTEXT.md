# CONTEXT.md — Registres Carnaval

Rolling architecture + changelog document. **Update after every code change.** Conventions and guardrails live in `CLAUDE.md`; session state in `HANDOFF.md`.

## What this app is

Account-based registration + supply-ordering app for carnival groups ("colles"), Catalan UI only. The app opens on a **login page**; first-timers register via a "Registra't" button.

- **Participants / members** (email+password account): register with a 6-char colla code → personal-data form (nom, cognoms, DNI/NIE, correu, telèfon, contrasenya) → confirm → scroll-read T&C → accept. **Only at acceptance** the Auth account is created and the registration + `users/{email}` profile are written. **If the colla has not published its T&C**, the terms screen is skipped: the registration is written with `tcAccepted: false`, the profile gets `tcPending: true`, and the member is **prompted to scroll-accept at login** once the colla uploads a document (the bundled `docs/terms.html` placeholder is no longer shown). Logged-in members see their **colla page**: cap-published posts (pinned first; text, images, YouTube embeds, links) and the names of fellow members.
- **Caps de colla** (email/password login): per-colla dashboard — registered people (view/delete/Excel, **Pagament checkbox per person + registered/paid counters**, T&C-accepted status column), per-colla T&C PDF upload, **Comandes** (order supplies from the admin-managed catalog, with history), and **Publicacions** (title/message/link/image posts to the colla page; YouTube links render as embedded players; posts can be pinned on top).
- **Admins** (`marna96@gmail.com`, `said@magmamedia.cat`, hardcoded in rules): manage caps (creation sends a set-password email; no passwords stored anywhere), colles (6-char code generation, cap assignment), all registrations, the services catalog, and all orders with aggregated shopping-list totals + two-sheet Excel export.
- Role routing on login: `admins/{email}` → admin, else `caps/{email}` → cap, else `users/{email}` → member, else sign-out. The login page has a self-service "Has oblidat la contrasenya?" reset link.

## Architecture

No build step, no framework, no tests. Three files:

- `index.html` — all views as sibling `<div class="view">` blocks toggled by `showView(id)`; initial view is `view-login` (`view-landing` is now register step 1: colla code entry); admin dashboard uses sidebar `data-admin-tab` switching; cap dashboard has a Registres/Comandes/Publicacions sub-nav; members get `view-user-dashboard`.
- `js/firebase-config.js` — Firebase compat SDK init (`auth`, `db`, `storage` globals). Project `registre-carnaval`.
- `js/app.js` — one IIFE. Module-level state: `currentUser/currentRole/currentUserProfile`, `pendingRegistration` + `pendingPassword` (password kept out of the Firestore write), `registrationInProgress` (suppresses auth routing mid-signup), `capColles`, `capActiveCollaId`, `servicesCache`, `adminOrdersCache`, `editingServiceId`. Role routing in `routeUser()` (called by `onAuthStateChanged`): `admins/{email}` → admin; `caps/{email}` → cap; `users/{email}` → member; else sign out.

CDN deps: Firebase 10 compat, SheetJS (Excel), Google Fonts (Oswald). After editing app.js: `node --check js/app.js` is the only safety net.

## Firestore collections

| Collection | Shape | Access (rules) |
|---|---|---|
| `admins/{email}` | `{ email }` | read: own/admin · write: admin |
| `caps/{email}` | `{ email, name, createdAt }` — **doc ID = email** (rules depend on it) | read: own/admin · write: admin |
| `colles/{autoId}` | `{ name, code, capEmails[], pdfUrl?, pdfName?, createdAt }` | read: public (landing code check) · create/delete: admin · update: admin, or assigned cap touching only `pdfUrl`/`pdfName` |
| `users/{email}` | `{ email, name, surname, collaId, collaCode, collaName, regId, createdAt, tcPending? }` — **doc ID = email**; `regId` links to the person's registration; `tcPending` = registered before the colla published T&C | create: own account (or admin, for backfill), keys constrained, colla exists · read: own/admin/owning cap/same-colla member · update: admin, or own with `collaId` unchanged · delete: admin or owning cap |
| `registrations/{autoId}` | `{ name, surname, idNumber, email, phone, collaCode, collaName, collaId, tcAccepted, timestamp, paid? }` — `paid` set by the cap's Pagament checkbox | create: authenticated, `email` must match the account, exact keys, colla exists, `tcAccepted:false` only allowed when the colla has no `pdfUrl` · read/delete: admin or owning-colla cap · update: same, **plus** the member may flip only their own `tcAccepted` to `true` (members can never read) |
| `posts/{autoId}` | `{ collaId, title, body?, url?, imageUrl?, imagePath?, pinned?, authorEmail, createdAt }` — images in Storage `posts/{collaId}/` | create: admin or owning cap (authorEmail = own) · read: admin/owning cap/same-colla member · update: same, `collaId` immutable · delete: admin or owning cap |
| `forms/{autoId}` | `{ collaId, title, description?, questions: [{text, type:'single'\|'multi', options[], allowOther, required}], authorEmail, createdAt }` — **immutable once created** (no edit UI; question index = answer key) | create: admin or owning cap · read: admin/owning cap/same-colla member · update: same, `collaId` immutable · delete: admin or owning cap |
| `forms/{id}/responses/{email}` | `{ email, name, answers: [{selected[], other?}], submittedAt }` — **doc ID = email**, one response per member, aligned with `questions[]` | create: the member themselves (same colla) · read: admin/owning cap/own · **no update** (immutable) · delete: admin or owning cap |
| `services/{autoId}` | `{ name, price:number, unit, category, imageUrl?, imagePath?, link?, createdAt }` | read: any authed · write: admin |
| `orders/{autoId}` | `{ collaId, collaCode, collaName, capEmail, items[{serviceId, serviceName, unitPrice, unit, category, quantity}], total, createdAt, updatedAt }` — items snapshot prices | create: owning cap (capEmail must match) or admin, exact keys · read/delete: admin or owning cap · update: same + `collaId` immutable |
| `meta/{docId}` | migration markers (`migrations: {v}`) | admin only |

**Cap scoping mechanism**: `capOwnsColla(collaId)` in rules does `auth.email in get(/colles/$(collaId)).data.capEmails`. Member scoping works the same way via `isMemberOfColla(collaId)`: `get(/users/$(auth.email)).data.collaId == collaId`. Both work for list queries **only** because clients filter `where('collaId','==', …)` — an equality filter the rules engine can bind. Composite indexes required: `registrations(collaId ASC, timestamp DESC)`, `orders(collaId ASC, createdAt DESC)`, `posts(collaId ASC, createdAt DESC)`.

**Storage**: `terms/{collaId}/…` (T&C PDFs; public read, cap/admin write via cross-service Firestore check), `services/…` (catalog images; public read, admin write, ≤5 MB image/*) and `posts/{collaId}/…` (post images; public read, cap/admin write, ≤5 MB image/*).

## Deployment

Git is the source of truth for everything.

- **Frontend**: push to `main` → GitHub Pages (https://scaredmeeseks.github.io/Registres-Carnaval/).
- **Rules**: Cloud Shell → `cd ~/Registres-Carnaval && ./deploy.sh`. The guard script verifies git remote + `.firebaserc`, pulls, and deploys with explicit `--project registre-carnaval` (see CLAUDE.md for the 2026-07-05 wrong-project incident that motivated it). Never bare `firebase deploy`.
- **Indexes**: managed in the console, deliberately not in the repo.
- Admin SDK one-off scripts (migrations, cleanups, password sets) run from Cloud Shell `~` with `firebase-admin` + built-in credentials.

## Known issues / accepted trade-offs

- **Stale JS after deploys**: GitHub Pages offers no cache control, and rules changes can break cached old frontends (2026-07-05: a cap got "Error carregant registres" because cached JS still queried by `collaCode`, which the new rules reject; fixed by hard refresh). If this recurs, the fix is moving hosting to Firebase Hosting with no-cache headers (considered 2026-07-05, deferred).
- **Pages deploy step can fail transiently**: on 2026-07-05 the forms commit's "pages build and deployment" run built fine but the deploy step failed on GitHub's side — the site silently kept serving old code. If a push doesn't appear live, check the repo's Actions tab; a retry (GitHub's own, or an empty commit push) fixes it. Verify with `curl` that the live JS contains the new code.
- `colles` is publicly readable (needed for register-code validation) → colla names + cap emails are enumerable.
- `users` docs are keyed by (and contain) email → **colla members can see each other's emails**, not just names (unavoidable: backfilled legacy people have no Auth uid). DNI/phone stay cap/admin-only in `registrations`.
- One account = one person = one colla. Duplicate emails across legacy registrations: the v2 backfill keeps the first; a person in two colles isn't supported (signup links the account to the existing colla and shows an info toast).
- A cap who also registers as a participant routes to the cap dashboard (role precedence admin > cap > user).
- Old registrations whose colla was deleted have no `collaId` (or a dangling one) → invisible to caps and skipped by the v2 backfill, admin-only.
- Existing caps kept their pre-overhaul Auth passwords; recovery paths are the login page's "Has oblidat la contrasenya?" link and the admin "🔁 Correu contrasenya" button.
- Legacy composite index `registrations(collaCode, timestamp)` still exists in console; delete after a few days (stale cached frontends).

## Changelog

### 2026-07-05 (6th pass) — Formularis (colla questionnaires) — deployed same day (`fdda122`)
- New `forms` collection + `responses` subcollection (see table). Caps build forms in a new 4th sub-nav tab "📝 Formularis": unlimited questions, single/multi select, options one-per-line, optional "Altres" free-text choice, per-question required flag. Forms are immutable after creation (delete only, cascades responses client-side).
- Member feed: unanswered forms show **first and highlighted** (amber card); click header to expand → answer → Enviar (validates required + "Altres" text; option values are indices so option text never hits an attribute). After submitting the card turns normal and expands to a **read-only** view of own answers — responses have no update rule, so they're immutable server-side too.
- Cap summaries per form: participation `X/Y (Z%)` (Y = colla registrations count), per-option single-hue horizontal CSS bars (brand primary on recessive track, counts in ink — dataviz-skill validated), "Altres" answers listed, per-form Excel (two sheets: Respostes with one column per question, Resum with per-option counts).
- `renderPostsList` refactored: card construction extracted to `buildPostCard` so the member feed can merge posts and forms (pinned posts still first among the answered/rest group). No new Firestore index (forms query has no orderBy; sorted client-side).

### 2026-07-05 (5th pass) — T&C status column in the cap table
- Cap registrations table shows "✅ Sí / ⏳ Pendent" per person from `tcAccepted`; cap Excel export gained a "T&C acceptats" column (the admin export already had one). Frontend-only.

### 2026-07-05 (4th pass) — Deferred T&C, pinned posts, post images + YouTube — deployed same day (`521a1fb`)
- **Deferred T&C acceptance**: colles without an uploaded T&C no longer show the `docs/terms.html` placeholder. Registration skips the terms screen, writes `tcAccepted: false` + profile `tcPending: true`, shows an info note on the success screen, and `routeUser()` prompts the member to scroll-accept at login once the colla has a `pdfUrl` (terms view reused in `termsMode = 'acceptance'`; button says "Acceptar"). Rules: `tcAccepted:false` creates allowed only when the colla has no `pdfUrl`; members may update only their own `tcAccepted` → `true`. `loadCollaPdf()` removed. Cap PDF card copy explains pending registrations.
- **Pinned posts**: `posts.pinned` toggled from the cap list (📌 Fixar/Desfixar); `renderPostsList` stable-sorts pinned first (no new index) and shows 📌 + accent border.
- **Post images**: optional image per post (≤5 MB) uploaded to Storage `posts/{collaId}/` (new storage.rules block), rendered in cards (click = full size), deleted with the post via `deleteStoredImage` (renamed from `deleteServiceImage`, shared with services).
- **YouTube embeds**: post links matching watch/shorts/embed/youtu.be render as a responsive `youtube-nocookie.com` iframe; other links stay plain anchors.
- Registration write path extracted to `completeRegistration(reg, accepted)` (used by both the terms-accept and the skip path).

### 2026-07-05 (later still) — Account-based registration, colla page, Pagament — deployed same day (`72053e9`)
- **Login-first entry**: app opens on the login page; "Sóc Cap de Colla" removed (roles come from data); "Registra't" starts the register flow (colla code → form with password → confirm → T&C). The Auth account + `registrations` doc + `users/{email}` profile are all created only at T&C acceptance; `registrationInProgress` flag keeps the auth listener from routing mid-signup. Anonymous registration is gone — the `registrations` create rule now requires auth + email match (App Check idea moot).
- **New member role + colla page** (`view-user-dashboard`): cap-published posts (title/message/http(s) link, newest first) and member name list (from `users`, sorted client-side). New `posts` collection + `users` collection with `isMemberOfColla()` rule scoping. **New composite index needed: `posts(collaId ASC, createdAt DESC)`.**
- **Cap Publicacions tab**: post form + list with delete, per active colla (sub-nav refactored to 3 tabs).
- **Pagament tracking**: checkbox per registration in the cap table (writes `paid` bool), 👥 registered / 💰 paid counters in the header, Pagament column in the cap Excel export.
- **Migration v2** (runs on next admin login): backfills `users/{email}` profiles from legacy registrations (skips deleted colles, first email wins) so legacy names appear in member lists and a later signup **links** to the existing registration instead of duplicating (`regId` match). Deleting a registration (cap or admin) also deletes the linked profile.
- Login page got a self-service "Has oblidat la contrasenya?" reset link.
- Deploy checklist: create the `posts` index → `./deploy.sh` (rules) → push (frontend) → admin login to run migration v2. Line endings of the four edited files were normalized to LF (repo had mixed CRLF).

### 2026-07-05 (later) — Comandes feature rebuilt (`4bf2c66`, `b4fcd1c`) — deployed + cap flow verified live same day
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
