import { supabase } from './supabase';

// Reuses the existing "Users can view their own requests" SELECT policy on
// business_partner_requests — real, live in RLS, previously unused by any client.
export async function getMyBusinessPartnerRequest() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return null;

  const { data, error } = await supabase
    .from('business_partner_requests')
    .select('*')
    .eq('requester_id', myId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
