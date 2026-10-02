-- Item 140. Rolled back: approving a join request (and a waitlist promotion) queues the push with gathering_id, so the
-- app opens the plan; match_id is still carried; the copy no longer promises a chat; mutes unchanged.
begin;
do $$
declare
  v_host uuid; v_guest uuid; v_g uuid; v_row uuid; v_out record;
begin
  select id into v_host from profiles order by created_at limit 1;
  select id into v_guest from profiles where id <> v_host order by created_at limit 1;
  update profiles set notify_planning = true where id = v_guest;
  insert into gatherings (host_id, title, area, interest_tag, scheduled_at, visibility)
    values (v_host, 'Item 140 coffee', 'Test area', 'Coffee', now() + interval '2 days', 'everyone') returning id into v_g;

  -- pending -> approved
  insert into gathering_interest (gathering_id, user_id, status) values (v_g, v_guest, 'pending') returning id into v_row;
  update gathering_interest set status = 'approved' where id = v_row;
  select * into v_out from push_outbox where recipient_id = v_guest and data->>'type' = 'gathering_approved' order by created_at desc limit 1;
  assert v_out.id is not null, 'approval push queued';
  assert v_out.data->>'gathering_id' = v_g::text, 'carries gathering_id';
  assert v_out.data ? 'match_id', 'still carries match_id for older app versions';
  assert v_out.title = 'You''re approved!';
  assert v_out.body = 'The host of "Item 140 coffee" approved your request. You''re in.', v_out.body;

  -- waitlisted -> approved (a spot opened up)
  delete from push_outbox where recipient_id = v_guest and data->>'type' = 'gathering_approved';
  update gathering_interest set status = 'waitlisted' where id = v_row;
  update gathering_interest set status = 'approved' where id = v_row;
  select * into v_out from push_outbox where recipient_id = v_guest and data->>'type' = 'gathering_approved' order by created_at desc limit 1;
  assert v_out.title = 'A spot opened up!';
  assert v_out.body = 'A spot opened up in "Item 140 coffee" and you''re in.', v_out.body;
  assert v_out.data->>'gathering_id' = v_g::text;

  -- the mute still applies
  delete from push_outbox where recipient_id = v_guest and data->>'type' = 'gathering_approved';
  update profiles set notify_planning = false where id = v_guest;
  update gathering_interest set status = 'pending' where id = v_row;
  update gathering_interest set status = 'approved' where id = v_row;
  assert not exists (select 1 from push_outbox where recipient_id = v_guest and data->>'type' = 'gathering_approved'), 'muted';

  assert (select count(*) from pg_proc where proname = 'notify_gathering_approved' and pronamespace = 'public'::regnamespace) = 1;
  raise notice 'gathering-approved-opens-plan ALL OK';
end $$;
rollback;
