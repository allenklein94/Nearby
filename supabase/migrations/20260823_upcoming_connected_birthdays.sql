-- "The Plan Engine" Phase 1 (see CLAUDE.md, Aug 23 2026): an advance-notice
-- birthday signal, distinct from the existing same-day send_birthday_reminders()
-- push (which fires only on the actual day and lands on ViewProfile -- a
-- "wish happy birthday" touchpoint, unchanged and untouched by this
-- migration). This is the earlier, planning-oriented signal: "there's still
-- real time to plan something" -- so Home can surface it days ahead, not
-- just wish happy birthday after the fact.
--
-- Real connected-set scoping (accepted friendships UNION matches, both
-- directions), matching the identical definition already established for
-- Tier 2 / group-intent elsewhere in this schema -- never a stranger.
-- Internal auth.uid() check, no caller-supplied id, matching every other
-- RPC of this shape in this schema.
create or replace function public.get_upcoming_connected_birthdays(days_ahead_param int default 14)
returns table(connection_id uuid, display_name text, days_until int)
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  r record;
  v_year int;
  v_month int;
  v_day int;
  v_next_bday date;
begin
  if v_caller is null then
    return;
  end if;

  for r in
    select p.id, p.display_name, p.birthdate
    from profiles p
    where p.birthdate is not null
      and p.id <> v_caller
      and (
        exists (
          select 1 from friendships f
          where f.status = 'accepted'
            and ((f.user_a = v_caller and f.user_b = p.id) or (f.user_b = v_caller and f.user_a = p.id))
        )
        or exists (
          select 1 from matches m
          where (m.user_a = v_caller and m.user_b = p.id) or (m.user_b = v_caller and m.user_a = p.id)
        )
      )
  loop
    v_year := extract(year from current_date)::int;
    v_month := extract(month from r.birthdate)::int;
    v_day := extract(day from r.birthdate)::int;

    begin
      v_next_bday := make_date(v_year, v_month, v_day);
    exception when others then
      -- A Feb 29 birthdate in a non-leap current year -- fall back to
      -- Feb 28, the same honest approximation most calendars use rather
      -- than erroring out and silently dropping this person's signal.
      v_next_bday := make_date(v_year, 2, 28);
    end;

    if v_next_bday < current_date then
      begin
        v_next_bday := make_date(v_year + 1, v_month, v_day);
      exception when others then
        v_next_bday := make_date(v_year + 1, 2, 28);
      end;
    end if;

    if (v_next_bday - current_date) between 0 and days_ahead_param then
      connection_id := r.id;
      display_name := r.display_name;
      days_until := v_next_bday - current_date;
      return next;
    end if;
  end loop;

  return;
end;
$function$;

revoke all on function public.get_upcoming_connected_birthdays(int) from public, anon;
grant execute on function public.get_upcoming_connected_birthdays(int) to authenticated;
