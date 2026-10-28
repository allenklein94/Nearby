// Recovered 2026-10-28 from the LIVE bundle (generate-icebreaker v7, Management API function-body endpoint): the deployed,
// type-stripped JavaScript, verbatim. Not redeployed. Its SUPABASE_SERVICE_ROLE_KEY is already the project's new secret key
// at runtime (digest compared 2026-10-28), so it does not depend on the legacy JWT secret.
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CACHE_DAYS = 7;
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
    const myId = userData.user.id;
    const { matchId } = await req.json();
    if (!matchId) {
      return new Response(JSON.stringify({
        error: 'Missing matchId'
      }), {
        status: 400
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: myProfileCheck } = await admin.from('profiles').select('is_premium').eq('id', myId).single();
    if (!myProfileCheck?.is_premium) {
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
      user_id_param: myId,
      daily_limit: DAILY_AI_LIMIT
    });
    if (!withinLimit) {
      return new Response(JSON.stringify({
        error: "You've hit today's AI usage limit. This resets tomorrow."
      }), {
        status: 429
      });
    }
    const { data: match, error: matchError } = await admin.from('matches').select('user_a, user_b, icebreaker_text, icebreaker_generated_at, source_friendship_id, gatherings(title)').eq('id', matchId).single();
    if (matchError || !match) {
      return new Response(JSON.stringify({
        error: 'Match not found'
      }), {
        status: 404
      });
    }
    if (match.user_a !== myId && match.user_b !== myId) {
      return new Response(JSON.stringify({
        error: 'Not a participant in this match'
      }), {
        status: 403
      });
    }
    if (match.icebreaker_text && match.icebreaker_generated_at) {
      const ageDays = (Date.now() - new Date(match.icebreaker_generated_at).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays < CACHE_DAYS) {
        return new Response(JSON.stringify({
          icebreaker: match.icebreaker_text
        }), {
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
    }
    const otherId = match.user_a === myId ? match.user_b : match.user_a;
    const { data: myProfile } = await admin.from('profiles').select('interests, prompts, basics, favorite_tracks').eq('id', myId).single();
    const { data: otherProfile } = await admin.from('profiles').select('interests, prompts, basics, favorite_tracks').eq('id', otherId).single();
    const sharedInterests = (myProfile?.interests ?? []).filter((i)=>(otherProfile?.interests ?? []).includes(i));
    const myArtists = (myProfile?.favorite_tracks ?? []).map((t)=>t.artist).filter(Boolean);
    const theirArtists = (otherProfile?.favorite_tracks ?? []).map((t)=>t.artist).filter(Boolean);
    const sharedArtists = [
      ...new Set(myArtists.filter((a)=>theirArtists.includes(a)))
    ];
    const context = {
      sharedInterests,
      sharedArtists,
      myPrompts: myProfile?.prompts ?? [],
      theirPrompts: otherProfile?.prompts ?? [],
      gatheringTitle: match.gatherings?.title ?? null,
      // This function already correctly avoided "dating app" phrasing
      // for gathering-sourced matches, but never checked friendship-
      // sourced ones — meaning a friend connection would silently
      // fall through to explicitly romantic framing.
      isFriendship: !!match.source_friendship_id
    };
    const promptText = context.gatheringTitle ? `Write one short, warm icebreaker message (1-2 sentences) for someone to send to a person they matched with through a shared gathering called "${context.gatheringTitle}". Reference the gathering naturally if it fits. Also consider: shared interests: ${JSON.stringify(context.sharedInterests)}, shared favorite artists: ${JSON.stringify(context.sharedArtists)}, their prompt answers: ${JSON.stringify(context.theirPrompts)}. Write it as if I'm sending it, in first person, casual and genuine, not corny. Reply with ONLY the message text, nothing else.` : context.isFriendship ? `Write one short, warm icebreaker message (1-2 sentences) for someone to send to a person they just became friends with on an app — a platonic connection, not a romantic one. Base it on: shared interests: ${JSON.stringify(context.sharedInterests)}, shared favorite artists: ${JSON.stringify(context.sharedArtists)}, their prompt answers: ${JSON.stringify(context.theirPrompts)}. Write it as if I'm sending it, in first person, casual and genuine, not corny, and clearly friendly rather than flirty. If there's not much to go on, keep it simple and open-ended. Reply with ONLY the message text, nothing else.` : `Write one short, warm icebreaker message (1-2 sentences) for someone to send to a person they matched with on a dating app. Base it on: shared interests: ${JSON.stringify(context.sharedInterests)}, shared favorite artists: ${JSON.stringify(context.sharedArtists)}, their prompt answers: ${JSON.stringify(context.theirPrompts)}. Write it as if I'm sending it, in first person, casual and genuine, not corny. If there's not much to go on, keep it simple and open-ended. Reply with ONLY the message text, nothing else.`;
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
    const icebreaker = data?.content?.[0]?.text?.trim();
    if (!icebreaker) {
      console.error('generate-icebreaker: unexpected Anthropic response', JSON.stringify(data));
      return new Response(JSON.stringify({
        error: 'Could not generate an icebreaker right now.'
      }), {
        status: 500
      });
    }
    await admin.from('matches').update({
      icebreaker_text: icebreaker,
      icebreaker_generated_at: new Date().toISOString()
    }).eq('id', matchId);
    return new Response(JSON.stringify({
      icebreaker
    }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error('generate-icebreaker error:', err);
    return new Response(JSON.stringify({
      error: String(err)
    }), {
      status: 500
    });
  }
});
