-- Owner item 154 (2026-10-03): do gatherings activate an existing social network? Internal analysis only, gatherings
-- only (group plans and occasion plans have different participant/state models and stay out until a deliberate decision
-- to combine them). Read only from existing records; no change to gathering, friendship, invitation or join behavior.
--
-- Definitions (owner, LOCKED):
--   attendee            an APPROVED gathering_interest row that is not the host (pending / waitlisted have not joined).
--                       joined_at = that row's created_at (the join moment; an approval time is not stored).
--   friend joined       an attendee who is CURRENTLY an accepted friend of the host AND whose friendship request
--                       (friendships.created_at) was made BEFORE they joined. Measures existing friends being activated.
--                       friendships keeps no accepted-at and its row disappears on unfriend / block, so a friendship that
--                       existed then and was later removed is not counted: an acknowledged UNDERCOUNT, never inferred.
--   invited recipient   a person (never the host) with at least one social_invites row for this gathering whose FIRST
--                       invitation was created before they joined (or who never joined). Counted once per gathering:
--                       repeat sends and invitations from several attendees do not add to it. A failed send raises in
--                       invite_friend_to_gathering / send_social_invite and leaves no row; there is no cancelled state,
--                       so every row is a successfully sent invitation (declined / expired ones still were sent).
--                       A person first invited AFTER they joined is not an invitation opportunity at all, and a person
--                       who joined without any invitation is never in the denominator (nothing is inferred from
--                       friendship, proximity or feed exposure).
--   invited joined      an invited recipient whose approved join came after their first invitation. Accepting the
--                       invitation alone is not a join.
--   became friends after  a pair of people who both attended (the host counts as attending from the gathering's
--                       creation) whose CURRENT accepted friendship was requested after the gathering's start AND after
--                       both had joined. Counted per gathering pair (a pair met at two gatherings counts at each). By
--                       construction never the same pair as "friend joined" (that one requires the request BEFORE the join).
--
-- Cohort: the calendar week (Monday, UTC) the gathering was CREATED, permanently; joins, invitations and friendships in
-- later weeks never move it. Overall = all history. No rolling windows. Event timestamps are kept on the per-gathering
-- view for timing analysis. Rates are NULL when their denominator is 0 (never 0% of nothing). A deleted (cancelled)
-- gathering has no rows, like everywhere else.
-- Internal only: no anon / authenticated / business access (service role / Management API), like request_journey.

create or replace view public.gathering_social_people as
with att as (
  select gi.gathering_id, gi.user_id, gi.created_at as joined_at
  from gathering_interest gi
  join gatherings g on g.id = gi.gathering_id
  where gi.status = 'approved' and gi.user_id <> g.host_id
),
inv as (
  select si.target_id as gathering_id, si.invitee_id as user_id, min(si.created_at) as first_invited_at, count(*) as invitations_received
  from social_invites si
  join gatherings g on g.id = si.target_id
  where si.invite_type = 'gathering' and si.invitee_id <> g.host_id
  group by si.target_id, si.invitee_id
),
p as (
  select coalesce(att.gathering_id, inv.gathering_id) as gathering_id, coalesce(att.user_id, inv.user_id) as user_id,
         att.joined_at, inv.first_invited_at, coalesce(inv.invitations_received, 0) as invitations_received
  from att full join inv on inv.gathering_id = att.gathering_id and inv.user_id = att.user_id
)
select p.gathering_id,
  g.created_at as gathering_created_at,
  date_trunc('week', g.created_at at time zone 'UTC')::date as gathering_week,
  g.scheduled_at,
  p.joined_at is not null as is_attendee,
  p.joined_at,
  hf.created_at as host_friend_requested_at,
  coalesce(p.joined_at is not null and hf.created_at < p.joined_at, false) as friend_joined,
  p.first_invited_at,
  p.invitations_received,
  (p.first_invited_at is not null and (p.joined_at is null or p.first_invited_at < p.joined_at)) as invited_recipient,
  (p.first_invited_at is not null and p.joined_at is not null and p.first_invited_at < p.joined_at) as invited_joined
from p
join gatherings g on g.id = p.gathering_id
left join lateral (
  select f.created_at from friendships f
  where f.status = 'accepted'
    and ((f.user_a = g.host_id and f.user_b = p.user_id) or (f.user_b = g.host_id and f.user_a = p.user_id))
  order by f.created_at limit 1
) hf on true;

revoke all on public.gathering_social_people from public, anon, authenticated;

create or replace view public.gathering_social_conversion as
with members as (
  select g.id as gathering_id, g.host_id as user_id, g.created_at as joined_at from gatherings g
  union all
  select gi.gathering_id, gi.user_id, gi.created_at
  from gathering_interest gi join gatherings g on g.id = gi.gathering_id
  where gi.status = 'approved' and gi.user_id <> g.host_id
),
after_pairs as (
  select a.gathering_id, f.created_at as friends_requested_at
  from members a
  join members b on b.gathering_id = a.gathering_id and a.user_id < b.user_id
  join gatherings g on g.id = a.gathering_id
  join friendships f on f.status = 'accepted'
    and ((f.user_a = a.user_id and f.user_b = b.user_id) or (f.user_a = b.user_id and f.user_b = a.user_id))
  where f.created_at > greatest(g.scheduled_at, a.joined_at, b.joined_at)
)
select g.id as gathering_id,
  g.created_at as gathering_created_at,
  date_trunc('week', g.created_at at time zone 'UTC')::date as gathering_week,
  g.scheduled_at,
  coalesce(sp.attendees, 0) as attendees,
  coalesce(sp.friends_joined, 0) as friends_joined,
  coalesce(sp.invited_recipients, 0) as invited_recipients,
  coalesce(sp.invited_joined, 0) as invited_joined,
  coalesce(ap.became_friends_after, 0) as became_friends_after,
  sp.first_join_at,
  sp.first_friend_join_at,
  sp.first_invited_at,
  sp.first_invited_join_at,
  ap.first_became_friends_at
from gatherings g
left join (
  select gathering_id,
    count(*) filter (where is_attendee) as attendees,
    count(*) filter (where friend_joined) as friends_joined,
    count(*) filter (where invited_recipient) as invited_recipients,
    count(*) filter (where invited_joined) as invited_joined,
    min(joined_at) as first_join_at,
    min(joined_at) filter (where friend_joined) as first_friend_join_at,
    min(first_invited_at) filter (where invited_recipient) as first_invited_at,
    min(joined_at) filter (where invited_joined) as first_invited_join_at
  from public.gathering_social_people group by gathering_id
) sp on sp.gathering_id = g.id
left join (
  select gathering_id, count(*) as became_friends_after, min(friends_requested_at) as first_became_friends_at
  from after_pairs group by gathering_id
) ap on ap.gathering_id = g.id;

revoke all on public.gathering_social_conversion from public, anon, authenticated;

create or replace view public.gathering_social_conversion_summary as
select
  case when grouping(gathering_week) = 0 then 'week' else 'overall' end as dimension,
  coalesce(case when grouping(gathering_week) = 0 then gathering_week::text end, 'all') as value,
  count(*) as gatherings,
  count(*) filter (where attendees > 0) as gatherings_with_attendees,
  sum(attendees) as attendees,
  sum(friends_joined) as friends_joined,
  count(*) filter (where friends_joined > 0) as gatherings_with_friend_joined,
  round(sum(friends_joined)::numeric / nullif(sum(attendees), 0), 4) as friends_joined_share,
  sum(invited_recipients) as invited_recipients,
  sum(invited_joined) as invited_joined,
  sum(invited_recipients) - sum(invited_joined) as invited_not_joined,
  round(sum(invited_joined)::numeric / nullif(sum(invited_recipients), 0), 4) as invitation_conversion_rate,
  sum(became_friends_after) as became_friends_after,
  count(*) filter (where became_friends_after > 0) as gatherings_with_new_friendship
from public.gathering_social_conversion
group by grouping sets ((), (gathering_week));

revoke all on public.gathering_social_conversion_summary from public, anon, authenticated;
