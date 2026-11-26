-- User-content screening (owner approved 2026-10-31: required external-user security gate). Staged after 20270372; deploy
-- only with its own approval, together with the new `screen-user-content` edge function, and only once every device runs
-- a build that screens through that function (build 87 does not: its public writes would be refused, see below).
--
-- Before: every consumer text write is a direct table write by the signed-in client, and the only check is in the app
-- (`moderate-text`: AWS Comprehend, English only, fail-open). A direct API call publishes anything; the database checks
-- nothing. Business content is already bound server-side (20270372).
--
-- 1. Public content is screened BEFORE it publishes, enforced by the database:
--      profiles: display_name, bio, pronouns, gender, sexual_orientation, the free-text basics keys, every prompt answer
--      gatherings: title, description          communities: name, description
--      gathering_questions: question_body, answer_body                 photo_comments: comment_text
--    A BEFORE INSERT/UPDATE trigger (fires after every other BEFORE trigger: suspension, phone, rate limits refuse first)
--    needs, for every screened text the write sets or changes (trimmed, non-empty), a screening row that the edge function
--    recorded for THIS signed-in user and THIS exact text (sha256 of the trimmed text), still valid (30 minutes; a person's
--    approval of held text: 7 days). No row = refused, hint 'screening_required', nothing written. Rows are reusable within
--    their window (same text in two fields, a retried save); they bind a text to its author, not to one write: a text that
--    was screened for you is the only text you can publish.
--    Outcomes (decided here, private.ugc_outcome_for, one source):
--      publish = low risk AND every language the classifier saw is calibrated (below)
--      hold    = medium / uncertain risk, OR low risk in a language not yet calibrated, OR high risk in a language not yet
--                calibrated (an unmeasured "high" is not trusted to refuse on its own)
--      refuse  = high risk in calibrated languages; never usable for a write (hint 'content_not_allowed' if tried)
--    Hold never publishes and never touches the account: a new row (gathering, community, question, comment) is written
--    with moderation_state 'held' and is seen only by its author and admins; an edit keeps the published text and parks
--    the new text for review. A person (admin) approves = applied / made visible, or rejects = stays unpublished
--    ('removed' for a new row). A new profile (sign-up) whose name is held is refused with hint 'content_held' (a profile
--    must have a name); the approval then lets that exact name through for 7 days.
--    Exempt: the server itself (private._is_server_write: edge service client, cron, migrations) and writes inside the
--    0361 private transaction marker (the review decision applying held text). Admins are NOT exempt as authors.
-- 2. Languages: private.ugc_language_calibration lists the 11 app languages + 'und' (no language) + 'names' (display and
--    community names, judged language-neutral). Every row starts 'pending': a language counts as screened only after a
--    calibration run on the REAL classifier passes for it (scripts/trust-safety/ugc-calibration.js, owner-approved
--    activation migration). Until then even a low result in that language is held for a person (the safe fallback); a
--    language outside the table is always held. Nothing is calibrated by this migration: no live run was possible
--    (Anthropic credit), and Anthropic's published multilingual table covers general reasoning in 7 of the 11 (not ht,
--    vi, tl, ru), not moderation accuracy in any.
-- 3. Community and gathering group chat publish at once (unchanged) and are screened AFTER, by the server: an AFTER INSERT
--    trigger queues every client message (no write path skips it), a cron job hands batches to the edge function, the
--    result is recorded here: high risk = hidden from everyone but the sender, kept as evidence, queued for a person;
--    medium / uncertain = queued for a person, still visible; low = nothing. Service failure = retried with backoff, given
--    up after 48 attempts (recorded). Never an account consequence.
--    Readers that bypass the policies (SECURITY DEFINER) were inventoried (2026-10-31): the ones that hand a gathering or
--    community to someone else (an invitation and its push, a business request, a partnership request, the signed-out
--    invite-link preview) refuse or hide held content (hint 'held_not_shareable'); the rest act for the author or only on
--    rows nobody else can be part of while held.
-- 4. Not changed: private 1:1 messages and group-plan chat (report + evidence, 0355), business content (0372), photos
--    (moderate-photo), and the old `moderate-text` function (still used by private content screens).
-- No existing row changes: every new column defaults to 'visible'.

-- ---------------------------------------------------------------------------------------------------------------------
-- Tables (private: no client access)
-- ---------------------------------------------------------------------------------------------------------------------

create table private.ugc_language_calibration (
  language text primary key,
  status text not null default 'pending' check (status in ('pending', 'calibrated')),
  calibrated_at timestamptz,
  evidence text,
  check ((status = 'calibrated') = (calibrated_at is not null and evidence is not null))
);
insert into private.ugc_language_calibration (language)
values ('en'), ('es'), ('de'), ('fr'), ('pt'), ('ht'), ('zh'), ('vi'), ('tl'), ('ru'), ('ko'), ('und'), ('names');

create table private.ugc_screenings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  is_name boolean not null,
  kind text not null,
  source text not null check (source in ('classifier', 'review', 'chat')),
  risk_tier text check (risk_tier in ('low', 'medium', 'high', 'uncertain')),
  categories text[] not null default '{}' check (categories <@ array['harassment', 'hate', 'sexual_content', 'minor_safety',
    'violence_threats', 'self_harm', 'spam_scam', 'personal_information', 'illegal_goods', 'impersonation']),
  languages text[] not null default '{}',
  outcome text not null check (outcome in ('publish', 'hold', 'refuse')),
  model text,
  reasoning text,
  created_at timestamptz not null default now(),
  valid_until timestamptz not null
);
create index ugc_screenings_lookup_idx on private.ugc_screenings (user_id, text_sha256, is_name, valid_until);

create table private.ugc_held_items (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references auth.users (id) on delete set null,
  target_table text not null check (target_table in ('profiles', 'gatherings', 'communities', 'gathering_questions',
    'photo_comments', 'community_messages', 'gathering_messages')),
  target_id uuid not null,
  field text not null,
  held_value jsonb not null,
  kind text not null check (kind in ('new_row', 'edit', 'chat_hidden', 'chat_review')),
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'superseded')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  check ((status in ('approved', 'rejected')) = (decided_at is not null))
);
create index ugc_held_items_pending_idx on private.ugc_held_items (created_at) where status = 'pending';
create index ugc_held_items_target_idx on private.ugc_held_items (target_table, target_id, field);

create table private.ugc_chat_queue (
  id bigserial primary key,
  target_table text not null check (target_table in ('community_messages', 'gathering_messages')),
  message_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'done', 'gave_up')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (target_table, message_id)
);
create index ugc_chat_queue_due_idx on private.ugc_chat_queue (next_attempt_at) where status in ('pending', 'claimed');

revoke all on table private.ugc_language_calibration, private.ugc_screenings, private.ugc_held_items, private.ugc_chat_queue
  from public, anon, authenticated;
revoke all on sequence private.ugc_chat_queue_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- New columns (default 'visible': no existing row changes). Clients get SELECT only where a column allowlist exists.
-- ---------------------------------------------------------------------------------------------------------------------

alter table public.gatherings add column moderation_state text not null default 'visible'
  check (moderation_state in ('visible', 'held', 'removed'));
alter table public.communities add column moderation_state text not null default 'visible'
  check (moderation_state in ('visible', 'held', 'removed'));
alter table public.gathering_questions add column moderation_state text not null default 'visible'
  check (moderation_state in ('visible', 'held', 'removed'));
alter table public.photo_comments add column moderation_state text not null default 'visible'
  check (moderation_state in ('visible', 'held', 'removed'));
alter table public.community_messages add column moderation_state text not null default 'visible'
  check (moderation_state in ('visible', 'hidden'));
alter table public.gathering_messages add column moderation_state text not null default 'visible'
  check (moderation_state in ('visible', 'hidden'));
-- gatherings has a column allowlist (item 146): the new column is readable, never insertable/updatable by a client.
grant select (moderation_state) on public.gatherings to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------------------------------------------------

-- Trimmed the same way as the edge function (ASCII whitespace at both ends; screen-user-content normalizeText).
create function private.ugc_norm(p_text text)
returns text
language sql
immutable
as $function$
  select regexp_replace(coalesce(p_text, ''), '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g');
$function$;

create function private.ugc_text_sha(p_text text)
returns text
language sql
immutable
as $function$
  select encode(sha256(convert_to(private.ugc_norm(p_text), 'UTF8')), 'hex');
$function$;

-- What a classifier result means. ONE source for the edge function's reply and the database's binding.
create function private.ugc_outcome_for(p_risk text, p_languages text[], p_is_name boolean)
returns text
language plpgsql
stable
security definer
set search_path to 'private', 'public'
as $function$
declare
  v_langs text[] := case when p_is_name then array['names']
                         when coalesce(cardinality(p_languages), 0) = 0 then array['und'] else p_languages end;
  v_all_calibrated boolean;
begin
  select count(*) = cardinality(v_langs) into v_all_calibrated
    from private.ugc_language_calibration c
   where c.language = any (v_langs) and c.status = 'calibrated';
  if p_risk = 'low' then
    return case when v_all_calibrated then 'publish' else 'hold' end;
  elsif p_risk = 'high' then
    return case when v_all_calibrated then 'refuse' else 'hold' end;
  end if;
  return 'hold';  -- medium, uncertain, anything unknown
end;
$function$;

-- The caller's best still-valid screening of a text: 'publish' > 'hold' > 'refuse', null = never screened.
-- (The journey harness replaces only this lookup inside its rolled-back transaction; ugcModeration opts out.)
create function private.ugc_screening_lookup(p_user uuid, p_sha text, p_is_name boolean)
returns text
language sql
stable
security definer
set search_path to 'private', 'public'
as $function$
  select s.outcome
    from private.ugc_screenings s
   where s.user_id = p_user and s.text_sha256 = p_sha and s.is_name = p_is_name and s.valid_until > now()
   order by case s.outcome when 'publish' then 0 when 'hold' then 1 else 2 end, s.created_at desc
   limit 1;
$function$;

-- One text of a client write: 'none' (empty), 'publish' or 'hold'; refuses otherwise.
create function private.ugc_require(p_text text, p_is_name boolean)
returns text
language plpgsql
stable
security definer
set search_path to 'private', 'public'
as $function$
declare
  v_outcome text;
begin
  if private.ugc_norm(p_text) = '' then return 'none'; end if;
  v_outcome := private.ugc_screening_lookup(auth.uid(), private.ugc_text_sha(p_text), p_is_name);
  if v_outcome is null then
    raise exception 'This needs to go through Nearby''s content check before it can be published.'
      using errcode = '42501', hint = 'screening_required';
  elsif v_outcome = 'refuse' then
    raise exception 'This can''t be published on Nearby. Please change it and try again.'
      using errcode = '42501', hint = 'content_not_allowed';
  end if;
  return v_outcome;
end;
$function$;

-- Every string inside a jsonb value (prompt answers; the free-text basics keys).
create function private.ugc_prompt_answers(p jsonb)
returns setof text
language sql
immutable
as $function$
  select e ->> 'answer' from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) e
   where jsonb_typeof(e -> 'answer') = 'string';
$function$;

-- The free-text basics keys: BASICS_FIELDS type 'text' in src/constants/basicsFields.js (guard ugcModeration.test.js).
create function private.ugc_basics_text(p jsonb)
returns setof text
language sql
immutable
as $function$
  select p ->> k from unnest(array['height', 'living_in', 'school', 'job_title', 'languages_spoken', 'five_year_vision',
    'dream_location', 'skill_to_learn', 'holiday_traditions', 'cultural_background']) k
   where jsonb_typeof(p) = 'object' and jsonb_typeof(p -> k) = 'string';
$function$;

-- Worst outcome of a set of texts (screened as ordinary text).
create function private.ugc_require_all(p_texts text[])
returns text
language plpgsql
stable
security definer
set search_path to 'private', 'public'
as $function$
declare
  t text;
  v text := 'none';
begin
  foreach t in array coalesce(p_texts, '{}'::text[]) loop
    if private.ugc_require(t, false) = 'hold' then v := 'hold';
    elsif v = 'none' and private.ugc_norm(t) <> '' then v := 'publish';
    end if;
  end loop;
  return v;
end;
$function$;

create function private.ugc_writes_exempt()
returns boolean
language sql
stable
security definer
set search_path to 'private', 'public'
as $function$
  select private._is_server_write() or private.trusted_write_active();
$function$;

-- Held text: park it for a person. Older pending edits of the same field are superseded (only the newest can be applied).
create function private.ugc_hold(p_table text, p_id uuid, p_field text, p_value jsonb, p_kind text, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
begin
  update private.ugc_held_items set status = 'superseded'
   where target_table = p_table and target_id = p_id and field = p_field and status = 'pending' and kind = 'edit';
  insert into private.ugc_held_items (author_id, target_table, target_id, field, held_value, kind, reason)
  values (auth.uid(), p_table, p_id, p_field, p_value, p_kind, p_reason);
end;
$function$;

-- A newly published value makes any older pending edit of that field stale.
create function private.ugc_supersede(p_table text, p_id uuid, p_field text)
returns void
language sql
security definer
set search_path to 'private', 'public'
as $function$
  update private.ugc_held_items set status = 'superseded'
   where target_table = p_table and target_id = p_id and field = p_field and status = 'pending' and kind = 'edit';
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Triggers: one per table, named zzz_ so they run after every other BEFORE trigger
-- ---------------------------------------------------------------------------------------------------------------------

create function private.ugc_screen_profiles()
returns trigger
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
declare
  v_o text;
  c text;
begin
  if private.ugc_writes_exempt() then return new; end if;
  if tg_op = 'INSERT' then
    if private.ugc_require(new.display_name, true) = 'hold'
       or private.ugc_require_all(array[new.bio, new.pronouns, new.gender, new.sexual_orientation]
            || array(select private.ugc_basics_text(new.basics)) || array(select private.ugc_prompt_answers(new.prompts))) = 'hold' then
      raise exception 'We need a moment to check this before it can be shown. Please try something different for now.'
        using errcode = '42501', hint = 'content_held';
    end if;
    return new;
  end if;
  -- UPDATE: only what changes is checked; held text keeps the published value and waits for a person.
  if new.display_name is distinct from old.display_name then
    v_o := private.ugc_require(new.display_name, true);
    if v_o = 'hold' then
      perform private.ugc_hold('profiles', new.id, 'display_name', to_jsonb(new.display_name), 'edit', 'held');
      new.display_name := old.display_name;
    else
      perform private.ugc_supersede('profiles', new.id, 'display_name');
    end if;
  end if;
  foreach c in array array['bio', 'pronouns', 'gender', 'sexual_orientation'] loop
    if (to_jsonb(new) -> c) is distinct from (to_jsonb(old) -> c) then
      v_o := private.ugc_require(to_jsonb(new) ->> c, false);
      if v_o = 'hold' then
        perform private.ugc_hold('profiles', new.id, c, to_jsonb(new) -> c, 'edit', 'held');
        new := jsonb_populate_record(new, jsonb_build_object(c, to_jsonb(old) -> c));
      else
        perform private.ugc_supersede('profiles', new.id, c);
      end if;
    end if;
  end loop;
  if new.basics is distinct from old.basics then
    v_o := private.ugc_require_all(array(select private.ugc_basics_text(new.basics)
                                          except select private.ugc_basics_text(old.basics)));
    if v_o = 'hold' then
      perform private.ugc_hold('profiles', new.id, 'basics', new.basics, 'edit', 'held');
      new.basics := old.basics;
    else
      perform private.ugc_supersede('profiles', new.id, 'basics');
    end if;
  end if;
  if new.prompts is distinct from old.prompts then
    v_o := private.ugc_require_all(array(select private.ugc_prompt_answers(new.prompts)
                                          except select private.ugc_prompt_answers(old.prompts)));
    if v_o = 'hold' then
      perform private.ugc_hold('profiles', new.id, 'prompts', new.prompts, 'edit', 'held');
      new.prompts := old.prompts;
    else
      perform private.ugc_supersede('profiles', new.id, 'prompts');
    end if;
  end if;
  return new;
end;
$function$;

-- Gatherings, communities: two text fields each. A new row with any held text is written held; an edit parks held text.
create function private.ugc_screen_two_fields()
returns trigger
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
declare
  f1 text := tg_argv[0];
  f2 text := tg_argv[1];
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  c text;
  v_o text;
  v_held boolean := false;
  v_series_state text;
begin
  if private.ugc_writes_exempt() then
    -- a server-generated recurring occurrence follows its series (never publishes a held series' text)
    if tg_op = 'INSERT' and tg_table_name = 'gatherings' then
      if (v_new ->> 'recurring_series_id') is not null then
        select g.moderation_state into v_series_state from gatherings g
         where g.recurring_series_id = (v_new ->> 'recurring_series_id')::uuid order by g.scheduled_at desc limit 1;
        if v_series_state is not null and v_series_state <> 'visible' then new.moderation_state := v_series_state; end if;
      end if;
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.moderation_state := 'visible';  -- never the client's own value
    foreach c in array array[f1, f2] loop
      if private.ugc_require(v_new ->> c, tg_table_name = 'communities' and c = 'name') = 'hold' then
        perform private.ugc_hold(tg_table_name, new.id, c, v_new -> c, 'new_row', 'held');
        v_held := true;
      end if;
    end loop;
    if v_held then new.moderation_state := 'held'; end if;
    return new;
  end if;
  v_old := to_jsonb(old);
  new.moderation_state := old.moderation_state;  -- only a review decision changes it
  foreach c in array array[f1, f2] loop
    if (v_new -> c) is distinct from (v_old -> c) then
      v_o := private.ugc_require(v_new ->> c, tg_table_name = 'communities' and c = 'name');
      if v_o = 'hold' then
        perform private.ugc_hold(tg_table_name, new.id, c, v_new -> c, 'edit', 'held');
        new := jsonb_populate_record(new, jsonb_build_object(c, v_old -> c));
      else
        perform private.ugc_supersede(tg_table_name, new.id, c);
      end if;
    end if;
  end loop;
  return new;
end;
$function$;

create function private.ugc_screen_questions()
returns trigger
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
declare
  v_o text;
begin
  if private.ugc_writes_exempt() then return new; end if;
  if tg_op = 'INSERT' then
    new.moderation_state := 'visible';
    if private.ugc_require(new.question_body, false) = 'hold' then
      perform private.ugc_hold('gathering_questions', new.id, 'question_body', to_jsonb(new.question_body), 'new_row', 'held');
      new.moderation_state := 'held';
    end if;
    if private.ugc_norm(new.answer_body) <> '' then
      raise exception 'Only the host can answer a question.' using errcode = '42501';
    end if;
    return new;
  end if;
  new.moderation_state := old.moderation_state;
  if new.question_body is distinct from old.question_body then
    raise exception 'A question can''t be changed after it''s asked.' using errcode = '42501';
  end if;
  if new.answer_body is distinct from old.answer_body then
    v_o := private.ugc_require(new.answer_body, false);
    if v_o = 'hold' then
      perform private.ugc_hold('gathering_questions', new.id, 'answer_body', to_jsonb(new.answer_body), 'edit', 'held');
      new.answer_body := old.answer_body;
      new.answered_at := old.answered_at;
    else
      perform private.ugc_supersede('gathering_questions', new.id, 'answer_body');
    end if;
  end if;
  return new;
end;
$function$;

create function private.ugc_screen_photo_comments()
returns trigger
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
begin
  if private.ugc_writes_exempt() then return new; end if;
  if tg_op = 'INSERT' then
    new.moderation_state := 'visible';
    if private.ugc_require(new.comment_text, false) = 'hold' then
      perform private.ugc_hold('photo_comments', new.id, 'comment_text', to_jsonb(new.comment_text), 'new_row', 'held');
      new.moderation_state := 'held';
    end if;
    return new;
  end if;
  new.moderation_state := old.moderation_state;
  if new.comment_text is distinct from old.comment_text then
    raise exception 'A comment can''t be changed after it''s posted.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

create trigger zzz_screen_user_content before insert or update on public.profiles
  for each row execute function private.ugc_screen_profiles();
create trigger zzz_screen_user_content before insert or update on public.gatherings
  for each row execute function private.ugc_screen_two_fields('title', 'description');
create trigger zzz_screen_user_content before insert or update on public.communities
  for each row execute function private.ugc_screen_two_fields('name', 'description');
create trigger zzz_screen_user_content before insert or update on public.gathering_questions
  for each row execute function private.ugc_screen_questions();
create trigger zzz_screen_user_content before insert or update on public.photo_comments
  for each row execute function private.ugc_screen_photo_comments();

-- ---------------------------------------------------------------------------------------------------------------------
-- Held rows are seen only by their author (admins read held text through admin_list_held_user_content)
-- ---------------------------------------------------------------------------------------------------------------------

-- gatherings: the ONE visibility rule (item 147) also covers every definer by-id read. Only the host sees a held one.
CREATE OR REPLACE FUNCTION public._gathering_row_visible(g_id uuid, g_host_id uuid, g_visibility text, g_women_only boolean, g_community_id uuid, g_hosting_partner_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_partner uuid;
begin
  if v_uid is null or g_id is null then return false; end if;
  if g_host_id = v_uid then return true; end if;
  -- 20270373: a held or removed gathering is seen by nobody but its host (admins review its text in the held queue)
  if exists (select 1 from gatherings where id = g_id and moderation_state <> 'visible') then return false; end if;
  -- already part of it (any request state) or personally invited
  if exists (select 1 from gathering_interest where gathering_id = g_id and user_id = v_uid) then return true; end if;
  if exists (select 1 from social_invites where invite_type = 'gathering' and target_id = g_id and invitee_id = v_uid
             and status in ('pending', 'accepted')) then return true; end if;
  -- the business that partners on it, or was asked to
  select managed_partner_id into v_partner from profiles where id = v_uid;
  if v_partner is not null and (
       v_partner = g_hosting_partner_id
       or exists (select 1 from business_partnership_requests r where r.target_type = 'gathering' and r.target_id = g_id
                  and r.partner_id = v_partner and r.status in ('pending', 'approved'))) then
    return true;
  end if;
  -- a suspended host's gatherings stay visible only to the people already in them (above), never to anyone new
  if private.account_suspended(g_host_id) then return false; end if;
  if public.viewer_blocked_either_way(g_host_id) then return false; end if;
  if coalesce(g_women_only, false)
     and lower(coalesce((select gender from profiles where id = v_uid), '')) not in ('female', 'woman') then return false; end if;
  return case g_visibility
    when 'everyone' then true
    when 'friends' then public.viewer_is_friend_of(g_host_id)
    when 'community' then g_community_id is not null
      and exists (select 1 from community_members where community_id = g_community_id and user_id = v_uid)
    else false
  end;
end;
$function$;

create policy "Held communities only to their creator" on public.communities as restrictive for select to public
  using (moderation_state = 'visible' or creator_id = auth.uid());
create policy "Held questions only to their asker" on public.gathering_questions as restrictive for select to public
  using (moderation_state = 'visible' or asker_id = auth.uid());
create policy "Held comments only to their author" on public.photo_comments as restrictive for select to public
  using (moderation_state = 'visible' or commenter_id = auth.uid());
create policy "Hidden community chat only to its sender" on public.community_messages as restrictive for select to public
  using (moderation_state = 'visible' or sender_id = auth.uid());
create policy "Hidden gathering chat only to its sender" on public.gathering_messages as restrictive for select to public
  using (moderation_state = 'visible' or sender_id = auth.uid());

-- The "this matches you" event (and its push) only for a gathering people can see; a later approval sends it then.
CREATE OR REPLACE FUNCTION public.emit_gathering_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.moderation_state <> 'visible' then return new; end if;  -- 20270373: held = announced on approval, if still upcoming
  perform public._emit_event('GATHERING_CREATED', 'gathering', new.id, new.host_id, 'gathering_insert',
    jsonb_build_object('gathering_id', new.id), 'GATHERING_CREATED:' || new.id);
  return new;
end;
$function$;

-- Readers that bypass the policies above (SECURITY DEFINER) and hand a gathering or community to SOMEONE ELSE: an invitation
-- (its push carries the title: _on_invitation_sent), a business request (a directed one shows the title to that business
-- in its Opportunities) and a partnership request. While its text is held nothing may point anyone at it, by any
-- path (both invite functions, a direct insert, every business-request function): refused, hint 'held_not_shareable'. Server
-- writes included (none should ever target held content). After approval it works again. (A visible gathering never
-- becomes held: an edit parks its new text, so the title these readers show is always published text.)
create function private.ugc_refuse_while_held()
returns trigger
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
declare
  v_gathering uuid;
  v_community uuid;
begin
  if tg_table_name = 'social_invites' then
    if new.invite_type = 'gathering' then v_gathering := new.target_id;
    elsif new.invite_type = 'community' then v_community := new.target_id; end if;
  elsif tg_table_name = 'business_partnership_requests' then
    if new.target_type = 'gathering' then v_gathering := new.target_id;
    elsif new.target_type = 'community' then v_community := new.target_id; end if;
  else
    v_gathering := new.gathering_id;
    v_community := new.community_id;
  end if;
  if (v_gathering is not null and exists (select 1 from public.gatherings where id = v_gathering and moderation_state <> 'visible'))
     or (v_community is not null and exists (select 1 from public.communities where id = v_community and moderation_state <> 'visible')) then
    raise exception 'Only you can see this until Nearby checks it. You can invite people or ask businesses once it''s approved.'
      using errcode = '42501', hint = 'held_not_shareable';
  end if;
  return new;
end;
$function$;

create trigger zzz_ugc_target_visible before insert on public.social_invites
  for each row execute function private.ugc_refuse_while_held();
create trigger zzz_ugc_target_visible before insert on public.business_requests
  for each row execute function private.ugc_refuse_while_held();
create trigger zzz_ugc_target_visible before insert on public.business_partnership_requests
  for each row execute function private.ugc_refuse_while_held();

-- The signed-out invite-link preview shows a gathering's title by id: never a held or removed one.
CREATE OR REPLACE FUNCTION public.get_public_gathering_invite_preview(gathering_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'id', g.id,
    'title', g.title,
    'interest_tag', g.interest_tag,
    'scheduled_at', g.scheduled_at,
    'host_display_name', p.display_name,
    'attendee_count', (
      select count(*) from public.gathering_interest gi
      where gi.gathering_id = g.id and gi.status = 'approved'
    )
  )
  into v_result
  from public.gatherings g
  join public.profiles p on p.id = g.host_id
  where g.id = gathering_id_param
    and g.moderation_state = 'visible';  -- 20270373

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Edge function entry points (service role only)
-- ---------------------------------------------------------------------------------------------------------------------

-- Records one classifier result for a user's text and returns what it means. The edge function never decides the outcome.
create function public.record_ugc_screening(p_user uuid, p_text_sha256 text, p_kind text, p_is_name boolean, p_risk text,
  p_categories text[], p_languages text[], p_reasoning text, p_model text)
returns jsonb
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
declare
  v_outcome text := private.ugc_outcome_for(p_risk, p_languages, p_is_name);
  v_id uuid;
begin
  insert into private.ugc_screenings (user_id, text_sha256, is_name, kind, source, risk_tier, categories, languages, outcome,
    model, reasoning, valid_until)
  values (p_user, p_text_sha256, p_is_name, left(coalesce(p_kind, 'text'), 40), 'classifier', p_risk,
    coalesce(p_categories, '{}'), coalesce(p_languages, '{}'), v_outcome, left(p_model, 80), left(p_reasoning, 600),
    now() + interval '30 minutes')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'outcome', v_outcome);
end;
$function$;

-- A still-valid earlier result for the same text (a retried save never calls the classifier again).
create function public.find_ugc_screening(p_user uuid, p_text_sha256 text, p_is_name boolean)
returns text
language sql
stable
security definer
set search_path to 'private', 'public'
as $function$
  select private.ugc_screening_lookup(p_user, p_text_sha256, p_is_name);
$function$;

-- Group chat: claim a batch (a claim older than 5 minutes is taken again).
create function public.claim_ugc_chat_batch(p_limit integer default 20)
returns table (queue_id bigint, target_table text, message_id uuid, sender_id uuid, body text)
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
begin
  return query
  with due as (
    select q.id from private.ugc_chat_queue q
     where (q.status = 'pending' and q.next_attempt_at <= now())
        or (q.status = 'claimed' and q.claimed_at < now() - interval '5 minutes')
     order by q.next_attempt_at
     limit greatest(1, least(coalesce(p_limit, 20), 50))
     for update skip locked
  ), claimed as (
    update private.ugc_chat_queue q set status = 'claimed', claimed_at = now()
      from due where q.id = due.id
    returning q.id, q.target_table, q.message_id
  )
  select c.id, c.target_table, c.message_id, m.sender_id, m.body
    from claimed c
    join lateral (
      select cm.sender_id, cm.body from community_messages cm where c.target_table = 'community_messages' and cm.id = c.message_id
      union all
      select gm.sender_id, gm.body from gathering_messages gm where c.target_table = 'gathering_messages' and gm.id = c.message_id
    ) m on true;
  -- a queued message that no longer exists (deleted) has nothing to screen
  update private.ugc_chat_queue q set status = 'done', last_error = 'message no longer exists'
   where q.status = 'claimed' and q.claimed_at > now() - interval '1 minute'
     and not exists (select 1 from community_messages where q.target_table = 'community_messages' and id = q.message_id)
     and not exists (select 1 from gathering_messages where q.target_table = 'gathering_messages' and id = q.message_id);
end;
$function$;

create function public.record_ugc_chat_screening(p_queue_id bigint, p_risk text, p_categories text[], p_languages text[],
  p_reasoning text, p_model text)
returns text
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
declare
  q record;
  v_sender uuid;
  v_body text;
  v_result text := 'none';
begin
  select * into q from private.ugc_chat_queue where id = p_queue_id and status = 'claimed' for update;
  if not found then return 'not_claimed'; end if;
  if q.target_table = 'community_messages' then
    select sender_id, body into v_sender, v_body from community_messages where id = q.message_id;
  else
    select sender_id, body into v_sender, v_body from gathering_messages where id = q.message_id;
  end if;
  if v_sender is not null then
    insert into private.ugc_screenings (user_id, text_sha256, is_name, kind, source, risk_tier, categories, languages, outcome,
      model, reasoning, valid_until)
    values (v_sender, private.ugc_text_sha(v_body), false, 'group_chat', 'chat', p_risk, coalesce(p_categories, '{}'),
      coalesce(p_languages, '{}'), private.ugc_outcome_for(p_risk, p_languages, false), left(p_model, 80),
      left(p_reasoning, 600), now());  -- a record only: never usable for a public write
    if p_risk = 'high' then
      execute format('update public.%I set moderation_state = ''hidden'' where id = $1', q.target_table) using q.message_id;
      insert into private.ugc_held_items (author_id, target_table, target_id, field, held_value, kind, reason)
      values (v_sender, q.target_table, q.message_id, 'body', to_jsonb(v_body), 'chat_hidden', 'high:' || array_to_string(coalesce(p_categories, '{}'), ','));
      v_result := 'hidden';
    elsif p_risk in ('medium', 'uncertain') then
      insert into private.ugc_held_items (author_id, target_table, target_id, field, held_value, kind, reason)
      values (v_sender, q.target_table, q.message_id, 'body', to_jsonb(v_body), 'chat_review', p_risk || ':' || array_to_string(coalesce(p_categories, '{}'), ','));
      v_result := 'review';
    end if;
  end if;
  update private.ugc_chat_queue set status = 'done', last_error = null where id = p_queue_id;
  return v_result;
end;
$function$;

create function public.fail_ugc_chat_screening(p_queue_id bigint, p_error text)
returns void
language sql
security definer
set search_path to 'private', 'public'
as $function$
  update private.ugc_chat_queue
     set attempts = attempts + 1,
         status = case when attempts + 1 >= 48 then 'gave_up' else 'pending' end,
         next_attempt_at = now() + make_interval(mins => least(5 * (attempts + 1), 60)),
         last_error = left(p_error, 300)
   where id = p_queue_id and status = 'claimed';
$function$;

create function private.ugc_enqueue_chat()
returns trigger
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
begin
  if private._is_server_write() or new.body is null or btrim(new.body) = '' then return new; end if;
  insert into private.ugc_chat_queue (target_table, message_id) values (tg_table_name, new.id)
    on conflict (target_table, message_id) do update set status = 'pending', next_attempt_at = now(), attempts = 0;
  return new;
end;
$function$;

-- The client can't change a chat message's moderation state.
create function private.ugc_chat_state_guard()
returns trigger
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
begin
  if not private.ugc_writes_exempt() then
    new.moderation_state := case when tg_op = 'INSERT' then 'visible' else old.moderation_state end;
  end if;
  return new;
end;
$function$;

create trigger zzz_screen_chat_state before insert or update on public.community_messages
  for each row execute function private.ugc_chat_state_guard();
create trigger zzz_screen_chat_state before insert or update on public.gathering_messages
  for each row execute function private.ugc_chat_state_guard();
create trigger zzz_screen_chat_after_insert after insert or update of body on public.community_messages
  for each row execute function private.ugc_enqueue_chat();
create trigger zzz_screen_chat_after_insert after insert or update of body on public.gathering_messages
  for each row execute function private.ugc_enqueue_chat();

-- Cron: hand a batch to the edge function only when something is due.
create function private.ugc_chat_kick()
returns text
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
declare
  v_key text;
begin
  if not exists (select 1 from private.ugc_chat_queue
                  where (status = 'pending' and next_attempt_at <= now())
                     or (status = 'claimed' and claimed_at < now() - interval '5 minutes')) then
    return 'idle';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then return 'no_key'; end if;
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/screen-user-content',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('mode', 'chat_batch'));
  return 'kicked';
end;
$function$;

select cron.schedule('screen-group-chat', '* * * * *', 'select private.ugc_chat_kick()');

-- ---------------------------------------------------------------------------------------------------------------------
-- The person's own held items; the review decision (admins)
-- ---------------------------------------------------------------------------------------------------------------------

create function public.get_my_held_content()
returns table (item_id uuid, target_table text, target_id uuid, field text, kind text, created_at timestamptz)
language sql
stable
security definer
set search_path to 'private', 'public'
as $function$
  -- kind: 'new_row' = the row itself is hidden from others until approved; 'edit' = the row stays visible with its
  -- published text and only this change waits
  select h.id, h.target_table, h.target_id, h.field, h.kind, h.created_at
    from private.ugc_held_items h
   where h.author_id = auth.uid() and h.status = 'pending' and h.kind in ('new_row', 'edit')
   order by h.created_at desc;
$function$;

create function public.admin_list_held_user_content()
returns table (item_id uuid, author_id uuid, author_name text, target_table text, target_id uuid, field text,
  held_value jsonb, kind text, reason text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'private', 'public'
as $function$
begin
  if not public.check_is_admin(auth.uid()) then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  return query
  select h.id, h.author_id, p.display_name, h.target_table, h.target_id, h.field, h.held_value, h.kind, h.reason, h.created_at
    from private.ugc_held_items h left join profiles p on p.id = h.author_id
   where h.status = 'pending'
   order by h.created_at;
end;
$function$;

-- The texts inside a held value (a jsonb value holds several), each approved for its author for 7 days.
create function private.ugc_record_approval(p_author uuid, p_table text, p_field text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
declare
  t text;
begin
  if p_author is null then return; end if;
  for t in
    select x from private.ugc_basics_text(p_value) x where p_field = 'basics'
    union all select x from private.ugc_prompt_answers(p_value) x where p_field = 'prompts'
    union all select p_value #>> '{}' where jsonb_typeof(p_value) = 'string'
  loop
    continue when private.ugc_norm(t) = '';
    insert into private.ugc_screenings (user_id, text_sha256, is_name, kind, source, outcome, valid_until)
    values (p_author, private.ugc_text_sha(t), (p_table = 'profiles' and p_field = 'display_name')
                                               or (p_table = 'communities' and p_field = 'name'),
            p_table || '.' || p_field, 'review', 'publish', now() + interval '7 days');
  end loop;
end;
$function$;

create function public.admin_decide_held_user_content(p_item_id uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
declare
  h record;
  v_mine boolean;
  v_state text;
begin
  if not public.check_is_admin(auth.uid()) then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  if p_approve is null then raise exception 'Choose approve or reject.' using errcode = '22023'; end if;
  -- Lock order = the author's own edit (its row first, then the held item, in the trigger): lock the content row first,
  -- then the item, so a decision racing an edit waits instead of deadlocking.
  select target_table into v_state from private.ugc_held_items where id = p_item_id;
  if not found then raise exception 'That item doesn''t exist.' using errcode = 'P0002'; end if;
  execute format('select 1 from public.%I where id = $1 for update',
    (select target_table from private.ugc_held_items where id = p_item_id))
    using (select target_id from private.ugc_held_items where id = p_item_id);
  select * into h from private.ugc_held_items where id = p_item_id for update;
  if h.status <> 'pending' then
    raise exception 'That item was already decided.' using errcode = 'P0001', hint = 'already_decided';
  end if;
  if h.author_id = auth.uid() then
    raise exception 'You can''t review your own content.' using errcode = '42501', hint = 'own_content';
  end if;
  update private.ugc_held_items set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_at = now(), decision_note = left(p_note, 500)
   where id = h.id;

  v_mine := private.mark_trusted_write();
  begin
    if h.kind = 'edit' and p_approve then
      if h.target_table = 'profiles' and h.field in ('basics', 'prompts') then
        execute format('update public.profiles set %I = $1 where id = $2', h.field) using h.held_value, h.target_id;
      elsif h.target_table = 'gathering_questions' then
        update public.gathering_questions set answer_body = h.held_value #>> '{}', answered_at = now() where id = h.target_id;
      elsif (h.target_table, h.field) in (('profiles', 'display_name'), ('profiles', 'bio'), ('profiles', 'pronouns'),
              ('profiles', 'gender'), ('profiles', 'sexual_orientation'), ('gatherings', 'title'),
              ('gatherings', 'description'), ('communities', 'name'), ('communities', 'description')) then
        execute format('update public.%I set %I = $1 where id = $2', h.target_table, h.field)
          using h.held_value #>> '{}', h.target_id;
      end if;
      perform private.ugc_record_approval(h.author_id, h.target_table, h.field, h.held_value);
    elsif h.kind = 'new_row' then
      if not p_approve then
        execute format('update public.%I set moderation_state = ''removed'' where id = $1', h.target_table) using h.target_id;
      else
        perform private.ugc_record_approval(h.author_id, h.target_table, h.field, h.held_value);
        -- visible once nothing else of that row is pending or rejected
        if not exists (select 1 from private.ugc_held_items o where o.target_table = h.target_table and o.target_id = h.target_id
                        and o.kind = 'new_row' and o.status in ('pending', 'rejected')) then
          execute format('update public.%I set moderation_state = ''visible'' where id = $1 and moderation_state = ''held''',
            h.target_table) using h.target_id;
          if h.target_table = 'gatherings' then
            -- a later occurrence of the same series made while it was held follows it
            update public.gatherings g set moderation_state = 'visible'
             where g.moderation_state = 'held' and g.recurring_series_id is not null
               and g.recurring_series_id = (select recurring_series_id from public.gatherings where id = h.target_id)
               and not exists (select 1 from private.ugc_held_items o where o.target_table = 'gatherings'
                                and o.target_id = g.id and o.status in ('pending', 'rejected'));
            perform public._emit_event('GATHERING_CREATED', 'gathering', g.id, g.host_id, 'gathering_approved',
                jsonb_build_object('gathering_id', g.id), 'GATHERING_CREATED:' || g.id)
               from public.gatherings g
              where g.id = h.target_id and g.moderation_state = 'visible' and g.scheduled_at > now();
          end if;
        end if;
      end if;
    elsif h.kind = 'chat_hidden' and p_approve then
      execute format('update public.%I set moderation_state = ''visible'' where id = $1', h.target_table) using h.target_id;
    elsif h.kind = 'chat_review' and not p_approve then
      execute format('update public.%I set moderation_state = ''hidden'' where id = $1', h.target_table) using h.target_id;
    end if;
  exception when others then
    if v_mine then perform private.unmark_trusted_write(); end if;
    raise;
  end;
  if v_mine then perform private.unmark_trusted_write(); end if;
  return case when p_approve then 'approved' else 'rejected' end;
end;
$function$;

-- Retention: screening records 30 days (a review approval to its own expiry); decided items' text 12 months; queue 7 days.
create function private.purge_ugc_moderation()
returns void
language sql
security definer
set search_path to 'private', 'public'
as $function$
  delete from private.ugc_screenings where valid_until < now() - interval '30 days';
  delete from private.ugc_held_items where status in ('approved', 'rejected', 'superseded')
     and coalesce(decided_at, created_at) < now() - interval '12 months';
  delete from private.ugc_chat_queue where status in ('done', 'gave_up') and created_at < now() - interval '7 days';
$function$;

select cron.schedule('purge-ugc-moderation', '23 4 * * *', 'select private.purge_ugc_moderation()');

-- ---------------------------------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------------------------------

revoke all on function private.ugc_norm(text), private.ugc_text_sha(text), private.ugc_outcome_for(text, text[], boolean),
  private.ugc_screening_lookup(uuid, text, boolean), private.ugc_require(text, boolean), private.ugc_prompt_answers(jsonb),
  private.ugc_basics_text(jsonb), private.ugc_require_all(text[]), private.ugc_writes_exempt(),
  private.ugc_hold(text, uuid, text, jsonb, text, text), private.ugc_supersede(text, uuid, text),
  private.ugc_screen_profiles(), private.ugc_screen_two_fields(), private.ugc_screen_questions(),
  private.ugc_screen_photo_comments(), private.ugc_enqueue_chat(), private.ugc_chat_state_guard(), private.ugc_chat_kick(),
  private.ugc_record_approval(uuid, text, text, jsonb), private.purge_ugc_moderation(), private.ugc_refuse_while_held()
  from public, anon, authenticated;

revoke all on function public.record_ugc_screening(uuid, text, text, boolean, text, text[], text[], text, text),
  public.find_ugc_screening(uuid, text, boolean), public.claim_ugc_chat_batch(integer),
  public.record_ugc_chat_screening(bigint, text, text[], text[], text, text), public.fail_ugc_chat_screening(bigint, text)
  from public, anon, authenticated;
grant execute on function public.record_ugc_screening(uuid, text, text, boolean, text, text[], text[], text, text),
  public.find_ugc_screening(uuid, text, boolean), public.claim_ugc_chat_batch(integer),
  public.record_ugc_chat_screening(bigint, text, text[], text[], text, text), public.fail_ugc_chat_screening(bigint, text)
  to service_role;

revoke all on function public.get_my_held_content(), public.admin_list_held_user_content(),
  public.admin_decide_held_user_content(uuid, boolean, text) from public, anon;
grant execute on function public.get_my_held_content(), public.admin_list_held_user_content(),
  public.admin_decide_held_user_content(uuid, boolean, text) to authenticated;
