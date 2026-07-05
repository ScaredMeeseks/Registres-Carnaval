# HANDOFF — Registres Carnaval

_Rolling document, overwritten each session. Last updated: 2026-07-05._

## Current state

- Repo at `c:\DATA\CLAUDE\Registres-Carnaval`, in the Claude-projects workspace. Git is now the source of truth (no more web uploads / console-pasted rules).
- Security overhaul + rules-via-git implemented, pushed, **and deployed 2026-07-05**: new Firestore/Storage rules live on `registre-carnaval`, composite index (collaId, timestamp) created, admin password for marna96 changed.
- ⚠️ During the first deploy attempt the Firebase CLI's remembered project sent Carnaval's rules to `mundial2026-ec8e7` (wiping Mundial's rules mid-World Cup); restored from the Mundial repo's local files and republished via console. Lesson recorded in both CLAUDE.md files: always `firebase use` + read the "Deploying to" header.

## Session summary (2026-07-05)

- Added `firebase.json`, `.firebaserc`, `storage.rules` — rules now deploy from the repo via Cloud Shell.
- Rewrote `firestore.rules`: no anonymous update/delete of registrations; caps limited server-side to their own colles (via `collaId` + `capEmails` lookup); colles updates by caps limited to `pdfUrl`/`pdfName`; validated anonymous create.
- `app.js`: removed hardcoded admin credentials and seeding; registration is now a single write after T&C acceptance (terms listeners made one-time to avoid duplicate writes); caps re-keyed by email; cap onboarding via password-reset email (no stored passwords); resend-email button in admin caps table; cap queries switched to `collaId`; one-time `runMigrations()` (marker `meta/migrations`, v1).
- Updated CLAUDE.md to match.

## Comandes feature rebuilt (2026-07-05, later same day)

The lost orders feature (data survived in `orders`/`services`) was rebuilt: cap dashboard has a Registres/Comandes sub-nav (catalog with quantities + prices + total, order history per colla); admin gets Serveis (catalog CRUD with image upload) and Comandes (all orders, per-colla filter, shopping-list totals, two-sheet Excel export) tabs. Rules added for both collections (`orders` scoped via `capOwnsColla`, `services` admin-write/authed-read; Storage `services/` images admin-write/public-read).

**Its deploy steps (pending until done):**
1. Cloud Shell data cleanup snippet: delete test order `UQxNkZ9zcy3XPhf7cUf6`, strip `link` + convert string `price`→number on the 4 services.
2. `cd ~/Registres-Carnaval && ./deploy.sh` (guard script: verifies repo + .firebaserc, pulls, deploys with explicit `--project`).
3. Create composite index **orders (collaId ASC, createdAt DESC)** via console error link or manually.
4. Test as cap (darnabar) + admin per CLAUDE.md.

## Pending / notes

- **Said's admin password** (`said@magmamedia.cat`) still needs changing — it shared the leaked `Garriguella2026`. Reset email or the Admin SDK snippet from this session.
- Verify the v1 migration ran: `meta/migrations` doc exists with `v: 1`, `caps` docs are email-keyed, registrations have `collaId`. (Runs automatically on admin login; should already be done.)
- Old composite index `registrations(collaCode, timestamp)` can be deleted after a few days (kept only for stale cached frontends).
- Existing caps' Auth accounts keep their old passwords (only storage of passwords was removed). If any cap doesn't know theirs, use the "🔁 Correu contrasenya" button.
- Registrations whose colla was deleted have no `collaId` → invisible to caps, still manageable by admins.
- Optional hardening ideas (not urgent): Firebase App Check on Firestore to raise the bar on spam registrations; `colles` public read exposes colla names + capEmails to anyone (needed for the landing code check today — restructuring would take a Cloud Function).
- EsquerrApp repo also exists on the GitHub account — unrelated.
