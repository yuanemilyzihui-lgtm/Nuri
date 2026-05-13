// POST /api/stripe/webhook
// Stripe → us. Signature verification is required.
// We listen for:
//   - checkout.session.completed         (subscription started)
//   - customer.subscription.created
//   - customer.subscription.updated
//   - customer.subscription.deleted
//   - account.updated                    (Connect account state changes)

import { buffer } from 'micro';
import { stripe } from '../../lib/stripe.js';
import { supabaseAdmin } from '../../lib/supabase.js';

// IMPORTANT: disable Vercel's default body parser so we can verify the raw signature.
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET not set');
    return res.status(500).end();
  }

  let event;
  try {
    const raw = await buffer(req);
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error('[webhook] signature verification failed', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotency: bail if we've already processed this event.
  const { data: existing } = await supabaseAdmin
    .from('stripe_events')
    .select('id')
    .eq('id', event.id)
    .maybeSingle();
  if (existing) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        // The subscription id is on the session for mode=subscription.
        if (s.mode === 'subscription' && s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription);
          await upsertSubscription(sub);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsertSubscription(event.data.object);
        break;
      }

      case 'account.updated': {
        const acct = event.data.object;
        await supabaseAdmin
          .from('dieticians')
          .update({
            charges_enabled: !!acct.charges_enabled,
            payouts_enabled: !!acct.payouts_enabled,
            details_submitted: !!acct.details_submitted,
          })
          .eq('stripe_account_id', acct.id);
        break;
      }

      default:
        // ignore other events
        break;
    }

    // Record the event for idempotency.
    await supabaseAdmin.from('stripe_events').insert({
      id: event.id,
      type: event.type,
      payload: event,
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[webhook] handler error', err);
    return res.status(500).json({ error: err.message });
  }
}

// ---------- helpers ----------

async function upsertSubscription(sub) {
  const dieticianId = sub.metadata?.dietician_id;
  const subscriberId = sub.metadata?.subscriber_id;
  if (!dieticianId || !subscriberId) {
    console.warn('[webhook] subscription missing metadata, skipping', sub.id);
    return;
  }

  const priceId = sub.items?.data?.[0]?.price?.id || null;

  const row = {
    subscriber_id: subscriberId,
    dietician_id: dieticianId,
    stripe_subscription_id: sub.id,
    stripe_price_id: priceId,
    status: sub.status,
    current_period_start: sub.current_period_start
      ? new Date(sub.current_period_start * 1000).toISOString()
      : null,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    canceled_at: sub.canceled_at
      ? new Date(sub.canceled_at * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from('subscriptions')
    .upsert(row, { onConflict: 'stripe_subscription_id' });
  if (error) throw error;
}
