// Journey #23 (owner item 57): a friend sends a gathering invitation -> the invitee receives it -> the event date
// passes -> the invitee opens it -> sees the expired state -> cannot accept -> can still see the historical invitation.
// Rolled back. The date "passing" is simulated by moving the gathering into the past inside the transaction (the
// server compares against now()); the real UI is not driven, the client rules are asserted on the rows the DB produced.
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { inviteLifecycleState, canDo, lifecycleClass } from '../utils/objectLifecycle';
import { isInviteExpired, expiredInviteLabel } from '../utils/inviteExpiry';

const d = hasToken ? describe : describe.skip;

d('journey: invitation is sent, the event passes, the invitation reads as expired and stays viewable', () => {
  let s;
  beforeAll(async () => {
    const [f] = await runSql(`select user_a, user_b from friendships where status = 'accepted' limit 1;`);
    const log = await runJourney(`
      v_a uuid := '${f.user_a}'; v_b uuid := '${f.user_b}'; v_g uuid; v_inv uuid; v_msg text; v_n int; v_st text; v_row record;`, `
  -- 1. the inviter hosts an upcoming gathering
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_a, 'Journey invite night', now() + interval '2 days', 40.0, -75.0, 'Coffee', 'journey', 8, 'everyone') returning id into v_g;
  -- 2. and invites their friend
  perform send_social_invite('gathering', v_g, v_b);
  select id into v_inv from social_invites where inviter_id = v_a and invitee_id = v_b and target_id = v_g;
  log := log || jsonb_build_array(jsonb_build_object('step','invite_sent','ok', v_inv is not null));

  -- 3. the invitee receives it (read under RLS as the invitee)
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from social_invites where id = v_inv and status = 'pending';
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','invitee_receives','ok', v_n = 1));

  -- 4. the event date passes
  update gatherings set scheduled_at = now() - interval '1 day' where id = v_g;

  -- 5. the invitee opens the invitation: it and its gathering are still readable
  set local role authenticated;
  select i.status as status, g.title, g.scheduled_at into v_row from social_invites i join gatherings g on g.id = i.target_id where i.id = v_inv;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','invitee_opens_after_event','ok', v_row.title = 'Journey invite night',
     'data', jsonb_build_object('status', v_row.status, 'scheduled_at', v_row.scheduled_at)));

  -- 6. accepting is refused with the expiry message
  begin perform respond_to_social_invite(v_inv, true); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  select status into v_st from social_invites where id = v_inv;
  log := log || jsonb_build_array(jsonb_build_object('step','accept_refused','ok', v_msg ilike '%expired%' and v_st = 'pending',
     'data', jsonb_build_object('message', v_msg, 'status_after', v_st)));

  -- 7. dismissing records 'expired' (never 'declined') and the row stays readable as history
  perform respond_to_social_invite(v_inv, false);
  set local role authenticated;
  select status into v_st from social_invites where id = v_inv;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','dismiss_records_expired_and_history_remains','ok', v_st = 'expired', 'data', jsonb_build_object('status', v_st)));

  -- 8. the inviter is not told the friend "declined"
  select count(*) into v_n from social_invites where id = v_inv and status = 'declined';
  log := log || jsonb_build_array(jsonb_build_object('step','never_recorded_as_declined','ok', v_n = 0));
`);
    s = stepMap(log);
  }, 60000);

  test.each([
    'invite_sent', 'invitee_receives', 'invitee_opens_after_event', 'accept_refused',
    'dismiss_records_expired_and_history_remains', 'never_recorded_as_declined',
  ])('step %s', (name) => {
    expect(s[name]).toBeDefined();
    expect(s[name].ok).toBe(true);
  });

  test('the client reads the same rows as expired: no Accept, still viewable', () => {
    const invite = { inviteType: 'gathering', status: 'pending', scheduledAt: s.invitee_opens_after_event.data.scheduled_at };
    expect(isInviteExpired(invite)).toBe(true);
    expect(inviteLifecycleState(invite)).toBe('expired');
    expect(canDo('invite', 'expired', 'accept')).toBe(false);
    expect(lifecycleClass('invite', 'expired')).toBe('expired');
    expect(expiredInviteLabel(invite)).toBeTruthy(); // the historical row says what it was, not just "expired"
    const stored = { ...invite, status: s.dismiss_records_expired_and_history_remains.data.status };
    expect(inviteLifecycleState(stored)).toBe('expired');
  });
});
