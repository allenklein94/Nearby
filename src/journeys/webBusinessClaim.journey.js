// Website-only business owners (owner, 2026-11-14; migration 20270418): an approved web application links to the
// applicant's account whether the profile exists at approval or is finished later on the business website.
// The bug it proves fixed: an owner who signed in (auth user with the applicant's phone) but had no profile row yet was
// marked claimed at approval while nothing linked, so finishing the profile later linked nothing.
// One rolled-back transaction under real roles. Not covered (browser only): the website's CompleteProfile screen itself.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;
// a statement run as v_who that must be refused: records the error text, or 'allowed'
const refused = (step, who, sql) => `begin
    ${as(who)}
    ${sql}
    reset role;
    log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', jsonb_build_object('result', 'allowed')));
  exception when others then
    reset role;
    log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', jsonb_build_object('result', 'refused')));
  end;`;

const as = (sub) => `perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;`;
const state = (step, req, who) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', jsonb_build_object(
    'claimed', (select claimed_at is not null from business_partner_requests where id = ${req}),
    'has_profile', exists (select 1 from profiles where id = ${who}),
    'linked', (select p.managed_partner_id is not null and p.managed_partner_id = r.resulting_partner_id
               from business_partner_requests r left join profiles p on p.id = ${who} where r.id = ${req}))));`;
const webApply = (req, name, phone) => `insert into business_partner_requests (source, applicant_name, applicant_email, applicant_phone, business_name, category, status)
    values ('web', 'Journey Applicant', 'applicant@journey.invalid', ${phone}, '${name}', 'food_drink', 'pending') returning id into ${req};`;

d('journey: a website-only owner is linked once their profile exists', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`${actorDeclares(['v_admin', 'v_with', 'v_web'])} v_req_web uuid; v_req_with uuid; v_phone_web text; v_phone_with text;`, `
  ${actorsSql({ people: ['v_admin', 'v_with'] })}
  update profiles set is_admin = true where id = v_admin;
  select phone into v_phone_with from auth.users where id = v_with;
  -- the website-only owner: signed in with a phone code (auth user), profile not finished yet (no profiles row)
  v_phone_web := '1555' || lpad((floor(random() * 100000000))::bigint::text, 8, '0');
  insert into auth.users (id, aud, role, email, phone, phone_confirmed_at, created_at)
    values (v_web, 'authenticated', 'authenticated', null, v_phone_web, now(), now());
  ${webApply('v_req_web', 'Journey Web Cafe', 'v_phone_web')}
  ${webApply('v_req_with', 'Journey Profile Cafe', 'v_phone_with')}

  ${as('v_admin')}
  perform approve_business_partner_request(v_req_web);
  perform approve_business_partner_request(v_req_with);
  reset role;
  ${state('approved_no_profile', 'v_req_web', 'v_web')}
  ${state('approved_with_profile', 'v_req_with', 'v_with')}

  -- the owner finishes CompleteProfile on the website (saveMyNewProfile = their own insert, through RLS)
  ${as('v_web')}
  insert into profiles (id, display_name, birthdate, terms_accepted_at) values (v_web, 'Journey Web Owner', date '1990-01-01', now());
  reset role;
  ${state('after_profile', 'v_req_web', 'v_web')}`);
    s = stepMap(log);
  }, 60000);

  test('approval while the owner has no profile marks nothing claimed (so nothing is lost)', () => {
    expect(s.approved_no_profile.data).toEqual({ claimed: false, has_profile: false, linked: false });
  });

  test('finishing the profile on the website links the business', () => {
    expect(s.after_profile.data).toEqual({ claimed: true, has_profile: true, linked: true });
  });

  test('unchanged: an owner who already has a profile is linked at approval', () => {
    expect(s.approved_with_profile.data).toEqual({ claimed: true, has_profile: true, linked: true });
  });
});

d('journey: claiming a web business is only for the approved applicant', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`${actorDeclares(['v_admin', 'v_owner', 'v_other', 'v_pend', 'v_stranger'])} v_req uuid; v_req_pend uuid; v_partner uuid; v_phone_owner text; v_phone_pend text; v_claimed_at timestamptz;`, `
  ${actorsSql({ people: ['v_admin', 'v_owner', 'v_other'] })}
  update profiles set is_admin = true where id = v_admin;
  select phone into v_phone_owner from auth.users where id = v_owner;
  ${webApply('v_req', 'Journey Owner Cafe', 'v_phone_owner')}
  -- an application left pending, and its applicant signs in without a profile
  v_phone_pend := '1555' || lpad((floor(random() * 100000000))::bigint::text, 8, '0');
  insert into auth.users (id, aud, role, email, phone, phone_confirmed_at, created_at)
    values (v_pend, 'authenticated', 'authenticated', null, v_phone_pend, now(), now());
  ${webApply('v_req_pend', 'Journey Pending Cafe', 'v_phone_pend')}
  -- a stranger: signed in with an unrelated phone, no application at all
  insert into auth.users (id, aud, role, email, phone, phone_confirmed_at, created_at)
    values (v_stranger, 'authenticated', 'authenticated', null, '1555' || lpad((floor(random() * 100000000))::bigint::text, 8, '0'), now(), now());

  ${refused('non_admin_approve', 'v_other', 'perform approve_business_partner_request(v_req);')}
  ${refused('client_calls_claim', 'v_other', 'perform _claim_web_business_requests(v_other);')}

  ${as('v_admin')}
  perform approve_business_partner_request(v_req);
  reset role;
  select resulting_partner_id, claimed_at into v_partner, v_claimed_at from business_partner_requests where id = v_req;
  ${state('owner_linked', 'v_req', 'v_owner')}

  -- running the claim again (duplicate) changes nothing
  perform _claim_web_business_requests(v_owner);
  log := log || jsonb_build_array(jsonb_build_object('step', 'duplicate_claim', 'ok', true, 'data', jsonb_build_object(
    'claimed_at_unchanged', (select claimed_at = v_claimed_at from business_partner_requests where id = v_req),
    'managers', (select count(*) from profiles where managed_partner_id = v_partner))));

  -- the pending applicant finishes their profile: nothing is claimed or linked
  ${as('v_pend')}
  insert into profiles (id, display_name, birthdate, terms_accepted_at) values (v_pend, 'Journey Pending Owner', date '1990-01-01', now());
  reset role;
  ${state('pending_after_profile', 'v_req_pend', 'v_pend')}

  -- the stranger finishes a profile: linked to nothing
  ${as('v_stranger')}
  insert into profiles (id, display_name, birthdate, terms_accepted_at) values (v_stranger, 'Journey Stranger', date '1990-01-01', now());
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'stranger_after_profile', 'ok', true, 'data', jsonb_build_object(
    'managed', (select managed_partner_id is not null from profiles where id = v_stranger))));

  -- nobody can make themselves the manager of the approved business
  ${refused('self_set_manager', 'v_stranger', 'update profiles set managed_partner_id = v_partner where id = v_stranger;')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'after_self_set', 'ok', true, 'data', jsonb_build_object(
    'stranger_managed', (select managed_partner_id is not null from profiles where id = v_stranger),
    'managers', (select count(*) from profiles where managed_partner_id = v_partner))));`);
    s = stepMap(log);
  }, 60000);

  test('a non-admin cannot approve an application', () => {
    expect(s.non_admin_approve.data.result).toBe('refused');
  });
  test('a signed-in client cannot call the claim function', () => {
    expect(s.client_calls_claim.data.result).toBe('refused');
  });
  test('the approved applicant is linked', () => {
    expect(s.owner_linked.data).toEqual({ claimed: true, has_profile: true, linked: true });
  });
  test('a duplicate claim changes nothing', () => {
    expect(s.duplicate_claim.data).toEqual({ claimed_at_unchanged: true, managers: 1 });
  });
  test('a pending (unapproved) application is never claimed by finishing a profile', () => {
    expect(s.pending_after_profile.data).toEqual({ claimed: false, has_profile: true, linked: false });
  });
  test('an unrelated account is linked to nothing', () => {
    expect(s.stranger_after_profile.data.managed).toBe(false);
  });
  test('no account can set itself as the business manager', () => {
    expect(s.after_self_set.data).toEqual({ stranger_managed: false, managers: 1 });
  });
});
