// Server-side Supabase client using the SERVICE ROLE key.
// NEVER import this from browser code — the service role key
// bypasses Row Level Security.
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.warn('[supabase] missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

export const supabaseAdmin = createClient(
  url || 'http://localhost',
  serviceRoleKey || 'service-role-placeholder',
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);

/**
 * Verify a user's access token (sent from the browser in the
 * `Authorization: Bearer <token>` header) and return the user.
 * Throws on failure.
 */
export async function getUserFromRequest(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    const err = new Error('Missing Authorization bearer token');
    err.statusCode = 401;
    throw err;
  }
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    const err = new Error('Invalid or expired session');
    err.statusCode = 401;
    throw err;
  }
  return data.user;
}
