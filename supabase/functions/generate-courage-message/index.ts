// Recovered 2026-10-28 from the LIVE bundle (generate-courage-message v4, Management API function-body endpoint): the deployed,
// type-stripped JavaScript, verbatim. Not redeployed. Its SUPABASE_SERVICE_ROLE_KEY is already the project's new secret key
// at runtime (digest compared 2026-10-28), so it does not depend on the legacy JWT secret.
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const DAILY_AI_LIMIT = 50;
const GOAL_PROMPTS = {
  ask_out: 'Help me ask someone out. Write a short, warm, low-pressure message inviting them to do something specific together.',
  set_boundary: 'Help me set a boundary clearly and kindly, without being harsh or apologetic.',
  say_interested: "Help me tell someone I'm interested in them, in a genuine, non-cheesy way.",
  say_not_interested: 'Help me kindly let someone know I\'m not interested, in a way that\'s honest but respectful.'
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
    const { data: profile } = await supabaseAuth.from('profiles').select('is_premium').eq('id', userData.user.id).single();
    if (!profile?.is_premium) {
      return new Response(JSON.stringify({
        error: 'Help Me Say It is a Premium feature.'
      }), {
        status: 403
      });
    }
    // A very high daily cap, even for Premium — protects against
    // runaway costs from a single account without meaningfully
    // affecting any genuine user's actual usage.
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
    const { goal, context } = await req.json();
    if (!goal || !GOAL_PROMPTS[goal]) {
      return new Response(JSON.stringify({
        error: 'Invalid or missing goal'
      }), {
        status: 400
      });
    }
    const contextLine = context && String(context).trim() ? ` Extra context from the person: "${String(context).trim().slice(0, 300)}"` : '';
    const promptText = `${GOAL_PROMPTS[goal]}${contextLine} Write it in first person, as if I'm sending it directly. Keep it short — 1-3 sentences. Reply with ONLY the message text, nothing else.`;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content: promptText
          }
        ]
      })
    });
    const data = await response.json();
    const message = data?.content?.[0]?.text?.trim();
    if (!message) {
      console.error('generate-courage-message: unexpected Anthropic response', JSON.stringify(data));
      return new Response(JSON.stringify({
        error: 'Could not generate a message right now.'
      }), {
        status: 500
      });
    }
    return new Response(JSON.stringify({
      message
    }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error('generate-courage-message error:', err);
    return new Response(JSON.stringify({
      error: String(err)
    }), {
      status: 500
    });
  }
});
