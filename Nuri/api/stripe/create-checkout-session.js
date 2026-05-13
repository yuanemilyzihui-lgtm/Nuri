// POST /api/stripe/create-checkout-session
// Body: { dietician_id, interval: 'monthly' | 'yearly' }
// Auth: subscriber bearer token (user must be signed in).
//
// Creates a Stripe Checkout session that:
//   - subscribes the user to a recurring price
//   - routes 80% to the dietician's connected account
//   - keeps 20% on the platform (application_fee_percent)
//
// Returns: { url } so the front-end can window.location = url.

import { stripe, PLATFORM_FEE_PERCENT } from '../../lib/stripe.js';
import { supabaseAdmin, getUserFromRequest } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const user = await getUserFromRequest(req);
    const { dietician_id, interval } = req.body || {};
    if (!dietician_id || !interval) {
      return res.status(400).json({ error: 'dietician_id and interval are required' });
    }

    const priceId =
      interval === 'yearly'
        ? process.env.STRIPE_PRICE_YEARLY
        : process.env.STRIPE_PRICE_MONTHLY;
    if (!priceId) {
      return res.status(500).json({ error: `STRIPE_PRICE_${interval.toUpperCase()} not configured` });
    }

    // Load the dietician + verify they can accept charges.
    const { data: rd, error: rdErr } = await supabaseAdmin
      .from('dieticians')
      .select('id, display_name, stripe_account_id, charges_enabled')
      .eq('id', dietician_id)
      .single();
    if (rdErr) throw rdErr;
    if (!rd?.stripe_account_id || !rd.charges_enabled) {
      return res
        .status(400)
        .json({ error: 'This dietician is not currently accepting subscriptions.' });
    }

    // Ensure the subscriber has a Stripe Customer record (on platform).
    const { data: profile, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, stripe_customer_id')
      .eq('id', user.id)
      .single();
    if (pErr) throw pErr;

    let customerId = profile.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email || user.email,
        name: profile.full_name || undefined,
        metadata: { nuri_profile_id: user.id },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    // Destination charges: keep the subscription on the platform account
    // but transfer funds (less the application fee) to the connected RD.
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/?subscribed=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/?subscribed=0`,
      allow_promotion_codes: true,
      subscription_data: {
        application_fee_percent: PLATFORM_FEE_PERCENT,
        transfer_data: { destination: rd.stripe_account_id },
        metadata: {
          dietician_id: rd.id,
          subscriber_id: user.id,
        },
      },
      metadata: {
        dietician_id: rd.id,
        subscriber_id: user.id,
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[create-checkout-session]', err);
    return res
      .status(err.statusCode || 500)
      .json({ error: err.message || 'Unknown error' });
  }
}
