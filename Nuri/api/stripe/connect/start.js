// POST /api/stripe/connect/start
// Auth: dietician (RD) bearer token.
// 1. Creates (or reuses) a Stripe Express Connect account for the RD.
// 2. Creates an Account Link and returns the onboarding URL.
//    Front-end should window.location = url.

import { stripe } from '../../../lib/stripe.js';
import { supabaseAdmin, getUserFromRequest } from '../../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getUserFromRequest(req);

    // Look up (or create) the dietician row for this user.
    let { data: rd, error } = await supabaseAdmin
      .from('dieticians')
      .select('*')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (error) throw error;

    if (!rd) {
      const { display_name, handle } = req.body || {};
      if (!display_name) {
        return res.status(400).json({ error: 'display_name required to create dietician profile' });
      }
      const insert = await supabaseAdmin
        .from('dieticians')
        .insert({ profile_id: user.id, display_name, handle })
        .select('*')
        .single();
      if (insert.error) throw insert.error;
      rd = insert.data;

      // mark profile.is_rd = true
      await supabaseAdmin.from('profiles').update({ is_rd: true }).eq('id', user.id);
    }

    // Create a Stripe Express account if we don't have one yet.
    let stripeAccountId = rd.stripe_account_id;
    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'individual',
        business_profile: {
          product_description: 'Premium nutrition recipes & content via Nuri.',
          mcc: '5814', // Eating Places, Restaurants — Stripe will adjust if needed
        },
        metadata: {
          dietician_id: rd.id,
          nuri_profile_id: user.id,
        },
      });
      stripeAccountId = account.id;
      await supabaseAdmin
        .from('dieticians')
        .update({ stripe_account_id: stripeAccountId })
        .eq('id', rd.id);
    }

    // Create an Account Link the dietician will click through.
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${appUrl}/dietician-portal?stripe=refresh`,
      return_url: `${appUrl}/dietician-portal?stripe=return`,
      type: 'account_onboarding',
    });

    return res.status(200).json({ url: accountLink.url });
  } catch (err) {
    console.error('[connect/start]', err);
    return res
      .status(err.statusCode || 500)
      .json({ error: err.message || 'Unknown error' });
  }
}
