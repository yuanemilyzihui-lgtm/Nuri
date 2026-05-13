// POST /api/stripe/connect/dashboard-link
// Auth: dietician bearer token.
// Returns a short-lived Express Dashboard login link so the RD
// can view their payouts, balance, etc.

import { stripe } from '../../../lib/stripe.js';
import { supabaseAdmin, getUserFromRequest } from '../../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const user = await getUserFromRequest(req);
    const { data: rd, error } = await supabaseAdmin
      .from('dieticians')
      .select('stripe_account_id')
      .eq('profile_id', user.id)
      .single();
    if (error) throw error;
    if (!rd?.stripe_account_id) {
      return res.status(400).json({ error: 'Stripe Connect account not yet set up' });
    }

    const link = await stripe.accounts.createLoginLink(rd.stripe_account_id);
    return res.status(200).json({ url: link.url });
  } catch (err) {
    console.error('[dashboard-link]', err);
    return res
      .status(err.statusCode || 500)
      .json({ error: err.message || 'Unknown error' });
  }
}
