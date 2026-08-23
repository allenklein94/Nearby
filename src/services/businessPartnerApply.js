import { supabase } from './supabase';

// "Request More Information" reviewer state -- deferred at v1, closed
// later. An admin's request_more_business_partner_info() moves a pending
// row to 'needs_info' with a real note; this is the applicant's own
// resubmit call, updating that same row (not a fresh INSERT) and flipping
// it back to 'pending' for another real review pass.
export async function requestMoreBusinessPartnerInfo(requestId, notes) {
  const { error } = await supabase.rpc('request_more_business_partner_info', {
    request_id_param: requestId,
    notes_param: notes,
  });
  if (error) throw error;
}

export async function resubmitBusinessPartnerRequest(requestId, fields) {
  const { error } = await supabase.rpc('resubmit_business_partner_request', {
    request_id_param: requestId,
    business_name_param: fields.businessName,
    business_description_param: fields.businessDescription || null,
    contact_info_param: fields.contactInfo || null,
    category_param: fields.category || null,
    website_param: fields.website || null,
    phone_param: fields.phone || null,
    address_param: fields.address || null,
    requested_features_param: fields.requestedFeatures || null,
  });
  if (error) throw error;
}

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
