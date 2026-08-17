-- "The Offer System" Phase 4 (see CLAUDE.md's own plan, Decision 3): a
-- real, general "Social Offer" primitive -- any connected person (not
-- just a business) proposing how they'll fulfill part of a Request --
-- with the first shipped surface deliberately scoped to Group Plans'
-- own existing participant mechanism, per the user's own locked words.
--
-- Schema decisions, resolved during build per the plan's own text:
--   - request_id scoped to business_requests, the only real Request
--     object that exists today (per Decision 3's own note).
--   - status mirrors Decision 6's refined commercial-offer lifecycle
--     (offered | accepted | declined | withdrawn | expired | cancelled)
--     -- not a second invented shape.
--   - unique(request_id, offerer_id) -- one row per person per request,
--     the same "row reused across the lifecycle via upsert" convention
--     business_request_offers already established for
--     (request_id, partner_id) -- a re-offer after withdraw/decline
--     updates the same row rather than creating a second one.
--   - No exclusivity/one-winner constraint (unlike commercial offers):
--     multiple Social Offers on the same request can all be accepted
--     independently ("I'll drive" AND "I'll host" aren't competing for
--     the same slot) -- a genuinely different scarcity model, not an
--     oversight.

create table if not exists public.social_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.business_requests(id) on delete cascade,
  offerer_id uuid not null references public.profiles(id) on delete cascade,
  offer_description text not null,
  status text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'withdrawn', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  viewed_at timestamptz,
  constraint social_offers_request_offerer_unique unique (request_id, offerer_id)
);

alter table public.social_offers enable row level security;

-- No INSERT/UPDATE policy -- every write goes through submit_social_offer()/
-- respond_to_social_offer() below, matching this schema's own established
-- "no direct client write on a lifecycle table" convention.

create policy "Offerers can view their own social offers"
on public.social_offers for select
using (auth.uid() = offerer_id);

create policy "Requesters can view social offers on their own requests"
on public.social_offers for select
using (
  exists (
    select 1 from public.business_requests br
    where br.id = social_offers.request_id and br.requester_id = auth.uid()
  )
);

-- The real "first shipped surface" mechanism -- reuses the exact same
-- is_group_plan_participant() SECURITY-DEFINER-bypasses-RLS helper the
-- Group Plans Phase D section already established for business_requests/
-- business_request_offers, so a Social Offer on a group plan's own
-- shared request is genuinely visible to the whole confirmed roster,
-- not just the offerer and the initiator.
create policy "Group plan participants can view social offers on their request"
on public.social_offers for select
using (
  exists (
    select 1 from public.business_requests br
    where br.id = social_offers.request_id
    and br.group_plan_id is not null
    and public.is_group_plan_participant(br.group_plan_id, auth.uid())
  )
);

-- ---------- FUNCTION: submit_social_offer ----------
-- Eligibility is re-validated server-side on every call, never trusted
-- from the client -- Decision 3's own locked, hard rule, restated
-- verbatim: "a Social Offer can only ever originate from someone already
-- connected to the recipient (accepted friend, match, or fellow member
-- of a shared community/gathering) -- never a stranger." This is
-- deliberately a real, general primitive (works on ANY business_requests
-- row, not just a group-plan-scoped one) -- the Group-Plan-only
-- restriction is a client-side scoping choice for this pass's first
-- surface, per Decision 3's own text, not a server-side one.
create or replace function public.submit_social_offer(
  request_id_param uuid,
  offer_description_param text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request record;
  v_offer_id uuid;
  v_eligible boolean;
  service_key text;
  v_offerer_name text;
begin
  if offer_description_param is null or length(trim(offer_description_param)) = 0 then
    raise exception 'Describe what you can offer.';
  end if;

  select * into v_request from business_requests where id = request_id_param;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if v_request.requester_id = auth.uid() then
    raise exception 'You cannot make a social offer on your own request.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;

  select (
    not is_blocked(auth.uid(), v_request.requester_id)
    and (
      exists (
        select 1 from friendships f
        where f.status = 'accepted'
        and ((f.user_a = auth.uid() and f.user_b = v_request.requester_id) or (f.user_a = v_request.requester_id and f.user_b = auth.uid()))
      )
      or exists (
        select 1 from matches m
        where (m.user_a = auth.uid() and m.user_b = v_request.requester_id) or (m.user_a = v_request.requester_id and m.user_b = auth.uid())
      )
      or exists (
        select 1 from community_members cm1
        join community_members cm2 on cm1.community_id = cm2.community_id
        where cm1.user_id = auth.uid() and cm2.user_id = v_request.requester_id
      )
      or exists (
        select 1
        from (
          select gathering_id from gathering_interest where user_id = auth.uid() and status = 'approved'
          union
          select id as gathering_id from gatherings where host_id = auth.uid()
        ) mine
        join (
          select gathering_id from gathering_interest where user_id = v_request.requester_id and status = 'approved'
          union
          select id as gathering_id from gatherings where host_id = v_request.requester_id
        ) theirs on mine.gathering_id = theirs.gathering_id
      )
    )
  ) into v_eligible;

  if not v_eligible then
    raise exception 'You need to already be connected to this person to make them an offer.';
  end if;

  insert into social_offers (request_id, offerer_id, offer_description, status)
  values (request_id_param, auth.uid(), trim(offer_description_param), 'offered')
  on conflict (request_id, offerer_id) do update
    set offer_description = excluded.offer_description, status = 'offered',
        responded_at = null, viewed_at = null, created_at = now()
    where social_offers.status in ('withdrawn', 'declined', 'expired', 'cancelled')
  returning id into v_offer_id;

  if v_offer_id is null then
    raise exception 'You already made an offer on this request.';
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_offerer_name from profiles where id = auth.uid();
  if service_key is not null then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_request.requester_id,
        'title', 'Someone offered to help!',
        'body', coalesce(v_offerer_name, 'Someone you know') || ' made you a social offer: "' || left(trim(offer_description_param), 60) || '"',
        'data', jsonb_build_object('type', 'social_offer_received', 'request_id', request_id_param, 'offer_id', v_offer_id)
      )
    );
  end if;

  return jsonb_build_object('success', true, 'offerId', v_offer_id);
end;
$function$;

revoke all on function public.submit_social_offer(uuid, text) from public, anon;
grant execute on function public.submit_social_offer(uuid, text) to authenticated;

-- ---------- FUNCTION: respond_to_social_offer ----------
-- Same request-ownership authority model as accept_business_offer's
-- original (pre-group-plan-guard) shape -- the request's own requester
-- accepts/declines. Deliberately NOT extended with commercial offers'
-- own group-plan full-consensus guard (confirm_group_plan_offer) --
-- a Social Offer never competes for a single winning slot the way a
-- commercial reservation does, so there is no "unilateral accept"
-- problem to guard against here; out of this pass's own real scope.
create or replace function public.respond_to_social_offer(
  offer_id_param uuid,
  accept_param boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_offer_id uuid;
  v_offerer_id uuid;
  service_key text;
  v_requester_name text;
begin
  select so.id, so.offerer_id
  into v_offer_id, v_offerer_id
  from social_offers so
  join business_requests br on br.id = so.request_id
  where so.id = offer_id_param
  and br.requester_id = auth.uid()
  and so.status = 'offered'
  for update of so;

  if v_offer_id is null then
    raise exception 'Offer not found or already responded to.';
  end if;

  update social_offers
  set status = case when accept_param then 'accepted' else 'declined' end,
      responded_at = now()
  where id = v_offer_id;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_requester_name from profiles where id = auth.uid();
  if service_key is not null then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_offerer_id,
        'title', case when accept_param then 'Your offer was accepted! 🎉' else 'An update on your offer' end,
        'body', coalesce(v_requester_name, 'Someone') || case when accept_param then ' accepted your offer.' else ' went a different way this time -- thanks for offering.' end,
        'data', jsonb_build_object('type', 'social_offer_responded', 'offer_id', v_offer_id, 'accepted', accept_param)
      )
    );
  end if;

  return jsonb_build_object('success', true, 'status', case when accept_param then 'accepted' else 'declined' end);
end;
$function$;

revoke all on function public.respond_to_social_offer(uuid, boolean) from public, anon;
grant execute on function public.respond_to_social_offer(uuid, boolean) to authenticated;

-- ---------- FUNCTION: mark_social_offer_viewed ----------
-- Same real, honest read-receipt shape as mark_business_offer_viewed
-- (Phase 1/3) -- built here rather than left unwired, so viewed_at is
-- never a permanently-null, unreachable column. Scoped to the
-- request's own requester, same authority model as respond_to_social_
-- offer() above -- that's the only role this column actually tracks.
create or replace function public.mark_social_offer_viewed(offer_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update social_offers so
  set viewed_at = now()
  from business_requests br
  where so.id = offer_id_param
  and so.request_id = br.id
  and br.requester_id = auth.uid()
  and so.viewed_at is null;
end;
$function$;

revoke all on function public.mark_social_offer_viewed(uuid) from public, anon;
grant execute on function public.mark_social_offer_viewed(uuid) to authenticated;
