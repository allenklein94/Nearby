-- Item 72 live verification (always rolls back): owner sets/clears booking_mode, the legacy reservation_required attribute is
-- removed on set, invalid mode and non-owner are refused, anon cannot execute.
begin;
do $$
declare
  owner_id uuid;
  pid uuid;
  stranger uuid;
  ok boolean;
begin
  select id, managed_partner_id into owner_id, pid from profiles where managed_partner_id is not null limit 1;
  select id into stranger from profiles where managed_partner_id is null limit 1;
  update brand_partners set attributes = array['quiet', 'reservation_required'] where id = pid;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  perform set_business_booking_mode(pid, 'reservation_required');
  if (select booking_mode from brand_partners where id = pid) <> 'reservation_required' then raise exception 'FAIL set'; end if;
  if (select attributes @> array['reservation_required'] from brand_partners where id = pid) then raise exception 'FAIL legacy attribute kept'; end if;
  if not (select attributes @> array['quiet'] from brand_partners where id = pid) then raise exception 'FAIL other attribute lost'; end if;

  perform set_business_booking_mode(pid, null);
  if (select booking_mode from brand_partners where id = pid) is not null then raise exception 'FAIL clear'; end if;

  ok := false;
  begin perform set_business_booking_mode(pid, 'drive_thru'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL invalid accepted'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  ok := false;
  begin perform set_business_booking_mode(pid, 'walk_in'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL non-owner accepted'; end if;

  if has_function_privilege('anon', 'public.set_business_booking_mode(uuid, text)', 'execute') then raise exception 'FAIL anon can execute'; end if;
  raise notice 'business-booking-mode: all checks passed';
end $$;
rollback;
