-- The feedback loop, two additions (no new feedback system):
--  1. "Good match?" on the existing post-plan outcome: business_offer_outcomes.match_fit (yes / somewhat / no),
--     asked next to "How did it go?" and "Would you do this again?". Private, consumer-only, like the rest of the row.
--  2. "You loved this kind of experience last time": get_my_positive_experience_signals also returns the KINDS the
--     caller loved (gathering interest tags from positive gathering feedback + request categories from positive
--     business outcomes), so Home can rank by a type of experience and not only a repeat host/business.
-- Both changes alter a function signature, so each old signature is dropped explicitly first (single overload after).

alter table public.business_offer_outcomes
  add column if not exists match_fit text check (match_fit is null or match_fit in ('yes', 'somewhat', 'no'));

drop function if exists public.submit_offer_outcome(uuid, text, text, text);

create function public.submit_offer_outcome(
  offer_id_param uuid,
  satisfaction_rating_param text,
  would_repeat_param text,
  feedback_text_param text default null,
  match_fit_param text default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_offer record;
  v_requester_id uuid;
begin
  select * into v_offer from business_request_offers where id = offer_id_param;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;
  if v_offer.status <> 'completed' then
    raise exception 'You can only share feedback once this is marked complete.';
  end if;

  select requester_id into v_requester_id from business_requests where id = v_offer.request_id;
  if auth.uid() <> v_requester_id then
    raise exception 'Only the person who made this request can share feedback on it.';
  end if;

  if satisfaction_rating_param not in ('loved_it', 'good', 'okay', 'not_for_me') then
    raise exception 'Invalid satisfaction rating.';
  end if;
  if would_repeat_param not in ('yes', 'maybe', 'no') then
    raise exception 'Invalid would-repeat value.';
  end if;
  if match_fit_param is not null and match_fit_param not in ('yes', 'somewhat', 'no') then
    raise exception 'Invalid match value.';
  end if;

  begin
    insert into business_offer_outcomes (offer_id, reviewer_id, satisfaction_rating, would_repeat, feedback_text, match_fit)
    values (offer_id_param, auth.uid(), satisfaction_rating_param, would_repeat_param, nullif(trim(coalesce(feedback_text_param, '')), ''), match_fit_param);
  exception when unique_violation then
    raise exception 'You''ve already shared feedback for this.';
  end;

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.submit_offer_outcome(uuid, text, text, text, text) from public, anon;
grant execute on function public.submit_offer_outcome(uuid, text, text, text, text) to authenticated;

drop function if exists public.get_my_positive_experience_signals();

create function public.get_my_positive_experience_signals()
 returns table(host_ids uuid[], partner_ids uuid[], category_names text[])
 language sql
 security definer
 set search_path to 'public'
as $function$
  select
    coalesce(
      (select array_agg(distinct g.host_id)
       from gathering_feedback gf
       join gatherings g on g.id = gf.gathering_id
       where gf.reviewer_id = auth.uid()
         and gf.satisfaction_rating in ('loved_it', 'good')
         and gf.would_attend_again = true
         and g.host_id <> auth.uid()),
      array[]::uuid[]
    ),
    coalesce(
      (select array_agg(distinct bro.partner_id)
       from business_offer_outcomes boo
       join business_request_offers bro on bro.id = boo.offer_id
       where boo.reviewer_id = auth.uid()
         and boo.satisfaction_rating in ('loved_it', 'good')
         and boo.would_repeat in ('yes', 'maybe')),
      array[]::uuid[]
    ),
    -- kinds of experience: only when the person also would do it again (and, for a business, it was not a bad match)
    coalesce(
      (select array_agg(distinct k) from (
         select g.interest_tag as k
         from gathering_feedback gf
         join gatherings g on g.id = gf.gathering_id
         where gf.reviewer_id = auth.uid()
           and gf.satisfaction_rating in ('loved_it', 'good')
           and gf.would_attend_again = true
           and g.interest_tag is not null
         union
         select br.category
         from business_offer_outcomes boo
         join business_request_offers bro on bro.id = boo.offer_id
         join business_requests br on br.id = bro.request_id
         where boo.reviewer_id = auth.uid()
           and boo.satisfaction_rating in ('loved_it', 'good')
           and boo.would_repeat in ('yes', 'maybe')
           and boo.match_fit is distinct from 'no'
           and br.category is not null
       ) s),
      array[]::text[]
    );
$function$;

revoke all on function public.get_my_positive_experience_signals() from public, anon;
grant execute on function public.get_my_positive_experience_signals() to authenticated;
