// The same public text on several accounts (20270378, owner 2026-11-01, idea 4 gap 1). Staged after 20270377: run with
// 0348-0378 as JOURNEY_PRELUDE_FILE until live. Story: people write their profile bio and their public gatherings'
// descriptions the way the app does (client writes under the real role). Off = nothing stored. On (the owner's proposed
// 5 accounts / 30 days): four accounts with one bio open nothing, a fifth does; case, punctuation and spacing don't make a
// different text; short, few-word and listed template texts are never recorded; one host's recurring gatherings are one
// account; friends-only and held-for-review gatherings are never read; the same group's bio and gathering description are ONE case; a closed
// case only notes new accounts; nothing restricts or notifies anyone; the text itself is stored nowhere; clients reach none of it.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`, role = 'authenticated') {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', '${role}')::text, true);
  set local role ${role};
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint, 'state', sqlstate);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;

// long, specific texts (>= 80 normalized characters, >= 12 distinct words)
const BIO = 'Weekend paddleboarder and amateur baker looking for new friends around Lake Worth who enjoy sunrise walks and farmers markets';
const BIO_VARIANT = '  weekend PADDLEBOARDER, and amateur baker... looking for new friends around Lake Worth -- who enjoy sunrise walks AND farmers markets!!';
const DESC = 'Bring your own board and meet at the north end of the beach, we paddle for an hour and then share coffee and pastries together';
const DESC2 = 'Casual chess evening for every level, boards provided, we rotate partners every half hour and finish with a short puzzle challenge';
const DESC3 = 'Community garden workday, gloves and seedlings provided, we weed the raised beds, water the herbs and swap cuttings afterwards';
const RECUR = 'Weekly sunset run along the intracoastal path, three easy miles at a conversational pace, all speeds welcome and nobody is left behind';
const TEMPLATE = 'Hi there, I am new to Nearby and I am looking forward to meeting people with similar interests in my neighbourhood soon';
const SHORT = 'Love coffee, dogs and the beach. Say hi!';
const FEWWORDS = 'fun fun fun fun fun fun fun fun fun fun fun fun fun fun fun fun fun fun fun fun fun fun fun fun fun fun fun';

const bio = (step, v, text) => as(step, v, `update profiles set bio = ${text === null ? 'null' : `'${text}'`} where id = ${v}`);
const gathering = (step, v, text, visibility = 'everyone', days = 3) => as(step, v,
  `insert into gatherings (host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
   values (${v}, 'Journey shared text', '${text}', now() + interval '${days} days', 26.59, -80.03, 'Coffee', 'x', '${visibility}')`);
const keyOf = (t) => `private.shared_text_key('${t}')`;
const caseOf = (t) => `(select ct.case_id from private.account_review_case_texts ct where ct.text_key = ${keyOf(t)})`;
const caseInfo = (t) => `(select jsonb_build_object('signal', c.signal, 'reason', c.reason, 'status', c.status,
    'members', (select count(*) from private.account_review_case_members m where m.case_id = c.id),
    'evidence', c.evidence) from private.account_review_cases c where c.id = ${caseOf(t)})`;
const sightings = (t) => `(select count(*) from private.text_sightings where text_key = ${keyOf(t)})`;

const PEOPLE = ['v_admin', 'v_o', 'v_a1', 'v_a2', 'v_a3', 'v_a4', 'v_a5', 'v_a6', 'v_a7', 'v_h1', 'v_h2', 'v_h3', 'v_h4', 'v_h5',
  'v_r', 'v_t1', 'v_t2', 'v_t3', 'v_t4', 'v_t5', 'v_f1', 'v_f2', 'v_f3', 'v_f4', 'v_f5', 'v_old', 'v_del'];
const A5 = ['v_a1', 'v_a2', 'v_a3', 'v_a4', 'v_a5'];
const H5 = ['v_h1', 'v_h2', 'v_h3', 'v_h4', 'v_h5'];
const T5 = ['v_t1', 'v_t2', 'v_t3', 'v_t4', 'v_t5'];
const F5 = ['v_f1', 'v_f2', 'v_f3', 'v_f4', 'v_f5'];

d('journey: the same public text on several accounts (20270378)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_out jsonb; v_hint text; v_case uuid; v_gid uuid; v_excl boolean;`, `
  ${actorsSql({ people: PEOPLE })}
  update profiles set is_admin = true where id = v_admin;
  update private.account_signal_settings set shared_text_min_accounts = null;
  delete from private.text_sightings; delete from private.shared_text_excluded_keys; delete from private.text_signal_failures;

  -- ===== off: nothing stored, nothing compared; saving works as before =====
  ${bio('off_bio', 'v_o', BIO)}
  ${rec('off', `jsonb_build_object('sightings', (select count(*) from private.text_sightings), 'key', ${keyOf(BIO)} is null)`)}

  -- ===== on, with the owner's proposed number (an initial testing assumption) =====
  update private.account_signal_settings set shared_text_min_accounts = 5;
  ${rec('key', `jsonb_build_object('bytes', length(${keyOf(BIO)}), 'variant_same', ${keyOf(BIO)} = ${keyOf(BIO_VARIANT)},
      'differs', ${keyOf(BIO)} <> ${keyOf(DESC)},
      'not_plain_sha256', ${keyOf(BIO)} <> extensions.digest(private.shared_text_normalized('${BIO}'), 'sha256')
                      and ${keyOf(BIO)} <> extensions.digest('public-text:v1:' || private.shared_text_normalized('${BIO}'), 'sha256'),
      'short_none', ${keyOf(SHORT)} is null, 'few_words_none', ${keyOf(FEWWORDS)} is null, 'blank_none', private.shared_text_key('  ') is null)`)}
  ${rec('limits', `(select jsonb_build_object('chars', shared_text_min_chars, 'words', shared_text_min_words) from private.account_signal_settings)`)}

  -- four accounts with one bio: nothing; the fifth: a many-accounts case
  ${A5.slice(0, 4).map((v, i) => bio(`a${i + 1}_bio`, v, BIO)).join('\n')}
  ${rec('four_accounts', `jsonb_build_object('sightings', ${sightings(BIO)}, 'case', ${caseOf(BIO)} is not null)`)}
  ${bio('a5_bio', 'v_a5', BIO)}
  ${rec('five_accounts', caseInfo(BIO))}
  -- a sixth writes it with different case, punctuation and spacing: the same text
  ${bio('a6_bio', 'v_a6', BIO_VARIANT)}
  ${rec('variant_joins', `jsonb_build_object('case', ${caseInfo(BIO)}, 'cases', (select count(*) from private.account_review_cases where signal = 'shared_text'))`)}
  -- saving the profile again without touching the bio, or re-saving the same bio, adds nothing
  ${as('a1_other_edit', 'v_a1', `update profiles set display_name = display_name where id = v_a1`)}
  ${bio('a1_bio_off', 'v_a1', 'Something else entirely about tide pools, sea turtles, kayaks and the new library downtown on Saturdays')}
  ${bio('a1_bio_back', 'v_a1', BIO)}
  ${rec('a1_again', `jsonb_build_object('sightings', ${sightings(BIO)}, 'members', (select count(*) from private.account_review_case_members where case_id = ${caseOf(BIO)}),
      'events', (select jsonb_agg(e.kind order by e.id) from private.account_review_case_events e where e.case_id = ${caseOf(BIO)}))`)}

  -- ===== generic text is never recorded: short, few distinct words, a listed template =====
  ${F5.map((v, i) => bio(`f${i + 1}_short`, v, SHORT)).join('\n')}
  ${F5.map((v, i) => as(`f${i + 1}_few`, v, `update profiles set bio = '${FEWWORDS}' where id = ${v}`)).join('\n')}
  ${rec('generic', `jsonb_build_object('sightings', (select count(*) from private.text_sightings where user_id in (${F5.join(', ')})),
      'cases', (select count(*) from private.account_review_cases where signal = 'shared_text'))`)}
  v_excl := private.exclude_shared_text('${TEMPLATE}');
  ${T5.map((v, i) => bio(`t${i + 1}_template`, v, TEMPLATE)).join('\n')}
  ${rec('template', `jsonb_build_object('excluded', v_excl, 'sightings', (select count(*) from private.text_sightings where user_id in (${T5.join(', ')})),
      'cases', (select count(*) from private.account_review_cases where signal = 'shared_text'), 'key', ${keyOf(TEMPLATE)} is null)`)}

  -- ===== gatherings: one host's recurring gatherings are one account; friends-only is never read =====
  ${[1, 2, 3, 4].map((n) => gathering(`r_g${n}`, 'v_r', RECUR, 'everyone', n + 1)).join('\n')}
  ${rec('one_host', `jsonb_build_object('sightings', ${sightings(RECUR)}, 'case', ${caseOf(RECUR)} is not null)`)}
  ${H5.map((v, i) => gathering(`h${i + 1}_friends`, v, DESC2, 'friends')).join('\n')}
  ${rec('friends_only', `jsonb_build_object('sightings', ${sightings(DESC2)}, 'case', ${caseOf(DESC2)} is not null)`)}
  -- one of them made public (a server write: clients can't change visibility after creation, 20270343): now read
  select id into v_gid from gatherings where host_id = v_h1 and description = '${DESC2}';
  update gatherings set visibility = 'everyone', is_public = true where id = v_gid;
  ${rec('made_public', `jsonb_build_object('sightings', ${sightings(DESC2)}, 'gathering', (select gathering_id = v_gid from private.text_sightings where text_key = ${keyOf(DESC2)}))`)}
  -- a public gathering held for review (20270373) is seen by nobody else: not read until it is approved (server writes)
  insert into gatherings (host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, moderation_state)
  values (v_o, 'Held one', '${DESC3}', now() + interval '4 days', 26.59, -80.03, 'Coffee', 'x', 'everyone', 'held') returning id into v_gid;
  ${rec('held', `${sightings(DESC3)}`)}
  update gatherings set moderation_state = 'visible' where id = v_gid;
  ${rec('approved', `(select count(*) from private.text_sightings where text_key = ${keyOf(DESC3)} and gathering_id = v_gid)`)}
  delete from private.text_sightings where gathering_id = v_gid;
  ${H5.slice(1).map((v, i) => gathering(`h${i + 2}_public`, v, DESC2)).join('\n')}
  ${rec('hosts_case', caseInfo(DESC2))}

  -- ===== the same group (a1-a5) posting one gathering description: joins their bio case, not a second one =====
  ${A5.map((v, i) => gathering(`a${i + 1}_g`, v, DESC)).join('\n')}
  ${rec('cluster', `jsonb_build_object('same_case', ${caseOf(DESC)} = ${caseOf(BIO)}, 'bio_case', ${caseInfo(BIO)},
      'cases', (select count(*) from private.account_review_cases where signal = 'shared_text'))`)}

  -- ===== 30 days: a sighting last posted 31 days ago doesn't count =====
  ${bio('old_bio', 'v_old', DESC3)}
  update private.text_sightings set first_seen = now() - interval '40 days', last_seen = now() - interval '31 days' where user_id = v_old;
  ${F5.slice(0, 4).map((v, i) => bio(`f${i + 1}_win`, v, DESC3)).join('\n')}
  ${rec('window', `jsonb_build_object('sightings', ${sightings(DESC3)}, 'case', ${caseOf(DESC3)} is not null)`)}

  -- ===== a closed case stays closed; a new account with that bio is new evidence =====
  select ${caseOf(BIO)} into v_case;
  ${as('close', 'v_admin', `perform admin_close_account_review_case(v_case, 'no_action', 'A club sharing its standard description')`)}
  ${bio('a7_bio', 'v_a7', BIO)}
  ${rec('closed_new_evidence', `(select jsonb_build_object('status', c.status, 'new_evidence', c.new_evidence_at is not null,
      'after_close', (select after_close from private.account_review_case_members where case_id = c.id and user_id = v_a7),
      'cases', (select count(*) from private.account_review_cases where signal = 'shared_text'),
      'new_evidence_events', (select count(*) from private.account_review_case_events e where e.case_id = c.id and e.kind = 'new_evidence'))
      from private.account_review_cases c where c.id = v_case)`)}

  -- ===== nothing restricts or notifies anyone; flagged accounts keep acting =====
  ${rec('untouched', `(select jsonb_agg(jsonb_build_object('suspended', p.suspended_at is not null, 'hidden', p.profile_hidden,
      'banned', u.banned_until is not null) order by p.id)
      from profiles p join auth.users u on u.id = p.id where p.id in (${[...A5, 'v_a6', 'v_a7', ...H5].join(', ')}))`)}
  ${rec('no_push', `(select count(*) from push_outbox where recipient_id in (${[...A5, 'v_a6', 'v_a7', ...H5, 'v_admin'].join(', ')}))`)}
  ${gathering('a2_still_acts', 'v_a2', 'Shell collecting at low tide', 'everyone', 9)}
  ${rec('bios_kept', `(select count(*) from profiles where id in (${A5.join(', ')}) and bio = '${BIO}')`)}

  -- ===== the text is stored nowhere; the key never appears in a case =====
  ${rec('no_text_stored', `jsonb_build_object(
      'sightings', (select count(*) from private.text_sightings t where to_jsonb(t)::text ilike '%paddleboard%' or to_jsonb(t)::text ilike '%chess%'),
      'cases', (select count(*) from private.account_review_cases c where c.signal = 'shared_text' and (to_jsonb(c)::text ilike '%paddleboard%'
                  or to_jsonb(c)::text ilike '%chess%' or to_jsonb(c)::text like '%' || encode(${keyOf(BIO)}, 'hex') || '%')),
      'events', (select count(*) from private.account_review_case_events e where e.detail::text ilike '%paddleboard%' or e.detail::text ilike '%chess%'),
      'columns', (select jsonb_agg(column_name order by column_name) from information_schema.columns
                   where table_schema = 'private' and table_name = 'text_sightings'))`)}

  -- ===== admins see the cases; nobody else reads or runs anything =====
  ${as('admin_lists', 'v_admin', `v_out := admin_list_account_review_cases(true)`,
    `(select count(*) from jsonb_array_elements(v_out) c where c ->> 'signal' = 'shared_text')`)}
  select ${caseOf(DESC2)} into v_case;
  ${as('admin_reads', 'v_admin', `v_out := admin_get_account_review_case(v_case)`, `v_out ->> 'signal'`)}
  ${as('client_lists', 'v_a1', `perform admin_list_account_review_cases()`)}
  ${as('client_reads_sightings', 'v_a1', `perform count(*) from private.text_sightings`)}
  ${as('client_reads_secret', 'v_a1', `perform secret from private.text_signal_secret`)}
  ${as('client_reads_excluded', 'v_a1', `perform count(*) from private.shared_text_excluded_keys`)}
  ${as('client_key', 'v_a1', `perform private.shared_text_key('x')`)}
  ${as('client_notes', 'v_a1', `perform private.note_text_sighting(v_a1, 'bio', null, 'x')`)}
  ${as('client_evaluates', 'v_a1', `perform private.evaluate_shared_text('\\x00')`)}
  ${as('client_excludes', 'v_a1', `perform private.exclude_shared_text('x')`)}
  ${as('client_backfills', 'v_a1', `perform private.backfill_shared_text_sightings()`)}
  ${as('client_forges', 'v_a1', `insert into private.text_sightings (text_key, user_id, source) values (extensions.gen_random_bytes(32), v_a1, 'bio')`)}
  ${as('anon_reads', 'null', `perform count(*) from private.text_sightings`, `'ok'::text`, 'anon')}

  -- ===== deleting an account deletes its sightings =====
  ${bio('del_bio', 'v_del', DESC2)}
  delete from profiles where id = v_del;
  delete from auth.users where id = v_del;
  ${rec('deleted', `(select count(*) from private.text_sightings where user_id = v_del)`)}

  -- ===== retention, activation backfill, job =====
  v_out := private.purge_text_sightings();
  ${rec('purged', `jsonb_build_object('result', v_out, 'old_left', exists (select 1 from private.text_sightings where user_id = v_old))`)}
  delete from private.text_sightings where user_id = v_h3;
  v_out := to_jsonb(private.backfill_shared_text_sightings());
  ${rec('backfill', `jsonb_build_object('n', v_out, 'h3', exists (select 1 from private.text_sightings where user_id = v_h3 and text_key = ${keyOf(DESC2)}),
      'friends_gatherings', (select count(*) from private.text_sightings t join gatherings g on g.id = t.gathering_id where g.visibility <> 'everyone'))`)}
  update private.account_signal_settings set shared_text_min_accounts = null;
  ${rec('backfill_off', `private.backfill_shared_text_sightings()`)}
  ${rec('jobs', `(select jsonb_agg(jobname) from cron.job where jobname = 'purge-text-sightings')`)}
  ${rec('failures', `(select count(*) from private.text_signal_failures)`)}
`);
    s = stepMap(log);
  }, 240000);

  const err = (k) => s[k].data && s[k].data.error;

  test('off: no key, no sighting; saving a bio works as before', () => {
    expect(s.off_bio.data).toBe('ok');
    expect(s.off.data).toEqual({ sightings: 0, key: true });
  });

  test('the key: keyed one-way hash of the normalized text; case/punctuation/spacing ignored; short and few-word text has none', () => {
    expect(s.key.data).toEqual({ bytes: 32, variant_same: true, differs: true, not_plain_sha256: true,
      short_none: true, few_words_none: true, blank_none: true });
    expect(s.limits.data).toEqual({ chars: 80, words: 12 });
  });

  test('four accounts with one bio open nothing; the fifth opens one many-accounts case', () => {
    ['a1_bio', 'a2_bio', 'a3_bio', 'a4_bio', 'a5_bio'].forEach((k) => expect(s[k].data).toBe('ok'));
    expect(s.four_accounts.data).toEqual({ sightings: 4, case: false });
    const c = s.five_accounts.data;
    expect(c).toMatchObject({ signal: 'shared_text', reason: 'many_accounts', status: 'open', members: 5 });
    expect(c.evidence).toEqual({ accounts: 5, window_days: 30, texts: 1, bio_accounts: 5, gathering_accounts: 0, gathering_ids: [] });
  });

  test('a variant with other case, punctuation and spacing joins the same case', () => {
    expect(s.variant_joins.data.case.members).toBe(6);
    expect(s.variant_joins.data.cases).toBe(1);
  });

  test('re-saving the profile or the same bio adds no sighting, member or alert', () => {
    expect(s.a1_again.data.sightings).toBe(6);
    expect(s.a1_again.data.members).toBe(6);
    expect(s.a1_again.data.events).toEqual(['opened', ...Array(6).fill('member_added')]);
  });

  test('short, few-word and listed template texts are never recorded', () => {
    [1, 2, 3, 4, 5].flatMap((n) => [`f${n}_short`, `f${n}_few`, `t${n}_template`]).forEach((k) => expect(s[k].data).toBe('ok'));
    expect(s.generic.data).toEqual({ sightings: 0, cases: 1 });
    expect(s.template.data).toEqual({ excluded: true, sightings: 0, cases: 1, key: true });
  });

  test('one host posting recurring gatherings is one account; friends-only and held gatherings are never read', () => {
    ['r_g1', 'r_g2', 'r_g3', 'r_g4'].forEach((k) => expect(s[k].data).toBe('ok'));
    expect(s.one_host.data).toEqual({ sightings: 4, case: false });
    expect(s.friends_only.data).toEqual({ sightings: 0, case: false });
    expect(s.made_public.data).toEqual({ sightings: 1, gathering: true });
    expect(s.held.data).toBe(0);
    expect(s.approved.data).toBe(1);
  });

  test('five hosts posting one public description open a case carrying the gathering ids, never the text', () => {
    const c = s.hosts_case.data;
    expect(c).toMatchObject({ signal: 'shared_text', reason: 'many_accounts', status: 'open', members: 5 });
    expect(c.evidence).toMatchObject({ accounts: 5, texts: 1, bio_accounts: 0, gathering_accounts: 5 });
    expect(c.evidence.gathering_ids).toHaveLength(5);
  });

  test('the same group copying its bio and a gathering description is ONE case', () => {
    expect(s.cluster.data.same_case).toBe(true);
    expect(s.cluster.data.cases).toBe(2);
    expect(s.cluster.data.bio_case.evidence).toMatchObject({ accounts: 6, texts: 2, bio_accounts: 6, gathering_accounts: 5 });
  });

  test('a text last posted more than 30 days ago does not count', () => {
    expect(s.window.data).toEqual({ sightings: 5, case: false }); // the 31-day-old one doesn't count: four
  });

  test('a closed case stays closed: a new account is new evidence, never a second case', () => {
    expect(s.close.data).toBe('ok');
    expect(s.closed_new_evidence.data).toEqual({ status: 'closed', new_evidence: true, after_close: true, cases: 2, new_evidence_events: 1 });
  });

  test('nothing restricts, hides, bans or notifies anyone; bios stay; flagged accounts keep acting', () => {
    expect(s.untouched.data).toHaveLength(12);
    s.untouched.data.forEach((p) => expect(p).toEqual({ suspended: false, hidden: false, banned: false }));
    expect(s.no_push.data).toBe(0);
    expect(s.a2_still_acts.data).toBe('ok');
    expect(s.bios_kept.data).toBe(5);
  });

  test('the text itself is stored nowhere; the key never appears in a case', () => {
    expect(s.no_text_stored.data).toEqual({ sightings: 0, cases: 0, events: 0,
      columns: ['first_seen', 'gathering_id', 'last_seen', 'source', 'text_key', 'user_id'] });
  });

  test('admins see shared-text cases; clients and anon reach none of it', () => {
    expect(s.admin_lists.data).toBe(2);
    expect(s.admin_reads.data).toBe('shared_text');
    ['client_lists', 'client_reads_sightings', 'client_reads_secret', 'client_reads_excluded', 'client_key', 'client_notes',
      'client_evaluates', 'client_excludes', 'client_backfills', 'client_forges', 'anon_reads'].forEach((k) => expect(err(k)).toBeTruthy());
  });

  test('deleted accounts, 30-day retention, activation backfill (public only, nothing while off), job, no failures', () => {
    expect(s.del_bio.data).toBe('ok');
    expect(s.deleted.data).toBe(0);
    expect(s.purged.data.old_left).toBe(false);
    ['f1_win', 'f2_win', 'f3_win', 'f4_win', 'old_bio'].forEach((k) => expect(s[k].data).toBe('ok'));
    expect(s.purged.data.result.sightings).toBeGreaterThanOrEqual(1);
    expect(s.backfill.data.h3).toBe(true);
    expect(s.backfill.data.friends_gatherings).toBe(0);
    expect(s.backfill.data.n).toBeGreaterThanOrEqual(1);
    expect(s.backfill_off.data).toBe(0);
    expect(s.jobs.data).toEqual(['purge-text-sightings']);
    expect(s.failures.data).toBe(0);
  });
});
