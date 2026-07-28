-- ============================================================================
-- DESTRUCTIVE: drops the pre-multitenant tables. Data in them is LOST.
-- ============================================================================
--
-- Run this ONLY if you have accepted losing the contents of these four tables,
-- or have already exported them to CSV for scripts/import-legacy.mjs.
--
-- Why this is needed: the pre-auth schema had no organization_id. The new
-- schema makes organization_id NOT NULL on every business table, so existing
-- rows cannot be migrated in place without inventing an owner for them.
-- Since this database holds test data only, dropping and recreating is
-- cleaner than an ALTER + backfill.
--
-- BACK UP FIRST:
--   pg_dump "$DATABASE_URL" > backup-before-multitenant.sql
--
-- Then:
--   psql "$DATABASE_URL" -f migrations/RESET_LEGACY_TABLES.sql
--   pnpm db:migrate
--
-- CASCADE is required: the old `rates` and `settings` tables are referenced by
-- nothing, but dropping in one statement avoids ordering problems if you have
-- added views or FKs by hand.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS trips CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS rates CASCADE;
DROP TABLE IF EXISTS settings CASCADE;

COMMIT;
