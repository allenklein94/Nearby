// Recovered 2026-10-28 from the LIVE bundle (export-data v9, Management API function-body endpoint): the deployed,
// type-stripped JavaScript, verbatim. Not redeployed. Its SUPABASE_SERVICE_ROLE_KEY is already the project's new secret key
// at runtime (digest compared 2026-10-28), so it does not depend on the legacy JWT secret.
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
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
    const { data: profile } = await admin.from('profiles').select('*').eq('id', userId).single();
    const { data: extraPhotos } = await admin.from('profile_photos').select('photo_url, position, photo_verified, created_at').eq('user_id', userId);
    const { data: noticesSent } = await admin.from('notices').select('to_user, is_super, created_at').eq('from_user', userId);
    const { data: matches } = await admin.from('matches').select('id, user_a, user_b, matched_at, source_gathering_id').or(`user_a.eq.${userId},user_b.eq.${userId}`);
    const { data: messagesSent } = await admin.from('messages').select('match_id, body, gif_url, audio_url, read_at, created_at').eq('sender_id', userId);
    const { data: reportsFiled } = await admin.from('reports').select('reason, details, created_at, resolved').eq('reporter_id', userId);
    const { data: blocks } = await admin.from('blocks').select('blocked_id, created_at').eq('blocker_id', userId);
    const { data: gatheringsHosted } = await admin.from('gatherings').select('title, description, interest_tag, scheduled_at, created_at').eq('host_id', userId);
    const { data: gatheringInterests } = await admin.from('gathering_interest').select('gathering_id, status, created_at').eq('user_id', userId);
    const { data: dateCheckins } = await admin.from('date_checkins').select('match_id, scheduled_at, status, created_at').eq('user_id', userId);
    const { data: playlistItems } = await admin.from('shared_playlist_items').select('match_id, song_title, artist, created_at').eq('added_by', userId);
    const { data: intentionHistory } = await admin.from('intention_history').select('old_intention, new_intention, changed_at').eq('user_id', userId);
    const { data: tripIdeas } = await admin.from('trip_ideas').select('match_id, category, idea_text, created_at').eq('added_by', userId);
    const { data: sharedDecisions } = await admin.from('shared_decisions').select('match_id, category, note_text, created_at').eq('added_by', userId);
    const { data: reactionsGiven } = await admin.from('message_reactions').select('message_id, emoji, created_at').eq('user_id', userId);
    const exportPayload = {
      exported_at: new Date().toISOString(),
      profile: profile ? {
        display_name: profile.display_name,
        bio: profile.bio,
        birthdate: profile.birthdate,
        pronouns: profile.pronouns,
        gender: profile.gender,
        gender_hidden: profile.gender_hidden,
        discovery_gender: profile.discovery_gender,
        sexual_orientation: profile.sexual_orientation,
        ethnicity: profile.ethnicity,
        ethnicity_hidden: profile.ethnicity_hidden,
        ethnicity_preferences: profile.ethnicity_preferences,
        relationship_intention: profile.relationship_intention,
        interests: profile.interests,
        basics: profile.basics,
        prompts: profile.prompts,
        show_me: profile.show_me,
        preferred_min_age: profile.preferred_min_age,
        preferred_max_age: profile.preferred_max_age,
        notify_matches: profile.notify_matches,
        notify_messages: profile.notify_messages,
        notify_waves: profile.notify_waves,
        photo_verified: profile.photo_verified,
        read_receipts_enabled: profile.read_receipts_enabled,
        is_premium: profile.is_premium,
        profile_hidden: profile.profile_hidden,
        created_at: profile.created_at
      } : null,
      additional_photos: extraPhotos ?? [],
      notices_sent: noticesSent ?? [],
      matches: matches ?? [],
      messages_sent: messagesSent ?? [],
      reports_filed: reportsFiled ?? [],
      users_blocked: blocks ?? [],
      gatherings_hosted: gatheringsHosted ?? [],
      gathering_interests_expressed: gatheringInterests ?? [],
      date_safety_checkins: dateCheckins ?? [],
      shared_playlist_songs_added: playlistItems ?? [],
      relationship_intention_history: intentionHistory ?? [],
      trip_planning_ideas_added: tripIdeas ?? [],
      shared_decision_notes_added: sharedDecisions ?? [],
      message_reactions_given: reactionsGiven ?? []
    };
    return new Response(JSON.stringify(exportPayload, null, 2), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error('export-data error:', err);
    return new Response(JSON.stringify({
      error: String(err)
    }), {
      status: 500
    });
  }
});
