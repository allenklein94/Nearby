// Business website: the "Admin review" link appears only once its backend is live (20270368 + 20270369 deployed).
// Until then the admin functions don't exist and the screen would fail, so an admin is treated like any other owner:
// straight to their dashboard (the published website's behaviour). Any doubt = hidden.
export function adminReviewAvailable(isAdmin, probe) {
  if (!isAdmin || !probe) return false;
  return !probe.error;
}

// The probe: the review screen's own first read. Refused for non-admins by the server; only called for admins.
export async function probeAdminReview(supabase) {
  try {
    return await supabase.rpc('admin_list_account_review_cases', { include_closed_param: false });
  } catch (error) {
    return { error };
  }
}
