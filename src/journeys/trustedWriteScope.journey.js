// Trusted-write flag scope (migration 20270359; staged after 20270358, run with 0348-0359 as JOURNEY_PRELUDE_FILE until
// live). `app.trusted_update` lets a trusted server function write guarded columns (is_premium, is_admin, verification,
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

function as(step, sub, stmt, value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
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
const powers = (v) => `(select jsonb_build_object('premium', coalesce(is_premium, false), 'admin', coalesce(is_admin, false)) from profiles where id = ${v})`;

d('journey: trusted-write flag lasts only as long as the function that set it', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_a', 'v_b'])}
      v_out jsonb; v_hint text;`, `
  ${actorsSql({ people: ['v_a', 'v_b'] })}
  update profiles set is_premium = false, is_admin = false where id in (v_a, v_b);
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
});
