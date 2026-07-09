# Subscription Plans & Running Costs

This document outlines pricing tiers, actual infrastructure costs, and profitability at different customer scales.

---

## Subscription Plans

### Plan Structure

**Base Plan: ₹1,299/month**
- 1–5 trucks
- Unlimited trip scans
- Unlimited drivers (per truck owner)
- Audit trail (30-day retention)
- Email support (24-hour response)
- Bill generation + Excel export
- Container checksum validation

**Growth Plan: ₹2,199/month**
- 5–15 trucks
- Everything in Base Plan, plus:
- Customizable bill template (letterhead upload)
- Advanced analytics dashboard
- Audit trail (90-day retention)
- Priority support (6-hour response)
- Integration API (for future 3rd-party apps)

**Enterprise Plan: Custom Quote**
- 15+ trucks
- Everything in Growth Plan, plus:
- Dedicated account manager
- Custom integrations (QuickBooks, Tally, etc.)
- Multi-user admin dashboard
- 1-year audit trail
- SLA (99.5% uptime guarantee)
- Data residency options

### Why This Structure?

1. **Base Plan anchored to tally-labor savings**
   - Average truck owner pays ₹2,000–3,000/month for a tally person (part-time)
   - ₹1,299 is 40–60% of that = easy sell ("saves money compared to hiring")

2. **Growth Plan adds value, not complexity**
   - Customizable bills + analytics justify the step-up
   - Targets owners with office staff (more sophisticated buyers)

3. **Enterprise Plan has infinite margin**
   - Custom integrations are time-heavy but high-margin
   - Only pursue when you have 10+ paying customers

### Payment Terms
- Monthly subscription (automatic renewal)
- Annual subscription (₹12,990 for Base Plan, ₹21,990 for Growth Plan) — saves 17% if pre-paid annually
- Free trial: First month free (no credit card required)

---

## Actual Running Costs (Per Month)

### Fixed Costs (Same Regardless of Customer Count)

| Item | Cost (INR) | Notes |
|------|-----------|-------|
| Vercel Pro Plan | ₹1,650 | $20/month (required for commercial use, higher limits) |
| Neon PostgreSQL | ₹825 | $10/month (free tier isn't suitable for production) |
| Domain + SSL | ₹500 | ($6/month domain + free SSL from Vercel) |
| **Total Fixed** | **₹2,975** | Needed before your first customer |

### Variable Costs (Per Customer Per Scan)

| Item | Cost per Scan | Calculation |
|------|---|---|
| Gemini 2.0 Flash (input) | ₹0.060 | 6 million tokens/month costs ₹360; avg 10K tokens/scan = 600 scans = ₹0.60/scan |
| Gemini 2.0 Flash (output) | ₹0.015 | Output 5x cheaper; ~2K tokens/scan = ₹0.30/scan output / 20 scans = ₹0.015 |
| **Gemini Total** | **₹0.075** | Per scan (70-second multi-pass extraction) |
| GPT-4o Mini (input) | ₹0.030 | Half the cost of Gemini for same accuracy |
| GPT-4o Mini (output) | ₹0.015 | Roughly same |
| **GPT-4o Mini Total** | **₹0.045** | Per scan (similar accuracy, cheaper) |

### Customer Volume Scenarios

#### Scenario 1: 5 Paying Customers (Base Plan)
```
Subscription Revenue:
  5 × ₹1,299 = ₹6,495/month

API Costs (using Gemini):
  5 customers × 100 scans/month × ₹0.075/scan = ₹37.50
  (approximately ₹150 for rounding, unpredictable volume)

Total Costs:
  Fixed: ₹2,975
  Variable: ₹150 (API)
  Total: ₹3,125

Gross Profit: ₹6,495 - ₹3,125 = ₹3,370 (52% margin)
```
**Verdict:** Profitable, but tight. Focus on acquisition.

#### Scenario 2: 20 Paying Customers (Mixed Plans)
```
Subscription Revenue:
  12 Base Plan × ₹1,299 = ₹15,588
  8 Growth Plan × ₹2,199 = ₹17,592
  Total: ₹33,180/month

API Costs (using Gemini):
  20 customers × 100 scans/month × ₹0.075/scan = ₹150
  (More realistic estimate: ₹800–1,000, accounting for variation)

Total Costs:
  Fixed: ₹2,975
  Variable: ₹1,000 (API)
  Support (1 person, part-time): ₹5,000
  Total: ₹8,975

Gross Profit: ₹33,180 - ₹8,975 = ₹24,205 (73% margin)
```
**Verdict:** Highly profitable. Hire a part-time support person.

#### Scenario 3: 50 Paying Customers (Mixed, Mature)
```
Subscription Revenue:
  30 Base Plan × ₹1,299 = ₹38,970
  20 Growth Plan × ₹2,199 = ₹43,980
  Total: ₹82,950/month

API Costs (using GPT-4o Mini to save money):
  50 customers × 150 scans/month (higher adoption) × ₹0.045/scan = ₹337.50
  (Realistic: ₹2,500, accounting for power users)

Total Costs:
  Fixed: ₹2,975
  Variable: ₹2,500 (API)
  Support (1 full-time person): ₹25,000
  Marketing/dev (contingency): ₹5,000
  Total: ₹35,475

Gross Profit: ₹82,950 - ₹35,475 = ₹47,475 (57% margin)
```
**Verdict:** Highly profitable. Can hire dedicated support + developer for features.

---

## Cost Optimization Strategies

### 1. Model Selection
- **Start with Gemini** (more accurate for Indian handwriting)
- **At 20+ customers, evaluate GPT-4o Mini** (half the cost, still excellent)
- **Switch if:** You notice no accuracy regression but API spend drops 50%

### 2. Duplicate Detection
- Hash every image before calling OCR
- Check if hash exists in database
- If yes, skip API call entirely (free check, same results)
- **Impact:** 10–20% fewer API calls (drivers often upload the same trip card twice by accident)

### 3. Concurrent Validation
- Run 3 validation passes in parallel (not sequentially)
- Wall-clock time stays ~70s (bounded by slowest pass)
- API cost per scan = cost of 1 pass (not 3)
- **Impact:** 66% cost reduction vs. sequential

### 4. Caching
- Once a trip is extracted + validated, don't re-extract if the owner asks to re-download the bill
- Store the extracted data in the database
- **Impact:** 5–10% fewer API calls

### 5. Rate Limits
- Per-customer rate limit: 50 scans/hour per API key
- Prevents abuse, reduces runaway bills if someone's app malfunctions
- **Cost if limit is hit:** Customer sees error, must retry later (no wasted API call)

---

## Break-Even Analysis

### Months to Break-Even

```
Monthly Fixed Costs: ₹2,975
Avg Gross Margin per Customer: ₹1,100 (accounting for API costs)
Required Customers: ₹2,975 / ₹1,100 = 2.7 customers

Takeaway: You break even at ~3 paying customers
```

**Realistic timeline:**
- Month 1–2: Validation + field research (no revenue)
- Month 3: First 2 pilot customers (free trial)
- Month 4: 2 paying customers + 3 in free trial → break even
- Month 6: 10–15 paying customers → confident profitability

---

## Cash Flow & Seasonality

### Seasonal Patterns (Your Truck Industry)

**High Season (Oct–Mar):** Port cargo volumes peak
- More trips = more scans
- Customers more willing to try the app (they're busy, need efficiency)
- API costs spike 2–3x

**Low Season (Apr–Sep):** Slower logistics, monsoon shutdowns
- Fewer trips = fewer scans
- Some customers may pause subscriptions (temporarily)
- API costs drop

**Strategy:**
- Plan cash reserves for low season (set aside 30% of profit in high season)
- Consider seasonal pricing (cheaper in low season, premium in high season)

---

## Pricing Psychology & Objection Handling

### "Why ₹1,299? That's expensive"

**Counter:** 
- "You're currently paying how much for your tally operator? [Wait for answer]"
- "₹1,299 saves you ₹2,000–3,000 in labor costs. Plus it catches mistakes that cost you more."
- "Try it free for a month. If you don't save that money back, no charge."

### "I want to pay per scan, not per truck"

**Counter:**
- "Per-scan pricing is unpredictable for you (some days 10 scans, some days 100)"
- "Monthly is predictable and cheaper overall. You pay ₹1,299 even if you do 300 scans."
- "This matches how you pay your tally person — by the month, not per ledger entry"

### "Can you do ₹999?"

**Counter:**
- "At ₹999, we'd lose money after 3 customers. I can offer ₹1,299 or a free trial so you see the value first."
- (Or: "Yes, if you commit to annual billing upfront" — effectively ₹999 annualized)

### "I need the Growth Plan, but can you give it for ₹1,500?"

**Counter:**
- "Growth Plan includes X, Y, Z features that Base doesn't. ₹2,199 is fair. But if budget is tight, start with Base for ₹1,299 and upgrade later."
- (Or: Offer annual discount — ₹21,990/year saves ₹900)

---

## Payment Infrastructure

### Setup (You'll Need These)

1. **Razorpay** (India's #1 payment gateway for startups)
   - 2% + ₹3 per transaction (very reasonable)
   - Handles Indian credit/debit cards, UPI, wallets
   - Supports automatic recurring charges (subscriptions)

2. **Vercel + Neon's Built-in Billing** (Optional)
   - Not suitable for Indian customers (no local payment method)
   - Skip this

3. **Manual Invoicing** (For the first 3–5 customers)
   - Use Google Docs + email
   - Track in a spreadsheet
   - Switch to Razorpay subscription once you're ready

### Recommended Flow
- Customer signs up on your site
- They enter email, truck count
- Razorpay payment gateway opens
- After payment → dashboard unlocks
- Automatic monthly recurring charge (customer can cancel anytime)

---

## Long-Term Pricing Adjustments

### When to Raise Prices

**After 30 days with 5+ happy customers:**
- Increase new customer price by ₹200–300 (existing customers stay on old price)
- Grandfathered pricing keeps churn low while new revenue goes up

**After achieving 50+ customers:**
- Increase all prices by 10–15% (with notice)
- You can do this because you have proof points + reviews

### When NOT to Raise Prices

- Your churn rate is above 10% (fix retention first)
- Competitors undercut you significantly (evaluate them first)
- You're losing deals to price every week (may already be too high)

---

## Financial Dashboard (Track These Monthly)

| Metric | Target | Current |
|--------|--------|---------|
| Monthly Recurring Revenue (MRR) | Growing 15–20%/month | _____ |
| Average Revenue per User (ARPU) | ₹1,500 (mixed plan) | _____ |
| Customer Acquisition Cost (CAC) | < ₹3,000 | _____ |
| Lifetime Value (LTV) | > ₹30,000 | _____ |
| Churn Rate | < 5%/month | _____ |
| Net Profit Margin | Growing toward 40% | _____ |
| API Cost as % of Revenue | < 5% | _____ |

---

## Summary

- **Your business model is profitable at very small scale** (3 customers = break even)
- **Pricing is anchored to real customer budgets** (₹1,299 is 40–60% of current tally cost)
- **Margin expands as you grow** (fixed costs are fixed; variable costs scale slowly)
- **API costs are manageable** (even at 50 customers, still < 3% of revenue if you're smart)
- **Seasonal volatility is real** (plan cash reserves)

Next step: Close your first 3 paying customers and prove the unit economics. Everything else scales from there.
