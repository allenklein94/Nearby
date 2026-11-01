-- Duplicate-photo detection activation (owner, 2026-11-01: "activated before public launch, not deferred"). STAGED on
-- post-tier1/photo-detection-activation, NOT deployed; deploys only with its own approval, AFTER 20270379 and every
-- earlier staged migration (0348-0379), and after the moderate-photo redeploy that carries 0357/0368's hashing.
--
-- What it switches on: near-duplicate matching (20270368) at the distances the owner chose on 2026-10-30, dHash <= 10 AND
-- pHash <= 10 (PRODUCT_AUDIT/PHOTO_SIMILARITY_CALIBRATION_2026-10-30.md). Exact-copy matching (20270357) is already on
-- from 20270358 (3 accounts, or 2 with names at similarity >= 0.5); this migration REFUSES to run unless those are still
-- exactly the approved numbers, so it can never activate near-duplicates under other rules.
--
-- Unchanged, by design: a match only opens a private admin review case (0357 / 0368 / 0369 rules: the photo on >= 3
-- accounts, or on 2+ accounts with similar names; a photo already in a case never opens a second one; a closed case stays
-- closed). Nothing bans, suspends, hides, restricts, scores or notifies anyone. No new data is collected: hashes are the
-- ones moderate-photo already records (also while detection is off).
--
-- It also checks every photo already fingerprinted ONCE (private.evaluate_existing_photo_signals), so photos hashed
-- before activation (new uploads since 0368 + scripts/trust-safety/fingerprint-existing-photos.js) are judged the same
-- way as new ones. A photo recorded WHILE this transaction is open sees detection off and isn't visible to this sweep yet,
-- so right after the deploy run `photo-detection-switch.js sweep` once (scripts/replay/review-case-concurrency.js step 6
-- shows the race and the fix). Off switch (instant, owner approval per run): scripts/trust-safety/photo-detection-switch.js off.
-- Rollback: scripts/rollback/20270380_photo_detection_activation.rollback.sql (cases already opened are kept for review).

do $$
declare
  s record;
begin
  if to_regprocedure('private.evaluate_similar_photo(uuid)') is null
     or to_regprocedure('private.evaluate_photo_fingerprint(text)') is null
     or to_regprocedure('public.admin_close_account_review_case(uuid, text, text)') is null
     or to_regclass('private.account_review_case_events') is null then
    raise exception 'photo detection activation needs 20270357, 20270368 and 20270369 deployed first';
  end if;
  select * into s from private.account_signal_settings where id;
  if s.duplicate_photo_min_accounts is distinct from 3 or s.similar_name_min_similarity is distinct from 0.5::real then
    raise exception 'exact-duplicate rules are not the approved 3 accounts / name similarity 0.5 (found %, %)',
      s.duplicate_photo_min_accounts, s.similar_name_min_similarity;
  end if;
end $$;

-- Judge every photo already fingerprinted under the current rules. Idempotent: the evaluate functions add to an open case
-- or do nothing (a closed case never reopens by itself, 20270369). Returns counts only.
create or replace function private.evaluate_existing_photo_signals()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_before integer;
  v_exact integer := 0;
  v_similar integer := 0;
  r record;
begin
  select count(*) into v_before from private.account_review_cases where signal in ('identical_photo', 'similar_photo');
  for r in select distinct sha256 from private.photo_fingerprints order by sha256 loop
    perform private.evaluate_photo_fingerprint(r.sha256);
    v_exact := v_exact + 1;
  end loop;
  for r in select distinct object_id from private.photo_perceptual_hashes order by object_id loop
    perform private.evaluate_similar_photo(r.object_id);
    v_similar := v_similar + 1;
  end loop;
  return jsonb_build_object('exact_checked', v_exact, 'similar_checked', v_similar,
    'cases_opened', (select count(*) from private.account_review_cases where signal in ('identical_photo', 'similar_photo')) - v_before);
end;
$function$;
revoke all on function private.evaluate_existing_photo_signals() from public, anon, authenticated, service_role;

update private.account_signal_settings
   set similar_photo_max_dhash = 10, similar_photo_max_phash = 10, updated_at = now()
 where id;

select private.evaluate_existing_photo_signals();
