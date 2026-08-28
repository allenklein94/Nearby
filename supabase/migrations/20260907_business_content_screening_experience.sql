-- Decision 6 (CLAUDE.md), Phase 2: Signature Experiences
-- (business_experiences) join the content-screening layer alongside
-- business_profile from Phase 1. Real, confirmed gap named in the locked
-- design: handleSaveExperience() (title/description) had zero
-- checkTextModeration calls anywhere.
--
-- No new table/column needed -- business_content_screening_results'
-- target_type CHECK constraint (Phase 1) already includes 'experience',
-- and target_id (nullable uuid) already fits an experience row's own id
-- perfectly (null for a genuinely new experience, real for an edit).
--
-- Only admin_review_business_content_screening() needs a new branch, for
-- the same reason business_profile's own approve branch is a raw table
-- write rather than calling update_business_profile(): at review time the
-- caller is the *admin*, not the business owner, so create_business_
-- experience()/update_business_experience()'s own internal auth.uid() =
-- managed_partner_id ownership check would incorrectly reject the admin.
-- Admin authority is already established once, at the top of this
-- function, via check_is_admin() -- the raw write below relies on
-- business_experiences' own real CHECK constraints (attributes/
-- price_level/party_type/title-length/description-length) as the same
-- schema-level backstop business_profile's own raw write already relies
-- on brand_partners' CHECK constraints for.
--
-- One real gap closed here that Phase 1 didn't need to worry about:
-- create_business_experience() enforces a real, live entitlement cap
-- (signature_experiences) on every direct (LOW-tier) create -- a raw
-- INSERT at admin-approval time would silently bypass that cap for a
-- MEDIUM/UNCERTAIN submission. Re-checked here too, for a genuinely new
-- experience only (target_id/experienceId null) -- editing an existing
-- one never changes the count, so no re-check is needed there.
--
-- Pulled the *live* function body fresh via the Management API before
-- editing (not reconstructed from the Phase 1 migration file) -- every
-- line of the existing business_profile branch and the closing status
-- update is byte-for-byte unchanged; only the new `declare` entries and
-- the new `if ... target_type = 'experience'` block were added.
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

  update business_content_screening_results
  set review_outcome = case when approve_param then 'approved' else 'denied' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = screening_id_param;
end;
$$;

revoke all on function admin_review_business_content_screening(uuid, boolean) from public, anon;
grant execute on function admin_review_business_content_screening(uuid, boolean) to authenticated;
