// Link destination safety (owner approved 2026-11-07; migration 20270396). Every actor runs under the real `authenticated`
// role + JWT claims and writes the tables directly, as a client (or anyone with a session and the API) can. The results the
// edge function would record are recorded as the server through the real functions. { realUgcScreening: true }: the real
// lookups, no harness stand-in.
//   A. the detector: plain, disguised (dot com, [.], hxxp, full-width, invisible characters, user@host, look-alike letters,
//      text before the name) and non-links (decimals, times, abbreviations, an email address)
//   B. bypass: linked text with only a 0373 (word-only) result, or none = refused 'link_check_required', nothing written;
//      text with no link is unchanged; same on edits, profile text and community text
//   C. clean = publishes (incl. a held outcome); malicious = refused 'link_not_allowed', even in an uncalibrated language
//   D. forged results: a client can't call the link functions, write or read the tables, borrow someone else's result or
//      use an expired one; a person's approval (source 'review') still counts
//   E. the lookup budget: 200 per account, 3000 for everyone, a day; nothing over 50 at once
// One rolled-back transaction. NOT covered here: the edge function's network side (Deno tests
// supabase/functions/_shared/linkSafety.test.ts with fake Web Risk + sites; real Web Risk needs the key), two transactions
// racing on the budget (scripts/replay/link-check-budget-concurrency.js).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, LIFT_GATHERING_CREATION_LIMIT } = require('./journeyHarness');

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
const note = (step, value) => `
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;
const q = (t) => `'${String(t).replace(/'/g, "''")}'`;
// the 0373 path (words only)
const rec = (who, text, risk = 'low', langs = ['en']) =>
  `perform public.record_ugc_screening(${who}, private.ugc_text_sha(${q(text)}), 'bio', false, '${risk}', '{}',
     array[${langs.map(q).join(', ')}]::text[], 'journey', 'journey');`;
// the 0396 path (destinations checked)
const clean = (who, text, risk = 'low', langs = ['en'], isName = false) =>
  `perform public.record_ugc_link_screening(${who}, private.ugc_text_sha(${q(text)}), 'bio', ${isName}, 'clean',
     greatest(1, cardinality(private.ugc_links(${q(text)}))), '{}', '${risk}', '{}', array[${langs.map(q).join(', ')}]::text[], 'journey', 'journey');`;
const bad = (who, text) =>
  `perform public.record_ugc_link_screening(${who}, private.ugc_text_sha(${q(text)}), 'bio', false, 'malicious', 1,
     array['SOCIAL_ENGINEERING'], null, '{}', '{}', null, null);`;
const gathering = (v, host, title, desc) =>
  `insert into gatherings (host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
   values (${host}, ${q(title)}, ${q(desc)}, now() + interval '2 days', 10.02, -10.03, 'Pickleball', 'j', 'everyone', true)
   returning id into ${v}`;

const DETECT = {
  plain: 'Tickets: https://example.org/tickets?x=1.',
  www: 'see www.Example.com/path',
  dotWord: 'visit example dot com today',
  brackets: 'evil[.]com or evil(dot)net',
  hxxp: 'hxxps://bad.example/login',
  backslash: 'HTTP:\\\\bad.example',
  userinfo: 'http://good.example@bad.example/x',
  fullwidth: 'ｅｖｉｌ．ｃｏｍ',
  invisible: 'e​vil.com',
  cyrillic: 'раураl.com is great',
  cjkPrefix: '访问evil.com现在',
  ellipsis: '...bit.ly/abc',
  colon: 'visit:evil.com',
  ip: 'go to 10.0.0.5:8080/admin',
  // not links
  decimals: 'Join us at 7.30pm, about 3.5km away. e.g. bring a friend!',
  abbreviations: 'U.S.A. Ph.D a.m. polka dot dress',
  email: 'mail me at bob@gmail.com',
};

d('journey: link destination safety (20270396)', () => {
  let s;
  beforeAll(async () => {
    s = stepMap(await runJourney(`
      ${actorDeclares(['v_a', 'v_b', 'v_h', 'v_ad'])}
      v_out jsonb; v_hint text; g1 uuid; g2 uuid; g3 uuid; i int; v_ok boolean;`, `
  ${actorsSql({ people: ['v_a', 'v_b', 'v_h', 'v_ad'] })}
  ${LIFT_GATHERING_CREATION_LIMIT}
  perform set_config('app.trusted_update', 'off', true);
  update profiles set bio = 'Original bio' where id = v_a;
  update private.ugc_language_calibration set status = 'calibrated', calibrated_at = now(), evidence = 'journey'
   where language in ('en', 'names');
  ${note('installed', `to_regprocedure('public.record_ugc_link_screening(uuid,text,text,boolean,text,integer,text[],text,text[],text[],text,text)') is not null`)}

  -- ===== A. the detector =====
  ${Object.entries(DETECT).map(([k, t]) => note(`detect_${k}`, `private.ugc_links(${q(t)})`)).join('\n')}

  -- ===== B. bypass =====
  ${rec('v_h', 'Pickleball meetup')}
  ${rec('v_h', 'Sign up at evil.example/free')}
  ${as('linked_word_only', 'v_h', gathering('g1', 'v_h', 'Pickleball meetup', 'Sign up at evil.example/free'))}
  ${as('linked_nothing', 'v_h', gathering('g1', 'v_h', 'Pickleball meetup', 'Pay at evil2.example'))}
  ${rec('v_h', 'Sign up at evil[.]example')}
  ${as('disguised_word_only', 'v_h', gathering('g1', 'v_h', 'Pickleball meetup', 'Sign up at evil[.]example'))}
  ${rec('v_h', 'Link in title: bit.ly/x')}
  ${as('title_link_word_only', 'v_h', gathering('g1', 'v_h', 'Link in title: bit.ly/x', 'Pickleball meetup'))}
  ${note('rows_after_bypass', `(select count(*) from gatherings where host_id = v_h)`)}
  ${rec('v_h', 'Bring a paddle, all levels welcome')}
  ${as('text_only_ok', 'v_h', `${gathering('g1', 'v_h', 'Pickleball meetup', 'Bring a paddle, all levels welcome')}; v_out := to_jsonb(g1)`, 'v_out')}
  select id into g1 from gatherings where host_id = v_h and description = 'Bring a paddle, all levels welcome';
  ${note('text_only_state', `(select moderation_state from gatherings where id = g1)`)}
  -- an edit adding a link needs the destination check; an edit of something else needs nothing
  ${rec('v_h', 'Details at evil.example')}
  ${as('edit_adds_link_word_only', 'v_h', `update gatherings set description = 'Details at evil.example' where id = g1`)}
  ${note('desc_after_edit', `(select description from gatherings where id = g1)`)}
  ${as('edit_other_field', 'v_h', `update gatherings set max_attendees = 12 where id = g1`)}
  -- other public text (0373's surfaces) follows the same rule
  ${rec('v_a', 'Follow me on evil.example')}
  ${as('bio_link_word_only', 'v_a', `update profiles set bio = 'Follow me on evil.example' where id = v_a`)}
  ${note('bio_after', `(select bio from profiles where id = v_a)`)}
  ${rec('v_h', 'Runners')}
  ${rec('v_h', 'Join at evil.example')}
  ${as('community_link_word_only', 'v_h', `insert into communities (creator_id, name, description) values (v_h, 'Runners', 'Join at evil.example')`)}

  -- ===== C. clean and malicious =====
  ${clean('v_h', 'Tickets at https://example.org/tickets')}
  ${as('clean_publishes', 'v_h', `${gathering('g2', 'v_h', 'Pickleball meetup', 'Tickets at https://example.org/tickets')}; v_out := to_jsonb(g2)`, 'v_out')}
  select id into g2 from gatherings where host_id = v_h and description = 'Tickets at https://example.org/tickets';
  ${note('clean_state', `(select moderation_state from gatherings where id = g2)`)}
  ${clean('v_h', 'Info: example.org/kreyol', 'low', ['ht'])}
  ${as('clean_uncalibrated_held', 'v_h', `${gathering('g3', 'v_h', 'Pickleball meetup', 'Info: example.org/kreyol')}; v_out := to_jsonb(g3)`, 'v_out')}
  ${note('clean_uncalibrated_state', `(select moderation_state from gatherings where host_id = v_h and description = 'Info: example.org/kreyol')`)}
  ${bad('v_h', 'Free tickets: bad.example/login')}
  ${as('malicious_refused', 'v_h', gathering('g3', 'v_h', 'Pickleball meetup', 'Free tickets: bad.example/login'))}
  ${note('malicious_row', `(select jsonb_build_object('outcome', outcome, 'link_check', link_check, 'categories', categories, 'threats', link_threats, 'risk', risk_tier)
     from private.ugc_screenings where user_id = v_h and text_sha256 = private.ugc_text_sha('Free tickets: bad.example/login'))`)}
  ${bad('v_a', 'Bon pri: bad.example/login')}
  ${as('malicious_uncalibrated', 'v_a', `update profiles set bio = 'Bon pri: bad.example/login' where id = v_a`)}
  -- a malicious result beats a clean one recorded for the same text
  ${clean('v_a', 'Mixed: bad2.example')}
  ${bad('v_a', 'Mixed: bad2.example')}
  ${as('malicious_beats_clean', 'v_a', `update profiles set bio = 'Mixed: bad2.example' where id = v_a`)}
  ${clean('v_a', 'Clean bio at example.org')}
  ${as('clean_bio', 'v_a', `update profiles set bio = 'Clean bio at example.org' where id = v_a`)}
  ${note('bio_clean_after', `(select bio from profiles where id = v_a)`)}
  -- the record function's own rules
  ${note('record_needs_verdict', `(select 1)`)}
  begin perform public.record_ugc_link_screening(v_a, private.ugc_text_sha('x'), 'bio', false, null, 1, '{}', 'low');
    log := log || jsonb_build_array(jsonb_build_object('step', 'rec_no_verdict', 'ok', true, 'data', 'accepted'));
  exception when others then log := log || jsonb_build_array(jsonb_build_object('step', 'rec_no_verdict', 'ok', true, 'data', 'refused')); end;
  begin perform public.record_ugc_link_screening(v_a, private.ugc_text_sha('x'), 'bio', false, 'clean', 1, '{}');
    log := log || jsonb_build_array(jsonb_build_object('step', 'rec_clean_no_risk', 'ok', true, 'data', 'accepted'));
  exception when others then log := log || jsonb_build_array(jsonb_build_object('step', 'rec_clean_no_risk', 'ok', true, 'data', 'refused')); end;
  begin perform public.record_ugc_link_screening(v_a, private.ugc_text_sha('x'), 'bio', false, 'clean', 0, '{}', 'low');
    log := log || jsonb_build_array(jsonb_build_object('step', 'rec_zero_links', 'ok', true, 'data', 'accepted'));
  exception when others then log := log || jsonb_build_array(jsonb_build_object('step', 'rec_zero_links', 'ok', true, 'data', 'refused')); end;

  -- ===== D. forged results =====
  ${as('client_record', 'v_a', `perform public.record_ugc_link_screening(v_a, private.ugc_text_sha('y.example'), 'bio', false, 'clean', 1, '{}', 'low', '{}', array['en'])`)}
  ${as('client_find', 'v_a', `perform public.find_ugc_link_screening(v_a, private.ugc_text_sha('y.example'), false)`)}
  ${as('client_detector', 'v_a', `perform public.ugc_links_for_check('y.example')`)}
  ${as('client_claim', 'v_a', `perform public.claim_link_checks(v_a, 1)`)}
  ${as('client_private_detector', 'v_a', `perform private.ugc_links('y.example')`)}
  ${as('client_reads_usage', 'v_a', `select count(*) into i from private.link_check_usage`, 'i')}
  ${as('client_marks_clean', 'v_a', `update private.ugc_screenings set link_check = 'clean' where user_id = v_a`)}
  ${clean('v_b', 'Borrowed: example.net')}
  ${as('borrowed', 'v_a', `update profiles set bio = 'Borrowed: example.net' where id = v_a`)}
  ${clean('v_a', 'Stale: example.net')}
  update private.ugc_screenings set valid_until = now() - interval '1 minute'
   where user_id = v_a and text_sha256 = private.ugc_text_sha('Stale: example.net');
  ${as('expired', 'v_a', `update profiles set bio = 'Stale: example.net' where id = v_a`)}
  insert into private.ugc_screenings (user_id, text_sha256, is_name, kind, source, outcome, valid_until)
  values (v_a, private.ugc_text_sha('Approved: example.net'), false, 'bio', 'review', 'publish', now() + interval '7 days');
  ${as('review_counts', 'v_a', `update profiles set bio = 'Approved: example.net' where id = v_a`)}
  ${note('bio_final', `(select bio from profiles where id = v_a)`)}

  -- ===== E. budget (as the server) =====
  ${note('claim_50', `public.claim_link_checks(v_b, 50)`)}
  ${note('claim_51', `public.claim_link_checks(v_b, 51)`)}
  ${note('claim_zero', `public.claim_link_checks(v_b, 0)`)}
  ${note('claim_null_user', `public.claim_link_checks(null, 1)`)}
  perform public.claim_link_checks(v_b, 50); perform public.claim_link_checks(v_b, 50); perform public.claim_link_checks(v_b, 49);
  ${note('claim_to_199', `(select lookups from private.link_check_usage where user_id = v_b and day = (now() at time zone 'utc')::date)`)}
  ${note('claim_200th', `public.claim_link_checks(v_b, 1)`)}
  ${note('claim_201st', `public.claim_link_checks(v_b, 1)`)}
  update private.link_check_usage set lookups = 2999 where user_id = '00000000-0000-0000-0000-000000000000';
  ${note('global_last', `public.claim_link_checks(v_a, 1)`)}
  ${note('global_over', `public.claim_link_checks(v_h, 1)`)}
  ${note('v_h_unchanged', `(select coalesce(max(lookups), 0) from private.link_check_usage where user_id = v_h)`)}
  `, { realUgcScreening: true }));
  });

  const refused = (step, hint) => expect(s[step].data).toMatchObject({ hint });

  test('installed (prelude with 20270396, or live)', () => expect(s.installed.data).toBe(true));

  test('A. one detector: plain and disguised links found, decimals / abbreviations / email addresses not', () => {
    expect(s.detect_plain.data).toEqual(['https://example.org/tickets?x=1']);
    expect(s.detect_www.data).toEqual(['www.example.com/path']);
    expect(s.detect_dotWord.data).toEqual(['example.com']);
    expect(s.detect_brackets.data).toEqual(['evil.com', 'evil.net']);
    expect(s.detect_hxxp.data).toEqual(['https://bad.example/login']);
    expect(s.detect_backslash.data).toEqual(['http://bad.example']);
    expect(s.detect_userinfo.data).toEqual(['http://good.example@bad.example/x']);
    expect(s.detect_fullwidth.data).toEqual(['evil.com']);
    expect(s.detect_invisible.data).toEqual(['evil.com']);
    expect(s.detect_cyrillic.data).toContain('раураl.com');
    expect(s.detect_cjkPrefix.data).toContain('evil.com');
    expect(s.detect_ellipsis.data).toEqual(['bit.ly/abc']);
    expect(s.detect_colon.data).toEqual(['evil.com']);
    expect(s.detect_ip.data).toEqual(['10.0.0.5:8080/admin']);
    expect(s.detect_decimals.data).toEqual([]);
    expect(s.detect_abbreviations.data).toEqual([]);
    expect(s.detect_email.data).toEqual([]);
  });

  test('B. linked text without a destination check is refused and writes nothing; text with no link is unchanged', () => {
    refused('linked_word_only', 'link_check_required');
    refused('linked_nothing', 'link_check_required');
    refused('disguised_word_only', 'link_check_required');
    refused('title_link_word_only', 'link_check_required');
    expect(s.rows_after_bypass.data).toBe(0);
    expect(typeof s.text_only_ok.data).toBe('string');
    expect(s.text_only_state.data).toBe('visible');
    refused('edit_adds_link_word_only', 'link_check_required');
    expect(s.desc_after_edit.data).toBe('Bring a paddle, all levels welcome');
    expect(s.edit_other_field.data).toBe('ok');
    refused('bio_link_word_only', 'link_check_required');
    expect(s.bio_after.data).toBe('Original bio');
    refused('community_link_word_only', 'link_check_required');
  });

  test('C. clean publishes (the language rule still applies); malicious is refused whatever the language', () => {
    expect(typeof s.clean_publishes.data).toBe('string');
    expect(s.clean_state.data).toBe('visible');
    expect(s.clean_uncalibrated_state.data).toBe('held');
    refused('malicious_refused', 'link_not_allowed');
    expect(s.malicious_row.data).toEqual({ outcome: 'refuse', link_check: 'malicious', categories: ['spam_scam'], threats: ['SOCIAL_ENGINEERING'], risk: null });
    refused('malicious_uncalibrated', 'link_not_allowed');
    refused('malicious_beats_clean', 'link_not_allowed');
    expect(s.clean_bio.data).toBe('ok');
    expect(s.bio_clean_after.data).toBe('Clean bio at example.org');
    expect(s.rec_no_verdict.data).toBe('refused');
    expect(s.rec_clean_no_risk.data).toBe('refused');
    expect(s.rec_zero_links.data).toBe('refused');
  });

  test('D. clients can\'t record, find, detect, claim, read the budget, mark a result clean, borrow or reuse a stale one', () => {
    for (const step of ['client_record', 'client_find', 'client_detector', 'client_claim', 'client_private_detector', 'client_reads_usage', 'client_marks_clean']) {
      expect(s[step].data).toHaveProperty('error');
    }
    refused('borrowed', 'link_check_required');
    refused('expired', 'link_check_required');
    expect(s.review_counts.data).toBe('ok');
    expect(s.bio_final.data).toBe('Approved: example.net');
  });

  test('E. the budget: 200 per account and 3000 for everyone a day, at most 50 at once; a refused claim takes nothing', () => {
    expect(s.claim_50.data).toBe(true);
    expect(s.claim_51.data).toBe(false);
    expect(s.claim_zero.data).toBe(false);
    expect(s.claim_null_user.data).toBe(false);
    expect(s.claim_to_199.data).toBe(199);
    expect(s.claim_200th.data).toBe(true);
    expect(s.claim_201st.data).toBe(false);
    expect(s.global_last.data).toBe(true);
    expect(s.global_over.data).toBe(false);
    expect(s.v_h_unchanged.data).toBe(0);
  });
});
