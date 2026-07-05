#!/usr/bin/env bash
# Deploys Firestore/Storage rules from Cloud Shell — with guards.
#
# Why the paranoia: on 2026-07-05 a deploy from this folder landed on
# mundial2026-ec8e7 because the Firebase CLI's remembered active project
# overrode .firebaserc. The --project flag below makes that impossible.
#
# Usage (Cloud Shell):  cd ~/Registres-Carnaval && ./deploy.sh
set -euo pipefail

EXPECTED_REPO="ScaredMeeseks/Registres-Carnaval"
PROJECT="registre-carnaval"

# 1. Right repo?
remote=$(git remote get-url origin 2>/dev/null || echo "none")
if [[ "$remote" != *"$EXPECTED_REPO"* ]]; then
  echo "❌ Wrong folder: git remote is '$remote' (expected $EXPECTED_REPO)."
  echo "   Run: cd ~/Registres-Carnaval"
  exit 1
fi
echo "✔ Repo: $remote"

# 2. .firebaserc sanity
if ! grep -q "\"$PROJECT\"" .firebaserc 2>/dev/null; then
  echo "❌ .firebaserc missing or doesn't point to $PROJECT."
  exit 1
fi
echo "✔ .firebaserc → $PROJECT"

# 3. Latest code
git pull --ff-only

# 4. Pin the CLI's active project (for any manual firebase commands later)
firebase use "$PROJECT" >/dev/null
echo "✔ Firebase CLI pinned to $PROJECT"

# 5. Deploy — explicit --project so no remembered setting can override it
firebase deploy --only firestore:rules,storage --project "$PROJECT"
