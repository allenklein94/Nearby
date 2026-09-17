-- Item 100 (CLAUDE.md, "Let the recipient contribute preferences without
-- spoiling the surprise"). User's own example: planning a wife's
-- anniversary, Nearby could already know her saved preferences (Italian /
-- outdoor seating / live music) without telling her anything is being
-- planned -- or, "if appropriate," the organizer could ask her directly
-- ("What kind of dinner are you in the mood for?") without exposing why.
--
-- Two real, separate halves, matching the item's own two examples:
--
-- (A) PASSIVE: a person's own standing dining preferences
-- (cuisine_preferences/venue_preferences on profiles, both real, optional,
-- self-declared fields -- same posture as profiles.interests, drawn from
-- the exact same CUISINE_OPTIONS/BUSINESS_ATTRIBUTE_OPTIONS vocabulary
-- business_requests.cuisine/attributes already use). Reading a connected
-- friend's own already-visible profile data for scoring purposes isn't a
-- new access grant -- ViewProfileScreen already reads a friend's profile
-- fields the same way, gated by the same existing "own profile OR
-- verified+not-hidden" RLS policy on profiles. Nothing about this ever
-- reaches or notifies the person being asked about.
--
-- (B) ACTIVE, "if appropriate": a real, disguised quick-question poll --
-- preference_polls. The organizer sends ONE of two fixed, neutral
-- questions (never free text, never occasion-shaped) to a real connected
-- friend/match; the recipient answers via a plain chip picker with zero
-- occasion/plan context ever surfaced to them (get_my_pending_preference_
-- polls never returns occasion_context -- that column exists purely for
-- the ASKER's own private reference, e.g. which occasion/plan prompted the
-- ask, and is only ever returned by get_my_asked_preference_polls, which
-- only the asker themselves can call). A real answered poll is fresher/
-- more specific than a standing declared preference, so the client merges
-- both into one signal (src/services/preferencePolls.js's
-- getWhoForPreferenceSignals) rather than treating them as competing
-- sources.
--
-- Both halves feed the exact same new scoring bonus
-- (whoForPreferenceBonus in intentResolverScoring.js) -- one signal, two
-- ways to fill it in, never a fabricated one: a business that doesn't
-- match either source is never excluded, just not boosted, same "real
-- signal, flat bonus, never a filter" shape every other bonus in that file
-- already uses.

-- ---- (A) profiles: real, optional, self-declared dining preferences ----

alter table public.profiles
  add column if not exists cuisine_preferences text[] not null default '{}';
alter table public.profiles
  add column if not exists venue_preferences text[] not null default '{}';

alter table public.profiles drop constraint if exists profiles_cuisine_preferences_check;
alter table public.profiles
  add constraint profiles_cuisine_preferences_check
  check (cuisine_preferences <@ array[
    'italian', 'mexican', 'japanese', 'chinese', 'american', 'french',
    'mediterranean', 'indian', 'thai', 'seafood', 'other'
  ]::text[]);

alter table public.profiles drop constraint if exists profiles_venue_preferences_check;
alter table public.profiles
  add constraint profiles_venue_preferences_check
  check (venue_preferences <@ array[
    'outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly',
    'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly',
    'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly',
    'book_lovers', 'craft_friendly', 'fitness_focused'
  ]::text[]);

-- No new RPC needed for reading/writing these -- profiles' own existing
-- "Users can update own profile" RLS policy (auth.uid() = id) already lets
-- a user edit their own row directly, exactly like profiles.interests
-- already does (ProfileScreen.js's plain `.from('profiles').update(...)`).

-- ---- (B) preference_polls ----

create table public.preference_polls (
  id uuid primary key default gen_random_uuid(),
  asker_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  question_key text not null check (question_key in ('cuisine_mood', 'venue_vibe')),
  -- Asker-only metadata (e.g. which occasion/plan prompted this) -- never
  -- returned by any target-facing read. Free text, not a FK, since the
  -- asker may not have a real occasion/plan id yet at ask time.
  occasion_context text,
  answer_keys text[],
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  check (asker_id <> target_id)
);

create index preference_polls_target_idx on public.preference_polls(target_id);
create index preference_polls_asker_idx on public.preference_polls(asker_id);

-- RLS enabled, zero client-facing policies -- every read/write goes
-- through a SECURITY DEFINER RPC below, same posture as every other
-- lifecycle table in this schema.
alter table public.preference_polls enable row level security;

create or replace function public.send_preference_poll(
  target_id_param uuid,
  question_key_param text,
  occasion_context_param text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_poll_id uuid;
  v_asker_name text;
  v_question_text text;
  service_key text;
  v_wants_notif boolean;
begin
  if target_id_param is null or target_id_param = auth.uid() then
    raise exception 'You can''t ask yourself.';
  end if;
  if question_key_param not in ('cuisine_mood', 'venue_vibe') then
    raise exception 'Invalid question.';
  end if;
  if is_blocked(auth.uid(), target_id_param) then
    raise exception 'You can''t send this to that person.';
  end if;

  -- Real connections only -- same eligibility check this schema's other
  -- friend-facing RPCs already use; standing "no stranger discovery" rule.
  if not (
    exists (
      select 1 from friendships f
      where f.status = 'accepted'
      and ((f.user_a = auth.uid() and f.user_b = target_id_param) or (f.user_a = target_id_param and f.user_b = auth.uid()))
    )
    or exists (
      select 1 from matches m
      where (m.user_a = auth.uid() and m.user_b = target_id_param) or (m.user_a = target_id_param and m.user_b = auth.uid())
    )
  ) then
    raise exception 'You can only ask a real connection.';
  end if;

  -- One pending question at a time per (asker, target) pair -- a simple,
  -- honest rate limit against accidentally spamming someone with several
  -- "quick questions" that would themselves become a tell.
  if exists (
    select 1 from preference_polls
    where asker_id = auth.uid() and target_id = target_id_param
      and answer_keys is null and expires_at > now()
  ) then
    raise exception 'You already have a question pending with them.';
  end if;

  v_question_text := case question_key_param
    when 'cuisine_mood' then 'What kind of food are you in the mood for lately?'
    when 'venue_vibe' then 'What''s your ideal night-out vibe?'
  end;

  insert into preference_polls (asker_id, target_id, question_key, occasion_context)
  values (auth.uid(), target_id_param, question_key_param, occasion_context_param)
  returning id into v_poll_id;

  select display_name into v_asker_name from profiles where id = auth.uid();
  select coalesce(notify_social, true) into v_wants_notif from profiles where id = target_id_param;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  -- Deliberately plain and unremarkable -- no occasion/plan reference of
  -- any kind, ever, in this push. This is the whole point of the feature.
  if service_key is not null and v_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', target_id_param,
        'title', '💬 Quick question',
        'body', coalesce(v_asker_name, 'Someone you know') || ' wants to know: ' || v_question_text,
        'data', jsonb_build_object('type', 'preference_poll_received', 'poll_id', v_poll_id)
      )
    );
  end if;

  return v_poll_id;
end;
$function$;

revoke all on function public.send_preference_poll(uuid, text, text) from public, anon;
grant execute on function public.send_preference_poll(uuid, text, text) to authenticated;

create or replace function public.answer_preference_poll(poll_id_param uuid, answer_keys_param text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_poll record;
  v_valid_keys text[];
begin
  select * into v_poll from preference_polls where id = poll_id_param and target_id = auth.uid();
  if v_poll is null then
    raise exception 'This question no longer exists.';
  end if;
  if v_poll.expires_at <= now() then
    raise exception 'This question has expired.';
  end if;

  v_valid_keys := case v_poll.question_key
    when 'cuisine_mood' then array['italian', 'mexican', 'japanese', 'chinese', 'american', 'french', 'mediterranean', 'indian', 'thai', 'seafood', 'other']
    when 'venue_vibe' then array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused']
  end;

  if answer_keys_param is null or array_length(answer_keys_param, 1) is null then
    raise exception 'Pick at least one answer.';
  end if;
  if not (answer_keys_param <@ v_valid_keys) then
    raise exception 'Invalid answer.';
  end if;

  update preference_polls
  set answer_keys = answer_keys_param, answered_at = now()
  where id = poll_id_param;
end;
$function$;

revoke all on function public.answer_preference_poll(uuid, text[]) from public, anon;
grant execute on function public.answer_preference_poll(uuid, text[]) to authenticated;

-- Target-facing read -- deliberately returns nothing beyond what's needed
-- to render a plain, neutral question: who asked and which fixed question
-- key (the client already has the real question text/options for each key
-- via src/constants/preferencePollQuestions.js). occasion_context is never
-- selected here at all.
create or replace function public.get_my_pending_preference_polls()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'askerDisplayName', pr.display_name,
    'questionKey', p.question_key,
    'createdAt', p.created_at
  ) order by p.created_at desc), '[]'::jsonb)
  from preference_polls p
  join profiles pr on pr.id = p.asker_id
  where p.target_id = auth.uid() and p.answer_keys is null and p.expires_at > now();
$function$;

revoke all on function public.get_my_pending_preference_polls() from public, anon;
grant execute on function public.get_my_pending_preference_polls() to authenticated;

-- Asker-facing read -- the only place occasion_context and answer_keys
-- are ever returned together, since only the asker themselves should ever
-- see both halves at once. Optionally scoped to one target, so the
-- resolver's own signal-merge (getWhoForPreferenceSignals) can ask for
-- just the one person it's scoring for.
create or replace function public.get_my_asked_preference_polls(target_id_param uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'targetId', p.target_id,
    'targetDisplayName', pr.display_name,
    'questionKey', p.question_key,
    'occasionContext', p.occasion_context,
    'answerKeys', p.answer_keys,
    'createdAt', p.created_at,
    'answeredAt', p.answered_at,
    'expiresAt', p.expires_at
  ) order by p.created_at desc), '[]'::jsonb)
  from preference_polls p
  join profiles pr on pr.id = p.target_id
  where p.asker_id = auth.uid()
    and (target_id_param is null or p.target_id = target_id_param);
$function$;

revoke all on function public.get_my_asked_preference_polls(uuid) from public, anon;
grant execute on function public.get_my_asked_preference_polls(uuid) to authenticated;
