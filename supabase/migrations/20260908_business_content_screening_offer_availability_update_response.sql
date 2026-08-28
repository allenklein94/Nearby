-- Decision 6 (CLAUDE.md), Phase 3: the remaining four real integration
-- points from the locked design's own "every one named" list -- standing
-- offers (`offer`), availability postings (`availability`), broadcast
-- updates (`update`), and offer responses to a specific customer request
-- (`offer_response`). Same general schema Phase 1 already built --
-- business_content_screening_results' target_type CHECK constraint
-- already includes all four -- this is only new admin_review_business_
-- content_screening() branches, matching Phase 1/2's own shape exactly.
--
-- None of the four writers below is a SECURITY-DEFINER-ownership-checked
-- RPC of the *same* shape update_business_profile()/create_business_
-- experience() are -- checked each live before writing this, not
-- assumed:
--   * createBusinessOffer() and postBusinessUpdate() are raw client
--     inserts into brand_offers/business_updates, relying on those
--     tables' own real owner-scoped INSERT RLS policies
--     (`managed_partner_id = auth.uid()`, confirmed live) rather than a
--     SECURITY DEFINER function -- so the LOW-tier immediate-publish
--     path in the Edge Function does the identical raw insert via the
--     caller's own bearer-token-scoped client, and the MEDIUM/UNCERTAIN
--     admin-approve raw write below (which runs as a service-role-
--     equivalent SECURITY DEFINER, not the real owner) bypasses RLS the
--     same way business_profile's own raw write already does, relying on
--     each table's real CHECK constraints as the schema-level backstop.
--   * post_business_availability() and submit_business_offer() ARE real
--     SECURITY DEFINER RPCs -- reused unmodified for the LOW-tier path
--     (called via the caller's own bearer-token-scoped client, matching
--     every prior phase). Neither is a plain single-row INSERT, though:
--       - post_business_availability() also runs a real backward-look
--         match against every currently-open business_requests row.
--         Replicating that whole loop (haversine distance, a real push
--         per match) inside a raw admin-approve write would be a lot of
--         duplicated logic for a real but narrow edge case -- **a real,
--         deliberate, disclosed simplification**: the admin-approve
--         branch below only ever inserts the business_availability row
--         itself, it does NOT re-run the backward-match sweep. A
--         MEDIUM/UNCERTAIN-then-approved posting is still fully live and
--         matchable going forward (any *new* request created after
--         approval matches it normally, through the resolver/fan-out
--         paths that already exist independent of this function) --
--         only a request that was ALREADY open before approval, and
--         stays open, is missed. Flagged here rather than silently
--         built to differ from a from-scratch reimplementation.
--       - submit_business_offer() UPDATEs an already-existing `pending`
--         business_request_offers row (created by the original fan-out
--         when the request was first made) -- it never INSERTs. The
--         admin-approve branch below does the matching real UPDATE, but
--         **re-validates both the parent request's own status and the
--         specific offer row's own status are still viable at the
--         actual moment of approval**, not just at submission time --
--         business_requests/business_request_offers both have real
--         expiry mechanics (expire_stale_business_requests()) that can
--         genuinely make a held response stale by the time an admin
--         reviews it, a real possibility this pass treats as an expected
--         case to handle honestly (a clear error to the admin), not a
--         hypothetical to ignore. On a genuine match it also replicates
--         the real "New offer for your request!" push submit_business_
--         offer() already sends on its own fast path, so a consumer's
--         experience doesn't silently degrade just because their offer
--         happened to be held for review.
--
-- Availability's own starts_at/ends_at are relative to "now," not a
-- fixed external time the way an offer's gathering-linked expiry is --
-- publishing a MEDIUM/UNCERTAIN posting with the *submission-time*
-- starts_at/ends_at baked into the snapshot would silently publish an
-- already-stale or already-expired time window once review actually
-- happens. The client instead sends a real duration (durationHours,
-- null meaning "rest of today," matching AVAILABILITY_DURATION_OPTIONS'
-- own real shape) and both the LOW-tier Edge Function path and this
-- admin-approve branch compute starts_at = now() / ends_at = now() +
-- duration at the real moment of actual publish, never a stale value.
--
-- Pulled the *live* function body fresh via the Management API before
-- editing (not reconstructed from the Phase 2 migration file) -- every
-- line of the existing business_profile/experience branches and the
-- closing status update is byte-for-byte unchanged; only new `declare`
-- entries and four new `if ... target_type = '...'` blocks were added.
create or replace function admin_review_business_content_screening(
  screening_id_param uuid,
  approve_param boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row business_content_screening_results;
  v_entitlement jsonb;
  v_current_count integer;
  v_lat double precision;
  v_lng double precision;
  v_gathering_scheduled_at timestamptz;
  v_expires_at timestamptz;
  v_duration_hours numeric;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_request_status text;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  service_key text;
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can review business content';
  end if;

  select * into v_row from business_content_screening_results where id = screening_id_param for update;
  if v_row.id is null then
    raise exception 'Screening result not found';
  end if;
  if v_row.review_outcome is not null then
    raise exception 'This has already been reviewed';
  end if;

  if approve_param and v_row.target_type = 'business_profile' then
    update brand_partners set
      name = coalesce(v_row.content_snapshot->>'name', name),
      description = v_row.content_snapshot->>'description',
      logo_url = v_row.content_snapshot->>'logoUrl',
      category = v_row.content_snapshot->>'category',
      attributes = coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
        '{}'::text[]
      ),
      cuisine = v_row.content_snapshot->>'cuisine',
      differentiator = v_row.content_snapshot->>'differentiator'
    where id = v_row.partner_id;
  end if;

  if approve_param and v_row.target_type = 'experience' then
    if v_row.content_snapshot->>'experienceId' is null then
      -- Genuinely new -- re-check the real entitlement cap at approval
      -- time too, matching what create_business_experience() itself
      -- already enforces on the fast (LOW-tier) path.
      select check_business_entitlement(v_row.partner_id, 'signature_experiences') into v_entitlement;
      if (v_entitlement ->> 'limit_value') is not null then
        select count(*) into v_current_count from business_experiences where partner_id = v_row.partner_id;
        if v_current_count >= (v_entitlement ->> 'limit_value')::integer then
          raise exception 'ENTITLEMENT_LIMIT:signature_experiences';
        end if;
      end if;

      insert into business_experiences (
        partner_id, title, description, icon, attributes, price_level, party_type, ai_suggested
      ) values (
        v_row.partner_id,
        v_row.content_snapshot->>'title',
        v_row.content_snapshot->>'description',
        v_row.content_snapshot->>'icon',
        coalesce(
          (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
          '{}'::text[]
        ),
        v_row.content_snapshot->>'priceLevel',
        v_row.content_snapshot->>'partyType',
        false
      );
    else
      -- Editing an existing experience -- the partner_id guard in the
      -- WHERE clause is defense in depth, closing off even a hypothetical
      -- data-integrity mismatch between this screening row's own
      -- partner_id and whatever experienceId ended up in its snapshot.
      update business_experiences set
        title = coalesce(v_row.content_snapshot->>'title', title),
        description = v_row.content_snapshot->>'description',
        icon = v_row.content_snapshot->>'icon',
        attributes = coalesce(
          (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
          '{}'::text[]
        ),
        price_level = v_row.content_snapshot->>'priceLevel',
        party_type = v_row.content_snapshot->>'partyType',
        ai_suggested = false,
        updated_at = now()
      where id = (v_row.content_snapshot->>'experienceId')::uuid and partner_id = v_row.partner_id;
    end if;
  end if;

  if approve_param and v_row.target_type = 'offer' then
    -- Real, absolute-time expiry -- never guessed, never stale.
    -- gathingId's own scheduled_at is a fixed external time (not
    -- relative to "now" the way availability's own window is), so
    -- reading it fresh at the real moment of approval is safe and
    -- naturally picks up any reschedule that happened while this was
    -- held, exactly like handleSaveProfile()'s own address/lat/lng
    -- carry-through already reads brand_partners fresh rather than
    -- trusting a submission-time snapshot.
    v_expires_at := null;
    if (v_row.content_snapshot->>'gatheringId') is not null then
      select scheduled_at into v_gathering_scheduled_at from gatherings where id = (v_row.content_snapshot->>'gatheringId')::uuid;
      if v_gathering_scheduled_at is not null then
        v_expires_at := v_gathering_scheduled_at + interval '48 hours';
      end if;
    end if;

    insert into brand_offers (
      partner_id, title, description, reward_type, redemption_instructions, active,
      gathering_id, expires_at, redemption_limit, target_interest_tag,
      unlock_scope, unlock_community_id, unlock_min_members
    ) values (
      v_row.partner_id,
      v_row.content_snapshot->>'title',
      v_row.content_snapshot->>'description',
      coalesce(v_row.content_snapshot->>'rewardType', 'discount'),
      v_row.content_snapshot->>'redemptionInstructions',
      true,
      nullif(v_row.content_snapshot->>'gatheringId', '')::uuid,
      v_expires_at,
      nullif(v_row.content_snapshot->>'redemptionLimit', '')::integer,
      nullif(v_row.content_snapshot->>'targetInterestTag', ''),
      nullif(v_row.content_snapshot->>'unlockScope', ''),
      nullif(v_row.content_snapshot->>'unlockCommunityId', '')::uuid,
      nullif(v_row.content_snapshot->>'unlockMinMembers', '')::integer
    );
  end if;

  if approve_param and v_row.target_type = 'availability' then
    select latitude, longitude into v_lat, v_lng from brand_partners where id = v_row.partner_id;
    if v_lat is null or v_lng is null then
      raise exception 'This business no longer has an address set -- the availability posting could not be published.';
    end if;

    v_duration_hours := nullif(v_row.content_snapshot->>'durationHours', '')::numeric;
    v_starts_at := now();
    v_ends_at := case
      when v_duration_hours is not null then v_starts_at + (v_duration_hours || ' hours')::interval
      else date_trunc('day', v_starts_at) + interval '1 day' - interval '1 second'
    end;

    -- Real, disclosed simplification, per this migration's own header
    -- comment: the backward-look match against already-open requests
    -- that post_business_availability()'s own fast path runs is NOT
    -- replicated here -- this row is still fully live and matchable for
    -- every request created after approval, just not for one that was
    -- already open beforehand.
    insert into business_availability (
      partner_id, category, title, description, offer_type, price,
      capacity, remaining_capacity, starts_at, ends_at, radius_miles
    ) values (
      v_row.partner_id,
      v_row.content_snapshot->>'category',
      v_row.content_snapshot->>'title',
      v_row.content_snapshot->>'description',
      v_row.content_snapshot->>'offerType',
      nullif(v_row.content_snapshot->>'price', '')::numeric,
      nullif(v_row.content_snapshot->>'capacity', '')::integer,
      nullif(v_row.content_snapshot->>'capacity', '')::integer,
      v_starts_at,
      v_ends_at,
      coalesce(nullif(v_row.content_snapshot->>'radiusMiles', '')::double precision, 15)
    );
  end if;

  if approve_param and v_row.target_type = 'update' then
    insert into business_updates (partner_id, title, body)
    values (v_row.partner_id, v_row.content_snapshot->>'title', v_row.content_snapshot->>'body');
  end if;

  if approve_param and v_row.target_type = 'offer_response' then
    -- Real, expected-not-hypothetical re-validation: the parent request
    -- may have expired, been fulfilled by a different business, or been
    -- cancelled while this response sat held for review -- a genuinely
    -- live possibility given expire_stale_business_requests()'s own real
    -- hourly sweep, not a defensive edge case to gloss over. raw_text
    -- lives on business_requests, not business_request_offers, so it's
    -- read here alongside the status check, not off the later UPDATE.
    select status, requester_id, raw_text into v_request_status, v_requester_id, v_raw_text
    from business_requests where id = nullif(v_row.content_snapshot->>'requestId', '')::uuid;
    if v_request_status is distinct from 'open' then
      raise exception 'This request is no longer open -- the offer response could not be published.';
    end if;

    update business_request_offers
    set status = 'offered',
        offer_type = v_row.content_snapshot->>'offerType',
        offer_description = v_row.content_snapshot->>'offerDescription',
        offer_price = nullif(v_row.content_snapshot->>'offerPrice', '')::numeric,
        proposed_time = nullif(v_row.content_snapshot->>'proposedTime', '')::timestamptz,
        responded_at = now()
    where request_id = nullif(v_row.content_snapshot->>'requestId', '')::uuid
      and partner_id = v_row.partner_id
      and status = 'pending';

    if not found then
      raise exception 'This offer response could not be published -- it may have expired or already been responded to.';
    end if;

    -- Replicates submit_business_offer()'s own real push, so a consumer's
    -- experience doesn't silently degrade just because their offer
    -- happened to be held for review instead of published immediately.
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select name into v_partner_name from brand_partners where id = v_row.partner_id;
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_requester_id,
        'title', 'New offer for your request!',
        'body', coalesce(v_partner_name, 'A business') || ' responded to "' || left(coalesce(v_raw_text, ''), 60) || '"',
        'data', jsonb_build_object('type', 'business_offer_received', 'request_id', nullif(v_row.content_snapshot->>'requestId', '')::uuid)
      )
    );
  end if;

  update business_content_screening_results
  set review_outcome = case when approve_param then 'approved' else 'denied' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = screening_id_param;
end;
$$;

revoke all on function admin_review_business_content_screening(uuid, boolean) from public, anon;
grant execute on function admin_review_business_content_screening(uuid, boolean) to authenticated;
