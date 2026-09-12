-- Item 59 fix ("Thursday acceptance test", Journey B trace, CLAUDE.md):
-- create_plan_from_date_proposal() (20260914_plans_unified_object.sql)
-- unconditionally inserted plan_type = 'dating_date' for every date-
-- proposal-sourced plan, even when the underlying match is friend-sourced
-- (matches.source_friendship_id set) or gathering-sourced
-- (matches.source_gathering_id set) -- the exact same real/fake distinction
-- ChatScreen.js's own isRomanticMatch already makes for the same match row
-- (`!match.source_gathering_id && !match.source_friendship_id`). The
-- plans table already has a real 'friend_hangout' CHECK value for exactly
-- this, already used correctly for friends-party-type gatherings
-- (create_plan_from_gathering(), same original migration) -- date
-- proposals just never got the same treatment.
--
-- Consequence found by the trace: every "Plan Something Together" made
-- from a Friends-tab connection landed on the Plans tab permanently
-- mislabeled with a heart icon and "Date" (PlansScreen.js's datePlanRow,
-- fixed in the same client change as this migration).

create or replace function public.create_plan_from_date_proposal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_type text;
begin
  select case
    when m.source_gathering_id is not null or m.source_friendship_id is not null
      then 'friend_hangout'
    else 'dating_date'
  end
  into v_plan_type
  from public.matches m
  where m.id = new.match_id;

  insert into public.plans (
    plan_type, created_by, title, status, resulting_date_proposal_id
  ) values (
    coalesce(v_plan_type, 'dating_date'), new.proposed_by, new.plan_text, 'draft', new.id
  );
  return new;
end;
$$;

-- Same signature as the original (a trigger function takes no arguments),
-- so this is a plain in-place replace -- no second overload risk, no
-- explicit drop needed.

-- Real data correction, not just a forward-looking function fix: backfill
-- every already-existing plans row that this exact bug already mislabeled.
update public.plans p
set plan_type = 'friend_hangout'
from public.date_proposals dp
join public.matches m on m.id = dp.match_id
where p.resulting_date_proposal_id = dp.id
  and p.plan_type = 'dating_date'
  and (m.source_gathering_id is not null or m.source_friendship_id is not null);
