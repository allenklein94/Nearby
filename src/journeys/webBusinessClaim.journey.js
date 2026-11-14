// Website-only business owners (owner, 2026-11-14; migration 20270418): an approved web application links to the
// applicant's account whether the profile exists at approval or is finished later on the business website.
// The bug it proves fixed: an owner who signed in (auth user with the applicant's phone) but had no profile row yet was
// marked claimed at approval while nothing linked, so finishing the profile later linked nothing.
// One rolled-back transaction under real roles. Not covered (browser only): the website's CompleteProfile screen itself.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

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
