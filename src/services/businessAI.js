import { supabase, functionUrl } from './supabase';

export async function askBusinessAssistant(partnerId, question) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error('Not signed in');

  const response = await fetch(functionUrl('business-ai-assistant'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ partnerId, question }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result?.error ?? 'Could not process that right now.');
  }
  return result.answer;
}
