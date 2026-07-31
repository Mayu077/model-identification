# Project Status — Verified Audit

Audited against the consolidated task list from prior AI chat history.
Every line below was confirmed by reading the actual code, not assumed.
Date of audit: 2026-07-31. Branch: `driver-dashboard` (0 commits ahead of `main`).

---

## Repo health

| Check | Result |
| --- | --- |
| `tsc --noEmit` | Passes, zero errors |
| Working tree | Clean |
| Migration ledger | Correctly baselined (`0000` baselined-not-executed, `0001` applied) |
| Gemini model IDs | **Valid** — `gemini-3.5-flash` (May 2026) and `gemini-3.1-flash-lite` (May 2026) both real |

The code quality is coherent and internally consistent. There is no hidden rot
from the model-masking incident. Do not rewrite working code on suspicion alone.

---

## DONE — verified in code

### Architecture (the "before pitching anyone" block)

- **Async submit/process** — `app/api/scan/route.ts:39` uses `after()` from
  `next/server`. POST returns `202` with a `jobId` immediately; extraction runs
  in the background. Driver never waits. GET `?id=` polls status.
- **Duplicate/idempotency hash** — `route.ts:32` sha256-hashes the raw image
  buffer into `idempotencyKey`, with a UNIQUE constraint on
  `(organization_id, idempotency_key)`. Re-uploading the same image returns the
  existing job with `200` instead of `202` and spends **zero** API calls.
- **Job durability** — `scan_jobs` table has `status`, `attemptCount`,
  `leaseExpiresAt`, `errorCode`, `errorMessage`. Terminal states clear `input`
  so base64 images are not retained forever.
- **ISO 6346 (not 4648)** — corrected everywhere. Zero occurrences of `4648`
  remain. Enforced in **two** layers:
  - the extraction prompt instructs full check-digit verification
  - `lib/domain.ts:75` `validateContainerISO6346()` independently re-verifies in
    code and emits a warning if the digit fails. This is the right design: the
    model cannot silently lie about the checksum.
- **Row-level duplicate detection** — `processJob` builds a
  `tripDate|containerNo` set from existing trips and flags `isDuplicate` per row.
- **Multi-provider AI rotation** — `lib/ai/router.ts` rotates across
  Gemini/Groq/OpenRouter/NVIDIA, up to 5 keys each, on 429/quota/auth/timeout.
  Per-attempt timeout 25s, total budget 50s, under the route's `maxDuration=60`
  so you get a JSON error instead of a gateway 504.
- **Audit trail foundation** — `audit_logs` table plus `lib/audit.ts`
  `writeAudit()`, already called on `scan.queued`.
- **Multi-tenancy** — every business table FKs to `organization_id` with
  cascade; `requireTenant()` scopes all queries.

### Docs (all six requested were written)

`AI_MODEL_GUIDE.md`, `BUSINESS_GUIDE.md`, `SETUP_AND_DEPLOYMENT_GUIDE.md`,
`SUBSCRIPTION_PLANS_AND_COSTS.md`, `TRUCK_OWNER_INTERVIEW_QUESTIONS.md`,
`MULTITENANT_CUTOVER.md`.

### Screens

`/` dashboard, `/scan`, `/trips`, `/expenses`, `/analytics`, `/export`,
`/settings`, `/admin`, `/sign-in`, `/sign-up`, `/onboarding`,
`/onboarding/setup`.

---

## NOT DONE — confirmed absent

### 1. Parallel 3-pass validation — **NOT BUILT**

This is the single biggest gap versus the plan. `extractTripsFromImage()` in
`lib/ai/extract.ts` makes **one** vision call. There is no multi-pass agreement
and no per-field confidence.

Consequence: the "only genuinely disputed fields need review" lever — your best
answer to the CA's "if you still have to check, what's the point" objection —
does not exist yet. Right now a human must review all 25 rows, not just the 2
disputed ones.

`withModelRotation` is *failover*, not consensus. It runs the next provider only
when one **fails**, never concurrently for cross-checking. Building consensus
means calling it 3x inside `Promise.all()` and diffing field-by-field.

Note: the checksum validator already gives you a free, deterministic accuracy
signal per container number without any extra API cost. Cheapest partial win.

### 2. Driver tier — **NOT BUILT** (branch is empty)

Branch `driver-dashboard` has zero commits ahead of `main`. No `/driver` route,
no driver login, no driver dashboard.

Two hard blockers must be cleared first, both requiring a `0002` migration:

- **`memberships_role_check` is `CHECK (role = 'owner')`** — Postgres will
  *reject* any driver membership insert. `schema.ts:33-34` already flags this.
- **`trips` has no `driver_id` column** — trips cannot be attributed to a
  driver, so "driver sees their own trips" and the foreign-key audit trail are
  both impossible today.

Also missing: `drivers` is a contact list (`name`, `mobile`, `active`), not
accounts — no credential linkage to `user`. And `memberships_user_id_key` is
UNIQUE on `user_id`, meaning one user can belong to only one org; fine for
drivers, but it constrains design.

Agreed scope for the driver tier (owner decision, recorded here):

- Driver logs in and sees **only their own** trips
- Driver can submit/scan new trips
- Owner creates driver accounts (no self-signup)
- Drivers do **NOT** log expenses — explicitly out of scope
- Driver cannot edit an entry's date; date changes route to owner approval
- No unilateral driver delete; delete requests route to owner
- Instant access-revocation toggle for the owner (one tap, `active` flag)

### 3. Slip-timestamp cross-check / red-flag — **NOT BUILT**

Zero occurrences of `slipTimestamp` / `redFlag`. The extraction prompt reads a
date from the receipt but never stores the port's printed timestamp separately,
so it cannot be compared against the driver's handwritten date. No column
exists to hold it. This is the driver-fraud detection feature.

### 4. Bill template overlay — **NOT BUILT**

No `react-pdf`, `pdf-lib`, or `jspdf` in dependencies. Export is
spreadsheet-only via `xlsx` (`lib/export.ts`). The Canva manual step is still
fully manual. Needs `@react-pdf/renderer` (flow layout handles variable trip
counts; avoids the Puppeteer/chromium cold-start weight on serverless).

### 5. Confidence-based field flagging — **NOT BUILT**

Depends on item 1. Currently only coarse `warnings[]` strings per row.

### 6. Hindi/Marathi UI — **NOT BUILT**

No i18n layer. All strings hardcoded English.

### 7. Field measurement — **NOT STARTED** (not a code task)

The two highest-priority items on the original list are still open and no amount
of coding substitutes for them:

- 5-10 real truck-owner conversations near Panvel/JNPT
- Stopwatch: AI-assisted confirm vs. manual entry, same trip card

The prior analysis was blunt and correct: pricing, the CA objection, and scale
planning are all unresolvable hypotheticals until these two numbers exist.

---

## Cost question — which model actually gets called

`TASK_PROVIDER_ORDER` in `lib/ai/router.ts`:

- `vision` → **gemini first**, then groq, then openrouter
- `text` → groq first, then gemini
- `reasoning` → groq first, then nvidia, openrouter, gemini

Vision is the expensive path (every trip-card scan) and it hits Gemini first.
That matches the observed good accuracy. Two caveats before optimizing:

- Switching vision to a cheaper model trades away the accuracy that is currently
  your main product claim. Do **not** switch before item 7 measures what accuracy
  is actually worth.
- If you build 3-pass consensus (item 1), vision cost multiplies by ~3. Budget
  for that. A cheap hedge: run pass 1 on Gemini and passes 2-3 on free-tier
  Groq/OpenRouter keys, so consensus costs little more than today.

---

## Recommended order

1. **Account recovery** — set `BOOTSTRAP_OWNER_EMAIL`, confirm org id via
   `scripts/diagnose-orphaned-data.sql`, claim workspace. Do this before any
   migration.
2. **Migrate off the borrowed Vercel/Neon account** to your own.
3. **`0002` migration** — widen `memberships_role_check`, add `trips.driver_id`,
   add slip-timestamp column. One migration, since all three touch production.
4. **Driver tier** per the agreed scope above.
5. **3-pass consensus + confidence flagging.**
6. Field measurement in parallel with all of the above — it gates pricing, not code.

Defer: bill templates, i18n, gamification, custom vision model, scale hardening.
