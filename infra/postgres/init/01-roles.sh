#!/bin/sh
# Creates least-privilege roles. Runs once on first container start (empty data dir).
#  - migrator: owns the schema, runs migrations/seed (not used by the running app)
#  - app:      DML only on tables owned by migrator (granted via default privileges)
set -eu
psql -v ON_ERROR_STOP=1 --username postgres --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE ${HBVL_MIGRATOR_USER} LOGIN PASSWORD '${HBVL_MIGRATOR_PASSWORD}';
CREATE ROLE ${HBVL_APP_USER} LOGIN PASSWORD '${HBVL_APP_PASSWORD}';
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${HBVL_MIGRATOR_USER}, ${HBVL_APP_USER};
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER SCHEMA public OWNER TO ${HBVL_MIGRATOR_USER};
GRANT USAGE ON SCHEMA public TO ${HBVL_APP_USER};
ALTER DEFAULT PRIVILEGES FOR ROLE ${HBVL_MIGRATOR_USER} IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${HBVL_APP_USER};
ALTER DEFAULT PRIVILEGES FOR ROLE ${HBVL_MIGRATOR_USER} IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ${HBVL_APP_USER};
SQL
