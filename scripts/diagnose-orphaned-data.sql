-- Read-only diagnostics for recovering the bootstrap owner account.
-- Run these in the Neon SQL Editor against the OLD project's database.
-- Nothing here writes. Paste the output of each block back for interpretation.
--
-- Context: the bootstrap owner user row was deleted, which cascaded away
-- session/account/memberships. Business data (organizations, trips, rates,
-- expenses, settings, drivers) is keyed on organization_id and survives.
-- claimOrganization() in app/actions/onboarding.ts re-attaches the bootstrap
-- email to the HARDCODED org id 'legacy-rajeshri-enterprises'. Query 2 is the
-- one that matters: it proves whether the data actually lives under that id.

-- =====================================================================
-- QUERY 1: Which organizations exist, and is anyone still attached?
-- =====================================================================
SELECT
  o.id,
  o.name,
  o.slug,
  o.is_legacy,
  o.onboarding_completed,
  o.created_at,
  COUNT(m.id) AS member_count
FROM organizations o
LEFT JOIN memberships m ON m.organization_id = o.id
GROUP BY o.id, o.name, o.slug, o.is_legacy, o.onboarding_completed, o.created_at
ORDER BY o.created_at;

-- =====================================================================
-- QUERY 2: THE IMPORTANT ONE. Row counts per organization id.
-- If the org holding your trips is 'legacy-rajeshri-enterprises', the
-- bootstrap claim works as-is. If it is a UUID instead, the claim will
-- create a new EMPTY legacy org and your rows stay orphaned.
-- =====================================================================
SELECT
  o.id AS organization_id,
  o.name,
  (SELECT COUNT(*) FROM trips    t WHERE t.organization_id = o.id) AS trips,
  (SELECT COUNT(*) FROM rates    r WHERE r.organization_id = o.id) AS rates,
  (SELECT COUNT(*) FROM expenses e WHERE e.organization_id = o.id) AS expenses,
  (SELECT COUNT(*) FROM settings s WHERE s.organization_id = o.id) AS settings,
  (SELECT COUNT(*) FROM drivers  d WHERE d.organization_id = o.id) AS drivers,
  (SELECT MIN(t.trip_date) FROM trips t WHERE t.organization_id = o.id) AS first_trip,
  (SELECT MAX(t.trip_date) FROM trips t WHERE t.organization_id = o.id) AS last_trip
FROM organizations o
ORDER BY trips DESC;

-- =====================================================================
-- QUERY 3: Confirm the expected legacy org id exists (or does not).
-- Expect exactly one row if the hardcoded claim path will land correctly.
-- =====================================================================
SELECT id, name, slug, is_legacy
FROM organizations
WHERE id = 'legacy-rajeshri-enterprises';

-- =====================================================================
-- QUERY 4: Who is left in the user table, and do they hold a membership?
-- Confirms your old user really is gone. memberships has a UNIQUE on
-- user_id, so one user can belong to only ONE organization.
-- =====================================================================
SELECT
  u.id,
  u.email,
  u.name,
  u."createdAt",
  m.organization_id,
  m.role
FROM "user" u
LEFT JOIN memberships m ON m.user_id = u.id
ORDER BY u."createdAt";

-- =====================================================================
-- QUERY 5: Are there unconsumed owner invite codes already in the DB?
-- If one is still valid you have a second way in, though the bootstrap
-- email route is preferable because it targets the legacy org.
-- =====================================================================
SELECT
  id,
  organization_name,
  expires_at,
  consumed_at,
  revoked_at,
  expires_at > now() AS still_valid
FROM owner_invites
ORDER BY created_at DESC;

-- =====================================================================
-- QUERY 6: Migration ledger state. Confirms which migrations the live DB
-- believes are applied, so drizzle does not try to re-run 0000.
-- =====================================================================
SELECT * FROM schema_migrations ORDER BY applied_at;
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;

-- =====================================================================
-- QUERY 7: Verify the role CHECK constraint that currently blocks drivers.
-- Expect: role = 'owner'::text  -- must be widened before driver accounts.
-- =====================================================================
SELECT
  conname,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'memberships'::regclass
  AND contype = 'c';
