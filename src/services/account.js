import { supabase } from './supabase';

// Calls the delete-account Edge Function, which permanently removes the
// user's profile, uploaded photo, and all associated app data (cascaded
// via foreign keys), then deletes their actual login/auth record. This
// cannot be undone — the confirmation UI lives in ProfileScreen.js.
export async function deleteAccount() {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (!token) {
    throw new Error('No active session.');
  }

  const response = await fetch('https://enmosvippabmuqslzrox.supabase.co/functions/v1/delete-account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  const result = await response.json();
  if (!response.ok || result.error) {
    throw new Error(result.error || 'Account deletion failed.');
  }

  await supabase.auth.signOut();
}