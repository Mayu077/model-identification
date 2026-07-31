-- ============================================================================
-- find-my-email.sql — hunt for traces of the deleted owner's email address
-- All read-only. Run one statement at a time in the v0/Neon SQL panel.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- QUERY 1 (most likely to succeed): verification table
-- Better Auth stores the email as `identifier` for sign-up verification and
-- password-reset flows. This table has NO FK to "user", so deleting the
-- account did NOT cascade here. Any verification/reset email ever sent
-- leaves the address behind.
-- ----------------------------------------------------------------------------
SELECT
  identifier::text  AS email_or_identifier,
  created_at::text  AS created_at,
  expires_at::text  AS expires_at
FROM verification
ORDER BY created_at DESC;

-- ----------------------------------------------------------------------------
-- QUERY 2: audit log metadata — some actions may embed the actor's email
-- in the jsonb metadata blob even though actor_user_id is just an id.
-- ----------------------------------------------------------------------------
SELECT
  action::text       AS action,
  entity_type::text  AS entity_type,
  metadata::text     AS metadata,
  created_at::text   AS created_at
FROM audit_logs
ORDER BY created_at DESC
LIMIT 50;

-- ----------------------------------------------------------------------------
-- QUERY 3: org settings — a contact/billing email may be stored as a value
-- ----------------------------------------------------------------------------
SELECT
  key::text    AS key,
  value::text  AS value
FROM settings;

-- ----------------------------------------------------------------------------
-- QUERY 4: neon_auth schema — leftover Neon-managed auth may have its OWN
-- users table that still holds the email. First list its tables:
-- ----------------------------------------------------------------------------
SELECT table_name::text AS neon_auth_table
FROM information_schema.tables
WHERE table_schema = 'neon_auth'
ORDER BY table_name;

-- ----------------------------------------------------------------------------
-- QUERY 5: if Query 4 shows a users-like table (commonly neon_auth.users),
-- peek at its columns, then its rows. Adjust the table name if different.
-- ----------------------------------------------------------------------------
SELECT column_name::text AS column_name, data_type::text AS data_type
FROM information_schema.columns
WHERE table_schema = 'neon_auth'
  AND table_name = 'users'
ORDER BY ordinal_position;

-- Then (only if the table exists):
-- SELECT id::text, email::text, created_at::text FROM neon_auth.users LIMIT 20;

-- ----------------------------------------------------------------------------
-- QUERY 6: owner_invites — created_by_user_id is SET NULL on user delete,
-- so this won't show the email, but confirms invite history exists.
-- ----------------------------------------------------------------------------
SELECT
  id::text                AS id,
  organization_name::text AS organization_name,
  created_by_user_id::text AS created_by_user_id,
  consumed_at::text       AS consumed_at,
  created_at::text        AS created_at
FROM owner_invites
ORDER BY created_at DESC;
