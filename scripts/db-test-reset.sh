#!/usr/bin/env bash
# Recreate the local test database: Supabase stub + all migrations, in order.
# Usage: TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres scripts/db-test-reset.sh
set -euo pipefail
ADMIN_URL="${TEST_DATABASE_ADMIN_URL:-${TEST_DATABASE_URL%/*}/postgres}"
DB_NAME="${TEST_DATABASE_URL##*/}"
DB_NAME="${DB_NAME%%\?*}"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "drop database if exists \"$DB_NAME\" with (force)" -c "create database \"$DB_NAME\""
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f tests/db/supabase-stub.sql
for f in supabase/migrations/*.sql; do
  psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "Test database $DB_NAME ready"
