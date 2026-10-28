// Recovered 2026-10-28 from the LIVE bundle (rehearsal-chat v5, Management API function-body endpoint): the deployed,
// type-stripped JavaScript, verbatim. Not redeployed. Its SUPABASE_SERVICE_ROLE_KEY is already the project's new secret key
// at runtime (digest compared 2026-10-28), so it does not depend on the legacy JWT secret.
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
// Higher than the other AI features specifically because this one
// fires once per message in a back-and-forth conversation, not once
// per generation — a single rehearsal session can easily use 10-15
// of these on its own. Still a real ceiling against runaway costs,
// just calibrated to this feature's actual usage pattern.
const DAILY_AI_LIMIT = 150;
const SCENARIO_SETUPS = {
  ask_out: 'You are playing the role of someone the user is practicing asking out for the first time. Respond naturally and realistically — sometimes warmly, sometimes a bit unsure, the way a real person might. Keep responses short, 1-3 sentences.',
  boundary: 'You are playing the role of someone the user is practicing setting a boundary with. Respond realistically — a real person might get a little defensive, or might respond well, varying naturally. Keep responses short, 1-3 sentences.',
  hard_conversation: 'You are playing the role of a partner in a difficult relationship conversation the user is practicing (like discussing a disagreement or bringing up a concern). Respond realistically and with some natural pushback or emotion, the way a real person would. Keep responses short, 1-3 sentences.',
  not_interested: 'You are playing the role of someone the user is practicing telling them they are not interested. Respond realistically — sometimes gracious, sometimes a little hurt or asking why, the way a real person might. Keep responses short, 1-3 sentences.'
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
        error: 'Rehearsal Room is a Premium feature.'
      }), {
        status: 403
      });
    }
    // A high daily cap, even for Premium — protects against runaway
    // costs from a single account without meaningfully affecting any
    // genuine user's actual usage.
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
    const { scenario, history } = await req.json();
    if (!scenario || !SCENARIO_SETUPS[scenario]) {
      return new Response(JSON.stringify({
        error: 'Invalid or missing scenario'
      }), {
        status: 400
      });
    }
    if (!Array.isArray(history) || history.length === 0) {
      return new Response(JSON.stringify({
        error: 'Missing conversation history'
      }), {
        status: 400
      });
    }
    const systemPrompt = `${SCENARIO_SETUPS[scenario]} This is explicitly a practice rehearsal, not a real conversation — the user knows this and is using it to build confidence and find words for a real conversation later. Never break character to give advice or commentary; just respond in-character.`;
    const anthropicMessages = history.slice(-10).map((m)=>({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.text
      }));
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
        system: systemPrompt,
        messages: anthropicMessages
      })
    });
    const data = await response.json();
    const reply = data?.content?.[0]?.text?.trim();
    if (!reply) {
      console.error('rehearsal-chat: unexpected Anthropic response', JSON.stringify(data));
      return new Response(JSON.stringify({
        error: 'Could not generate a response right now.'
      }), {
        status: 500
      });
    }
    return new Response(JSON.stringify({
      reply
    }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error('rehearsal-chat error:', err);
    return new Response(JSON.stringify({
      error: String(err)
    }), {
      status: 500
    });
  }
});
