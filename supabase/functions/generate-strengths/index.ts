// Recovered 2026-10-28 from the LIVE bundle (generate-strengths v6, Management API function-body endpoint): the deployed,
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
    const userId = userData.user.id;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from('profiles').select('bio, interests, basics, prompts, is_premium, favorite_tracks').eq('id', userId).single();
    if (!profile) {
      return new Response(JSON.stringify({
        error: 'Profile not found'
      }), {
        status: 404
      });
    }
    if (!profile.is_premium) {
      return new Response(JSON.stringify({
        error: 'This is a Premium feature.'
      }), {
        status: 403
      });
    }
    // A very high daily cap, even for Premium — protects against
    // runaway costs from a single account without meaningfully
    // affecting any genuine user's actual usage.
    const { data: withinLimit } = await admin.rpc('check_and_increment_ai_use', {
      user_id_param: userId,
      daily_limit: DAILY_AI_LIMIT
    });
    if (!withinLimit) {
      return new Response(JSON.stringify({
        error: "You've hit today's AI usage limit. This resets tomorrow."
      }), {
        status: 429
      });
    }
    const profileSummary = JSON.stringify({
      bio: profile.bio,
      interests: profile.interests,
      basics: profile.basics,
      prompts: profile.prompts,
      favoriteArtists: (profile.favorite_tracks ?? []).map((t)=>t.artist).filter(Boolean)
    });
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        messages: [
          {
            role: 'user',
            content: `Based only on this dating profile data, write a warm, genuine, 2-3 sentence note about why someone would be lucky to date this person. Base it ONLY on what's actually in the data below — do not invent details. Write directly to them ("You..."), be specific rather than generic, and keep it grounded and real rather than flattering or over-the-top.\n\nProfile data: ${profileSummary}`
          }
        ]
      })
    });
    const data = await response.json();
    const summary = data?.content?.[0]?.text?.trim();
    if (!summary) {
      console.error('generate-strengths: unexpected Anthropic response', JSON.stringify(data));
      return new Response(JSON.stringify({
        error: 'Could not generate summary',
        debug: data
      }), {
        status: 500
      });
    }
    return new Response(JSON.stringify({
      summary
    }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error('generate-strengths error:', err);
    return new Response(JSON.stringify({
      error: String(err)
    }), {
      status: 500
    });
  }
});
