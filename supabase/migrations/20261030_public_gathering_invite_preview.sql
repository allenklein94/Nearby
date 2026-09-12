-- Item 72 (CLAUDE.md): "Make invitations frictionless -- don't require
-- everyone to download Nearby just to participate." Today, every
-- share-a-plan path (GatheringConfirmationScreen's "Share Gathering,"
-- GatheringHubScreen's growth-loop share prompt, and
-- InviteFriendsModal's own handleShareWithNonUser -- a function
-- literally named for this exact case) shares a bare `nearby://gathering/:id`
-- deep link. That link does nothing at all for someone who doesn't
-- already have the app installed (a custom URL scheme has no web
-- fallback) -- confirmed by reading app.json (`"scheme": "nearby"`, no
-- associatedDomains/intentFilters anywhere), the opposite of the
-- "frictionless, natural acquisition loop" this item asks for.
--
-- Fix, mirroring the exact precedent this repo already established for
-- Live Tracking (`get_live_tracking_session`, `docs/track.html`, both
-- already shipped and already anon-callable): a narrow, capability-URL-
-- style SECURITY DEFINER RPC returning ONLY the minimal, non-sensitive
-- fields a "you're invited" preview needs, callable by anon so a plain
-- static GitHub Pages page (no Expo build, no login) can render it for
-- literally anyone holding the link -- the recipient views the plan in a
-- browser with zero install, then either taps "Open Nearby" (works
-- instantly if already installed) or "Get Nearby" (App/Play Store) for
-- the full experience.
--
-- Deliberately conservative about what crosses this boundary, same
-- discipline as Item 69's business-request privacy boundary: no exact
-- coordinates (precise_lat/precise_lng), no free-text description (could
-- carry anything the host typed, never vetted for public consumption),
-- no attendee list, and -- a real correction made before this ever shipped,
-- caught by reading gatherings.js's own localArea() -- no `area` column
-- either: it isn't a neighborhood name, it's a real lat/lng pair rounded to
-- ~1km, i.e. still genuine coordinate data. Showing that to a fully
-- anonymous, unauthenticated web visitor is exactly the kind of
-- pre-acceptance overexposure Item 69 already drew a hard line against for
-- businesses; the same line applies here. Only title/category/time/host
-- name/a plain attendee count cross this boundary -- exact location is
-- part of "the full experience," reachable only once they open Nearby, per
-- this item's own framing. A gathering that's since been cancelled (this
-- schema's own cancellation is delete-based, per "Host cancellation
-- lifecycle for Communities and Gatherings," CLAUDE.md) or never existed
-- both naturally return null -- the page shows an honest "no longer
-- available" state, nothing fabricated.
--
-- Scope: gatherings only (the one concrete, already-external-shareable
-- "plan" object across every existing share call site). Group-vote plans
-- (occasion_group_plans) and business-request plans are NOT covered by
-- this migration -- a real, disclosed boundary: those flows only ever
-- invite the organizer's own already-connected Nearby friends by
-- construction (occasion_group_plans' invite list is sourced from
-- get_my_friends()), so there's no existing "share with someone who might
-- not be a Nearby user" path to fix for them yet, and building genuine
-- anonymous-guest voting is a materially bigger, separate feature (guest
-- identity, spam/abuse risk) than this item asks for.

create or replace function public.get_public_gathering_invite_preview(gathering_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
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
  where g.id = gathering_id_param;

  return v_result;
end;
$$;

-- Deliberate exception to this repo's own "revoke from public, anon"
-- convention -- this function exists specifically to be callable by a
-- signed-out visitor, same as get_live_tracking_session already is. Its
-- own fixed return column list (no `select *`, no requester/participant
-- identity) is what keeps this safe, not caller authentication.
revoke all on function public.get_public_gathering_invite_preview(uuid) from public;
grant execute on function public.get_public_gathering_invite_preview(uuid) to anon, authenticated;
