// The same website in public gatherings posted by several accounts (20270413, owner 2026-11-12, idea 35 follow-up). Staged
// after 20270412: run with 0348-0413 as JOURNEY_PRELUDE_FILE until live. Story: people post public gatherings the way the app
// does (client writes under the real role), each with DIFFERENT wording. Off = nothing stored. On (the owner's 5 accounts /
// 30 days): four accounts linking one site open nothing, a fifth does; other URL forms, subdomains, punycode and IP forms
// don't split a destination; shared platforms (YouTube, Eventbrite, ...) are never recorded; one person's own subdomain on a
// hosting platform and one group in a messaging link stay distinct; one host's recurring gatherings are one account;
// friends-only and held gatherings are never read; a listed legitimate site is dropped; one group linking two sites = ONE
// case; a closed case only notes new accounts; nothing restricts or notifies anyone; no URL or host is stored; clients reach
// none of it; a failure in the detector never blocks saving a gathering.
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
const q = (t) => t.replace(/'/g, "''");

const gathering = (step, v, title, desc, visibility = 'everyone', days = 3) => as(step, v,
  `insert into gatherings (host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
   values (${v}, '${q(title)}', '${q(desc)}', now() + interval '${days} days', 26.59, -80.03, 'Coffee', 'x', '${visibility}')`);
const dest = (l) => `private.shared_link_destination('${q(l)}')`;
const keyOf = (l) => `private._shared_link_hmac(${dest(l)})`;
const caseOf = (l) => `(select ck.case_id from private.account_review_case_link_keys ck where ck.link_key = ${keyOf(l)})`;
const caseInfo = (l) => `(select jsonb_build_object('signal', c.signal, 'reason', c.reason, 'status', c.status,
    'members', (select count(*) from private.account_review_case_members m where m.case_id = c.id),
    'evidence', c.evidence) from private.account_review_cases c where c.id = ${caseOf(l)})`;
const sightings = (l) => `(select count(distinct user_id) from private.link_sightings where link_key = ${keyOf(l)})`;
const linkCases = `(select count(*) from private.account_review_cases where signal = 'shared_link')`;

// one scam site, written five different ways by five accounts with five different pitches
const CAMPAIGN = [
  ['Amazing party tonight', 'Free drinks for the first 50, RSVP at https://www.deal-party.com/rsvp?ref=1'],
  ['Free concert', 'Grab tickets fast: hxxps://tickets.deal-party[.]com before they go'],
  ['VIP event', 'Exclusive list, sign up at deal-party dot com and bring a friend'],
  ['Exclusive meetup', 'Details and passes: HTTPS://Promo.Deal-Party.COM:443/vip'],
  ['Beach bash Saturday', 'Wristbands at http://user@%64eal-party.com./bash'],
];
const SITE = 'deal-party.com';

const PEOPLE = ['v_admin', 'v_o', 'v_c1', 'v_c2', 'v_c3', 'v_c4', 'v_c5', 'v_c6', 'v_c7', 'v_y1', 'v_y2', 'v_y3', 'v_y4', 'v_y5',
  'v_p1', 'v_p2', 'v_p3', 'v_p4', 'v_p5', 'v_r', 'v_h1', 'v_h2', 'v_h3', 'v_h4', 'v_h5', 'v_v1', 'v_v2', 'v_v3', 'v_v4', 'v_v5',
  'v_w1', 'v_w2', 'v_w3', 'v_w4', 'v_old', 'v_del'];
const C5 = ['v_c1', 'v_c2', 'v_c3', 'v_c4', 'v_c5'];
const Y5 = ['v_y1', 'v_y2', 'v_y3', 'v_y4', 'v_y5'];
const P5 = ['v_p1', 'v_p2', 'v_p3', 'v_p4', 'v_p5'];
const H5 = ['v_h1', 'v_h2', 'v_h3', 'v_h4', 'v_h5'];
const V5 = ['v_v1', 'v_v2', 'v_v3', 'v_v4', 'v_v5'];
const W4 = ['v_w1', 'v_w2', 'v_w3', 'v_w4'];

d('journey: the same website in public gatherings on several accounts (20270413)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_out jsonb; v_hint text; v_case uuid; v_gid uuid; v_excl boolean;`, `
  ${actorsSql({ people: PEOPLE })}
  update profiles set is_admin = true where id = v_admin;
  update private.account_signal_settings set shared_link_min_accounts = null, shared_text_min_accounts = null;
  delete from private.link_sightings; delete from private.shared_link_excluded_keys; delete from private.text_signal_failures;

  -- ===== off: nothing stored, nothing compared; saving works as before =====
  ${gathering('off_g', 'v_o', 'Sunset yoga', 'Mats at https://www.deal-party.com')}
  ${rec('off', `jsonb_build_object('sightings', (select count(*) from private.link_sightings), 'key', private.shared_link_key('${SITE}') is null)`)}

  -- ===== destinations (pure: one site however it is written; what is never a destination) =====
  ${rec('same_site', `(select count(distinct ${'private.shared_link_destination(l)'}) = 1 and bool_and(private.shared_link_destination(l) = '${SITE}')
      from unnest(array['https://www.deal-party.com/rsvp?ref=1', 'https://tickets.deal-party.com', 'deal-party.com', 'deal-party.com.',
        'https://user:pw@deal-party.com:8443/x', 'https://a.b.deal-party.com', 'https://%64eal-party.com', 'www.deal-party.com']) l)`)}
  ${rec('via_detector', `(select jsonb_agg(distinct private.shared_link_destination(l)) from unnest(private.ugc_links('${q(CAMPAIGN.map((c) => c[1]).join(' '))}')) l
      where private.shared_link_destination(l) is not null)`)}
  ${rec('distinct', `jsonb_build_object(
      'cc_sld', ${dest('shop.evil.co.uk')}, 'cc_other', ${dest('other.co.uk')},
      'per_site', jsonb_build_array(${dest('https://alice.github.io')}, ${dest('https://bob.github.io/x')}, ${dest('https://x.alice.github.io')}),
      'per_path', jsonb_build_array(${dest('https://t.me/scamgroup')}, ${dest('https://T.me/ScamGroup/')}, ${dest('https://t.me/other')},
                                    ${dest('instagram.com/p/abc')}, ${dest('https://discord.com/invite/abc')}),
      'nothing_specific', jsonb_build_array(${dest('instagram.com')}, ${dest('https://www.facebook.com/profile.php?id=1')}, ${dest('https://t.me/joinchat')}),
      'ignored', jsonb_build_array(${dest('https://www.youtube.com/watch?v=1')}, ${dest('youtu.be/abc')}, ${dest('https://www.eventbrite.co.uk/e/123')},
                                   ${dest('https://www.meetup.com/x/events/1')}, ${dest('https://maps.google.com/?q=x')}, ${dest('https://allenklein94.github.io/Nearby/invite')}),
      'ip', jsonb_build_array(${dest('http://192.168.000.001')}, ${dest('http://3232235521')}, ${dest('http://0xc0a80001')}),
      'punycode', ${dest('https://xn--80ak6aa92e.com')} = private.shared_link_destination('https://' || U&'\\0430\\0440\\0440\\04CF\\0435' || '.com'),
      'idn', ${dest('xn--mnchen-3ya.de')} = ${dest('münchen.de')},
      'not_sites', jsonb_build_array(${dest('st.lucie')}, ${dest('localhost')}, ${dest('')}),
      'unusual_ending', jsonb_build_array(${dest('evil.lol')}, ${dest('www.evil.zzz')}, ${dest('evil.zzz')}))`)}

  -- ===== on, with the owner's number (5 accounts / 30 days, a proposed starting point) =====
  update private.account_signal_settings set shared_link_min_accounts = 5;
  ${rec('key', `jsonb_build_object('bytes', length(private.shared_link_key('${SITE}')),
      'same', private.shared_link_key('https://promo.deal-party.com/x') = private.shared_link_key('${SITE}'),
      'not_plain_sha256', private.shared_link_key('${SITE}') <> extensions.digest('${SITE}', 'sha256')
                      and private.shared_link_key('${SITE}') <> extensions.digest('link-destination:v1:${SITE}', 'sha256'))`)}

  -- four accounts, four different pitches, one site: nothing; the fifth: a many-accounts case
  ${C5.slice(0, 4).map((v, i) => gathering(`c${i + 1}_g`, v, CAMPAIGN[i][0], CAMPAIGN[i][1])).join('\n')}
  ${rec('four_accounts', `jsonb_build_object('accounts', ${sightings(SITE)}, 'case', ${caseOf(SITE)} is not null)`)}
  ${gathering('c5_g', 'v_c5', CAMPAIGN[4][0], CAMPAIGN[4][1])}
  ${rec('five_accounts', caseInfo(SITE))}
  -- the link in the TITLE counts too
  ${gathering('c6_g', 'v_c6', 'Party at deal-party.com', 'See you there')}
  ${rec('title_joins', `jsonb_build_object('case', ${caseInfo(SITE)}, 'cases', ${linkCases})`)}
  -- re-saving a gathering without touching its text adds nothing
  ${as('c1_other_edit', 'v_c1', `update gatherings set title = title where host_id = v_c1`)}
  ${rec('c1_again', `jsonb_build_object('rows', (select count(*) from private.link_sightings where link_key = ${keyOf(SITE)}),
      'events', (select jsonb_agg(e.kind order by e.id) from private.account_review_case_events e where e.case_id = ${caseOf(SITE)}))`)}

  -- ===== legitimate shared links: shared platforms are never recorded =====
  ${Y5.map((v, i) => gathering(`y${i + 1}_g`, v, `Watch party ${i}`, `Trailer https://www.youtube.com/watch?v=${i} and tickets https://www.eventbrite.com/e/${i}00 or meetup.com/club${i}/events/${i}`)).join('\n')}
  ${rec('platforms', `jsonb_build_object('rows', (select count(*) from private.link_sightings where user_id in (${Y5.join(', ')})), 'cases', ${linkCases})`)}
  -- five people, each with their OWN site on one hosting platform, and five different Telegram groups: five destinations each
  ${P5.map((v, i) => gathering(`p${i + 1}_g`, v, `Run club ${i}`, `Info https://runner${i}.github.io and chat https://t.me/runclub${i}`)).join('\n')}
  ${rec('own_sites', `jsonb_build_object('destinations', (select count(distinct link_key) from private.link_sightings where user_id in (${P5.join(', ')})),
      'cases', ${linkCases})`)}

  -- ===== one host's recurring gatherings are one account; friends-only and held are never read =====
  ${[1, 2, 3, 4, 5].map((n) => gathering(`r_g${n}`, 'v_r', `Weekly run ${n}`, 'Route at runroute.net', 'everyone', n + 1)).join('\n')}
  ${rec('one_host', `jsonb_build_object('accounts', ${sightings('runroute.net')}, 'case', ${caseOf('runroute.net')} is not null)`)}
  ${H5.map((v, i) => gathering(`h${i + 1}_friends`, v, `Game night ${i}`, 'Rules at boardgame-hub.org', 'friends')).join('\n')}
  ${rec('friends_only', `jsonb_build_object('accounts', ${sightings('boardgame-hub.org')}, 'case', ${caseOf('boardgame-hub.org')} is not null)`)}
  insert into gatherings (host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, moderation_state)
  values (v_o, 'Held one', 'Rules at boardgame-hub.org', now() + interval '4 days', 26.59, -80.03, 'Coffee', 'x', 'everyone', 'held') returning id into v_gid;
  ${rec('held', sightings('boardgame-hub.org'))}
  update gatherings set moderation_state = 'visible' where id = v_gid;
  ${rec('approved', `(select count(*) from private.link_sightings where link_key = ${keyOf('boardgame-hub.org')} and gathering_id = v_gid)`)}

  -- ===== a listed legitimate destination (a popular local venue) is dropped and never recorded again =====
  ${V5.slice(0, 3).map((v, i) => gathering(`v${i + 1}_g`, v, `Trivia ${i}`, 'At the Pier House, menu at pierhouse-lw.com')).join('\n')}
  v_excl := private.exclude_shared_link('https://www.pierhouse-lw.com/menu');
  ${V5.slice(3).map((v, i) => gathering(`v${i + 4}_g`, v, `Trivia ${i + 3}`, 'At the Pier House, menu at pierhouse-lw.com')).join('\n')}
  ${rec('excluded', `jsonb_build_object('excluded', v_excl, 'rows', (select count(*) from private.link_sightings where user_id in (${V5.join(', ')})),
      'case', ${caseOf('pierhouse-lw.com')} is not null, 'key', private.shared_link_key('pierhouse-lw.com') is null)`)}

  -- ===== the same group (c1-c5) linking a SECOND site: joins their case, not a second one =====
  ${C5.map((v, i) => gathering(`c${i + 1}_g2`, v, `Round two ${i}`, `New passes at deal-tix${i % 2 ? '.net' : '.net/vip'}`)).join('\n')}
  ${rec('cluster', `jsonb_build_object('same_case', ${caseOf('deal-tix.net')} = ${caseOf(SITE)}, 'case', ${caseInfo(SITE)}, 'cases', ${linkCases})`)}

  -- ===== 30 days: a sighting last seen 31 days ago doesn't count =====
  ${gathering('old_g', 'v_old', 'Old one', 'Book at stale-site.com')}
  update private.link_sightings set first_seen = now() - interval '40 days', last_seen = now() - interval '31 days' where user_id = v_old;
  ${W4.map((v, i) => gathering(`w${i + 1}_g`, v, `New one ${i}`, 'Book at stale-site.com')).join('\n')}
  ${rec('window', `jsonb_build_object('accounts', ${sightings('stale-site.com')}, 'case', ${caseOf('stale-site.com')} is not null)`)}

  -- ===== a closed case stays closed; a new account linking the site is new evidence =====
  select ${caseOf(SITE)} into v_case;
  ${as('close', 'v_admin', `perform admin_close_account_review_case(v_case, 'no_action', 'Checked the site, it is a real promoter')`)}
  ${gathering('c7_g', 'v_c7', 'Late arrival', 'Tickets at deal-party.com')}
  ${rec('closed_new_evidence', `(select jsonb_build_object('status', c.status, 'new_evidence', c.new_evidence_at is not null,
      'after_close', (select after_close from private.account_review_case_members where case_id = c.id and user_id = v_c7),
      'cases', ${linkCases},
      'new_evidence_events', (select count(*) from private.account_review_case_events e where e.case_id = c.id and e.kind = 'new_evidence'))
      from private.account_review_cases c where c.id = v_case)`)}

  -- ===== nothing restricts or notifies anyone; flagged accounts keep acting; their gatherings stay =====
  ${rec('untouched', `(select jsonb_agg(jsonb_build_object('suspended', p.suspended_at is not null, 'hidden', p.profile_hidden,
      'banned', u.banned_until is not null) order by p.id)
      from profiles p join auth.users u on u.id = p.id where p.id in (${[...C5, 'v_c6', 'v_c7'].join(', ')}))`)}
  ${rec('no_push', `(select count(*) from push_outbox where recipient_id in (${[...C5, 'v_c6', 'v_c7', 'v_admin'].join(', ')}))`)}
  ${gathering('c2_still_acts', 'v_c2', 'Another one', 'Shell collecting at low tide, deal-party.com')}
  ${rec('gatherings_kept', `(select count(*) from gatherings where host_id in (${C5.join(', ')}) and moderation_state = 'visible')`)}

  -- ===== no URL, host or text is stored; the key never appears in a case =====
  ${rec('nothing_readable', `jsonb_build_object(
      'sightings', (select count(*) from private.link_sightings l where to_jsonb(l)::text ilike '%deal%' or to_jsonb(l)::text ilike '%party%'),
      'cases', (select count(*) from private.account_review_cases c where c.signal = 'shared_link' and (to_jsonb(c)::text ilike '%deal%'
                  or to_jsonb(c)::text ilike '%party%' or to_jsonb(c)::text like '%' || encode(${keyOf(SITE)}, 'hex') || '%')),
      'events', (select count(*) from private.account_review_case_events e where e.detail::text ilike '%deal%'),
      'columns', (select jsonb_agg(column_name order by column_name) from information_schema.columns
                   where table_schema = 'private' and table_name = 'link_sightings'))`)}

  -- ===== admins see the cases; nobody else reads or runs anything =====
  ${as('admin_lists', 'v_admin', `v_out := admin_list_account_review_cases(true)`,
    `(select count(*) from jsonb_array_elements(v_out) c where c ->> 'signal' = 'shared_link')`)}
  ${as('admin_reads', 'v_admin', `v_out := admin_get_account_review_case(v_case)`, `v_out ->> 'signal'`)}
  ${as('client_lists', 'v_c1', `perform admin_list_account_review_cases()`)}
  ${as('client_reads_sightings', 'v_c1', `perform count(*) from private.link_sightings`)}
  ${as('client_reads_secret', 'v_c1', `perform secret from private.link_signal_secret`)}
  ${as('client_reads_platforms', 'v_c1', `perform count(*) from private.shared_link_platforms`)}
  ${as('client_reads_excluded', 'v_c1', `perform count(*) from private.shared_link_excluded_keys`)}
  ${as('client_reads_case_keys', 'v_c1', `perform count(*) from private.account_review_case_link_keys`)}
  ${as('client_destination', 'v_c1', `perform private.shared_link_destination('x.com')`)}
  ${as('client_key', 'v_c1', `perform private.shared_link_key('x.com')`)}
  ${as('client_hmac', 'v_c1', `perform private._shared_link_hmac('x.com')`)}
  ${as('client_notes', 'v_c1', `perform private.note_link_sightings(v_c1, v_c1, 'x', 'x.com')`)}
  ${as('client_evaluates', 'v_c1', `perform private.evaluate_shared_link('\\x00')`)}
  ${as('client_excludes', 'v_c1', `perform private.exclude_shared_link('x.com')`)}
  ${as('client_backfills', 'v_c1', `perform private.backfill_link_sightings()`)}
  ${as('client_purges', 'v_c1', `perform private.purge_link_sightings()`)}
  ${as('client_forges', 'v_c1', `insert into private.link_sightings (link_key, user_id, gathering_id) values (extensions.gen_random_bytes(32), v_c1, v_c1)`)}
  ${as('anon_reads', 'null', `perform count(*) from private.link_sightings`, `'ok'::text`, 'anon')}
  ${rec('service_role', `jsonb_build_object(
      'tables', (select bool_or(has_table_privilege('service_role', t, 'select')) from unnest(array['private.link_sightings', 'private.link_signal_secret',
                 'private.shared_link_platforms', 'private.shared_link_excluded_keys', 'private.account_review_case_link_keys']::regclass[]) t),
      'functions', (select bool_or(has_function_privilege(r, p.oid, 'execute')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                    unnest(array['anon', 'authenticated', 'service_role']) r
                    where n.nspname = 'private' and p.proname in ('shared_link_destination', 'shared_link_key', '_shared_link_hmac', 'note_link_sightings',
                      'evaluate_shared_link', 'exclude_shared_link', 'backfill_link_sightings', 'purge_link_sightings', 'shared_link_active', 'punycode_decode')))`)}

  -- ===== deleting an account deletes its sightings =====
  ${gathering('del_g', 'v_del', 'Bye', 'Book at deal-party.com')}
  delete from gatherings where host_id = v_del;
  delete from profiles where id = v_del;
  delete from auth.users where id = v_del;
  ${rec('deleted', `(select count(*) from private.link_sightings where user_id = v_del)`)}

  -- ===== retention, activation backfill, job =====
  v_out := private.purge_link_sightings();
  ${rec('purged', `jsonb_build_object('result', v_out, 'old_left', exists (select 1 from private.link_sightings where user_id = v_old))`)}
  delete from private.link_sightings where user_id = v_r;
  v_out := to_jsonb(private.backfill_link_sightings());
  ${rec('backfill', `jsonb_build_object('n', v_out, 'r', exists (select 1 from private.link_sightings where user_id = v_r),
      'friends_gatherings', (select count(*) from private.link_sightings l join gatherings g on g.id = l.gathering_id where g.visibility <> 'everyone'))`)}
  ${rec('jobs', `(select jsonb_agg(jobname) from cron.job where jobname = 'purge-link-sightings')`)}
  ${rec('failures_before', `(select count(*) from private.text_signal_failures)`)}

  -- ===== a failure in the detector never blocks saving a gathering (the case table gone mid-transaction; rolled back) =====
  drop table private.account_review_case_link_keys;
  ${C5.map((v, i) => gathering(`fail${i + 1}_g`, v, `Still saves ${i}`, 'Now at broken-detector.com')).join('\n')}
  ${rec('failure', `jsonb_build_object('saved', (select count(*) from gatherings where title like 'Still saves %'),
      'failures', (select jsonb_agg(step) from private.text_signal_failures))`)}

  update private.account_signal_settings set shared_link_min_accounts = null;
  ${rec('backfill_off', `private.backfill_link_sightings()`)}
`);
    s = stepMap(log);
  }, 240000);

  const err = (k) => s[k].data && s[k].data.error;

  test('off: no key, no sighting; saving a gathering with a link works as before', () => {
    expect(s.off_g.data).toBe('ok');
    expect(s.off.data).toEqual({ sightings: 0, key: true });
  });

  test('one site however it is written: www, subdomains, user@, port, path, %XX, trailing dot, hxxp, [.], " dot "', () => {
    expect(s.same_site.data).toBe(true);
    expect(s.via_detector.data).toEqual([SITE]);
  });

  test('what stays distinct, what is ignored, and what is not a website', () => {
    const x = s.distinct.data;
    expect(x.cc_sld).toBe('evil.co.uk');
    expect(x.cc_other).toBe('other.co.uk');
    expect(x.per_site).toEqual(['alice.github.io', 'bob.github.io', 'alice.github.io']);
    expect(x.per_path).toEqual(['t.me/scamgroup', 't.me/scamgroup', 't.me/other', 'instagram.com/p/abc', 'discord.com/invite/abc']);
    expect(x.nothing_specific).toEqual([null, null, null]);
    expect(x.ignored).toEqual([null, null, null, null, null, null]);
    expect(x.ip).toEqual(['ip:192.168.0.1', 'ip:192.168.0.1', 'ip:192.168.0.1']);
    expect(x.punycode).toBe(true);
    expect(x.idn).toBe(true);
    expect(x.not_sites).toEqual([null, null, null]);
    expect(x.unusual_ending).toEqual(['evil.lol', 'evil.zzz', null]); // a rare ending counts when written as a link
  });

  test('the key: keyed one-way hash of the destination, never a plain hash', () => {
    expect(s.key.data).toEqual({ bytes: 32, same: true, not_plain_sha256: true });
  });

  test('four accounts with four pitches and one site open nothing; the fifth opens one many-accounts case', () => {
    ['c1_g', 'c2_g', 'c3_g', 'c4_g', 'c5_g'].forEach((k) => expect(s[k].data).toBe('ok'));
    expect(s.four_accounts.data).toEqual({ accounts: 4, case: false });
    const c = s.five_accounts.data;
    expect(c).toMatchObject({ signal: 'shared_link', reason: 'many_accounts', status: 'open', members: 5 });
    expect(c.evidence).toMatchObject({ accounts: 5, window_days: 30, links: 1 });
    expect(c.evidence.gathering_ids).toHaveLength(5);
  });

  test('a link in the title counts; re-saving without touching the text adds nothing', () => {
    expect(s.title_joins.data.case.members).toBe(6);
    expect(s.title_joins.data.cases).toBe(1);
    expect(s.c1_other_edit.data).toBe('ok');
    expect(s.c1_again.data.rows).toBe(6);
    expect(s.c1_again.data.events).toEqual(['opened', ...Array(6).fill('member_added')]);
  });

  test('legitimate shared links: platforms never recorded; own subdomains and separate groups stay apart', () => {
    [1, 2, 3, 4, 5].flatMap((n) => [`y${n}_g`, `p${n}_g`]).forEach((k) => expect(s[k].data).toBe('ok'));
    expect(s.platforms.data).toEqual({ rows: 0, cases: 1 });
    expect(s.own_sites.data).toEqual({ destinations: 10, cases: 1 });
  });

  test('one host posting recurring gatherings is one account; friends-only and held gatherings are never read', () => {
    [1, 2, 3, 4, 5].forEach((n) => expect(s[`r_g${n}`].data).toBe('ok'));
    expect(s.one_host.data).toEqual({ accounts: 1, case: false });
    expect(s.friends_only.data).toEqual({ accounts: 0, case: false });
    expect(s.held.data).toBe(0);
    expect(s.approved.data).toBe(1);
  });

  test('a listed legitimate destination is dropped and never recorded again', () => {
    [1, 2, 3, 4, 5].forEach((n) => expect(s[`v${n}_g`].data).toBe('ok'));
    expect(s.excluded.data).toEqual({ excluded: true, rows: 0, case: false, key: true });
  });

  test('the same group linking a second site is ONE case', () => {
    expect(s.cluster.data.same_case).toBe(true);
    expect(s.cluster.data.cases).toBe(1);
    expect(s.cluster.data.case.evidence).toMatchObject({ accounts: 6, links: 2 });
  });

  test('a link last posted more than 30 days ago does not count', () => {
    expect(s.window.data).toEqual({ accounts: 5, case: false }); // the 31-day-old one doesn't count: four
  });

  test('a closed case stays closed: a new account is new evidence, never a second case', () => {
    expect(s.close.data).toBe('ok');
    expect(s.closed_new_evidence.data).toEqual({ status: 'closed', new_evidence: true, after_close: true, cases: 1, new_evidence_events: 1 });
  });

  test('nothing restricts, hides, bans or notifies anyone; gatherings stay; flagged accounts keep acting', () => {
    expect(s.untouched.data).toHaveLength(7);
    s.untouched.data.forEach((p) => expect(p).toEqual({ suspended: false, hidden: false, banned: false }));
    expect(s.no_push.data).toBe(0);
    expect(s.c2_still_acts.data).toBe('ok');
    expect(s.gatherings_kept.data).toBe(11);
  });

  test('no URL, host or text is stored; the key never appears in a case', () => {
    expect(s.nothing_readable.data).toEqual({ sightings: 0, cases: 0, events: 0,
      columns: ['first_seen', 'gathering_id', 'last_seen', 'link_key', 'user_id'] });
  });

  test('admins see shared-link cases; clients, anon and the service role reach none of it', () => {
    expect(s.admin_lists.data).toBe(1);
    expect(s.admin_reads.data).toBe('shared_link');
    ['client_lists', 'client_reads_sightings', 'client_reads_secret', 'client_reads_platforms', 'client_reads_excluded',
      'client_reads_case_keys', 'client_destination', 'client_key', 'client_hmac', 'client_notes', 'client_evaluates',
      'client_excludes', 'client_backfills', 'client_purges', 'client_forges', 'anon_reads'].forEach((k) => expect(err(k)).toBeTruthy());
    expect(s.service_role.data).toEqual({ tables: false, functions: false });
  });

  test('deleted accounts, 30-day retention, activation backfill (public only, nothing while off), job', () => {
    expect(s.del_g.data).toBe('ok');
    expect(s.deleted.data).toBe(0);
    expect(s.purged.data.old_left).toBe(false);
    expect(s.purged.data.result.sightings).toBeGreaterThanOrEqual(1);
    expect(s.backfill.data.r).toBe(true);
    expect(s.backfill.data.friends_gatherings).toBe(0);
    expect(s.backfill.data.n).toBeGreaterThanOrEqual(1);
    expect(s.backfill_off.data).toBe(0);
    expect(s.jobs.data).toEqual(['purge-link-sightings']);
    expect(s.failures_before.data).toBe(0);
  });

  test('a failure in the detector never blocks saving a gathering; it is recorded, step only', () => {
    [1, 2, 3, 4, 5].forEach((n) => expect(s[`fail${n}_g`].data).toBe('ok'));
    expect(s.failure.data.saved).toBe(5);
    expect(s.failure.data.failures).toEqual(Array(5).fill('gathering_link'));
  });
});
