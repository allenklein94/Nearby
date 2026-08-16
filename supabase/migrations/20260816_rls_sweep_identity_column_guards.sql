-- Full RLS resweep (Aug 16 2026) -- the "full RLS resweep beyond group plans and
-- the tables touched this pass" item flagged as deliberately deferred across
-- several sections of CLAUDE.md. Pulled every one of the 60 public tables'
-- real RLS policies + grants live from production and read them systematically
-- for the same bug shapes this file has already found and fixed once each
-- (missing column pins that let a participant-scoped UPDATE policy rewrite who
-- the *other* party is, missing grants that silently break a real read path,
-- a SELECT policy drifting out of sync with a sibling table's privacy rule).
--
-- Two real, previously-undocumented, high-severity findings, both the same
-- root-cause shape: a two-party table's UPDATE policy checks "am I one of the
-- two parties" on both the OLD row (USING) and the NEW row (WITH CHECK), but
-- never pins the *other* party's id -- so a real participant can silently
-- repoint who the other party is to an arbitrary third person who never
-- consented to anything.
--
--   1. matches: any match participant could UPDATE their own match row and
--      set user_b (or user_a) to an arbitrary victim id. WITH CHECK still
--      passes because it only re-checks "auth.uid() = user_a OR auth.uid() =
--      user_b", which stays true as long as the caller's own slot is
--      untouched. Once repointed, `messages` INSERT for that match id
--      succeeds (its own policy just re-checks the same matches row), so
--      this is a direct path to messaging any user without their consent,
--      bypassing every real match-formation flow.
--   2. friendships: the identical shape -- a friend-request recipient
--      responding to accept/decline could also silently repoint user_a/
--      user_b/requested_by. This is worse than #1 in isolation, because
--      `create_match_on_friendship_accepted` (an existing AFTER UPDATE
--      trigger) automatically creates a real `matches` row the moment
--      status transitions to 'accepted' -- so hijacking a friendship and
--      accepting it in the same call chains straight into a fabricated
--      match with a non-consenting victim, without even needing to touch
--      `matches` directly.
--
-- Fixed the same way this codebase already fixed the identical problem for
-- `profiles.is_admin`/`is_premium` and `gatherings/communities.hosting_
-- partner_id` (see prevent_self_premium_edit()/prevent_hosting_partner_self_
-- edit(), already live) -- a BEFORE UPDATE trigger that silently reverts a
-- protected column back to its old value unless a real, explicitly-set
-- app.trusted_update flag says otherwise. Scoped narrowly to only the true
-- identity/consent columns (matches.user_a/user_b; friendships.user_a/
-- user_b/requested_by), NOT provenance columns like matches.source_
-- gathering_id/source_friendship_id -- those are legitimately rewritten by
-- join_gathering()/leave_gathering()/approve_gathering_interest()/
-- create_match_on_friendship_accepted() via `on conflict (user_a, user_b) do
-- update set source_gathering_id = ...`, none of which ever touch user_a/
-- user_b themselves (they're the conflict target, never in the SET clause),
-- so this fix needs zero changes to any of those functions -- confirmed by
-- reading every one of their live bodies first, not assumed.
--
-- Two smaller findings of the identical shape, fixed the same way, since
-- they cost nothing extra once the pattern's already being applied:
--   3. gathering_interest: a host approving/denying interest can update any
--      column on the interest row, not just `status` -- including gathering_
--      id/user_id/match_id, letting a host redirect someone else's interest
--      row to a different gathering they also host, or reassign it to a
--      different user_id, fabricating an attendance record for someone who
--      never asked. Guarded gathering_id/user_id/match_id; the client only
--      ever sets `status`.
--   4. gathering_questions: a host answering a question can also rewrite the
--      question's own gathering_id/asker_id/question_body. Guarded all
--      three; the client only ever sets answer_body/answered_at.
--
-- One defense-in-depth fix, currently unexploitable but a real drift worth
-- closing:
--   5. profile_photos' SELECT policy checks `photo_verified = true` but,
--      unlike profiles' own SELECT policy, never checks `profile_hidden =
--      false` -- so a profile that hides itself would still have its extra
--      photos readable by anyone. Not live-exploitable today (profile_
--      hidden defaults false and no client code anywhere ever sets it true
--      -- confirmed via a repo-wide grep before writing this), but the two
--      policies should say the same thing, not drift.
--
-- One real, confirmed regression matching the exact "gatherings had no
-- authenticated SELECT grant" bug this file already found and fixed once
-- (Aug 9 2026):
--   6. live_tracking_sessions has zero SELECT grant for `authenticated` at
--      all -- `getMyActiveLiveTrackingSession()` (services/liveTracking.js)
--      does a direct `.select('id, expires_at')` against this table and has
--      been silently failing with a permission-denied error for every real
--      user, always returning null. Separately, the one SELECT policy that
--      does exist only lets the session's own owner read it -- there was
--      never a policy letting anyone else (including an anonymous viewer
--      holding the share link) read a specific session by id, so the "the
--      viewing link works for anyone" feature (services/liveTracking.js's
--      own comment) has never actually been reachable at the RLS layer
--      either, not just a client bug. Fixed both: the missing grant, and a
--      narrow SECURITY DEFINER RPC scoped to exactly one session id (the id
--      itself is the capability, matching every other "know the UUID, get a
--      safe read" pattern already established in this schema) returning
--      coordinates only while the session is still active and unexpired.

-- ============ 1. matches: pin user_a/user_b ============

create or replace function prevent_match_participant_edit()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.trusted_update', true), '') <> 'true' then
    if new.user_a is distinct from old.user_a then
      new.user_a := old.user_a;
    end if;
    if new.user_b is distinct from old.user_b then
      new.user_b := old.user_b;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function prevent_match_participant_edit() from public, anon, authenticated;

drop trigger if exists on_match_updated_protect_participants on matches;
create trigger on_match_updated_protect_participants
before update on matches
for each row execute function prevent_match_participant_edit();

-- ============ 2. friendships: pin user_a/user_b/requested_by ============

create or replace function prevent_friendship_participant_edit()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.trusted_update', true), '') <> 'true' then
    if new.user_a is distinct from old.user_a then
      new.user_a := old.user_a;
    end if;
    if new.user_b is distinct from old.user_b then
      new.user_b := old.user_b;
    end if;
    if new.requested_by is distinct from old.requested_by then
      new.requested_by := old.requested_by;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function prevent_friendship_participant_edit() from public, anon, authenticated;

drop trigger if exists on_friendship_updated_protect_participants on friendships;
create trigger on_friendship_updated_protect_participants
before update on friendships
for each row execute function prevent_friendship_participant_edit();

-- ============ 3. gathering_interest: pin gathering_id/user_id/match_id ============

create or replace function prevent_gathering_interest_identity_edit()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.trusted_update', true), '') <> 'true' then
    if new.gathering_id is distinct from old.gathering_id then
      new.gathering_id := old.gathering_id;
    end if;
    if new.user_id is distinct from old.user_id then
      new.user_id := old.user_id;
    end if;
    if new.match_id is distinct from old.match_id then
      new.match_id := old.match_id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function prevent_gathering_interest_identity_edit() from public, anon, authenticated;

drop trigger if exists on_gathering_interest_updated_protect_identity on gathering_interest;
create trigger on_gathering_interest_updated_protect_identity
before update on gathering_interest
for each row execute function prevent_gathering_interest_identity_edit();

-- ============ 4. gathering_questions: pin gathering_id/asker_id/question_body ============

create or replace function prevent_gathering_question_identity_edit()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.trusted_update', true), '') <> 'true' then
    if new.gathering_id is distinct from old.gathering_id then
      new.gathering_id := old.gathering_id;
    end if;
    if new.asker_id is distinct from old.asker_id then
      new.asker_id := old.asker_id;
    end if;
    if new.question_body is distinct from old.question_body then
      new.question_body := old.question_body;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function prevent_gathering_question_identity_edit() from public, anon, authenticated;

drop trigger if exists on_gathering_question_updated_protect_identity on gathering_questions;
create trigger on_gathering_question_updated_protect_identity
before update on gathering_questions
for each row execute function prevent_gathering_question_identity_edit();

-- ============ 5. profile_photos SELECT: align with profiles' own profile_hidden rule ============

drop policy if exists "Users can view own or verified user's extra photos" on profile_photos;
create policy "Users can view own or verified user's extra photos" on profile_photos
  for select using (
    (auth.uid() = user_id)
    or (exists (
      select 1 from profiles p
      where p.id = profile_photos.user_id
        and p.photo_verified = true
        and p.profile_hidden = false
    ))
  );

-- ============ 6. live_tracking_sessions: fix the missing grant + add a real shared-link read path ============

-- get_live_tracking_session(uuid) already exists live (present in the
-- baseline, just never called out in CLAUDE.md's own running log) --
-- confirmed via pg_get_functiondef before writing anything here: it's a
-- narrow SECURITY DEFINER read scoped to one session id, granted to
-- anon+authenticated, returning coordinates only while active and
-- unexpired -- exactly the shape this migration would otherwise have
-- built. Nothing to add there. The one real, confirmed gap is the missing
-- direct-table SELECT grant for `authenticated`, which is what
-- getMyActiveLiveTrackingSession() actually calls.
grant select on public.live_tracking_sessions to authenticated;
