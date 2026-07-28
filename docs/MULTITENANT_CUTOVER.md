# Multi-Tenant Cutover (one-time)

This is a **one-time** procedure for upgrading a database created before
authentication existed. New databases should just follow
[SETUP_AND_DEPLOYMENT_GUIDE.md](SETUP_AND_DEPLOYMENT_GUIDE.md) Part 2.

## What changed

The pre-auth schema had 4 tables and no concept of an owner:

| | Before | After |
|---|---|---|
| Tables | `trips`, `rates`, `expenses`, `settings` | those 4 + 11 more |
| Tenancy | none — every row was global | `organization_id NOT NULL` on every business table |
| Auth | none | Better Auth (`user`, `session`, `account`, `verification`) |
| Accountability | none | `audit_logs`, `drivers`, `owner_invites` |
| Scan | synchronous request | `scan_jobs` queue |

Other breaking column changes:

- `settings.key` was the primary key; it is now `UNIQUE(organization_id, key)`.
- `expenses.description` was nullable; it is now `NOT NULL DEFAULT ''`.
- `trips` uniqueness went from `(trip_date, container_no)` to
  `(organization_id, trip_date, container_no)`.
- `id` columns moved from `serial` to `bigserial`.

## Why there is no in-place migration

`organization_id` is `NOT NULL` on every business table. Existing rows have no
organization and no user to attribute one to, so there is nothing to backfill
*from* — an in-place `ALTER` would require inventing an owner. Because this
database holds test data only, dropping and recreating is the honest path.

If you later need the old rows, the intended route is
`scripts/import-legacy.mjs`, which loads CSVs from `.v0/imports/` into a
dedicated organization flagged `is_legacy = true`.

## STOP: check whether the cutover already ran

This project was built across **multiple v0 accounts, each with its own Neon
database**, and v0 applied schema changes *directly to those databases* without
committing migration files. So at least one database is likely already on the
new schema with legacy data imported — one work log reports **45 trips, 12
rates, 1 expense, 11 settings**.

Running `RESET_LEGACY_TABLES.sql` against that database would destroy real data.

Identify every database before touching any of them:

```bash
DATABASE_URL="postgresql://..." node scripts/db-fingerprint.mjs
```

It is read-only and prints no password. Read the `generation` line:

| `generation` | Meaning | What to do |
|---|---|---|
| `NEW (multi-tenant, post-cutover)` | Already migrated. May hold the 45 imported trips. | **Do not run the reset.** Baseline instead — see below. |
| `OLD (pre-auth, no organization_id)` | Never migrated. | The procedure below applies. |
| `EMPTY` | No tables. | Just run `pnpm db:migrate`. |

Use the highest `newest trip created_at` across all databases to decide which
one is actually current.

### If a database is already on the new schema

Do not re-run the migration and do not drop anything. The schema exists but was
never recorded in a ledger, so `pnpm db:migrate` would try to create tables that
already exist and fail on the first `CREATE TABLE`. Reconcile instead:

```bash
# Write the live schema out and diff it against migrations/0000_*.sql by hand.
pnpm exec drizzle-kit pull

# Record 0000 as applied WITHOUT executing its SQL, so later migrations stack.
pnpm db:baseline
```

`scripts/baseline-ledger.mjs` inserts the migration's hash and journal timestamp
into `drizzle.__drizzle_migrations`, creating the schema and table exactly as
drizzle's own migrator would. It is idempotent and never runs migration SQL.
After baselining, `pnpm db:migrate` applies only `0001` onward.

If the live schema has drifted from `lib/db/schema.ts`, fix `schema.ts` to match
live *first* and regenerate `0000`, then baseline. Generating a "corrective"
migration in the other direction would run DDL against production for objects
that are already correct.

### This already ran on the current database (2026-07-29)

Neon project `nameless-shadow-39962436`, host `ep-restless-term-av5wy3wo`. It
reported `generation NEW` with 45 trips / 12 rates / 1 expense / 11 settings, so:

- `lib/db/schema.ts` was rewritten to match live exactly, including the five
  `CHECK` constraints, the composite `settings_pkey`, and the two
  `UNIQUE(id, organization_id)` constraints that were missing from it. Constraint
  names are pinned to live so drizzle-kit does not emit a drop/recreate.
- `0000_baseline_live_schema` was **baselined, not executed** — verified
  byte-equal to a fresh `drizzle-kit pull` in both directions first.
- `0001_trips_dedup_constraint` was **applied**, adding the
  `UNIQUE(organization_id, trip_date, container_no)` that live was missing. Until
  then `addTrips`'s `onConflictDoNothing()` had nothing to conflict on, so
  re-scanning a card silently inserted a duplicate. There were 0 duplicates at
  the time, so the constraint was added without a cleanup step.

You should not need this document again for that database.

---

## Procedure for a pre-auth database

Everything below assumes `generation` reported `OLD`.

### 1. Back up — not optional

```bash
pg_dump "$DATABASE_URL" > backup-before-multitenant.sql
```

### 2. Export anything you want to keep

Only needed if you plan to re-import. `scripts/import-legacy.mjs` reads `.csv`
files from `.v0/imports/` and classifies each by its column headers, so export
one file per table with headers intact:

```bash
mkdir -p .v0/imports
for t in trips rates expenses settings; do
  psql "$DATABASE_URL" -c "\copy (SELECT * FROM $t) TO '.v0/imports/$t.csv' WITH CSV HEADER"
done
```

Note the script expects a `settings` export whose columns are exactly
`key,organization_id,value`, so add an `organization_id` column to that CSV (any
value — the script overwrites it with the legacy org id).

### 3. Drop the old tables

```bash
psql "$DATABASE_URL" -f migrations/RESET_LEGACY_TABLES.sql
```

### 4. Create the new schema

```bash
pnpm db:migrate
```

Verify with `pnpm db:studio` — you should see all 15 tables.

### 5. Create the first owner

Start the app, go to `/sign-up`, and register. The `/onboarding` flow creates
the organization and the `memberships` row that scopes all your data.

> `memberships` has `UNIQUE(user_id)`, so a user belongs to exactly one
> organization. Multi-org users are not supported yet.

### 6. Re-import legacy data (optional)

```bash
pnpm import:legacy
```

Idempotent: it records a `legacy-csv-import-v1` row in `schema_migrations` with
a checksum of the CSVs, and refuses to run twice or against changed files.

## Deploying this to Vercel

`lib/auth.ts` throws at module load if `BETTER_AUTH_SECRET` is unset, so the
deploy will crash on boot rather than fail gracefully. **Set it before pushing:**

```
BETTER_AUTH_SECRET   openssl rand -base64 32
DATABASE_URL         your Neon connection string
BETTER_AUTH_URL      https://your-app.vercel.app   (optional; inferred from VERCEL_URL)
GEMINI_API_KEY_1     required for /scan
```

Run the database steps above **before** the deploy goes live, or the new code
will query tables that do not exist yet.
