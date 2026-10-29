#!/bin/sh
set -eu

: "${APP_DATABASE_PASSWORD:?APP_DATABASE_PASSWORD is required}"
: "${MIGRATION_DATABASE_PASSWORD:?MIGRATION_DATABASE_PASSWORD is required}"
export APP_DATABASE_PASSWORD MIGRATION_DATABASE_PASSWORD

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
roles_sql=${BOOTSTRAP_ROLES_SQL:-$script_dir/roles.sql}
if [ -n "${BOOTSTRAP_DATABASE_URL:-}" ]; then
  set -- "$BOOTSTRAP_DATABASE_URL"
else
  set -- --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-anar}"
fi
exec psql -X --set=ON_ERROR_STOP=1 "$@" --file="$roles_sql"
