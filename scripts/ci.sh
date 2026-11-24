#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL to a disposable PostgreSQL database ending in _test.}"
export CI=true
export DATABASE_URL=''
export MIGRATION_DATABASE_URL=''

echo 'Checking JavaScript syntax...'
while IFS= read -r -d '' source_file; do
  node --check "$source_file"
done < <(find src public/js tests -type f -name '*.js' -print0)
node --check playwright.config.js

echo 'Building the React feed...'
npm run build:feed

echo 'Running unit and PostgreSQL integration tests...'
npm test

echo 'Running desktop and mobile browser tests...'
npm run test:e2e -- --workers=2 --reporter=line,html
