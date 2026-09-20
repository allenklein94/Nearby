-- Push notification copy sweep. Each patch edits the LIVE function body in
-- place (same signature, so no second overload) and fails loudly if the text it
-- expects is not there.
--
-- 1. PRIVACY: four business-facing push bodies still embedded the first 60
--    characters of the consumer's free text (business_requests.raw_text),
--    against the locked minimum-payload rule. They now use the structured
--    business_safe_request_summary(), like every other business push.
-- 2. Gathering reminder said "starts in about 2 hours" whatever the real lead
--    time (the cron window is 0-2 hours ahead).
-- 3. Host push said "X is interested in ..." for every new row, including a
--    person who simply joined; it now says what happened (joined / asked to
--    join / joined the waitlist). "approved your interest" -> "request".
-- 4. Three consumer pushes said "matches your interests" without naming the
--    interest; they now name the real matched one.
-- 5. The 3rd-signup push said "N people are interested" for a count of all
--    gathering_interest rows (attendees and requests); it now says "signed up".

create or replace function pg_temp._patch(fname text, old text, new text)
returns void language plpgsql as $f$
declare
  v_oid oid;
  v_def text;
begin
  select p.oid into strict v_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = fname;   -- strict: exactly one overload
  v_def := pg_get_functiondef(v_oid);
  if position(old in v_def) = 0 then
    raise exception 'push copy patch: expected text not found in %: %', fname, old;
  end if;
  execute replace(v_def, old, new);
end;
$f$;

-- 1. business pushes: no consumer free text
select pg_temp._patch('_match_request_to_availability',
  $q$matches a new request: "' || left(coalesce(v_raw_text, ''), 60) || '"'$q$,
  $q$matches a new request: ' || coalesce(public.business_safe_request_summary(request_id_param), 'a new request')$q$);
select pg_temp._patch('_match_request_to_package',
  $q$matches a new request: "' || left(coalesce(v_raw_text, ''), 60) || '"'$q$,
  $q$matches a new request: ' || coalesce(public.business_safe_request_summary(request_id_param), 'a new request')$q$);
select pg_temp._patch('_match_request_to_policy',
  $q$auto-accepted: "' || left(coalesce(v_raw_text, ''), 60) || '"'$q$,
  $q$auto-accepted: ' || coalesce(public.business_safe_request_summary(request_id_param), 'a new request')$q$);
select pg_temp._patch('_accept_business_offer_internal',
  $q$accepted your offer on "' || left(v_request.raw_text, 60) || '"'$q$,
  $q$accepted your offer: ' || coalesce(public.business_safe_request_summary(v_request.id), 'a request')$q$);

-- 2. reminder lead time is the real one
select pg_temp._patch('send_gathering_reminders',
  $q$starts in about 2 hours.'$q$,
  $q$starts ' || case
              when g.scheduled_at - now() < interval '50 minutes'
                then 'in about ' || greatest(5, (round(extract(epoch from g.scheduled_at - now()) / 300) * 5)::int) || ' minutes'
              when g.scheduled_at - now() < interval '90 minutes' then 'in about an hour'
              else 'in about 2 hours'
            end || '.'$q$);

-- 3. host push says what happened; approval says "request"
select pg_temp._patch('notify_gathering_interest',
  $q$'title', 'New interest in your gathering',$q$,
  $q$'title', case new.status
                     when 'approved' then 'Someone joined your gathering'
                     when 'waitlisted' then 'Someone joined your waitlist'
                     else 'New request to join your gathering' end,$q$);
select pg_temp._patch('notify_gathering_interest',
  $q$interested_user_name || ' is interested in "' || gathering_title || '"'$q$,
  $q$interested_user_name || case new.status
                     when 'approved' then ' joined "'
                     when 'waitlisted' then ' joined the waitlist for "'
                     else ' asked to join "' end || gathering_title || '"'$q$);
select pg_temp._patch('notify_gathering_approved',
  $q$approved your interest. Start chatting!$q$,
  $q$approved your request. Start chatting!$q$);

-- 4. name the real interest
select pg_temp._patch('notify_matching_things_to_do',
  $q$'" (' || new.interest_tag || ') is happening ' || v_when_phrase || ' and matches your interests.'$q$,
  $q$'" is happening ' || v_when_phrase || ' and you like ' || new.interest_tag || '.'$q$);
select pg_temp._patch('notify_gathering_interest_threshold',
  $q$' — and it matches your interests.'$q$,
  $q$' — and you like ' || v_gathering.interest_tag || '.'$q$);
select pg_temp._patch('notify_matching_business_availability',
  $q$p.notify_nearby_opportunities_time_pref
    from profiles p$q$,
  $q$p.notify_nearby_opportunities_time_pref,
           coalesce(
             case when new.category is not null and p.interests @> array[new.category] then new.category end,
             case when v_partner.subcategory is not null and p.interests @> array[v_partner.subcategory] then v_partner.subcategory end,
             (select c from unnest(coalesce(v_partner.categories, array[]::text[])) c where p.interests @> array[c] limit 1)
           ) as matched_tag
    from profiles p$q$);
select pg_temp._patch('notify_matching_business_availability',
  $q$'" matches your interests.'$q$,
  $q$'" is nearby, and you like ' || coalesce(v_candidate.matched_tag, 'this kind of thing') || '.'$q$);

-- 5. the count is signups (attendees + requests), not "interested"
select pg_temp._patch('notify_gathering_interest_threshold',
  $q$' people are interested in "'$q$,
  $q$' people have signed up for "'$q$);
select pg_temp._patch('notify_gathering_interest_threshold',
  $q$'" (' || v_gathering.interest_tag || '), happening '$q$,
  $q$'", happening '$q$);
