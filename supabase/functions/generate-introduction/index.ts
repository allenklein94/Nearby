// Recovered 2026-10-28 from the LIVE bundle (generate-introduction v3, Management API function-body endpoint): the deployed,
// type-stripped JavaScript, verbatim. Not redeployed. Its SUPABASE_SERVICE_ROLE_KEY is already the project's new secret key
// at runtime (digest compared 2026-10-28), so it does not depend on the legacy JWT secret.
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const DAILY_AI_LIMIT = 50;
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
    // all, the same gap found in translate-message — meaning any
    // authenticated user could call it unlimited times with no
    // ceiling on cost.
    const { data: withinLimit } = await supabaseAuth.rpc('check_and_increment_ai_use', {
      user_id_param: userData.user.id,
      daily_limit: DAILY_AI_LIMIT
    });
    if (!withinLimit) {
      return new Response(JSON.stringify({
        error: "You've hit today's AI usage limit. This resets tomorrow."
      }), {
        status: 429
      });
    }
    const { sharedInterests, matchingFields, theirName } = await req.json();
    if (!theirName) {
      return new Response(JSON.stringify({
        error: 'Missing theirName'
      }), {
        status: 400
      });
    }
    if ((!sharedInterests || sharedInterests.length === 0) && (!matchingFields || matchingFields.length === 0)) {
      return new Response(JSON.stringify({
        introduction: null
      }), {
        headers: {
          'Content-Type': 'application/json'
        }
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
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: `Write a brief, warm 2-sentence introduction explaining why these two people might connect, based ONLY on this data — like a thoughtful friend making an introduction, not a dating algorithm. Do not invent anything beyond what's listed.\n\nShared interests: ${JSON.stringify(sharedInterests ?? [])}\nMatching profile fields: ${JSON.stringify(matchingFields ?? [])}\nThe other person's name: ${theirName}`
          }
        ]
      })
    });
    const data = await response.json();
    const introduction = data?.content?.[0]?.text?.trim();
    if (!introduction) {
      return new Response(JSON.stringify({
        error: 'Could not generate introduction'
      }), {
        status: 500
      });
    }
    return new Response(JSON.stringify({
      introduction
    }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error('generate-introduction error:', err);
    return new Response(JSON.stringify({
      error: String(err)
    }), {
      status: 500
    });
  }
});
