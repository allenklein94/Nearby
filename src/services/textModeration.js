import { supabase } from './supabase';

export async function checkTextModeration(text) {
  if (!text || !text.trim()) return { safe: true };

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) return { safe: true };

    const response = await fetch('https://enmosvippabmuqslzrox.supabase.co/functions/v1/moderate-text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text }),
    });

    const result = await response.json();
    return result;
  } catch (err) {
    console.error('checkTextModeration failed', err);
    return { safe: true };
  }
}
