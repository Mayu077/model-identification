-- ============================================================================
-- DESTRUCTIVE: drops the pre-multitenant tables. Data in them is LOST.
-- ============================================================================
--
-- DO NOT RUN THIS until you have confirmed which database you are pointed at:
--
--     DATABASE_URL="postgresql://..." node scripts/db-fingerprint.mjs
--
-- This project was built across multiple v0 accounts, each with its own Neon
-- database, and at least one of them is already on the new schema with legacy
-- data imported (~45 trips). Running this against that database destroys it.
-- Only proceed if the fingerprint reported:
--
--     generation OLD (pre-auth, no organization_id)
--
-- See docs/MULTITENANT_CUTOVER.md.
--
-- ----------------------------------------------------------------------------
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
