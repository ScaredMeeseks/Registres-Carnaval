# HANDOFF — Registres Carnaval

_Rolling document, overwritten each session. Last updated: 2026-07-05 (end of session)._

## Current state

- Everything is **live and verified**: git-based workflow, security overhaul, and the rebuilt Comandes feature are deployed (frontend on GitHub Pages, rules via `./deploy.sh`, migrations run, data cleaned). Cap login + registrations verified live with darnabar (temp password set via Admin SDK).
- Repo: `c:\DATA\CLAUDE\Registres-Carnaval` → https://github.com/ScaredMeeseks/Registres-Carnaval, HEAD `943c577` + this session's doc commits. Read `CONTEXT.md` for architecture + full changelog.
- Deploys: push to `main` = frontend; `cd ~/Registres-Carnaval && ./deploy.sh` in Cloud Shell = rules (guard script — never bare `firebase deploy`; a bare deploy once landed on Mundial and wiped its rules, restored same day).

## Session summary (2026-07-05, first session on this machine)

1. Cloned repo, added to `Claude-projects.code-workspace`, created CLAUDE.md / CONTEXT.md / HANDOFF.md.
2. **Security overhaul** (`2dd82ae`): removed hardcoded admin credentials + seeding; cap onboarding via password-reset email (no stored passwords); caps re-keyed to email doc IDs; registration = single write after T&C; rules rewritten with per-colla scoping (`collaId` + `capOwnsColla`); `firebase.json`/`.firebaserc`/`storage.rules` added.
3. **Incident**: first rules deploy hit `mundial2026-ec8e7` (CLI remembered project overrode `.firebaserc`); Mundial rules restored from its local repo; `deploy.sh` guard script created (`b4fcd1c`).
4. **Comandes rebuilt** (`4bf2c66`): the lost orders feature reconstructed from surviving `orders`/`services` data — cap catalog + order history, admin catalog CRUD + orders overview with totals + two-sheet Excel. Test data cleaned (order deleted, prices → numbers, joke links stripped).
5. Migration v1 run via Admin SDK (in-app run had been missed); indexes created: `registrations(collaId, timestamp)`, `orders(collaId, createdAt)`; marna96 admin password changed.
6. Learned the hard way: GitHub Pages stale JS + new rules = errors until hard refresh (documented; Firebase Hosting move considered, **deferred by user**).

## Pending / next session

1. **Said's admin password** (`said@magmamedia.cat`) — still on the leaked `Garriguella2026` unless the user changed it without saying so. Confirm and rotate (reset email or Admin SDK snippet in CONTEXT.md conventions).
2. **Full Comandes end-to-end check as admin**: darnabar's cap side worked; still worth one admin pass — order visible in Comandes tab, totals correct, Excel export opens with both sheets.
3. **Delete legacy index** `registrations(collaCode, timestamp)` in Firestore console (kept a few days for stale cached frontends; safe to remove ~2026-07-10).
4. Real caps will need the "🔁 Correu contrasenya" button on first login (their old generated passwords are gone).
5. Deferred ideas: Firebase Hosting move (cache control + private repo), App Check against registration spam.
