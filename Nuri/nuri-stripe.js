/* Nuri × Stripe — browser helpers
 *
 * Drop into any HTML page with:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script>
 *     window.NURI_CONFIG = {
 *       supabaseUrl: 'https://xxx.supabase.co',
 *       supabaseAnonKey: 'eyJ...'
 *     };
 *   </script>
 *   <script src="/nuri-stripe.js"></script>
 *
 * Then call window.Nuri.subscribe({ dieticianId, interval }) etc.
 */
(function () {
  const cfg = window.NURI_CONFIG || {};
  if (!window.supabase) {
    console.warn('[nuri] supabase-js not loaded — auth/subs disabled');
  }
  const sb = window.supabase && cfg.supabaseUrl && cfg.supabaseAnonKey
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : null;

  async function authHeader() {
    if (!sb) throw new Error('Supabase client not configured');
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Please sign in first');
    return { Authorization: `Bearer ${session.access_token}` };
  }

  async function postJSON(path, body) {
    const headers = { 'Content-Type': 'application/json', ...(await authHeader()) };
    const res = await fetch(path, {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return res.json();
  }
  async function getJSON(path) {
    const headers = await authHeader();
    const res = await fetch(path, { headers });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return res.json();
  }

  const Nuri = {
    supabase: sb,
    /** Subscribe the current user to a dietician. Redirects to Stripe Checkout. */
    async subscribe({ dieticianId, interval = 'monthly' }) {
      const { url } = await postJSON('/api/stripe/create-checkout-session', {
        dietician_id: dieticianId,
        interval,
      });
      window.location.href = url;
    },
    /** Open Stripe Customer Portal for managing billing. */
    async manageBilling() {
      const { url } = await postJSON('/api/stripe/create-portal-session');
      window.location.href = url;
    },
    /** Start (or continue) Stripe Connect onboarding for a dietician. */
    async startConnectOnboarding({ display_name, handle } = {}) {
      const { url } = await postJSON('/api/stripe/connect/start', {
        display_name,
        handle,
      });
      window.location.href = url;
    },
    /** Get Connect status — for showing "Finish onboarding" badges in the portal. */
    connectStatus() {
      return getJSON('/api/stripe/connect/status');
    },
    /** Get a fresh Express Dashboard login link. */
    async openExpressDashboard() {
      const { url } = await postJSON('/api/stripe/connect/dashboard-link');
      window.open(url, '_blank', 'noopener');
    },
    /** Current user's subscriptions (one per RD). */
    mySubscriptions() {
      return getJSON('/api/me/subscriptions');
    },
    /** Convenience: does the signed-in user have access to dietician X? */
    async hasAccessTo(dieticianId) {
      try {
        const { activeDieticianIds } = await this.mySubscriptions();
        return activeDieticianIds.includes(dieticianId);
      } catch {
        return false;
      }
    },
  };

  window.Nuri = Nuri;
})();
