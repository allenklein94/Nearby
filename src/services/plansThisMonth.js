import { supabase } from './supabase';
import { localMonthBounds } from '../utils/plansThisMonth';

// Owner item 53: the plans that really happened this local month (get_my_plans_this_month, auth.uid() inside). Returns the
// server's rows ({ plan_key, happened_at }), or null when the read failed (Home then shows no line, never a 0).
export async function getMyPlansThisMonth(now = new Date()) {
  const { since, until } = localMonthBounds(now);
  const { data, error } = await supabase.rpc('get_my_plans_this_month', { p_since: since.toISOString(), p_until: until.toISOString() });
  if (error) {
    console.error('getMyPlansThisMonth error', error);
    return null;
  }
  return Array.isArray(data) ? data : [];
}
