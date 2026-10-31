// User-content screening (owner approved 2026-10-31; migration 20270373). Every actor runs under the real `authenticated`
// role + JWT claims and writes the tables directly, exactly as a client (or anyone with a session and the API) can; the
// screening results the edge function would record are recorded as the server through the real record_ugc_screening,
// so the language-calibration rule is the real one. { realUgcScreening: true }: the real lookup, no harness stand-in.
//   A. direct API bypass: unscreened profile text, gathering, community, question, answer, photo comment = refused,
//      nothing written; edits that don't change screened text need nothing; the server itself is exempt
//   B. forged approvals: a client can't write the screening table, call the record/lookup/chat functions, borrow someone
//      else's screening, use an expired one, or set moderation_state itself
//   C. languages: low + calibrated = publish; low / high in a pending language = held (never refused on an unmeasured
//      verdict); a language outside the 11 = held; mixed = the least calibrated governs; names judged on their own row
//   D. held new rows: seen only by the author; nobody can join a held gathering; no "this matches you" event until approved
//   E. edits: held text keeps the published text; a later edit supersedes the pending one; approve applies, reject doesn't
//   F. review: admins only, never their own content, decided once
//   G. group chat: queued on send, claimed by the server, high = hidden from others (sender + evidence keep it), approve
//      restores; retry on failure
//   H. multilingual: byte-exact binding for text in all 11 app languages; whitespace trim matches the app's rule
// One rolled-back transaction. NOT covered: the edge function itself (Deno; the classifier needs Anthropic credit), two
// transactions racing (scripts/replay/ugc-moderation-concurrency.js).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, LIFT_GATHERING_CREATION_LIMIT } = require('./journeyHarness');
const { MULTILINGUAL_SAMPLES } = require('../utils/ugcMultilingualSamples');

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
// what screen-user-content records for a text (as the server)
const rec = (who, text, risk = 'low', langs = ['en'], isName = false) =>
  `perform public.record_ugc_screening(${who}, private.ugc_text_sha(${q(text)}), 'bio', ${isName}, '${risk}', '{}',
     array[${langs.map(q).join(', ')}]::text[], 'journey', 'journey');`;
const gathering = (v, host, title, desc = null) =>
  `insert into gatherings (host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
   values (${host}, ${q(title)}, ${desc === null ? 'null' : q(desc)}, now() + interval '2 days', 10.02, -10.03, 'Pickleball', 'j', 'everyone', true)
   returning id into ${v}`;
const heldCount = (tbl, id) => `(select count(*) from private.ugc_held_items where target_table = '${tbl}' and target_id = ${id} and status = 'pending')`;

d('journey: user-content screening bound to the write (20270373)', () => {
  let s;
  beforeAll(async () => {
    s = stepMap(await runJourney(`
      ${actorDeclares(['v_a', 'v_b', 'v_h', 'v_ad', 'v_new'])}
      v_out jsonb; v_hint text; g1 uuid; g2 uuid; g3 uuid; g4 uuid; c1 uuid; c2 uuid; qn uuid; m1 uuid; v_item uuid;
      v_q bigint; i int; v_sample text;`, `
  ${actorsSql({ people: ['v_a', 'v_b', 'v_h', 'v_ad'] })}
  ${LIFT_GATHERING_CREATION_LIMIT}
  perform set_config('app.trusted_update', 'off', true);
  update profiles set is_admin = true where id = v_ad;
  update profiles set bio = 'Original bio' where id = v_a;
  -- the calibration this journey assumes: English + names measured, everything else pending (the migration's own start
  -- is all pending)
  update private.ugc_language_calibration set status = 'calibrated', calibrated_at = now(), evidence = 'journey'
   where language in ('en', 'names');

  -- ===== A. direct API bypass =====
  ${as('bio_unscreened', 'v_a', `update profiles set bio = 'Buy followers now' where id = v_a`)}
  ${note('bio_after_unscreened', `(select bio from profiles where id = v_a)`)}
  ${as('gathering_unscreened', 'v_h', gathering('g1', 'v_h', 'Sunset run'))}
  ${note('gathering_unscreened_rows', `(select count(*) from gatherings where host_id = v_h)`)}
  ${as('community_unscreened', 'v_h', `insert into communities (creator_id, name) values (v_h, 'Runners')`)}
  ${as('interests_only_edit', 'v_a', `update profiles set interests = array['Pickleball'] where id = v_a`)}
  -- the server itself (no signed-in user) is exempt
  ${gathering('g4', 'v_h', 'Server-made title')};
  ${note('server_write_ok', `(select moderation_state from gatherings where id = g4)`)}

  -- ===== B. forged approvals =====
  ${as('client_writes_screening_table', 'v_a', `insert into private.ugc_screenings (user_id, text_sha256, is_name, kind, source, outcome, valid_until)
      values (v_a, private.ugc_text_sha('Buy followers now'), false, 'bio', 'review', 'publish', now() + interval '1 day')`)}
  ${as('client_calls_record', 'v_a', `perform public.record_ugc_screening(v_a, private.ugc_text_sha('x'), 'bio', false, 'low', '{}', array['en'], 'x', 'x')`)}
  ${as('client_calls_find', 'v_a', `perform public.find_ugc_screening(v_a, private.ugc_text_sha('x'), false)`)}
  ${as('client_claims_chat', 'v_a', `perform public.claim_ugc_chat_batch(5)`)}
  ${as('client_records_chat', 'v_a', `perform public.record_ugc_chat_screening(1, 'low', '{}', array['en'], 'x', 'x')`)}
  ${as('client_lookup_direct', 'v_a', `perform private.ugc_screening_lookup(v_a, 'x', false)`)}
  ${rec('v_b', "Borrowed words")}
  ${as('someone_elses_screening', 'v_a', `update profiles set bio = 'Borrowed words' where id = v_a`)}
  ${rec('v_a', 'Stale words')}
  update private.ugc_screenings set valid_until = now() - interval '1 minute', created_at = now() - interval '31 minutes'
   where user_id = v_a and text_sha256 = private.ugc_text_sha('Stale words');
  ${as('expired_screening', 'v_a', `update profiles set bio = 'Stale words' where id = v_a`)}
  ${rec('v_a', 'Clearly abusive words', 'high')}
  ${as('refused_text', 'v_a', `update profiles set bio = 'Clearly abusive words' where id = v_a`)}
  ${note('bio_after_forgeries', `(select bio from profiles where id = v_a)`)}
  ${as('non_admin_lists_queue', 'v_a', `perform public.admin_list_held_user_content()`)}
  ${as('non_admin_decides', 'v_a', `perform public.admin_decide_held_user_content(gen_random_uuid(), true, null)`)}

  -- ===== C. languages =====
  ${rec('v_a', 'I love long beach walks')}
  ${as('bio_en_low', 'v_a', `update profiles set bio = 'I love long beach walks' where id = v_a`)}
  ${note('bio_en_published', `(select bio from profiles where id = v_a)`)}
  ${rec('v_a', 'Mwen renmen mache sou plaj la', 'low', ['ht'])}
  ${as('bio_ht_low', 'v_a', `update profiles set bio = 'Mwen renmen mache sou plaj la' where id = v_a`)}
  ${note('bio_ht_kept_old', `(select bio from profiles where id = v_a)`)}
  ${note('bio_ht_held_item', heldCount('profiles', 'v_a'))}
  ${as('my_held_content', 'v_a', `select count(*) into i from public.get_my_held_content()`, 'i')}
  ${as('others_held_content', 'v_b', `select count(*) into i from public.get_my_held_content()`, 'i')}
  ${note('outcome_high_pending_lang', `private.ugc_outcome_for('high', array['ht'], false)`)}
  ${note('outcome_high_en', `private.ugc_outcome_for('high', array['en'], false)`)}
  ${note('outcome_mixed', `private.ugc_outcome_for('low', array['en', 'ht'], false)`)}
  ${note('outcome_unlisted_lang', `private.ugc_outcome_for('low', array['ja'], false)`)}
  ${note('outcome_no_lang', `private.ugc_outcome_for('low', array[]::text[], false)`)}
  ${note('outcome_medium_en', `private.ugc_outcome_for('medium', array['en'], false)`)}
  ${note('outcome_name_ht', `private.ugc_outcome_for('low', array['ht'], true)`)}
  ${note('outcome_unknown_risk', `private.ugc_outcome_for('banana', array['en'], false)`)}

  -- ===== D. held new rows =====
  ${rec('v_h', 'Beach cleanup', 'low', ['en'])}
  ${rec('v_h', 'Nou pral netwaye plaj la', 'low', ['ht'])}
  ${as('held_gathering_insert', 'v_h', `${gathering('g2', 'v_h', 'Beach cleanup', 'Nou pral netwaye plaj la')}; v_out := to_jsonb(g2)`, 'v_out')}
  ${note('held_gathering_state', `(select moderation_state from gatherings where host_id = v_h and title = 'Beach cleanup')`)}
  select id into g2 from gatherings where host_id = v_h and title = 'Beach cleanup';
  ${note('held_no_created_event', `(select count(*) from domain_events where type = 'GATHERING_CREATED' and object_id = g2)`)}
  ${as('host_sees_held', 'v_h', `select count(*) into i from gatherings where id = g2`, 'i')}
  ${as('stranger_sees_held', 'v_b', `select count(*) into i from gatherings where id = g2`, 'i')}
  ${as('stranger_joins_held', 'v_b', `perform public.join_gathering(g2)`)}
  ${as('host_unholds_itself', 'v_h', `update gatherings set moderation_state = 'visible' where id = g2`)}
  ${note('still_held_after_client_update', `(select moderation_state from gatherings where id = g2)`)}
  -- a client can't insert a gathering as visible with held text either
  ${rec('v_h', 'Second beach day', 'low', ['ht'])}
  ${as('insert_claims_visible', 'v_h', `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public, moderation_state)
      values (v_h, 'Second beach day', now() + interval '3 days', 10.02, -10.03, 'Pickleball', 'j', 'everyone', true, 'visible')`)}
  ${note('insert_claims_visible_state', `(select moderation_state from gatherings where host_id = v_h and title = 'Second beach day')`)}
  -- held community + question + photo comment
  ${rec('v_h', 'Kominote kourè', 'uncertain', ['ht'], true)}
  ${as('held_community', 'v_h', `insert into communities (creator_id, name) values (v_h, 'Kominote kourè') returning id into c1; v_out := to_jsonb(c1)`, 'v_out')}
  select id into c1 from communities where creator_id = v_h and name = 'Kominote kourè';
  ${note('held_community_state', `(select moderation_state from communities where id = c1)`)}
  ${as('stranger_sees_held_community', 'v_b', `select count(*) into i from communities where id = c1`, 'i')}
  ${as('creator_sees_held_community', 'v_h', `select count(*) into i from communities where id = c1`, 'i')}
  ${rec('v_h', 'Visible run')}
  ${as('visible_gathering', 'v_h', `${gathering('g3', 'v_h', 'Visible run')}; v_out := to_jsonb(g3)`, 'v_out')}
  select id into g3 from gatherings where host_id = v_h and title = 'Visible run';
  ${note('visible_created_event', `(select count(*) from domain_events where type = 'GATHERING_CREATED' and object_id = g3)`)}
  ${rec('v_b', 'Ki lè nou kòmanse?', 'low', ['ht'])}
  ${as('held_question', 'v_b', `insert into gathering_questions (gathering_id, asker_id, question_body) values (g3, v_b, 'Ki lè nou kòmanse?')`)}
  ${as('host_sees_held_question', 'v_h', `select count(*) into i from gathering_questions where gathering_id = g3`, 'i')}
  ${as('asker_sees_held_question', 'v_b', `select count(*) into i from gathering_questions where gathering_id = g3`, 'i')}
  ${as('question_unscreened', 'v_b', `insert into gathering_questions (gathering_id, asker_id, question_body) values (g3, v_b, 'What time?')`)}
  ${rec('v_b', 'What should I bring?')}
  ${as('question_screened', 'v_b', `insert into gathering_questions (gathering_id, asker_id, question_body) values (g3, v_b, 'What should I bring?')`)}
  select id into qn from gathering_questions where gathering_id = g3 and question_body = 'What should I bring?';
  ${as('answer_unscreened', 'v_h', `update gathering_questions set answer_body = 'Water', answered_at = now() where id = qn`)}
  ${rec('v_h', 'Pote dlo', 'low', ['ht'])}
  ${as('answer_held', 'v_h', `update gathering_questions set answer_body = 'Pote dlo', answered_at = now() where id = qn`)}
  ${note('answer_held_kept', `(select jsonb_build_object('answer', answer_body, 'answered_at', answered_at) from gathering_questions where id = qn)`)}
  ${as('comment_unscreened', 'v_b', `insert into photo_comments (photo_owner_id, photo_ref, commenter_id, comment_text) values (v_a, 'p1', v_b, 'Nice!')`)}
  ${rec('v_b', 'Bèl foto!', 'low', ['ht'])}
  ${as('comment_held', 'v_b', `insert into photo_comments (photo_owner_id, photo_ref, commenter_id, comment_text) values (v_a, 'p1', v_b, 'Bèl foto!')`)}
  ${as('owner_sees_held_comment', 'v_a', `select count(*) into i from photo_comments where photo_owner_id = v_a`, 'i')}
  ${as('author_sees_held_comment', 'v_b', `select count(*) into i from photo_comments where photo_owner_id = v_a`, 'i')}

  -- ===== E. edits =====
  ${rec('v_a', 'Bonjou tout moun', 'low', ['ht'])}
  ${as('edit_held_1', 'v_a', `update profiles set bio = 'Bonjou tout moun' where id = v_a`)}
  ${rec('v_a', 'Hello everyone')}
  ${as('edit_published_2', 'v_a', `update profiles set bio = 'Hello everyone' where id = v_a`)}
  ${note('edit_published_2_bio', `(select bio from profiles where id = v_a)`)}
  ${note('earlier_held_superseded', `(select jsonb_agg(status order by created_at) from private.ugc_held_items where target_table = 'profiles' and target_id = v_a and field = 'bio')`)}
  ${rec('v_a', 'Pikleball, tanpri', 'low', ['ht'], false)}
  ${as('prompt_answer_held', 'v_a', `update profiles set prompts = '[{"question":"Q1","answer":"Pikleball, tanpri"}]'::jsonb where id = v_a`)}
  ${note('prompts_kept', `(select prompts from profiles where id = v_a)`)}
  ${as('basics_select_only', 'v_a', `update profiles set basics = jsonb_build_object('hair_color', 'Brown') where id = v_a`)}
  ${as('basics_text_unscreened', 'v_a', `update profiles set basics = jsonb_build_object('hair_color', 'Brown', 'job_title', 'Spammer') where id = v_a`)}
  ${rec('v_a', 'Mwen se yon enfimyè', 'medium', ['ht'], true)}
  ${as('display_name_held', 'v_a', `update profiles set display_name = 'Mwen se yon enfimyè' where id = v_a`)}
  ${note('display_name_kept', `(select display_name from profiles where id = v_a)`)}
  -- whitespace: screened "  Surf club  " written with a trailing newline still matches (one trim rule)
  ${rec('v_a', 'Surf club')}
  ${as('trim_matches', 'v_a', `update profiles set bio = E'  Surf club\\n' where id = v_a`)}

  -- ===== F. review =====
  select id into v_item from private.ugc_held_items where target_table = 'gatherings' and target_id = g2 and status = 'pending' limit 1;
  ${as('admin_lists', 'v_ad', `select count(*) into i from public.admin_list_held_user_content()`, 'i')}
  ${as('admin_approves_gathering', 'v_ad', `perform public.admin_decide_held_user_content(v_item, true, 'fine')`)}
  ${note('gathering_after_approval', `(select moderation_state from gatherings where id = g2)`)}
  ${note('created_event_after_approval', `(select count(*) from domain_events where type = 'GATHERING_CREATED' and object_id = g2)`)}
  ${as('stranger_sees_after_approval', 'v_b', `select count(*) into i from gatherings where id = g2`, 'i')}
  ${as('decided_twice', 'v_ad', `perform public.admin_decide_held_user_content(v_item, false, null)`)}
  select id into v_item from private.ugc_held_items where target_table = 'communities' and target_id = c1 and status = 'pending';
  ${as('admin_rejects_community', 'v_ad', `perform public.admin_decide_held_user_content(v_item, false, 'no')`)}
  ${note('community_after_reject', `(select moderation_state from communities where id = c1)`)}
  select id into v_item from private.ugc_held_items where target_table = 'profiles' and target_id = v_a and field = 'display_name' and status = 'pending';
  ${as('admin_approves_name', 'v_ad', `perform public.admin_decide_held_user_content(v_item, true, null)`)}
  ${note('display_name_applied', `(select display_name from profiles where id = v_a)`)}
  ${note('approval_lets_name_through_7d', `(select count(*) from private.ugc_screenings where user_id = v_a and source = 'review' and valid_until > now() + interval '6 days')`)}
  select id into v_item from private.ugc_held_items where target_table = 'gathering_questions' and target_id = qn and status = 'pending';
  ${as('admin_approves_answer', 'v_ad', `perform public.admin_decide_held_user_content(v_item, true, null)`)}
  ${note('answer_applied', `(select jsonb_build_object('answer', answer_body, 'answered', answered_at is not null) from gathering_questions where id = qn)`)}
  select id into v_item from private.ugc_held_items where target_table = 'profiles' and target_id = v_a and field = 'bio' and status = 'superseded' limit 1;
  ${as('approve_superseded', 'v_ad', `perform public.admin_decide_held_user_content(v_item, true, null)`)}
  -- an admin's own held content goes to another admin
  ${rec('v_ad', 'Admin pa ka apwouve tèt li', 'low', ['ht'])}
  ${as('admin_own_held', 'v_ad', `update profiles set bio = 'Admin pa ka apwouve tèt li' where id = v_ad`)}
  select id into v_item from private.ugc_held_items where author_id = v_ad and status = 'pending';
  ${as('admin_decides_own', 'v_ad', `perform public.admin_decide_held_user_content(v_item, true, null)`)}

  -- ===== G. group chat =====
  ${rec('v_h', 'Chat club', 'low', ['en'], true)}
  ${as('chat_community', 'v_h', `insert into communities (creator_id, name) values (v_h, 'Chat club') returning id into c2; v_out := to_jsonb(c2)`, 'v_out')}
  select id into c2 from communities where creator_id = v_h and name = 'Chat club';
  insert into community_members (community_id, user_id, role) values (c2, v_h, 'creator'), (c2, v_b, 'member') on conflict do nothing;
  ${as('chat_send', 'v_h', `insert into community_messages (community_id, sender_id, body) values (c2, v_h, 'You are all idiots')`)}
  select id into m1 from community_messages where community_id = c2;
  ${note('chat_queued', `(select status from private.ugc_chat_queue where message_id = m1)`)}
  ${as('chat_visible_before', 'v_b', `select count(*) into i from community_messages where community_id = c2`, 'i')}
  select queue_id into v_q from public.claim_ugc_chat_batch(50) where message_id = m1;
  ${note('chat_claimed', `(select status from private.ugc_chat_queue where message_id = m1)`)}
  perform public.fail_ugc_chat_screening(v_q, 'classifier unavailable');
  ${note('chat_retry', `(select jsonb_build_object('status', status, 'attempts', attempts) from private.ugc_chat_queue where message_id = m1)`)}
  update private.ugc_chat_queue set next_attempt_at = now() where message_id = m1;
  select queue_id into v_q from public.claim_ugc_chat_batch(50) where message_id = m1;
  ${note('chat_recorded', `public.record_ugc_chat_screening(v_q, 'high', array['harassment'], array['en'], 'journey', 'journey')`)}
  ${as('chat_hidden_from_member', 'v_b', `select count(*) into i from community_messages where community_id = c2`, 'i')}
  ${as('chat_sender_still_sees', 'v_h', `select count(*) into i from community_messages where community_id = c2`, 'i')}
  ${as('sender_unhides', 'v_h', `update community_messages set moderation_state = 'visible' where id = m1`)}
  ${note('still_hidden', `(select moderation_state from community_messages where id = m1)`)}
  ${note('chat_evidence', `(select jsonb_build_object('kind', kind, 'text', held_value) from private.ugc_held_items where target_id = m1)`)}
  select id into v_item from private.ugc_held_items where target_id = m1;
  ${as('admin_restores_chat', 'v_ad', `perform public.admin_decide_held_user_content(v_item, true, null)`)}
  ${as('chat_visible_after_restore', 'v_b', `select count(*) into i from community_messages where community_id = c2`, 'i')}

  -- ===== H. multilingual: byte-exact binding in all 11 languages (as if each had passed calibration); held sign-up name =====
  update private.ugc_language_calibration set status = 'calibrated', calibrated_at = now(), evidence = 'journey';
  ${MULTILINGUAL_SAMPLES.map(([lang, text], k) => `
  ${rec('v_b', text, 'low', [lang])}
  ${as(`ml_${lang}`, 'v_b', `update profiles set bio = ${q(text)} where id = v_b`, `(select bio from profiles where id = v_b) = ${q(text)}`)}
  ${note(`ml_${lang}_sha`, `private.ugc_text_sha(${q(text)})`)}`).join('\n')}
  ${as('ml_nfd_differs', 'v_b', `update profiles set bio = ${q('Tiếng Việt')} where id = v_b`)}
  insert into auth.users (id, aud, role, email, created_at) values (v_new, 'authenticated', 'authenticated', v_new || '@journey.invalid', now());
  update private.ugc_language_calibration set status = 'pending', calibrated_at = null, evidence = null where language = 'names';
  ${rec('v_new', 'Ti Jan Bis', 'low', ['ht'], true)}
  ${as('signup_held_name', 'v_new', `insert into profiles (id, display_name, birthdate, terms_accepted_at) values (v_new, 'Ti Jan Bis', date '1990-01-01', now())`)}
  ${note('signup_no_row', `(select count(*) from profiles where id = v_new)`)}
  `, { realUgcScreening: true }));
  });

  const refused = (step, hint) => expect(s[step].data).toMatchObject({ hint });

  test('A. a direct write of unscreened public text is refused and writes nothing; non-text edits + the server pass', () => {
    refused('bio_unscreened', 'screening_required');
    expect(s.bio_after_unscreened.data).toBe('Original bio');
    refused('gathering_unscreened', 'screening_required');
    expect(s.gathering_unscreened_rows.data).toBe(0);
    refused('community_unscreened', 'screening_required');
    expect(s.interests_only_edit.data).toBe('ok');
    expect(s.server_write_ok.data).toBe('visible');
    refused('question_unscreened', 'screening_required');
    refused('answer_unscreened', 'screening_required');
    refused('comment_unscreened', 'screening_required');
    refused('basics_text_unscreened', 'screening_required');
    expect(s.basics_select_only.data).toBe('ok');
    expect(s.question_screened.data).toBe('ok');
  });

  test('B. forged approvals: no client path records, finds or borrows a screening; expired and refused never publish', () => {
    for (const step of ['client_writes_screening_table', 'client_calls_record', 'client_calls_find', 'client_claims_chat',
      'client_records_chat', 'client_lookup_direct']) {
      expect(s[step].data.error).toMatch(/permission denied/);
    }
    refused('someone_elses_screening', 'screening_required');
    refused('expired_screening', 'screening_required');
    refused('refused_text', 'content_not_allowed');
    expect(s.bio_after_forgeries.data).toBe('Original bio');
    expect(s.non_admin_lists_queue.data.error).toMatch(/Admins only/);
    expect(s.non_admin_decides.data.error).toMatch(/Admins only/);
    expect(s.still_held_after_client_update.data).toBe('held');
    expect(s.insert_claims_visible_state.data).toBe('held');
  });

  test('C. languages: only calibrated languages publish on their own; unmeasured verdicts go to a person', () => {
    expect(s.bio_en_published.data).toBe('I love long beach walks');
    expect(s.bio_ht_low.data).toBe('ok');
    expect(s.bio_ht_kept_old.data).toBe('I love long beach walks');
    expect(s.bio_ht_held_item.data).toBe(1);
    expect(s.my_held_content.data).toBeGreaterThanOrEqual(1);
    expect(s.others_held_content.data).toBe(0);
    expect(s.outcome_high_pending_lang.data).toBe('hold');
    expect(s.outcome_high_en.data).toBe('refuse');
    expect(s.outcome_mixed.data).toBe('hold');
    expect(s.outcome_unlisted_lang.data).toBe('hold');
    expect(s.outcome_no_lang.data).toBe('hold');
    expect(s.outcome_medium_en.data).toBe('hold');
    expect(s.outcome_name_ht.data).toBe('publish'); // names have their own (calibrated in this journey) row
    expect(s.outcome_unknown_risk.data).toBe('hold');
  });

  test('D. a held new row is seen only by its author; nobody can join it; announced only once approved', () => {
    expect(s.held_gathering_state.data).toBe('held');
    expect(s.held_no_created_event.data).toBe(0);
    expect(s.host_sees_held.data).toBe(1);
    expect(s.stranger_sees_held.data).toBe(0);
    expect(s.stranger_joins_held.data.error).toBeTruthy();
    expect(s.visible_created_event.data).toBe(1);
    expect(s.held_community_state.data).toBe('held');
    expect(s.stranger_sees_held_community.data).toBe(0);
    expect(s.creator_sees_held_community.data).toBe(1);
    expect(s.host_sees_held_question.data).toBe(0); // the held question is only the asker's
    expect(s.asker_sees_held_question.data).toBe(1);
    expect(s.answer_held.data).toBe('ok');
    expect(s.answer_held_kept.data).toEqual({ answer: null, answered_at: null });
    expect(s.owner_sees_held_comment.data).toBe(0);
    expect(s.author_sees_held_comment.data).toBe(1);
  });

  test('E. edits: held text keeps the published text; a newer edit supersedes it', () => {
    expect(s.edit_published_2_bio.data).toBe('Hello everyone');
    expect(s.earlier_held_superseded.data).toEqual(['superseded', 'superseded']);
    expect(s.prompts_kept.data).toEqual([]);
    expect(s.display_name_kept.data).toMatch(/^Journey /);
    expect(s.trim_matches.data).toBe('ok');
  });

  test('F. review: admins decide once, never their own; approve applies, reject keeps it unpublished', () => {
    expect(s.admin_lists.data).toBeGreaterThanOrEqual(4);
    expect(s.admin_approves_gathering.data).toBe('ok');
    expect(s.gathering_after_approval.data).toBe('visible');
    expect(s.created_event_after_approval.data).toBe(1);
    expect(s.stranger_sees_after_approval.data).toBe(1);
    refused('decided_twice', 'already_decided');
    expect(s.community_after_reject.data).toBe('removed');
    expect(s.display_name_applied.data).toBe('Mwen se yon enfimyè');
    expect(s.approval_lets_name_through_7d.data).toBeGreaterThanOrEqual(1);
    expect(s.answer_applied.data).toEqual({ answer: 'Pote dlo', answered: true });
    refused('approve_superseded', 'already_decided');
    refused('admin_decides_own', 'own_content');
  });

  test('G. group chat: queued, hidden on a high result (sender + evidence keep it), retried on failure, restorable', () => {
    expect(s.chat_send.data).toBe('ok');
    expect(s.chat_queued.data).toBe('pending');
    expect(s.chat_visible_before.data).toBe(1);
    expect(s.chat_claimed.data).toBe('claimed');
    expect(s.chat_retry.data).toEqual({ status: 'pending', attempts: 1 });
    expect(s.chat_recorded.data).toBe('hidden');
    expect(s.chat_hidden_from_member.data).toBe(0);
    expect(s.chat_sender_still_sees.data).toBe(1);
    expect(s.still_hidden.data).toBe('hidden');
    expect(s.chat_evidence.data).toEqual({ kind: 'chat_hidden', text: 'You are all idiots' });
    expect(s.chat_visible_after_restore.data).toBe(1);
  });

  test('H. multilingual: every app language binds byte-exactly, hashes the same as the app; a held sign-up name is refused', () => {
    const { createHash } = require('crypto');
    const { normalizeUgcText } = require('../utils/ugcText');
    for (const [lang, text] of MULTILINGUAL_SAMPLES) {
      expect(s[`ml_${lang}`].data).toBe(true);
      expect(s[`ml_${lang}_sha`].data).toBe(createHash('sha256').update(normalizeUgcText(text), 'utf8').digest('hex'));
    }
    refused('ml_nfd_differs', 'screening_required');
    refused('signup_held_name', 'content_held');
    expect(s.signup_no_row.data).toBe(0);
  });
});
