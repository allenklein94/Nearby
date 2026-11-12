// Duplicate business details and identical business images for the admin review (20270414, owner idea 36). Staged after
// 20270413: run with 0348-0414 as JOURNEY_PRELUDE_FILE until live. Story: people apply the way the app does (client insert
// under the real role) with their phone, email and website written in different ways; one is approved; the admin reads the
// warnings, a second application from an approved business's phone shows it, the same account's re-application is labelled,
// shared platforms and different pages never match; approval still works with a warning; nobody but an admin reads or
// dismisses anything. Media: two businesses using the exact same image (logo vs offer photo) warn, one business reusing its
// own image never does, archived / replaced media stops counting and is purged, a dismissal with a reason mutes one pair and
// a new business making a new pair shows again; applicants and businesses can't record or read fingerprints.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');
const { duplicateWarningLine, warningsFor, approvalNeedsConfirm, mediaMatchPairs, dismissArgs } = require('../utils/businessDuplicateWarnings');

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
// only this journey's applications and businesses (never other rows on the database it runs against)
const ours = `(w.subject_id = any(v_ours) and coalesce(w.other_request_id, w.other_partner_id) = any(v_ours))`;
const warnings = `(select coalesce(jsonb_agg(to_jsonb(w) order by w.subject_type, w.match_kind, w.other_name), '[]'::jsonb)
   from public.admin_business_duplicate_warnings() w where ${ours})`;
const mediaWarnings = `(select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) from public.admin_business_duplicate_warnings() w
   where w.match_kind = 'media' and ${ours})`;
const asAdmin = (step, value) => as(step, 'v_admin', 'perform 1', value);
const refreshOurs = `v_ours := array(select id from business_partner_requests where requester_id = any(v_people)
    union select id from brand_partners where id = any(array[v_p1, v_p2, v_p3, v_p4]) or id in
      (select resulting_partner_id from business_partner_requests where requester_id = any(v_people)));`;
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

const PEOPLE = ['v_admin', 'v_joe', 'v_copy', 'v_mail', 'v_web1', 'v_web2', 'v_fb1', 'v_fb2', 'v_gh1', 'v_gh2', 'v_yelp1', 'v_yelp2',
  'v_plain', 'v_owner1', 'v_owner2', 'v_owner3'];

d('journey: duplicate business details and identical business images for admin review (20270414)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_out jsonb; v_hint text; v_joe_req uuid; v_joe_biz uuid; v_copy_req uuid; v_mail_req uuid; v_old_req uuid; v_again_req uuid;
      v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_people uuid[]; v_ours uuid[];`, `
  ${actorsSql({ people: PEOPLE })}
  update profiles set is_admin = true where id = v_admin;
  v_people := array[${PEOPLE.join(', ')}];

  -- ===== applications, as the app sends them (client insert under the applicant's own role) =====
  ${as('apply_joe', 'v_joe', `insert into business_partner_requests (requester_id, business_name, phone, website, contact_info)
     values (v_joe, 'Joe''s Cafe', '+1 (561) 555-0101', 'https://www.Joes-Cafe.com/menu', 'Joe, joe@JoesCafe.com') returning id into v_joe_req`)}
  ${as('apply_plain', 'v_plain', `insert into business_partner_requests (requester_id, business_name, phone, website)
     values (v_plain, 'Unrelated Bakery', '561-555-0199', 'https://bakery.example.org')`)}
  ${refreshOurs}
  ${asAdmin('before_approval', warnings)}

  -- the admin approves Joe (approval is unchanged)
  ${as('approve_joe', 'v_admin', `v_joe_biz := approve_business_partner_request(v_joe_req)`, 'v_joe_biz')}

  -- another account applies with Joe's phone written another way (in its contact text) and Joe's site without www/path
  ${as('apply_copy', 'v_copy', `insert into business_partner_requests (requester_id, business_name, website, contact_info)
     values (v_copy, 'Joes Cafe Downtown', 'joes-cafe.com', 'call 561.555.0101 anytime') returning id into v_copy_req`)}
  -- an email match: Joe's email in a web application's applicant_email, in another case
  insert into business_partner_requests (requester_id, business_name, source, applicant_name, applicant_email, applicant_phone)
    values (v_mail, 'Coffee Corner', 'web', 'Pat', '  JOE@joescafe.com ', '+15615550177') returning id into v_mail_req;
  -- different pages on shared platforms never match; one person's own site-builder subdomain stays apart
  ${as('apply_fb1', 'v_fb1', `insert into business_partner_requests (requester_id, business_name, website) values (v_fb1, 'FB One', 'https://facebook.com/fb-one')`)}
  ${as('apply_fb2', 'v_fb2', `insert into business_partner_requests (requester_id, business_name, website) values (v_fb2, 'FB Two', 'facebook.com/fb-two')`)}
  ${as('apply_gh1', 'v_gh1', `insert into business_partner_requests (requester_id, business_name, website) values (v_gh1, 'GH One', 'https://alice.github.io')`)}
  ${as('apply_gh2', 'v_gh2', `insert into business_partner_requests (requester_id, business_name, website) values (v_gh2, 'GH Two', 'https://bob.github.io')`)}
  ${as('apply_yelp1', 'v_yelp1', `insert into business_partner_requests (requester_id, business_name, website) values (v_yelp1, 'Yelp One', 'https://www.yelp.com/biz/same-page')`)}
  ${as('apply_yelp2', 'v_yelp2', `insert into business_partner_requests (requester_id, business_name, website) values (v_yelp2, 'Yelp Two', 'https://www.yelp.com/biz/same-page')`)}
  -- the same account applies twice (declined, then again): labelled as the same account
  ${as('apply_old', 'v_web1', `insert into business_partner_requests (requester_id, business_name, phone) values (v_web1, 'Taco Spot', '(772) 555-0142') returning id into v_old_req`)}
  ${as('deny_old', 'v_admin', `perform deny_business_partner_request(v_old_req)`)}
  update business_partner_requests set created_at = now() - interval '1 minute' where id = v_old_req;
  ${as('apply_again', 'v_web1', `insert into business_partner_requests (requester_id, business_name, phone) values (v_web1, 'Taco Spot', '7725550142') returning id into v_again_req`)}

  ${rec('ids', `jsonb_build_object('joe', v_joe_req, 'joe_biz', v_joe_biz, 'copy', v_copy_req, 'mail', v_mail_req, 'old', v_old_req, 'again', v_again_req)`)}
  ${refreshOurs}
  ${asAdmin('contact', warnings)}

  -- ===== who can read or act =====
  ${as('applicant_reads', 'v_copy', `perform public.admin_business_duplicate_warnings()`)}
  ${as('applicant_dismisses', 'v_copy', `perform public.admin_dismiss_business_duplicate('phone', v_copy_req, v_joe_req, 'I am not a duplicate at all')`)}
  ${as('anon_reads', 'null', `perform public.admin_business_duplicate_warnings()`, `'ok'::text`, 'anon')}
  ${as('applicant_records', 'v_copy', `perform public.record_business_media_fingerprint(v_joe_biz, 'logo', 'x', '${SHA_A}')`)}
  ${as('applicant_private', 'v_copy', `perform 1 from private.business_media_fingerprints`)}
  ${as('applicant_rows', 'v_copy', `perform 1`, `(select count(*) from business_partner_requests)`)}

  -- ===== a warning never blocks approval =====
  ${as('approve_copy', 'v_admin', `perform approve_business_partner_request(v_copy_req)`,
      `(select status from business_partner_requests where id = v_copy_req)`)}

  -- ===== dismissal =====
  ${as('dismiss_short', 'v_admin', `perform public.admin_dismiss_business_duplicate('email', v_mail_req, v_joe_req, 'ok')`)}
  ${as('dismiss_nonmatch', 'v_admin', `perform public.admin_dismiss_business_duplicate('website', v_mail_req, v_joe_req, 'Same owner, two locations')`)}
  ${as('dismiss_email', 'v_admin', `perform public.admin_dismiss_business_duplicate('email', v_mail_req, v_joe_req, 'Same owner, confirmed by phone call')`)}
  ${refreshOurs}
  ${asAdmin('after_dismiss', warnings)}

  -- ===== identical images =====
  insert into brand_partners (name, active) values ('Media One', true) returning id into v_p1;
  insert into brand_partners (name, active) values ('Media Two', true) returning id into v_p2;
  insert into brand_partners (name, active) values ('Media Three', true) returning id into v_p3;
  insert into brand_partners (name, active) values ('Media Four', true) returning id into v_p4;
  update profiles set managed_partner_id = v_p1 where id = v_owner1;
  update profiles set managed_partner_id = v_p2 where id = v_owner2;
  update brand_partners set logo_url = 'https://x.test/business-logos/' || v_p1 || '/logo.png' where id = v_p1;
  insert into business_creatives (partner_id, media_type, media_path, status) values
    (v_p1, 'image', v_p1 || '/own-1.jpg', 'ready'), (v_p1, 'image', v_p1 || '/own-2.jpg', 'ready'),
    (v_p2, 'image', v_p2 || '/copied.jpg', 'ready'), (v_p3, 'image', v_p3 || '/old.jpg', 'ready');
  update business_creatives set archived_at = now() where partner_id = v_p3;
  ${as('rec_p1_logo', 'null', `perform public.record_business_media_fingerprint(v_p1, 'logo', 'https://x.test/business-logos/' || v_p1 || '/logo.png', '${SHA_A}')`, `'ok'::text`, 'service_role')}
  ${as('rec_p1_own', 'null', `perform public.record_business_media_fingerprint(v_p1, 'offer_photo', v_p1 || '/own-1.jpg', '${SHA_B}');
     perform public.record_business_media_fingerprint(v_p1, 'offer_photo', v_p1 || '/own-2.jpg', '${SHA_B}')`, `'ok'::text`, 'service_role')}
  ${as('rec_p2', 'null', `perform public.record_business_media_fingerprint(v_p2, 'offer_photo', v_p2 || '/copied.jpg', '${SHA_A}')`, `'ok'::text`, 'service_role')}
  ${as('rec_p3_archived', 'null', `perform public.record_business_media_fingerprint(v_p3, 'offer_photo', v_p3 || '/old.jpg', '${SHA_A}')`, `'ok'::text`, 'service_role')}
  ${as('rec_bad', 'null', `perform public.record_business_media_fingerprint(v_p2, 'video', 'x', '${SHA_A}')`, `'ok'::text`, 'service_role')}
  ${as('owner_records', 'v_owner2', `perform public.record_business_media_fingerprint(v_p2, 'logo', 'y', '${SHA_A}')`)}
  ${rec('media_ids', `jsonb_build_object('p1', v_p1, 'p2', v_p2, 'p3', v_p3, 'p4', v_p4)`)}
  ${refreshOurs}
  ${asAdmin('media', mediaWarnings)}

  ${as('dismiss_media', 'v_admin', `perform public.admin_dismiss_business_duplicate('media', v_p2, v_p1, 'Licensed stock photo, both sent the licence')`)}
  -- a fourth business later uses the same image: a NEW pair, shown again
  insert into business_creatives (partner_id, media_type, media_path, status) values (v_p4, 'image', v_p4 || '/new.jpg', 'ready');
  ${as('rec_p4', 'null', `perform public.record_business_media_fingerprint(v_p4, 'offer_photo', v_p4 || '/new.jpg', '${SHA_A}')`, `'ok'::text`, 'service_role')}
  ${asAdmin('media_after_dismiss', mediaWarnings)}

  -- Media One replaces its logo; Media Four archives its photo: neither counts, and the daily purge forgets them
  update brand_partners set logo_url = 'https://x.test/business-logos/' || v_p1 || '/logo-2.png' where id = v_p1;
  update business_creatives set archived_at = now() where partner_id = v_p4;
  ${asAdmin('media_after_replace', `(select count(*) from public.admin_business_duplicate_warnings() w where w.match_kind = 'media' and ${ours})`)}
  perform private.purge_business_duplicate_records();
  ${rec('purged', `jsonb_build_object('p1_logo', (select count(*) from private.business_media_fingerprints where partner_id = v_p1 and kind = 'logo'),
      'p1_own', (select count(*) from private.business_media_fingerprints where partner_id = v_p1 and kind = 'offer_photo'),
      'p3', (select count(*) from private.business_media_fingerprints where partner_id = v_p3),
      'p4', (select count(*) from private.business_media_fingerprints where partner_id = v_p4),
      'p2', (select count(*) from private.business_media_fingerprints where partner_id = v_p2))`)}
  -- deleting a business deletes its fingerprints; its dismissals go with the next purge
  delete from brand_partners where id = v_p2;
  perform private.purge_business_duplicate_records();
  ${rec('deleted', `jsonb_build_object('fingerprints', (select count(*) from private.business_media_fingerprints where partner_id = v_p2),
      'dismissals', (select count(*) from private.business_duplicate_dismissals where kind = 'media' and (a = any(v_ours) or b = any(v_ours))))`)}
  ${rec('no_push', `(select count(*) from push_outbox where created_at >= now() - interval '1 minute' and data->>'type' ilike '%duplicate%')`)}`);
    s = stepMap(log);
  }, 90000);

  const find = (rows, subject, kind, other) => rows.filter((r) => r.subject_id === subject && r.match_kind === kind
    && (r.other_request_id === other || r.other_partner_id === other));

  test('nothing matches when nothing is shared', () => {
    expect(s.before_approval.data).toEqual([]);
  });

  test('a phone written another way, in another field, on another account matches an approved business, both ways', () => {
    const { joe, joe_biz, copy } = s.ids.data;
    const rows = s.contact.data;
    const [onCopy] = find(rows, copy, 'phone', joe);
    expect(onCopy).toMatchObject({ subject_type: 'application', other_name: "Joe's Cafe", other_status: 'approved', other_partner_id: joe_biz, same_account: false, dismissed: false });
    expect(duplicateWarningLine(onCopy)).toBe('Same phone number as "Joe\'s Cafe" (approved business).');
    expect(find(rows, joe, 'phone', copy)).toHaveLength(1);
    expect(approvalNeedsConfirm(rows, copy)).toBe(true);
  });

  test('a website with or without www, path or capitals is one site; an email in another case and field is one email', () => {
    const { joe, copy, mail } = s.ids.data;
    expect(find(s.contact.data, copy, 'website', joe)).toHaveLength(1);
    expect(find(s.contact.data, mail, 'email', joe)).toHaveLength(1);
    expect(find(s.contact.data, mail, 'phone', joe)).toHaveLength(0);
  });

  test('different Facebook pages, different github.io sites, a shared Yelp page and unrelated businesses never match', () => {
    const names = new Set(s.contact.data.flatMap((r) => [r.other_name]));
    for (const n of ['FB One', 'FB Two', 'GH One', 'GH Two', 'Yelp One', 'Yelp Two', 'Unrelated Bakery']) expect(names.has(n)).toBe(false);
  });

  test("the same account's re-application is labelled as the same account, against its declined one", () => {
    const { old, again } = s.ids.data;
    const [row] = find(s.contact.data, again, 'phone', old);
    expect(row).toMatchObject({ same_account: true, other_status: 'denied' });
    expect(duplicateWarningLine(row)).toBe('Same phone number as "Taco Spot" (declined application, sent from this same account).');
  });

  test('only an admin reads or dismisses; applicants record nothing and still see only their own application', () => {
    expect(s.applicant_reads.data.hint).toBe('admin_only');
    expect(s.applicant_dismisses.data.hint).toBe('admin_only');
    expect(s.anon_reads.data.state).toBe('42501');
    expect(s.applicant_records.data.state).toBe('42501');
    expect(s.applicant_private.data.state).toBe('42501');
    expect(s.owner_records.data.state).toBe('42501');
    expect(s.applicant_rows.data).toBe(1);
  });

  test('a warning never blocks approval', () => {
    expect(s.approve_copy.data).toBe('approved');
  });

  test('a dismissal needs a reason and a real match, then stays listed as dismissed and stops asking for confirmation', () => {
    const { joe, mail } = s.ids.data;
    expect(s.dismiss_short.data.hint).toBe('reason_required');
    expect(s.dismiss_nonmatch.data.hint).toBe('no_such_match');
    expect(s.dismiss_email.data).toBe('ok');
    const [row] = find(s.after_dismiss.data, mail, 'email', joe);
    expect(row).toMatchObject({ dismissed: true, dismissed_reason: 'Same owner, confirmed by phone call' });
    expect(find(s.after_dismiss.data, joe, 'email', mail)[0].dismissed).toBe(true);
    expect(approvalNeedsConfirm(s.after_dismiss.data, mail)).toBe(false);
  });

  test('the same image on two businesses warns (logo vs offer photo); a business reusing its own image and archived media never do', () => {
    const { p1, p2, p3 } = s.media_ids.data;
    const rows = s.media.data;
    expect(rows).toHaveLength(2);
    const [onP2] = find(rows, p2, 'media', p1);
    expect(onP2).toMatchObject({ subject_type: 'business', subject_media: 'offer_photo', other_media: 'logo', other_name: 'Media One', dismissed: false });
    expect(duplicateWarningLine(onP2)).toBe('Its offer photo is the exact same image as the logo of "Media One" (business).');
    expect(rows.some((r) => r.subject_id === p3 || r.other_partner_id === p3)).toBe(false);
    expect(mediaMatchPairs(rows)).toHaveLength(1);
    expect(s.rec_bad.data.state).toBe('22023');
  });

  test('a dismissed image pair stays dismissed; a new business making a new pair shows again', () => {
    const { p1, p2, p4 } = s.media_ids.data;
    expect(s.dismiss_media.data).toBe('ok');
    const rows = s.media_after_dismiss.data;
    expect(find(rows, p1, 'media', p2)[0].dismissed).toBe(true);
    expect(find(rows, p4, 'media', p1)[0].dismissed).toBe(false);
    expect(find(rows, p4, 'media', p2)[0].dismissed).toBe(false);
    expect(dismissArgs(find(rows, p4, 'media', p1)[0], ' Same franchise ')).toEqual({ p_kind: 'media', p_subject: p4, p_other: p1, p_reason: 'Same franchise' });
    expect(warningsFor(rows, 'business', p1).map((r) => r.dismissed)).toEqual([false, true]);
  });

  test('replaced or archived media stops counting and is purged; deleting a business deletes its records', () => {
    expect(s.media_after_replace.data).toBe(0);
    expect(s.purged.data).toEqual({ p1_logo: 0, p1_own: 2, p3: 0, p4: 0, p2: 1 });
    expect(s.deleted.data).toEqual({ fingerprints: 0, dismissals: 0 });
    expect(s.no_push.data).toBe(0);
  });
});
