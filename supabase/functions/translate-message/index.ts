// Recovered 2026-10-28 from the LIVE bundle (translate-message v5, Management API function-body endpoint): the deployed,
// type-stripped JavaScript, verbatim. Not redeployed. Its SUPABASE_SERVICE_ROLE_KEY is already the project's new secret key
// at runtime (digest compared 2026-10-28), so it does not depend on the legacy JWT secret.
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
// Calibrated higher than one-shot generation features, since
// translation can reasonably be called many times during a single
// active conversation — still a real ceiling against runaway costs.
const DAILY_AI_LIMIT = 150;
const LANGUAGE_NAMES = {
  en: 'English',
  es: 'Spanish',
  de: 'German',
  fr: 'French',
  pt: 'Portuguese',
  ht: 'Haitian Creole',
  zh: 'Chinese',
  vi: 'Vietnamese',
  tl: 'Tagalog',
  ru: 'Russian',
  ko: 'Korean'
};
serve(async (req)=>{
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: 'Missing auth'
      }), {
        status: 401
      });
    }
    const supabaseAuth = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({
        error: 'Invalid session'
      }), {
        status: 401
      });
    }
    // Critical: this function previously had no rate-limiting at
    // all, unlike every other AI feature — meaning any authenticated
    // user could call it unlimited times with no ceiling on cost.
    const { data: withinLimit } = await supabaseAuth.rpc('check_and_increment_ai_use', {
      user_id_param: userData.user.id,
      daily_limit: DAILY_AI_LIMIT
    });
    if (!withinLimit) {
      return new Response(JSON.stringify({
        error: "You've hit today's translation limit. This resets tomorrow."
      }), {
        status: 429
      });
    }
    const { text, targetLanguage } = await req.json();
    if (!text || !targetLanguage || !LANGUAGE_NAMES[targetLanguage]) {
      return new Response(JSON.stringify({
        error: 'Missing text or valid targetLanguage'
      }), {
        status: 400
      });
    }
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: `Translate the following message into ${LANGUAGE_NAMES[targetLanguage]}. Reply with ONLY the translation, nothing else, no preamble.\n\nMessage: "${text}"`
          }
        ]
      })
    });
    const data = await response.json();
    const translation = data?.content?.[0]?.text?.trim();
    if (!translation) {
      console.error('translate-message: unexpected Anthropic response', JSON.stringify(data));
      return new Response(JSON.stringify({
        error: 'Translation failed',
        debug: data
      }), {
        status: 500
      });
    }
    return new Response(JSON.stringify({
      translation
    }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error('translate-message error:', err);
    return new Response(JSON.stringify({
      error: String(err)
    }), {
      status: 500
    });
  }
});
