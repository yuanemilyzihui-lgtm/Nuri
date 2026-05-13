# Nuri — Stripe Connect + Supabase setup

This adds a real backend to the Nuri static prototype:

- **Auth + DB:** Supabase
- **Payments:** Stripe **Connect Express** (marketplace: dieticians sell, platform takes 20%)
- **Server:** Vercel serverless functions in `/api`

End-to-end flow:

1. Dietician signs up → completes Stripe Express onboarding → can accept subscriptions.
2. Subscriber signs up → subscribes to a dietician via Stripe Checkout.
3. Stripe charges $9.99/mo or $99/yr → 20% (`application_fee_percent`) stays on the platform → 80% transfers to the dietician's Connect account.
4. Webhook updates Supabase so the app knows who has access to what.

---

## 1. Stripe setup

### 1a. Enable Connect

Go to https://dashboard.stripe.com/settings/connect and **enable Connect**. Choose "Platform or marketplace." Use **Express accounts** for dieticians.

### 1b. Create the subscription Product + Prices

https://dashboard.stripe.com/products → **+ Add product**

- Name: `Nuri Premium`
- Two recurring prices:
  - **$9.99 USD / month**
  - **$99.00 USD / year**

Copy both Price IDs (they look like `price_1Abc...`). You'll paste them into env vars.

### 1c. Grab your API keys

https://dashboard.stripe.com/apikeys

- Publishable key → `STRIPE_PUBLISHABLE_KEY` (safe in browser)
- Secret key → `STRIPE_SECRET_KEY` (server only — never commit)

### 1d. Configure Customer Portal

https://dashboard.stripe.com/settings/billing/portal → enable cancellations, plan switching, payment method update, etc.

---

## 2. Supabase setup

1. Create a free project at https://app.supabase.com.
2. Settings → API: copy the **Project URL**, the **anon public key**, and the **service_role key**.
3. SQL Editor → New query → paste the contents of `supabase/schema.sql` → Run.
4. Authentication → Providers → Email: enable.

---

## 3. Local environment

Install Node 18+ and the Vercel CLI:

```bash
npm i -g vercel
cd /path/to/Nuri
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Where to find it |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys |
| `STRIPE_PUBLISHABLE_KEY` | same |
| `STRIPE_WEBHOOK_SECRET` | output of `stripe listen` (next step) |
| `STRIPE_PRICE_MONTHLY` | from your $9.99/mo Price |
| `STRIPE_PRICE_YEARLY` | from your $99/yr Price |
| `PLATFORM_FEE_PERCENT` | `20` (matches your monetization model) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same |
| `SUPABASE_SERVICE_ROLE_KEY` | same — **server only** |
| `APP_URL` | `http://localhost:3000` for dev |

Run locally:

```bash
vercel dev                 # serves the site at http://localhost:3000
stripe listen --forward-to localhost:3000/api/stripe/webhook
# copy the printed whsec_... into STRIPE_WEBHOOK_SECRET, restart vercel dev
```

---

## 4. Deploy to Vercel

1. Push this repo to GitHub (fork the original if you don't have push access).
2. https://vercel.com → New Project → import the repo.
3. Project Settings → Environment Variables: add every variable from `.env.local` **except** change `APP_URL` to `https://nuri-recipes.vercel.app` (or your prod URL).
4. Deploy.
5. After it's live, set up the production webhook:
   - https://dashboard.stripe.com/webhooks → **+ Add endpoint**
   - URL: `https://nuri-recipes.vercel.app/api/stripe/webhook`
   - Events:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `account.updated`
   - Copy the **Signing secret** into Vercel's `STRIPE_WEBHOOK_SECRET` env var and redeploy.

---

## 5. Wire the front-end

Inside each HTML page (`index.html`, `dietician-portal.html`, `recipe-studio.html`), add this near the top of `<head>` (or before your main app script):

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
  window.NURI_CONFIG = {
    // Inject at deploy time, or hard-code your PUBLIC values (anon key is safe in browser).
    supabaseUrl:     'https://YOUR_PROJECT.supabase.co',
    supabaseAnonKey: 'YOUR_ANON_KEY'
  };
</script>
<script src="/nuri-stripe.js"></script>
```

Then call from button handlers:

```js
// Subscribe button on a dietician profile
await Nuri.subscribe({ dieticianId: '...uuid...', interval: 'monthly' });

// "Manage billing" link
await Nuri.manageBilling();

// Dietician portal: "Connect with Stripe" button
await Nuri.startConnectOnboarding({ display_name: 'Rachel Foster, RD' });

// Show "Pending verification" vs "You're live"
const { account } = await Nuri.connectStatus();
if (!account?.charges_enabled) showFinishOnboarding();

// Gate a recipe
if (!(await Nuri.hasAccessTo(dieticianId))) showPaywall();
```

Auth uses Supabase's built-in `supabase.auth.signUp / signInWithPassword / signInWithOtp` — call them on the existing login forms and reuse the `Nuri.supabase` client.

---

## 6. Test the full flow

1. Sign up as a dietician (Supabase) → click "Connect with Stripe" → finish Express onboarding using Stripe's [test data](https://stripe.com/docs/connect/testing) (SSN `000-00-0000`, routing `110000000`, account `000123456789`).
2. Sign up as a subscriber → click "Subscribe $9.99/mo" → use test card `4242 4242 4242 4242`.
3. Confirm in Supabase: a row in `subscriptions` with `status = 'active'` and the right `dietician_id`.
4. Confirm in Stripe Dashboard → Connected accounts: a $9.99 charge with a $2.00 application fee.

---

## What's NOT done yet (next steps)

- The three existing HTML files still use the fake hardcoded login flows. They need to be wired to `Nuri.supabase.auth.*` and have real subscribe / manage / connect buttons added. (Happy to do that next — it touches a lot of the existing UI, so I wanted to lock in the backend first.)
- Tax (Stripe Tax), refunds policy, and dispute handling.
- Dietician-facing earnings dashboard (we link to Express Dashboard for now).
- Email notifications (use Supabase + Resend or Postmark).
- Production hardening: rate limiting, CSRF on webhook isn't needed (signature does that), logging/monitoring (Sentry).
