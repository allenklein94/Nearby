// Trusted-write flag scope (migrations 20270359 + 20270360; staged after 20270358, run with 0348-0360 as
// JOURNEY_PRELUDE_FILE until live). 20270360: the flag counts only inside a server function, so a client role that forges it
// (set_config as authenticated / anon) still cannot write a guarded column. `app.trusted_update` lets a trusted server function write guarded columns (is_premium, is_admin, verification,
// daily counters). Before 20270359 the functions that set it left it on for the rest of the transaction, so a LATER
// statement inherited it: after a gathering insert (enforce_gathering_daily_limit) the person's own profile update could
// set is_premium / is_admin. Now each such function saves the caller's value on entry and puts it back right after its
// trusted write: trust ends with that write, and a trusted caller gets its own value back. A failed statement undoes the
// flag with its (sub)transaction.
// Every step runs in ONE rolled-back transaction, so the flag would leak between steps exactly as within one request.
// Not covered: every one of the 24 functions run individually (the catalog step checks each body for the save + restore,
// the same test as 20270359's DO block).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`, role = 'authenticated') {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', '${role}')::text, true);
  set local role ${role};
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;
const flag = `coalesce(current_setting('app.trusted_update', true), '')`;
const gathering = (v, title) => `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility) values (${v}, '${title}', now() + interval '2 days', 10.02, -10.03, 'Pickleball', 'j', 'everyone')`;
const selfGrant = (v) => `update profiles set is_premium = true, is_admin = true where id = ${v}`;
const forge = `perform set_config('app.trusted_update', 'true', true)`;
const powers = (v) => `(select jsonb_build_object('premium', coalesce(is_premium, false), 'admin', coalesce(is_admin, false)) from profiles where id = ${v})`;

d('journey: trusted-write flag lasts only as long as the function that set it, and a client cannot forge it', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_a', 'v_b', 'v_c', 'v_admin', 'v_new'])}
      v_out jsonb; v_hint text; v_comm uuid;`, `
  ${actorsSql({ people: ['v_a', 'v_b', 'v_c', 'v_admin'], friends: [['v_a', 'v_c']] })}
  update profiles set is_premium = false, is_admin = false where id in (v_a, v_b, v_c);
  update profiles set is_admin = true where id = v_admin;
  insert into auth.users (id, aud, role, email, created_at) values (v_new, 'authenticated', 'authenticated', v_new || '@journey.invalid', now());
  perform set_config('app.trusted_update', 'false', true);
  ${rec('unscoped_functions', `(select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]'::jsonb) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and ((p.prosrc ~ 'set_config\\(\\s*''app\\.trusted_update''\\s*,\\s*''true'''
              and (p.prosrc !~ 'v_caller_trusted text := current_setting\\(''app\\.trusted_update'', true\\)'
                   or p.prosrc !~ 'set_config\\(''app\\.trusted_update'', coalesce\\(v_caller_trusted, ''false''\\), true\\)'))
          or (p.prosrc ~ 'set_config\\(\\s*''app\\.trusted_update''\\s*,\\s*''false'''
              and p.oid <> 'public._rate_limit_commercial_post()'::regprocedure)))`)}

  -- a gathering insert fires the daily-limit trigger (a trusted counter write) ...
  ${as('create_gathering', 'v_a', gathering('v_a', 'Scope test'))}
  ${rec('flag_after_gathering', flag)}
  ${rec('counter_written', `(select gatherings_created_today from profiles where id = v_a)`)}
  -- ... and the person's next statement in the same transaction must not inherit it
  ${as('self_grant_after_gathering', 'v_a', selfGrant('v_a'))}
  ${rec('powers_after_gathering', powers('v_a'))}

  -- same after an RPC that sets the flag (spend_bonus_notice)
  update profiles set bonus_notices = 1 where id = v_b;
  ${as('spend_notice', 'v_b', `v_out := to_jsonb(spend_bonus_notice())`, 'v_out')}
  ${rec('flag_after_rpc', flag)}
  ${as('self_grant_after_rpc', 'v_b', selfGrant('v_b'))}
  ${rec('powers_after_rpc', powers('v_b'))}

  -- a trusted caller keeps its own scope after a nested trusted function returns
  perform set_config('app.trusted_update', 'true', true);
  ${gathering('v_b', 'Nested scope')};
  ${rec('caller_scope_kept', flag)}
  perform set_config('app.trusted_update', 'false', true);

  -- a statement that fails while the flag is on never leaves it on
  begin
    perform set_config('app.trusted_update', 'true', true);
    raise exception 'fail while trusted';
  exception when others then null;
  end;
  ${rec('flag_after_failure', flag)}

  -- 20270360: a FORGED flag (set by the client role itself) never unlocks a guarded column
  ${as('forge_self_grant', 'v_c', `${forge}; ${selfGrant('v_c')}`)}
  perform set_config('app.trusted_update', 'false', true);
  ${rec('powers_after_forge', powers('v_c'))}
  ${as('forge_bonus', 'v_c', `${forge}; update profiles set bonus_notices = 50, managed_partner_id = gen_random_uuid() where id = v_c`)}
  perform set_config('app.trusted_update', 'false', true);
  ${rec('bonus_after_forge', `(select jsonb_build_object('bonus', coalesce(bonus_notices, 0), 'partner', managed_partner_id) from profiles where id = v_c)`)}
  ${as('forge_verified_unsuspend', 'v_c', `${forge}; update profiles set id_verified = true, id_verified_at = now() where id = v_c`)}
  perform set_config('app.trusted_update', 'false', true);
  ${rec('verified_after_forge', `(select coalesce(id_verified, false) from profiles where id = v_c)`)}
  ${as('forge_friendship', 'v_c', `${forge}; update friendships set user_b = v_b, requested_by = v_c where (user_a = v_a and user_b = v_c) or (user_a = v_c and user_b = v_a)`)}
  perform set_config('app.trusted_update', 'false', true);
  ${rec('friendship_after_forge', `(select count(*) from friendships where (user_a = v_a and user_b = v_c) or (user_a = v_c and user_b = v_a))`)}
  ${as('make_community', 'v_c', `insert into communities (creator_id, name) values (v_c, 'Forge community') returning id into v_comm`)}
  ${as('forge_community_status', 'v_c', `${forge}; update communities set status = 'cancelled' where id = v_comm`)}
  perform set_config('app.trusted_update', 'false', true);
  ${rec('community_status_after_forge', `(select status from communities where id = v_comm)`)}
  -- a brand-new account inserting its own profile with powers, flag forged
  ${as('forge_profile_insert', 'v_new', `${forge}; insert into profiles (id, display_name, birthdate, terms_accepted_at, is_admin, is_premium) values (v_new, 'New', date '1990-01-01', now(), true, true)`)}
  perform set_config('app.trusted_update', 'false', true);
  ${rec('new_profile_powers', `(select coalesce(jsonb_build_object('premium', coalesce(is_premium, false), 'admin', coalesce(is_admin, false)), '"no row"'::jsonb) from profiles where id = v_new)`)}
  update profiles set is_premium = false, is_admin = false, suspended_at = null where id = v_c; -- each check starts from no powers
  -- anon with a forged flag
  ${as('anon_forge', 'null', `${forge}; update profiles set is_admin = true where id = v_c`, `'ok'::text`, 'anon')}
  perform set_config('app.trusted_update', 'false', true);
  ${rec('powers_after_anon', powers('v_c'))}
  update profiles set is_premium = false, is_admin = false, suspended_at = null where id = v_c; -- each check starts from no powers
  -- a failed operation that turned trust on (daily-limit trigger runs, then the insert fails), then a self-grant
  ${as('failed_gathering', 'v_c', `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility) values (v_c, null, now() + interval '2 days', 10.02, -10.03, 'Pickleball', 'j', 'everyone')`)}
  ${rec('flag_after_failed_op', flag)}
  ${as('self_grant_after_failure', 'v_c', selfGrant('v_c'))}
  ${rec('powers_after_failure', powers('v_c'))}

  -- legitimate trusted writes still work under 20270360
  ${rec('bonus_after_spend', `(select coalesce(bonus_notices, 0) from profiles where id = v_b)`)}
  ${as('admin_suspends', 'v_admin', `perform admin_suspend_user(v_c, 'journey: trusted write still works', null, false)`)}
  ${rec('suspended_by_admin', `(select suspended_at is not null from profiles where id = v_c)`)}
  ${as('admin_reinstates', 'v_admin', `perform admin_reinstate_user(v_c, 'journey: reinstate')`)}
  ${rec('reinstated_by_admin', `(select suspended_at is null from profiles where id = v_c)`)}
  ${as('pause_own_community', 'v_c', `perform pause_community(v_comm)`)}
  ${rec('community_paused', `(select status from communities where id = v_comm)`)}
  ${rec('forgeable_guards', `(select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]'::jsonb) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosrc ~ 'current_setting\\(''app\\.trusted_update'', true\\), ''''\\) <> ''true'''
        and (p.prosecdef or p.prosrc !~ 'current_user in \\(''anon'', ''authenticated''\\)'))`)}
`);
    s = stepMap(log);
  }, 120000);

  const data = (k) => s[k].data;

  test('every function that turns the flag on saves and restores the caller\'s value', () => {
    expect(data('unscoped_functions')).toEqual([]);
  });

  test('after a gathering insert the flag is off again and a self-grant of premium / admin does nothing', () => {
    expect(data('create_gathering')).toBe('ok');
    expect(data('counter_written')).toBe(1); // the trusted write itself still works
    expect(data('flag_after_gathering')).not.toBe('true');
    expect(data('powers_after_gathering')).toEqual({ premium: false, admin: false });
  });

  test('after a trusted RPC the flag is off again and a self-grant does nothing', () => {
    expect(data('spend_notice')).toBe(true);
    expect(data('flag_after_rpc')).not.toBe('true');
    expect(data('powers_after_rpc')).toEqual({ premium: false, admin: false });
  });

  test('a trusted caller gets its own value back after a nested trusted function', () => {
    expect(data('caller_scope_kept')).toBe('true');
  });

  test('a failure while the flag is on leaves it as it was before', () => {
    expect(data('flag_after_failure')).toBe('false');
  });

  test('20270360: no guard trusts the flag for a client role', () => {
    expect(data('forgeable_guards')).toEqual([]);
  });

  test('20270360: a client that forges the flag cannot give itself admin, premium, bonus, a business or ID verification', () => {
    expect(data('powers_after_forge')).toEqual({ premium: false, admin: false });
    expect(data('bonus_after_forge')).toEqual({ bonus: 0, partner: null });
    expect(data('verified_after_forge')).toBe(false);
  });

  test('20270360: a forged flag does not let a client rewrite a friendship or a community status', () => {
    expect(data('friendship_after_forge')).toBe(1);
    expect(data('make_community')).toBe('ok');
    expect(data('community_status_after_forge')).toBe('active');
  });

  test('20270360: a new account cannot insert its own profile with powers, even with a forged flag', () => {
    const r = data('forge_profile_insert');
    if (r === 'ok') expect(data('new_profile_powers')).toEqual({ premium: false, admin: false });
    else expect(r.error).toBeTruthy();
  });

  test('anon with a forged flag changes nothing', () => {
    expect(data('powers_after_anon')).toEqual({ premium: false, admin: false });
  });

  test('after a failed operation that turned trust on, a self-grant does nothing', () => {
    expect(data('failed_gathering').error).toBeTruthy();
    expect(data('flag_after_failed_op')).not.toBe('true');
    expect(data('powers_after_failure')).toEqual({ premium: false, admin: false });
  });

  test('legitimate trusted writes still work: counters, admin suspend / reinstate, owner pause', () => {
    expect(data('bonus_after_spend')).toBe(0);
    expect(data('admin_suspends')).toBe('ok');
    expect(data('suspended_by_admin')).toBe(true);
    expect(data('reinstated_by_admin')).toBe(true);
    expect(data('pause_own_community')).toBe('ok');
    expect(data('community_paused')).toBe('paused');
  });
});
