// Gathering ratings are private to their writer (migration 20270408, owner 2026-11-09; staged, run with it as JOURNEY_PRELUDE_FILE until live).
// Every step runs as an ordinary signed-in person, or signed out, under the real client role, in ONE rolled-back transaction.
// Not covered: the real HTTP API (`scripts/replay/gathering-feedback-api-local.js` runs Build 87's query shapes through PostgREST,
// `src/qa/gatheringFeedbackPrivacy.live.js` is the post-deploy check on production) and the phone.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, journeyOwner } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;
const owner = journeyOwner();

function as(step, sub, stmt, role = 'authenticated') {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', '${role}')::text, true);
  execute 'set local role ${role}';
  begin ${stmt};
  exception when others then
    get stacked diagnostics v_hint = returned_sqlstate;
    v_out := jsonb_build_object('error', v_hint);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rows = (filter = 'true') => `select count(*)::int into v_n from gathering_feedback where ${filter}; v_out := to_jsonb(v_n)`;
const gathering = (host, title, extra = '', extraVal = '') => `insert into gatherings (host_id, title, scheduled_at, duration_minutes, precise_lat, precise_lng, interest_tag, area, visibility, is_public${extra})
    values (${host}, '${title}', now() - interval '3 hours', 60, 10.02, -10.03, 'Pickleball', 'j', 'everyone', true${extraVal})`;

d('journey: gathering ratings are private to their writer', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_host', 'v_rater', 'v_other', 'v_stranger'])}
      v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}';
      v_out jsonb; v_hint text; v_n int; v_g uuid; v_bg uuid;`, `
  ${actorsSql({ people: ['v_owner', 'v_host', 'v_rater', 'v_other', 'v_stranger'], business: { owner: 'v_owner', partner: 'v_partner' } })}
  ${gathering('v_host', 'Over')} returning id into v_g;
  ${gathering('v_owner', 'Business hosted', ', hosting_partner_id', ', v_partner')} returning id into v_bg;
  insert into gathering_interest (gathering_id, user_id, status) values
    (v_g, v_rater, 'approved'), (v_g, v_other, 'approved'), (v_bg, v_rater, 'approved');

  ${as('rater_writes_own', 'v_rater', `insert into gathering_feedback (gathering_id, reviewer_id, satisfaction_rating, great_because, felt_welcoming) values (v_g, v_rater, 'loved_it', array['people'], true); insert into gathering_feedback (gathering_id, reviewer_id, satisfaction_rating) values (v_bg, v_rater, 'not_for_me'); v_out := to_jsonb('ok'::text)`)}
  ${as('other_writes_own', 'v_other', `insert into gathering_feedback (gathering_id, reviewer_id, satisfaction_rating) values (v_g, v_other, 'good'); v_out := to_jsonb('ok'::text)`)}
  ${as('forge_for_someone_else', 'v_stranger', `insert into gathering_feedback (gathering_id, reviewer_id, satisfaction_rating) values (v_g, v_rater, 'loved_it'); v_out := to_jsonb('ok'::text)`)}

  ${as('rater_reads_all', 'v_rater', rows())}
  ${as('rater_reads_other', 'v_rater', rows('reviewer_id = v_other'))}
  ${as('other_reads_rater', 'v_other', rows('reviewer_id = v_rater'))}
  ${as('stranger_reads', 'v_stranger', rows())}
  ${as('stranger_by_gathering', 'v_stranger', rows('gathering_id = v_g'))}
  ${as('stranger_by_tag', 'v_stranger', rows(`great_because @> array['people']`))}
  ${as('host_reads', 'v_host', rows('gathering_id = v_g'))}
  ${as('business_owner_reads', 'v_owner', rows('gathering_id = v_bg'))}
  ${as('stranger_changes_rating', 'v_stranger', `update gathering_feedback set satisfaction_rating = 'okay' where reviewer_id = v_rater; get diagnostics v_n = row_count; v_out := to_jsonb(v_n)`)}
  ${as('stranger_deletes_rating', 'v_stranger', `delete from gathering_feedback where reviewer_id = v_rater; get diagnostics v_n = row_count; v_out := to_jsonb(v_n)`)}
  ${as('anon_reads', 'null', rows(), 'anon')}

  ${as('private_word_rater', 'v_rater', `select jsonb_build_object('loved_host', v_host = any(t.loved_host_ids), 'not_for_me_partner', v_partner = any(t.not_for_me_partner_ids)) into v_out from get_my_experience_feedback() t`)}
  ${as('plans_this_month_rater', 'v_rater', `select count(*)::int into v_n from get_my_plans_this_month(now() - interval '1 day', now() + interval '1 day'); v_out := to_jsonb(v_n)`)}
  ${as('private_word_stranger', 'v_stranger', `select jsonb_build_object('loved_host', v_host = any(t.loved_host_ids), 'not_for_me_partner', v_partner = any(t.not_for_me_partner_ids)) into v_out from get_my_experience_feedback() t`)}

  log := log || jsonb_build_array(jsonb_build_object('step', 'all_rows_kept', 'ok', true, 'data', (select count(*) from gathering_feedback where gathering_id in (v_g, v_bg))));
  log := log || jsonb_build_array(jsonb_build_object('step', 'catalog', 'ok', true, 'data', jsonb_build_object(
    'policies', (select jsonb_agg(polname order by polname) from pg_policy where polrelid = 'public.gathering_feedback'::regclass and polcmd = 'r'),
    'open', exists (select 1 from pg_policy where polrelid = 'public.gathering_feedback'::regclass and polcmd = 'r' and pg_get_expr(polqual, polrelid) = 'true'),
    'rls', (select relrowsecurity from pg_class where oid = 'public.gathering_feedback'::regclass),
    'anon_select', has_table_privilege('anon', 'public.gathering_feedback', 'select'),
    'service_role_select', has_table_privilege('service_role', 'public.gathering_feedback', 'select'))));
`);
    s = stepMap(log);
  }, 120000);

  const data = (n) => s[n].data;

  it('a person can still write their own rating, and never someone else\'s', () => {
    expect(data('rater_writes_own')).toBe('ok');
    expect(data('other_writes_own')).toBe('ok');
    expect(data('forge_for_someone_else').error).toBe('42501');
  });

  it('a person reads their own ratings and nobody else\'s', () => {
    expect(data('rater_reads_all')).toBe(2);
    expect(data('rater_reads_other')).toBe(0);
    expect(data('other_reads_rater')).toBe(0);
  });

  it('strangers read nothing, by any filter', () => {
    expect(data('stranger_reads')).toBe(0);
    expect(data('stranger_by_gathering')).toBe(0);
    expect(data('stranger_by_tag')).toBe(0);
  });

  it('a host or business owner reads no individual rating of their own gathering', () => {
    expect(data('host_reads')).toBe(0);
    expect(data('business_owner_reads')).toBe(0);
  });

  it('a signed-out caller has no access to the table', () => {
    expect(data('anon_reads').error).toBe('42501');
  });

  it('nobody can change or delete another person\'s rating', () => {
    expect(data('stranger_changes_rating')).toBe(0);
    expect(data('stranger_deletes_rating')).toBe(0);
    expect(data('all_rows_kept')).toBe(3);
  });

  it('private ranking and the plans count still read the person\'s own feedback, and only theirs', () => {
    expect(data('private_word_rater')).toEqual({ loved_host: true, not_for_me_partner: true });
    expect(data('plans_this_month_rater')).toBeGreaterThan(0);
    expect(data('private_word_stranger')).toEqual({ loved_host: false, not_for_me_partner: false });
  });

  it('the open policy is gone; row security stays on; server-side access is unchanged', () => {
    expect(data('catalog')).toEqual({ policies: ['People can read their own feedback'], open: false, rls: true, anon_select: false, service_role_select: true });
  });
});
