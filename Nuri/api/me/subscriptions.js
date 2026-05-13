// GET /api/me/subscriptions
// Auth: subscriber bearer token.
// Returns the signed-in user's subscriptions (one row per RD they pay for).
// The front-end uses this to gate premium content client-side; the
// server-side webhook is the source of truth.

import { supabaseAdmin, getUserFromRequest } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const user = await getUserFromRequest(req);
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .select(`
        id,
        status,
        stripe_price_id,
        cancel_at_period_end,
        current_period_end,
        dietician:dieticians ( id, display_name, handle )
      `)
      .eq('subscriber_id', user.id);
    if (error) throw error;

    const active = (data || []).filter(s =>
      ['trialing', 'active'].includes(s.status)
    );

    return res.status(200).json({
      subscriptions: data || [],
      activeDieticianIds: active.map(s => s.dietician?.id).filter(Boolean),
    });
  } catch (err) {
    console.error('[me/subscriptions]', err);
    return res
      .status(err.statusCode || 500)
      .json({ error: err.message || 'Unknown error' });
  }
}
