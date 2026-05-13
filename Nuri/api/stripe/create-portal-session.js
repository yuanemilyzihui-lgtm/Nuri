// POST /api/stripe/create-portal-session
// Auth: subscriber bearer token.
// Returns a Stripe Customer Portal URL — users can cancel,
// switch plans, update payment methods, see invoices.

import { stripe } from '../../lib/stripe.js';
import { supabaseAdmin, getUserFromRequest } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const user = await getUserFromRequest(req);
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();
    if (error) throw error;
    if (!profile?.stripe_customer_id) {
      return res.status(400).json({ error: 'No Stripe customer for this user yet.' });
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${appUrl}/?from=portal`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[create-portal-session]', err);
    return res
      .status(err.statusCode || 500)
      .json({ error: err.message || 'Unknown error' });
  }
}
