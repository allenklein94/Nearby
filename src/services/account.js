import { supabase, functionUrl } from './supabase';

// Calls the delete-account Edge Function, which permanently removes the
// user's profile, uploaded photo, and all associated app data (cascaded
// via foreign keys), then deletes their actual login/auth record. This
// cannot be undone — the confirmation UI lives in SettingsScreen.js (with the 20270375 step-up before it).
// What deleting would do to the group plans the person organizes (20270405). Null when it can't be read (not live yet, offline): the
// warning is skipped and delete-account still refuses what it must.
export async function getDeletionPlanImpact() {
  const { data, error } = await supabase.rpc('account_deletion_plan_impact');
  return error ? null : data;
}

export async function deleteAccount() {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (!token) {
    throw new Error('No active session.');
  }

  const response = await fetch(functionUrl('delete-account'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  const result = await response.json();
  if (!response.ok || result.error) {
    throw Object.assign(new Error(result.error || 'Account deletion failed.'), { hint: result.hint });
  }

  // 20270375 D2: a deletion from a recently signed-in device may be scheduled (its sessions are already ended server-side);
  // the caller tells the person the date. Signing out locally either way.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  return { scheduled: result.scheduled === true, purgeAt: result.purge_at || null };
}