// Release compatibility (owner, 2026-11-26): the app build in this checkout, through its REAL service code (unmodified
// src/services/*), against a local PostgREST on an ISOLATED replay database at one migration version. Run by
// scripts/compat/release-compat.sh at every checkpoint (0347, each batch boundary, 0373, 0396, latest); never against a
// hosted project (the URLs below must be local or the run refuses).
//
// What is real: PostgREST, Postgres, every RLS policy / grant / trigger / function at that version, the app's supabase-js
// client with the app's own fetch wrapper (withActingBusiness), and the app's service functions + the exact screen writes
// cited by file. What stands in (and only that): Supabase Auth (a signed JWT for the actor; sign-in itself is the separate
// Auth test, scripts/replay/signup-hook-auth-local.js), the device location (40.0, -75.0) and the two content-screening
// edge functions, emulated step for step from their source (screen-user-content: hash, find, record 'low';
// screen-business-content offer_response: record the screening result, then call submit_business_offer AS THE USER, as the
// function does). The AI classifier answer is always 'low'; Web Risk has no key (as staging/prod today), so a text with a
// link is "unavailable" from 0396.
//
// Env: NEARBY_COMPAT_REST (http://<postgrest>:3000), NEARBY_COMPAT_SECRET (its JWT secret), NEARBY_LOCAL_DB_URL (service
// connection, setup + edge emulation only), NEARBY_COMPAT_VERSION (e.g. 20270372), NEARBY_COMPAT_OUT (results JSON).
const crypto = require('crypto');
const fs = require('fs');

const REST = process.env.NEARBY_COMPAT_REST;
const SECRET = process.env.NEARBY_COMPAT_SECRET;
const DB_URL = process.env.NEARBY_LOCAL_DB_URL;
const VERSION = Number(process.env.NEARBY_COMPAT_VERSION || 0);
const LOCAL = /^(postgres|http):\/\/([^@/]+@)?(localhost|127\.|172\.|10\.|192\.168\.)/;
const enabled = !!(REST && SECRET && DB_URL && LOCAL.test(REST) && LOCAL.test(DB_URL));
const has = (v) => VERSION >= v;

const mockActor = { current: null };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function mockJwtFor(id) {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(id
    ? { sub: id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }
    : { role: 'anon', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${crypto.createHmac('sha256', SECRET || 'x').update(body).digest('base64url')}`;
}

// Service connection (setup + the edge-function stand-ins).
let mockPg = null;
const svc = (sql, params) => mockPg.query(sql, params);

const mockJson = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const mockFnExists = async (sig) => (await svc(`select to_regprocedure($1) is not null ok`, [sig])).rows[0].ok;

// screen-user-content (supabase/functions/screen-user-content/index.ts screenForUser), step for step.
async function mockScreenUserContent(userId, body) {
  const NAME_KINDS = ['name', 'community_name']; // screen-user-content/index.ts NAME_KINDS
  const results = [];
  for (const t of body.texts || []) {
    const text = String(t.text || '').replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '');
    if (!text) { results.push('publish'); continue; }
    if (!(await mockFnExists('public.find_ugc_screening(uuid,text,boolean)'))) return mockJson(200, { code: 'not_installed' });
    const isName = NAME_KINDS.includes(t.kind);
    const sha = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    if (await mockFnExists('public.ugc_links_for_check(text)')) {
      const links = (await svc(`select public.ugc_links_for_check($1) l`, [text])).rows[0].l;
      if (Array.isArray(links) && links.length) {
        // No GOOGLE_WEB_RISK_API_KEY (staging + production today): checkLinks answers 'unavailable'.
        return mockJson(503, { code: 'link_check_unavailable' });
      }
    }
    const earlier = (await svc(`select public.find_ugc_screening($1, $2, $3) o`, [userId, sha, isName])).rows[0].o;
    if (earlier === 'publish' || earlier === 'hold') { results.push(earlier); continue; }
    const rec = (await svc(`select public.record_ugc_screening($1, $2, $3, $4, 'low', '{}', '{en}', 'compat stand-in', 'compat') r`,
      [userId, sha, t.kind || 'bio', isName])).rows[0].r;
    results.push(rec.outcome);
  }
  const sev = { publish: 0, hold: 1, refuse: 2 };
  return mockJson(200, { outcome: results.reduce((w, r) => (sev[r] > sev[w] ? r : w), 'publish') });
}

// screen-business-content, target offer_response: record the low-risk screening result for this exact content (when 0372's
// binding exists), then submit AS THE USER through PostgREST, as the function's supabaseAsUser does.
async function mockScreenBusinessContent(userId, body) {
  if (body.targetType !== 'offer_response') return mockJson(400, { error: `compat stand-in: ${body.targetType} not emulated` });
  if (await mockFnExists('private.require_business_screening(uuid,text,uuid,jsonb)')) {
    await svc(`insert into business_content_screening_results (partner_id, target_type, target_id, submitted_by, content_snapshot,
                 risk_tier, model_reasoning, source)
               select p.managed_partner_id, 'offer_response', null, $1,
                 private.screening_content_offer_response($2, $3, $4, $5::text[]::text, $6, $7, $8, $9, $10::uuid),
                 'low', 'compat stand-in for screen-business-content', 'submission'
                 from profiles p where p.id = $1`,
    [userId, body.requestId, body.offerDescription, body.offerTitle ?? null, body.includedItems ?? [], body.redemptionInstructions ?? null,
      body.mediaPath ?? null, body.mediaType ?? null, null, body.creativeId ?? null]);
  }
  const res = await fetch(`${REST}/rpc/submit_business_offer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mockJwtFor(userId)}` },
    body: JSON.stringify({
      request_id_param: body.requestId, offer_type_param: body.offerType, offer_description_param: body.offerDescription,
      offer_price_param: body.offerPrice ?? null, proposed_time_param: body.proposedTime ?? null, offer_title_param: body.offerTitle ?? null,
      included_items_param: body.includedItems ?? [], price_is_per_person_param: !!body.priceIsPerPerson,
    }),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) return mockJson(res.status, { error: out?.message || 'submit failed', code: out?.code, hint: out?.hint });
  return mockJson(200, { riskTier: 'low', published: true, result: out });
}

async function mockFetch(url, init = {}) {
  const u = String(url);
  const fn = u.match(/\/functions\/v1\/([a-z-]+)/);
  if (fn) {
    const userId = mockActor.current;
    const body = init.body ? JSON.parse(init.body) : {};
    if (fn[1] === 'screen-user-content') return mockScreenUserContent(userId, body);
    if (fn[1] === 'screen-business-content') return mockScreenBusinessContent(userId, body);
    if (fn[1] === 'moderate-text') return mockJson(200, { safe: true });
    return mockJson(404, { error: `compat: edge function ${fn[1]} not emulated` });
  }
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${mockJwtFor(mockActor.current)}`);
  return fetch(u.replace('http://compat.local/rest/v1', REST), { ...init, headers });
}

let mockClient = null;
jest.mock('../../services/supabase', () => {
  const { createClient } = require('@supabase/supabase-js');
  const { withActingBusiness } = require('../../services/actingBusiness');
  mockClient = createClient('http://compat.local', 'compat-publishable', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: withActingBusiness((...a) => mockFetch(...a)) }, // the app's own wrapper (services/supabase.js)
  });
  const session = () => (mockActor.current
    ? { access_token: mockJwtFor(mockActor.current), user: { id: mockActor.current } } : null);
  mockClient.auth.getSession = async () => ({ data: { session: session() }, error: null });
  mockClient.auth.getUser = async () => ({ data: { user: session()?.user ?? null }, error: null });
  return {
    supabase: mockClient, functionUrl: (n) => `http://compat.local/functions/v1/${n}`, PUBLISHABLE_KEY: 'compat-publishable',
    ENVIRONMENT: 'staging', ENVIRONMENT_ERROR: null, SERVICES: {}, createIsolatedAuthClient: () => mockClient,
  };
});
const mockCoords = { coords: { latitude: 40.0, longitude: -75.0, accuracy: 10 }, timestamp: Date.now() };
jest.mock('../../services/userLocation', () => ({
  ...jest.requireActual('../../services/userLocation'),
  getUserLocation: async () => mockCoords, requireUserLocation: async () => mockCoords, getCachedUserLocation: () => mockCoords,
}));

const d = enabled ? describe : describe.skip;

d(`app build x database ${VERSION}: real service code through PostgREST`, () => {
  const ids = { A: crypto.randomUUID(), B: crypto.randomUUID(), C: crypto.randomUUID(), N: crypto.randomUUID(), O: crypto.randomUUID(), P: crypto.randomUUID() };
  const st = {};
  const results = [];
  let errors = [];
  const as = (who) => { mockActor.current = ids[who]; };
  const run = (name, fn) => test(name, async () => {
    errors = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.map(String).join(' ').slice(0, 300)); });
    const r = { step: name, ok: false };
    try {
      r.detail = await fn();
      r.ok = true;
      if (errors.length) { r.ok = false; r.detail = { swallowed: errors }; }
    } catch (e) {
      r.detail = { error: e?.message || String(e), code: e?.code, hint: e?.hint };
    } finally { spy.mockRestore(); results.push(r); }
    if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.detail).slice(0, 600)}`);
  }, 30000);
  const need = (k) => { if (!st[k]) throw new Error(`blocked: needs ${k} from an earlier step`); return st[k]; };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

  beforeAll(async () => {
    const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
    mockPg = new Client({ connectionString: DB_URL });
    await mockPg.connect();
    const { actorsSql } = require('../../journeys/journeyHarness');
    const L = (k) => `'${ids[k]}'::uuid`;
    await svc(`do $$ begin ${actorsSql({
      people: [L('A'), L('B'), L('C'), L('O')], friends: [[L('A'), L('B')]],
      business: { owner: L('O'), partner: L('P'), lat: 40.0, lng: -75.0, subcategory: 'Coffee' },
    })}
      update profiles set onboarding_motivations = array['Go on dates', 'Make new friends'], open_to_friend_discovery = true,
        wide_area = '40.0,-75.0', photo_url = 'https://example.invalid/compat.jpg', interests = array['Coffee']
        where id in (${L('A')}, ${L('C')});
      update profiles set photo_url = 'https://example.invalid/compat.jpg' where id in (${L('B')}, ${L('O')});
    end $$`);
    // The new sign-up N: an SMS-confirmed Auth user with no profile yet (CompleteProfileScreen creates it).
    await svc(`insert into auth.users (id, aud, role, email, phone, phone_confirmed_at)
               values ($1, 'authenticated', 'authenticated', $1 || '@compat.invalid', '1555' || lpad((abs(hashtext($1::text)) % 100000000)::text, 8, '0'), now())`, [ids.N]);
  });
  afterAll(async () => {
    if (process.env.NEARBY_COMPAT_OUT) fs.writeFileSync(process.env.NEARBY_COMPAT_OUT, JSON.stringify({ version: VERSION, results }, null, 1));
    await mockPg?.end();
  });

  // ---- auth + onboarding (CompleteProfileScreen.submit) ----
  run('signup: name screened, profile created, start-up read complete', async () => {
    const { screenUserContent } = require('../../services/userContentScreening');
    const { saveMyNewProfile, readMyProfile } = require('../../services/myProfile');
    as('N');
    const check = await screenUserContent([{ text: 'Compat Newcomer', kind: 'name' }]);
    if (check.outcome !== 'publish') throw new Error(`name screening: ${check.outcome}`);
    const { error } = await saveMyNewProfile({
      id: ids.N, display_name: 'Compat Newcomer', birthdate: '1995-03-03', interests: ['Coffee', 'Hiking'],
      terms_accepted_at: new Date().toISOString(), onboarding_motivations: ['Make new friends'],
      social_comfort_level: 'small,medium', open_to_friend_discovery: true, // onboarding fixes: several social-plan choices
    });
    if (error) throw error;
    await svc(`update profiles set photo_url = 'https://example.invalid/n.jpg' where id = $1`, [ids.N]); // photo upload step
    const me = await readMyProfile('display_name, birthdate, photo_url, is_admin');
    if (me.error || me.data?.display_name !== 'Compat Newcomer' || !me.data?.photo_url) throw new Error(`start-up read: ${JSON.stringify(me)}`);
    return { complete: true };
  });

  // ---- profile edit (ProfileScreen.save: screen the bio, then update) ----
  run('profile: bio screened and saved, read back', async () => {
    const { screenUserContent } = require('../../services/userContentScreening');
    const { readMyProfile } = require('../../services/myProfile');
    as('A');
    const bio = `Coffee and long walks ${VERSION}`;
    const check = await screenUserContent([{ text: bio, kind: 'bio' }]);
    if (check.outcome !== 'publish') throw new Error(`bio screening: ${check.outcome}`);
    const { error } = await mockClient.from('profiles').update({ bio, social_comfort_level: 'small' }).eq('id', ids.A);
    if (error) throw error;
    const me = await readMyProfile('bio');
    if (me.data?.bio !== bio) throw new Error(`read back: ${JSON.stringify(me)}`);
    return { saved: true };
  });

  run('profile: a text with a link is screened (Web Risk dependency from 0396)', async () => {
    const { screenUserContent } = require('../../services/userContentScreening');
    as('A');
    const check = await screenUserContent([{ text: 'See example.com for my photos', kind: 'bio' }]);
    const expected = has(20270396) ? 'unavailable' : 'publish';
    if (check.outcome !== expected) throw new Error(`expected ${expected}, got ${check.outcome}`);
    return { outcome: check.outcome, note: has(20270396) ? 'needs GOOGLE_WEB_RISK_API_KEY before 0396 (gate, not a build defect)' : undefined };
  });

  // ---- Friends ----
  run('friends: request, pending list, accept, both see the friendship', async () => {
    const f = require('../../services/friends');
    as('C'); await f.sendFriendRequest(ids.A);
    as('A'); const pending = await f.getPendingFriendRequests();
    const row = (pending ?? []).find((p) => [p.requested_by, p.user_a, p.user_b, p.id, p.profile?.id, p.other?.id].includes(ids.C) || JSON.stringify(p).includes(ids.C));
    if (!row) throw new Error(`pending list lacks the request: ${JSON.stringify(pending).slice(0, 300)}`);
    await f.respondToFriendRequest(row.friendshipId ?? row.friendship_id ?? row.id, true);
    const mine = await f.getMyFriends();
    if (!JSON.stringify(mine).includes(ids.C)) throw new Error('accepted friend missing from getMyFriends');
    as('C'); const theirs = await f.getMyFriends();
    if (!JSON.stringify(theirs).includes(ids.A)) throw new Error('friendship not visible to the requester');
    return { friends: true };
  });

  // ---- Dating (Browse) ----
  run('dating: Browse returns the other opted-in person', async () => {
    const { browseDatingCandidates } = require('../../services/datingBrowse');
    as('A');
    const { data, error } = await browseDatingCandidates({ buckets: ['40.0,-75.0'], offset: 0, limit: 20, columns: 'id, display_name' });
    if (error) throw error;
    if (!(data ?? []).some((p) => p.id === ids.C)) throw new Error(`C not in Browse (${(data ?? []).length} rows)`);
    return { rows: data.length };
  });

  // ---- Gatherings ----
  run('gathering: title screened, created, found by a friend, joined, host sees it', async () => {
    const { screenUserContent } = require('../../services/userContentScreening');
    const g = require('../../services/gatherings');
    as('A');
    const title = `Compat coffee walk ${VERSION}`;
    const check = await screenUserContent([{ text: title, kind: 'gathering_title' }, { text: 'Meet by the fountain', kind: 'gathering_description' }]);
    if (check.outcome !== 'publish') throw new Error(`title screening: ${check.outcome}`);
    const created = await g.createGathering({ title, description: 'Meet by the fountain', interestTag: 'Coffee',
      scheduledAt: new Date(Date.now() + 26 * 3600e3).toISOString(), customLocation: { latitude: 40.0, longitude: -75.0 } });
    st.gathering = created.id;
    as('B');
    const found = await g.searchGatherings(title);
    if (!(found ?? []).some((x) => x.id === st.gathering)) throw new Error(`friend's search misses it (${(found ?? []).length} rows)`);
    const joined = await g.expressInterest(st.gathering);
    if (!['approved', 'pending'].includes(joined.status)) throw new Error(`join: ${JSON.stringify(joined)}`);
    const attending = await g.getMyAttendingGatherings();
    const list = [...(attending?.upcoming ?? []), ...(attending?.past ?? [])];
    if (joined.status === 'approved' && !list.some((x) => (x.id ?? x.gathering_id ?? x.gathering?.id) === st.gathering)) throw new Error('not in my attending list');
    as('A');
    const reqs = await g.getGatheringRequestsForHost(st.gathering);
    if (!JSON.stringify(reqs).includes(ids.B)) throw new Error('host view misses the attendee');
    return { joined: joined.status };
  });

  // ---- Messaging (gathering chat) ----
  run('messaging: attendee writes in the gathering chat, host reads it', async () => {
    const chat = require('../../services/gatheringChat');
    const gid = need('gathering');
    as('B'); await chat.sendGatheringMessage(gid, `hello ${VERSION}`);
    as('A'); const page = await chat.getGatheringMessagesPage(gid);
    const rows = page?.messages ?? page?.data ?? page ?? [];
    if (!JSON.stringify(rows).includes(`hello ${VERSION}`)) throw new Error(`host doesn't see the message: ${JSON.stringify(page).slice(0, 300)}`);
    return { delivered: true };
  });

  // ---- Communities ----
  run('community: created (screened), joined, message sent and read', async () => {
    const { screenUserContent } = require('../../services/userContentScreening');
    const c = require('../../services/communities');
    as('A');
    const name = `Compat walkers ${VERSION}`;
    const check = await screenUserContent([{ text: name, kind: 'community_name' }, { text: 'Weekly walks', kind: 'community_description' }]);
    if (check.outcome !== 'publish') throw new Error(`name screening: ${check.outcome}`);
    const made = await c.createCommunity({ name, description: 'Weekly walks', interestTag: 'Coffee', isPublic: true });
    const cid = made?.id ?? made?.data?.id;
    if (!cid) throw new Error(`no community id: ${JSON.stringify(made).slice(0, 200)}`);
    as('B'); await c.joinCommunity(cid); await c.sendCommunityMessage(cid, `hi group ${VERSION}`);
    as('A'); const page = await c.getCommunityMessagesPage(cid);
    if (!JSON.stringify(page).includes(`hi group ${VERSION}`)) throw new Error('creator does not see the message');
    return { community: true };
  });

  // ---- Business: request -> opportunity -> offer -> accept (booking) -> visit confirmation ----
  run('business request: sent, reaches the business', async () => {
    const bf = require('../../services/businessFulfillment');
    as('A');
    const res = await bf.submitBusinessRequest({ text: 'Coffee for two', category: 'Coffee', partySize: 2, date: today, radiusMiles: 15 });
    st.request = res?.requestId ?? res?.request_id ?? res?.id;
    if (!st.request) throw new Error(`no request id: ${JSON.stringify(res).slice(0, 200)}`);
    if (!(Number(res?.notifiedCount ?? res?.notified_count) >= 1)) throw new Error(`reached nobody: ${JSON.stringify(res).slice(0, 200)}`);
    return { notified: res.notifiedCount ?? res.notified_count };
  });

  run('business mode: loads, opportunity listed', async () => {
    const bf = require('../../services/businessFulfillment');
    const { getMyManagedPartner } = require('../../services/brandOffers');
    const { getMyBusinessLocations, noteLocationAwareSession } = require('../../services/businessLocations');
    const rid = need('request');
    as('O');
    const partner = await getMyManagedPartner();
    if ((partner?.id ?? partner?.partner?.id) !== ids.P) throw new Error(`managed partner: ${JSON.stringify(partner).slice(0, 200)}`);
    await getMyBusinessLocations(); await noteLocationAwareSession();
    const ops = await bf.getBusinessOpportunities(ids.P);
    if (!JSON.stringify(ops).includes(rid)) throw new Error('request not in Opportunities');
    return { opportunities: true };
  });

  run('offer: business sends a reply (screened path), customer sees it', async () => {
    const bf = require('../../services/businessFulfillment');
    const rid = need('request');
    as('O');
    const proposed = new Date(Date.now() + 60 * 60e3).toISOString();
    const out = await bf.submitBusinessOfferResponseForScreening(ids.P, rid, { offerType: 'discount', offerDescription: `Two lattes, 10% off ${VERSION}`,
      offerTitle: 'Latte for two', offerPrice: 9, proposedTime: proposed, includedItems: [] });
    if (out?.error) throw new Error(JSON.stringify(out));
    as('A');
    const full = await bf.getBusinessRequestWithOffers(rid);
    const offers = full?.offers ?? full?.business_request_offers ?? [];
    const mine = offers.find((o) => o.status === 'offered');
    if (!mine) throw new Error(`no open offer for the customer: ${JSON.stringify(full).slice(0, 300)}`);
    st.offer = mine.id;
    return { offer: true };
  });

  run('booking: customer accepts, business sees the booking', async () => {
    const bf = require('../../services/businessFulfillment');
    const oid = need('offer');
    as('A'); await bf.acceptBusinessOffer(oid);
    as('O');
    const ops = await bf.getBusinessOpportunities(ids.P);
    if (!JSON.stringify(ops).includes(oid)) throw new Error('booking not shown to the business');
    const status = (await svc(`select status from business_request_offers where id = $1`, [oid])).rows[0]?.status;
    if (status !== 'accepted') throw new Error(`offer status ${status}`);
    return { booked: true };
  });

  run('visit: customer marks done, business confirms the visit', async () => {
    const bf = require('../../services/businessFulfillment');
    const oid = need('offer');
    as('A'); await bf.completeBusinessReservation(oid);
    as('O');
    let confirmErr = null;
    try { await bf.completeBusinessReservation(oid); } catch (e) { confirmErr = e.message; }
    const cols = has(20270430) ? 'status, customer_done_at, visit_confirmed_at' : 'status';
    const row = (await svc(`select ${cols} from business_request_offers where id = $1`, [oid])).rows[0];
    if (has(20270430)) {
      if (confirmErr || !row.customer_done_at || !row.visit_confirmed_at) throw new Error(`0430 semantics: ${JSON.stringify({ row, confirmErr })}`);
    } else if (row.status !== 'completed') throw new Error(`not completed: ${JSON.stringify({ row, confirmErr })}`);
    return { row, businessSecondCall: confirmErr ? 'refused (already completed, pre-0430 semantics)' : 'ok' };
  });
});
