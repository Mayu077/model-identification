# Complete Setup & Deployment Guide

This guide walks you through downloading the app from v0, setting it up locally, deploying it live on Vercel, and configuring everything needed to go live.

---

## Part 1: Download & Initial Setup

### Step 1: Download the Code from v0

1. Go to **v0.app** (your current chat)
2. In the top right, click the **⋮ menu**
3. Select **"Download ZIP"** or **"Install with GitHub"**

#### Option A: Download ZIP
- Extract the ZIP to your computer: `trip-card-app-main/`
- Open terminal in that folder: `cd trip-card-app-main`
- Skip to Step 2

#### Option B: Install with GitHub (Recommended)
1. v0 will open GitHub → authorize v0 to create a repo
2. Choose an organization (or just your personal account)
3. v0 pushes the code to `yourusername/trip-card-app`
4. Clone it locally:
   ```bash
   git clone https://github.com/yourusername/trip-card-app.git
   cd trip-card-app
   ```

**Why GitHub is better:** You get version history, easy rollbacks, and Vercel auto-deploys when you push.

### Step 2: Install Dependencies

```bash
# Make sure you have Node.js 18+ and pnpm installed
# If you don't have pnpm: npm install -g pnpm

pnpm install
```

This downloads all dependencies (~500MB) and might take 2–3 minutes on a slow internet.

### Step 3: Set Up Environment Variables

Create a `.env.local` file in the root directory:

```bash
touch .env.local
```

Open it in a text editor and add (get these values from the steps below):

```
# Database (Neon PostgreSQL)
DATABASE_URL=postgresql://user:password@host/dbname

# AI API Keys (required for scanning)
GEMINI_API_KEY_1=your_gemini_key_here
# Optional (for fallback):
# GEMINI_API_KEY_2=...
# GROQ_API_KEY_1=...
# OPENROUTER_API_KEY_1=...

# For deployment only (not needed locally):
# BETTER_AUTH_SECRET=generated_below
```

---

## Part 2: Set Up the Database (Neon PostgreSQL)

### Step 1: Create a Neon Account

1. Go to **neon.tech**
2. Sign up with email (or GitHub)
3. Create a new project (name it `trip-card-app` or similar)
4. Choose a region near your users (e.g., Asia–Singapore)

### Step 2: Get Your Connection String

1. After creating the project, Neon shows your connection string
2. It looks like: `postgresql://user:password@host.neon.tech/dbname`
3. Copy this and paste it into your `.env.local` as `DATABASE_URL`

### Step 3: Run Database Migrations

The Drizzle ORM schema is in `lib/db/schema.ts`. To create tables:

```bash
pnpm db:migrate
```

This applies everything in `migrations/` and creates all 15 tables (`user`,
`session`, `account`, `verification`, `organizations`, `memberships`,
`owner_invites`, `trips`, `expenses`, `rates`, `settings`, `drivers`,
`audit_logs`, `scan_jobs`, `schema_migrations`) in your Neon database.

> **Upgrading an existing database?** If your database predates
> authentication — i.e. it has `trips`/`expenses`/`rates`/`settings` with no
> `organization_id` column — `pnpm db:migrate` will fail with
> `relation "trips" already exists`. Follow **[MULTITENANT_CUTOVER.md](MULTITENANT_CUTOVER.md)**
> instead of this step.

After changing `lib/db/schema.ts`, regenerate the SQL with:

```bash
pnpm db:generate
```

### Step 4: Verify

```bash
pnpm db:studio
```

This opens a web UI showing your database tables. If you see `trips`, `expenses`, `drivers`, you're good.

---

## Part 3: Set Up AI API Keys

### Option 1: Gemini (Recommended for Accuracy)

1. Go to **ai.google.dev** → "Get API Key"
2. Sign in with Google
3. Create a new API key
4. Copy it and add to `.env.local`:
   ```
   GEMINI_API_KEY_1=your_key_here
   ```
5. Test it:
   ```bash
   pnpm dev
   # Visit http://localhost:3000/scan
   # Upload a trip card image
   # Should see extraction results
   ```

**Free Tier:** 15 requests per minute, plenty for testing.

### Option 2: Groq (Cheaper Fallback)

1. Go to **console.groq.com** → Sign up
2. Create an API key
3. Add to `.env.local`:
   ```
   GROQ_API_KEY_1=your_key_here
   ```

The router will automatically rotate to Groq if Gemini hits rate limits.

### Option 3: OpenRouter (Multi-Model)

1. Go to **openrouter.ai** → Sign up
2. Create an API key
3. Add to `.env.local`:
   ```
   OPENROUTER_API_KEY_1=your_key_here
   ```

---

## Part 4: Run Locally

```bash
pnpm dev
```

Open **http://localhost:3000** in your browser.

**What you should see:**
- Dashboard with 0 trips (first time)
- "Scan" tab → upload a trip card image
- "Trips" tab → manual entry
- "Export" tab → download bills

**Test the scan:**
1. Go to **Scan**
2. Upload a photo of a trip card
3. After 30–60 seconds, see extracted entries
4. Click "Save 1 Trips"
5. Go to Trips tab → see the trip you just entered

---

## Part 5: Deploy to Vercel (Go Live)

### Step 1: Connect Your GitHub Repo to Vercel

1. Go to **vercel.com** → Sign in (or create account with GitHub)
2. Click **"Add New..." → "Project"**
3. Choose **"Import Git Repository"** → find your `trip-card-app` repo
4. Click **"Import"**

### Step 2: Configure Environment Variables

Vercel shows a form for `.env` variables. Fill in:

```
DATABASE_URL = postgresql://...
GEMINI_API_KEY_1 = your_key
BETTER_AUTH_SECRET = (generate below)
```

**Generating BETTER_AUTH_SECRET (for deployment):**
```bash
# On your local terminal:
openssl rand -base64 32
# Output example: Kx9mN2pQ7vL4wZ8jB6sT3hF5gC1dE9aR=
# Copy this and paste into BETTER_AUTH_SECRET
```

### Step 3: Deploy

1. Click **"Deploy"** on the Vercel dashboard
2. Vercel builds & deploys (takes 2–5 minutes)
3. You'll get a URL like: `https://trip-card-app.vercel.app`
4. Visit it — your app is now live!

### Step 4: Test on Your Phone

1. Open the live URL on your phone browser
2. Go to **Scan** → **"Take Photo"** or **"Upload Image"**
3. Take a photo of a trip card
4. Verify it extracts correctly
5. Try to **Download Summary + Bill** on Export tab

---

## Part 6: PWA Installation (Install as App on Phone)

### On Android (Chrome)

1. Open the app URL in Chrome
2. Tap the **⋮ menu** (three dots)
3. Select **"Add to Home screen"**
4. App appears in your home screen with an icon

### On iPhone (Safari)

1. Open the app URL in Safari
2. Tap the **Share** button
3. Select **"Add to Home Screen"**
4. App appears in your home screen

---

## Part 7: Daily Operations

### For Drivers

1. Open the app on their phone
2. **Scan** → take photo of trip card
3. Review extracted data (red highlights if checksum fails)
4. Correct mistakes
5. Click **"Save 1 Trips"**
6. Done — trip is now in the owner's dashboard

### For Owners

1. Log in to dashboard
2. View all trips on the **Trips** tab
3. Filter by date, port, driver
4. Click a trip to edit or delete (goes to audit trail)
5. Go to **Export** → pick date range → download **Summary + Bill**

---

## Part 8: Troubleshooting

### "Scan failed (server error 504)"
- Your free Vercel functions have a time limit
- **Fix:** Upgrade to **Vercel Pro** ($20/month) for longer function durations
- After upgrade, re-deploy: `git push` → Vercel auto-redeploys

### "Unexpected token error when uploading from phone"
- Phone photos are too large (8–15 MB)
- **Fix:** Already included in the app — it auto-compresses. If still failing, try the PC version first to verify the image works.

### "Database connection failed"
- Your `DATABASE_URL` is wrong or Neon is down
- **Fix:** 
  1. Go to Neon dashboard → copy connection string again
  2. Update `.env.local` locally
  3. Test: `pnpm dev` and try a scan
  4. If local works, re-deploy to Vercel (update env vars there too)

### "AI extraction returns empty or garbage"
- Your API key is invalid or out of quota
- **Fix:**
  1. Test the key locally: `pnpm dev` → Scan → check console logs for `[ai-router]` messages
  2. Verify key is correct on **ai.google.dev** or **console.groq.com**
  3. If quota is hit, wait 24 hours or upgrade to a paid plan

### "I can't find my trips after I saved them"
- They're in the database, but you're viewing as a different driver
- **Fix:** The app filters by `driver_id`. If you logged in as "Driver A" but created as "Driver B", switch driver accounts in the top-right menu.

---

## Part 9: Ongoing Maintenance

### Weekly
- Check dashboard → any scans failing? Look at console logs
- Monitor API costs on Gemini console (Should be < ₹100/week for testing)

### Monthly
- Backup your database: Go to Neon dashboard → export backup
- Review audit log (Settings tab) — any suspicious activity?
- Check Vercel logs for errors: Dashboard → Deployments → latest → Logs

### Before Going Live with Customers
- [ ] Switch to Vercel Pro plan ($20/month)
- [ ] Increase Neon to Pro tier if you'll have 100+ scans/day
- [ ] Set up a simple status page (use **status.vercel.com** or add `/api/health` endpoint)
- [ ] Document support process (email, phone, response time)
- [ ] Test full flow on 3–5 people who aren't you

---

## Part 10: Scaling Checklist

### When You Hit 10 Customers

- [ ] Enable database backups in Neon (automatic daily)
- [ ] Set up monitoring (uptime, error rate) — use **Better Uptime** or similar
- [ ] Document FAQs for customers
- [ ] Add rate limiting on `/api/scan` (50 requests/hour per customer)

### When You Hit 50 Customers

- [ ] Migrate to Neon Pro (higher concurrency, better performance)
- [ ] Consider a Vercel Pro plan upgrade to Pro+ if API costs spike
- [ ] Set up a help desk or support ticketing system
- [ ] Implement payment processing (Razorpay for Indian customers)

### When You Hit 200+ Customers

- [ ] Consider a custom domain (instead of vercel.app)
- [ ] Set up a separate staging environment for testing
- [ ] Hire someone part-time to handle customer support
- [ ] Review and optimize your database queries for performance

---

## Part 11: Security Checklist

### Before Going Live

- [ ] `.env.local` is in `.gitignore` (never commit secrets)
- [ ] API keys are rotating (enable key rotation on Gemini/Groq dashboards)
- [ ] CORS is locked down (only your domain can call the API)
- [ ] Driver data is scoped by `driver_id` (no leaking other drivers' data)
- [ ] All writes are audited (audit_log table has entries)
- [ ] Passwords are hashed by Better Auth (don't store plain text)

### Ongoing

- [ ] Monthly: Check Vercel & Neon security advisories
- [ ] Monthly: Rotate old API keys
- [ ] Quarterly: Review audit logs for suspicious activity
- [ ] Annually: Get a security audit from a professional (optional but recommended)

---

## How to Deploy Updates

### Making a Change

1. Edit code locally (e.g., fix a bug)
2. Test: `pnpm dev`
3. Commit: `git add . && git commit -m "Fix scan timeout bug"`
4. Push: `git push`
5. Vercel auto-deploys (takes 2–5 minutes)
6. Done — new version is live in ~5 minutes

### Rollback if Something Breaks

1. Go to Vercel dashboard → Deployments
2. Find the last working deployment
3. Click "Rollback" → your app goes back to the old version instantly

---

## Getting Help

| Problem | Resource |
|---------|----------|
| Neon database questions | neon.tech/docs |
| Vercel deployment issues | vercel.com/support or Discord |
| Better Auth setup | authjs.dev/getting-started |
| Drizzle ORM | orm.drizzle.team/docs |
| General technical question | Check the AI_MODEL_GUIDE.md in this folder |

---

## Success Criteria

After deployment, you should be able to:
- [ ] Access the app on your phone via the live URL
- [ ] Upload a trip card → get extracted data in < 90 seconds
- [ ] Save a trip → see it in the Trips tab
- [ ] Export a bill → download as Excel
- [ ] See a container number fail the checksum validation (red highlight)
- [ ] View audit trail showing who created each trip

If all of these work, you're ready to start your first pilot with a real customer.

Good luck. You've got this.
