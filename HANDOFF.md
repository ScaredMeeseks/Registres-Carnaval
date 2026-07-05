# HANDOFF — Registres Carnaval

_Rolling document, overwritten each session. Last updated: 2026-07-05._

## Current state

- Repo at `c:\DATA\CLAUDE\Registres-Carnaval`, in the Claude-projects workspace. Git is now the source of truth (no more web uploads / console-pasted rules).
- Security overhaul + rules-via-git implemented and pushed to `main` (frontend auto-deployed by GitHub Pages).
- **Firestore/Storage rules NOT yet deployed** — see checklist below. Until deployed, the old permissive rules are still active.

## Session summary (2026-07-05)

- Added `firebase.json`, `.firebaserc`, `storage.rules` — rules now deploy from the repo via Cloud Shell.
- Rewrote `firestore.rules`: no anonymous update/delete of registrations; caps limited server-side to their own colles (via `collaId` + `capEmails` lookup); colles updates by caps limited to `pdfUrl`/`pdfName`; validated anonymous create.
- `app.js`: removed hardcoded admin credentials and seeding; registration is now a single write after T&C acceptance (terms listeners made one-time to avoid duplicate writes); caps re-keyed by email; cap onboarding via password-reset email (no stored passwords); resend-email button in admin caps table; cap queries switched to `collaId`; one-time `runMigrations()` (marker `meta/migrations`, v1).
- Updated CLAUDE.md to match.

## DEPLOY CHECKLIST (pending, in this order)

1. ~~Push to main~~ (done → GitHub Pages serves new frontend).
2. **Log into the live site as admin once** → `runMigrations()` re-keys caps and backfills `collaId` (must happen while old rules are still active, or as admin under new rules — admin works either way, but do it before caps try to log in).
3. **Cloud Shell**: `git clone https://github.com/ScaredMeeseks/Registres-Carnaval.git` → `cd Registres-Carnaval` → `firebase deploy --only firestore:rules,storage`.
4. **Composite index** on `registrations` (collaId ASC, timestamp DESC): open the cap dashboard once and use the index link from the browser-console error, or create it in Firebase Console → Firestore → Indexes.
5. **Change both admin passwords** (Firebase Console → Authentication) — `Garriguella2026` is public in git history.
6. Verify per CLAUDE.md/plan: anonymous registration end-to-end, cap sees only own colles, admin tabs, add-cap reset email.

## Pending / notes

- Existing caps' Auth accounts keep their old passwords (only storage of passwords was removed). If any cap doesn't know theirs, use the "🔁 Correu contrasenya" button.
- Registrations whose colla was deleted have no `collaId` → invisible to caps, still manageable by admins.
- EsquerrApp repo also exists on the GitHub account — unrelated.
