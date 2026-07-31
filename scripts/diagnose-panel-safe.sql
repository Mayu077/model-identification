-- ============================================================
-- PANEL-SAFE DIAGNOSTICS (v0 SQL panel / Neon console)
-- ============================================================
-- All queries are READ-ONLY. No writes, no DDL.
--
-- Why this file exists:
--   The v0 SQL panel crashes with
--     "Cannot read properties of undefined (reading 'map')"
--   when a query returns Postgres catalog types it cannot map --
--   e.g. `name`, `oid`, `regclass`, or information_schema domain
--   types like sql_identifier / character_data.
--
--   It is a RENDERER bug, not a database error. The query itself
--   is valid SQL. The fix is to cast every column to ::text (or
--   ::int / ::bigint) so the panel receives only primitive types.
--
-- RUN THESE ONE AT A TIME. The panel executes a single statement
-- per click; pasting the whole file will fail.
-- ============================================================


-- ============================================================
-- QUERY A  <<< RUN THIS FIRST - THIS IS THE DECISIVE ONE >>>
-- ============================================================
-- Answers: "which organization_id actually holds my ~45 trips?"
--
-- This determines whether the bootstrap claim in
-- app/actions/onboarding.ts reattaches your data or silently
-- creates a new empty org. Everything else is secondary.
--
-- WHAT TO LOOK FOR in the `id` column of the row whose
-- trip_count is ~45:
--   * 'legacy-rajeshri-enterprises'  -> claim works as-is, no code change
--   * a UUID (e.g. '3f9a1c...')      -> code change REQUIRED before claiming
--
-- Paste the output back and I will tell you which path applies.

SELECT
  o.id::text                          AS id,
  o.name::text                        AS org_name,
  (SELECT count(*) FROM trips    t WHERE t.organization_id = o.id)::int AS trip_count,
  (SELECT count(*) FROM rates    r WHERE r.organization_id = o.id)::int AS rate_count,
  (SELECT count(*) FROM expenses e WHERE e.organization_id = o.id)::int AS expense_count,
  (SELECT count(*) FROM drivers  d WHERE d.organization_id = o.id)::int AS driver_count,
  (SELECT count(*) FROM memberships m WHERE m.organization_id = o.id)::int AS member_count
FROM organizations o
ORDER BY trip_count DESC;


-- ============================================================
-- QUERY B - orphan check
-- ============================================================
-- Catches trips whose organization_id points at an org row that
-- no longer exists. Should return 0 rows. If it returns anything,
-- the FK was dropped at some point and needs separate handling.

SELECT
  t.organization_id::text AS orphan_org_id,
  count(*)::int           AS trip_count
FROM trips t
LEFT JOIN organizations o ON o.id = t.organization_id
WHERE o.id IS NULL
GROUP BY t.organization_id;


-- ============================================================
-- QUERY C - who currently holds membership
-- ============================================================
-- Confirms your old membership row is really gone, and shows any
-- other user still attached. Remember: memberships.user_id is
-- UNIQUE, so one user can hold exactly one org. If a stale row
-- exists you must know about it BEFORE claiming.

SELECT
  m.user_id::text         AS user_id,
  u.email::text           AS email,
  m.organization_id::text AS organization_id,
  m.role::text            AS role
FROM memberships m
LEFT JOIN "user" u ON u.id = m.user_id
ORDER BY m.role;


-- ============================================================
-- QUERY D - roles currently in use
-- ============================================================
-- Cheap proxy for the role CHECK constraint. If this returns only
-- 'owner', the constraint is almost certainly still
-- CHECK (role = 'owner') and the driver tier needs migration 0002
-- to widen it before any driver membership can be inserted.

SELECT DISTINCT role::text AS role_in_use
FROM memberships;


-- ============================================================
-- QUERY E - the role constraint definition (panel-safe rewrite)
-- ============================================================
-- This replaces the query that crashed. Two fixes applied:
--   1. removed  'memberships'::regclass   -> joined pg_class instead
--   2. cast conname and the definition to ::text
--
-- Expect: memberships_role_check | CHECK ((role = 'owner'::text))

SELECT
  c.conname::text                      AS constraint_name,
  pg_get_constraintdef(c.oid)::text    AS definition
FROM pg_constraint c
JOIN pg_class     t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = 'memberships'
  AND c.contype = 'c';


-- ============================================================
-- QUERY F - migration ledger state
-- ============================================================
-- Confirms which migrations the live DB believes are applied, so
-- migration 0002 gets the correct next version number.

SELECT
  version::text     AS version,
  name::text        AS name,
  applied_at::text  AS applied_at
FROM schema_migrations
ORDER BY version;


-- ============================================================
-- QUERY G - does trips.driver_id exist yet?
-- ============================================================
-- Expected: 0 rows (column not built). Confirms the driver tier
-- blocker. If it unexpectedly returns a row, migration 0002 must
-- not re-add the column.

SELECT
  column_name::text AS column_name,
  data_type::text   AS data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'trips'
  AND column_name IN ('driver_id', 'slip_timestamp');
