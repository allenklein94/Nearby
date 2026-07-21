import { supabase } from './supabase';

export async function getOnlineStatuses(userIds) {
  if (!userIds || userIds.length === 0) return {};

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  try {
    const response = await fetch('https://enmosvippabmuqslzrox.supabase.co/functions/v1/get-online-status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userIds }),
    });
    const result = await response.json();
    return result.statuses ?? {};
  } catch (err) {
    console.error('getOnlineStatuses error', err);
    return {};
  }
}