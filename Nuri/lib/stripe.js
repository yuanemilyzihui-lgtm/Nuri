// Shared Stripe client. Used by every /api/stripe/* route.
import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  // We don't throw at import time in production so static imports
  // don't crash unrelated routes, but we'll log loudly.
  console.warn('[stripe] STRIPE_SECRET_KEY is not set');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2024-06-20',
  appInfo: {
    name: 'nuri-recipes',
    version: '0.1.0',
  },
});

// Platform commission expressed as a percent (e.g. 20 == 20%).
// Stripe expects `application_fee_percent` as a number 0-100.
export const PLATFORM_FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT ?? 20);
