// GET /api/stripe/connect/status
// Auth: dietician bearer token.
// Returns the connected account state so the portal UI can show
// "Finish onboarding" vs "You're live" vs "Restricted".

import { stripe } from '../../../lib/stripe.js';
import { supabaseAdmin, getUserFromRequest } from '../../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const user = await getUserFromRequest(req);

    const { data: rd, error } = await supabaseAdmin
      .from('dieticians')
      .select('*')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!rd) return res.status(200).json({ connected: false });

    if (!rd.stripe_account_id) {
      return res.status(200).json({ connected: false, dietician: rd });
    }

    // Fetch live status from Stripe and cache key flags in Supabase.
    const account = await stripe.accounts.retrieve(rd.stripe_account_id);
    await supabaseAdmin
      .from('dieticians')
      .update({
        charges_enabled: !!account.charges_enabled,
        payouts_enabled: !!account.payouts_enabled,
        details_submitted: !!account.details_submitted,
      })
      .eq('id', rd.id);

    return res.status(200).json({
      connected: true,
      dietician: { ...rd },
      account: {
        id: account.id,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        details_submitted: account.details_submitted,
        requirements: account.requirements,
      },
    });
  } catch (err) {
    console.error('[connect/status]', err);
    return res
      .status(err.statusCode || 500)
      .json({ error: err.message || 'Unknown error' });
  }
}
