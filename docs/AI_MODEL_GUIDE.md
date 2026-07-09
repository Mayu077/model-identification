# AI Model Guide: Making Changes to the Trip Card OCR App

This document explains how to make intelligent, maintainable changes to this codebase. Read this before modifying the app.

## Architecture Overview

```
app/
├── api/
│   ├── scan/route.ts          ← Main OCR endpoint (calls AI router)
│   ├── expense-ai/route.ts    ← Expense classification
│   └── ...
├── page.tsx                    ← Dashboard (displays aggregated data)
├── trips/page.tsx              ← Trip list & manual entry
├── scan/page.tsx               ← Scan interface
└── export/page.tsx             ← Bill generation & Excel download

lib/
├── ai/
│   ├── router.ts               ← Model rotation, timeouts, provider management
│   ├── extract.ts              ← Trip extraction prompt (handwritten + computer receipts)
│   └── expense.ts              ← Expense classification prompt
├── db/
│   ├── schema.ts               ← Drizzle ORM schema (trips, expenses, settings, drivers)
│   └── queries.ts              ← Common database operations
├── domain.ts                   ← Validation: ISO 6346 checksums, container warnings
└── ui-helpers.ts               ← Formatting, port lookups, etc.

components/
├── scan/
│   ├── scan-client.tsx         ← Photo upload + compression + review table
│   └── scan-server.tsx         ← Server component wrapper
├── export/
│   ├── bill-generator.tsx      ← React-PDF bill rendering
│   └── summary-excel.tsx       ← XLSX generation
└── ...other UI components

Database (Neon PostgreSQL):
- trips (container_no, rate, from_port, to_port, tripDate, driver_id)
- expenses (category, amount, expenseDate, description)
- drivers (id, truck_owner_id, name, phone, active)
- settings (key, value) — stores invoice_counter, config flags
- audit_log (action, user_id, trip_id, old_value, new_value)
```

## How the Scan Flow Works (Current)

1. **Driver uploads image** → `components/scan/scan-client.tsx`
2. **Browser compresses** → max 2048px, 85% JPEG quality
3. **POST /api/scan** with FormData (image blob)
4. **Route handler** → `app/api/scan/route.ts`
5. **withModelRotation()** calls `lib/ai/extract.ts` prompt
6. **AI reads image** → returns JSON array of trips
7. **Sanitization** → `containerWarning()`, ISO 6346 checksum validation, duplicate check
8. **Return to client** → review table, driver edits if needed
9. **Driver submits** → POST /api/scan/save → trips written to DB

**Problem:** Steps 5-7 can take 70+ seconds on free Vercel functions (timeout at 60s → 504). This blocks the driver.

**Solution coming:** Async pattern (Fluid Compute `waitUntil`) — submit returns instantly, processing happens in background, results land in DB for owner review.

## Making Changes: The Rules

### 1. Always validate container numbers
If you're accepting a container number anywhere (manual entry, AI extraction, import), call `containerWarning(number)` from `lib/domain.ts`:
```typescript
import { containerWarning } from "@/lib/domain"

const warning = containerWarning(userInput)
if (warning) {
  return { error: warning } // Show red error to user
}
```

This checks both format (4 letters + 7 digits) AND ISO 6346 checksum. Don't skip it.

### 2. Always use the AI router, never call models directly
```typescript
// ❌ WRONG
const response = await fetch('https://api.openai.com/...')

// ✅ CORRECT
import { withModelRotation } from "@/lib/ai/router"
const result = await withModelRotation('extract', async (model) => {
  return await generateText({
    model,
    prompt: TRIP_EXTRACTION_PROMPT,
    // ...
  })
})
```

The router handles:
- Key rotation (cycles through GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.)
- Retries on rate limits
- Per-attempt 25s timeout + 50s total budget (prevents 504s)
- Provider fallback (Gemini → Groq → OpenRouter → Nvidia)
- Logging which model/key was used (important for cost tracking)

### 3. Port codes must match the enum
Only these six exist:
```typescript
'JNPT' | 'GTI' | 'BMCT' | 'NSICT' | 'NSIGT' | 'JNB'
```

If you're adding a new port, update:
1. `lib/domain.ts` — add port code + name mapping
2. `lib/db/schema.ts` — update the `from_port` and `to_port` enum
3. `lib/ai/extract.ts` — update the receipt-parsing rules (which terminal names map to which codes)

### 4. Always query by driver ownership
Every query that touches driver data must filter by the requesting driver's `driver_id`:
```typescript
// ❌ WRONG — exposes all trips
const trips = await db.select().from(tripsTable)

// ✅ CORRECT
import { getDriverTrips } from "@/lib/db/queries"
const trips = await getDriverTrips(driverId)
```

This is your security model — no RLS in Neon, so code-level filtering is mandatory.

### 5. Audit every write
When a driver creates, updates, or deletes a trip, log it:
```typescript
import { logAudit } from "@/lib/db/queries"
await logAudit({
  action: 'trip_created',
  driver_id: driverId,
  trip_id: newTripId,
  old_value: null,
  new_value: JSON.stringify(tripData),
})
```

This creates an immutable audit trail. The owner's dashboard can show "who entered this, when" — valuable for the CA's accountability concerns.

### 6. Dates are always YYYY-MM-DD
Never store dates as timestamps or other formats. Always use the string format `YYYY-MM-DD`:
```typescript
const tripDate = new Date().toISOString().split('T')[0] // "2026-07-04"
```

This is how the DB schema expects it, and it keeps it consistent with trip cards.

### 7. Testing before deployment
- **Type check:** `npx tsc --noEmit` — must have zero errors
- **Lint:** `npx eslint .` — catch style issues
- **Local dev:** `pnpm dev` then test in the browser
- **If you add a new API key env var:** update the router's `getModelCandidates()` function to recognize it

### 8. Cost tracking: Which model are we calling?
Look at the console logs after a scan. You'll see:
```
[ai-router] gemini-2.0-flash-exp key#1 succeeded
```

Gemini is currently called first because it's more accurate. But **before going live**, calculate:
- Gemini 2.0 Flash: ~$0.075 per million input tokens (very cheap)
- GPT-4o Mini: ~$0.15 per million input tokens (2x cheaper for this volume)

A single trip-card extraction uses ~8000-12000 input tokens (depends on image size + OCR quality). At 100 customers × 5 trips/day:
- **Gemini:** 100 × 5 × 10,000 tokens/day = 5M tokens/day = ~$0.375/day = ~$11/month
- **GPT-4o Mini:** same volume = ~$22/month

Gemini is still cheaper. But if Gemini starts having quality issues, flip the order in `router.ts` line 1 (currently Gemini-first, can swap to GPT-first).

---

## Adding a New Feature

### Example: "Notify owner when a trip is entered"

1. **Add to schema** (`lib/db/schema.ts`):
   - Add `owner_notifications` table if it doesn't exist
   - Columns: `id`, `owner_id`, `trip_id`, `message`, `read`, `created_at`

2. **Write query helper** (`lib/db/queries.ts`):
   ```typescript
   export async function createNotification(
     ownerId: string,
     tripId: string,
     message: string,
   ) {
     return await db.insert(notifications).values({
       owner_id: ownerId,
       trip_id: tripId,
       message,
       read: false,
       created_at: new Date().toISOString(),
     })
   }
   ```

3. **Call it at the right place** (after a trip is saved):
   ```typescript
   // In app/api/scan/save or wherever trips are created
   const trip = await createTrip(driverId, tripData)
   const owner = await getDriverOwner(driverId)
   await createNotification(owner.id, trip.id, `New trip: ${trip.containerNo}`)
   ```

4. **Show it in UI** (`app/dashboard/page.tsx` or new `/notifications` page):
   ```typescript
   const notifications = await getOwnerNotifications(ownerId)
   return <NotificationList notifications={notifications} />
   ```

5. **Type-check & test:**
   - `npx tsc --noEmit` — ensure types are correct
   - Test in dev: `pnpm dev`, create a trip, see notification appear

---

## Common Gotchas

**"I added a new env var but the app doesn't see it"**
- You updated `.env.local` but didn't restart `pnpm dev`? Restart it.
- You pushed to GitHub but deployed on Vercel without adding the var to project Settings → Vars? Add it there.

**"The AI is returning wrong data"**
- Check the extraction prompt in `lib/ai/extract.ts` — did you change it accidentally?
- Is the image quality so bad that even human eyes can't read it? The AI won't either.
- Are you sending the right model? Check `withModelRotation` logs: which provider actually ran?

**"Driver can see other drivers' trips"**
- You forgot to filter by `driver_id`. Check your query — it should include a WHERE clause for the requesting driver.

**"Typecheck passes but it crashes at runtime"**
- You're calling `containerWarning()` on undefined? Use optional chaining: `containerWarning(number ?? '')`.
- You're accessing an array without checking length? Add a bounds check.

**"The bill export looks wrong"**
- Check `components/export/bill-generator.tsx` — is the data being mapped correctly?
- Is the PDF margin/font size cutting off text? React-PDF has size constraints.

---

## Deployment Checklist

Before going live on Vercel:
- [ ] All env vars are set in project Settings → Vars (don't rely on `.env.local`)
- [ ] `maxDuration` is set to 60s on any route that calls AI (already done on `/api/scan` and `/api/expense-ai`)
- [ ] Run `npx tsc --noEmit` — zero TypeScript errors
- [ ] Run `npx eslint .` — no lint errors
- [ ] Test a real scan on your phone using the deployed URL (not localhost)
- [ ] Test on Vercel Pro (free tier functions have hard limits; you need Pro for commercial use)
- [ ] Audit trail is being logged for every trip create/update/delete

---

## Questions? Debug Steps

If the app breaks:

1. **Check the server logs:** Go to Vercel dashboard → your project → Deployments → latest → Logs. Look for errors.
2. **Check your browser console:** Open DevTools → Console. Any JavaScript errors?
3. **Check the AI router logs:** If extraction failed, look for `[ai-router]` lines showing which provider failed and why.
4. **Reproduce locally first:** `pnpm dev`, replicate the bug. Is it a code issue or a deployment issue?
5. **Type-check:** `npx tsc --noEmit`. Often TypeScript catches the bug before runtime.

---

**This app is built to scale.** Every decision — async processing, audit trails, container validation, per-driver security — is designed to support 50+ truck owners without reimplementation. Make changes carefully, follow the rules above, and you're good.
