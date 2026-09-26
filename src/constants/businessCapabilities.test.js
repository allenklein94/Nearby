import fs from 'fs';
import path from 'path';
import {
  CAPABILITIES, CAPABILITY_ATTRIBUTE_KEYS, EXCLUDED_CAPABILITIES, capabilitiesOf, cleanMaxGroupSize, maxGroupSizeProblem,
  privateEventAsk, cateringAsk, wordsBackedAttributes, capacityFit, applyCapabilitiesToCandidates,
  CAPACITY_FIT_POINTS, CAPACITY_TOO_SMALL_POINTS, PRIVATE_EVENTS_POINTS,
} from './businessCapabilities';
import { BUSINESS_ATTRIBUTE_OPTIONS, VENUE_PREFERENCE_OPTIONS } from './businessAttributes';
import { BOOKING_MODE_KEYS } from './bookingMode';
import { CATEGORY_GROUPS } from './gatheringCategories';
import { resolveAsk } from '../utils/askResolver';
import { extractAttributesFromText } from './businessAttributeExtraction';

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MIG = 'supabase/migrations/20270216_business_capabilities_catering_max_group.sql';
const biz = (id, partner, score = 5) => ({ type: 'business_availability', id, partnerId: id, score, subtitle: 'Open now', businessPartner: partner });

describe('capabilities are a named view over the one attribute vocabulary', () => {
  it('Private events, Groups, Outdoor dining and Catering; every one is a real attribute key', () => {
    expect(CAPABILITIES.map((c) => c.label)).toEqual(['Private events', 'Groups', 'Outdoor dining', 'Catering']);
    const keys = BUSINESS_ATTRIBUTE_OPTIONS.map((o) => o.key);
    for (const k of CAPABILITY_ATTRIBUTE_KEYS) expect(keys).toContain(k);
  });
  it('Catering is a valid, declarable, business-only attribute found from plain text', () => {
    expect(BUSINESS_ATTRIBUTE_OPTIONS.find((o) => o.key === 'catering')?.label).toBe('Catering');
    expect(VENUE_PREFERENCE_OPTIONS.map((o) => o.key)).not.toContain('catering');
    expect(extractAttributesFromText('We cater birthdays and office parties')).toContain('catering');
    expect(capabilitiesOf({ attributes: ['catering', 'quiet'] }).map((c) => c.key)).toEqual(['catering']);
  });
  it('Delivery and Takeout exist nowhere: not a capability, attribute, category, filter or edge/DB list', () => {
    const blob = [MIG, 'supabase/functions/create-assistant/index.ts', 'supabase/functions/business-onboarding-assistant/index.ts',
      'supabase/functions/screen-business-content/index.ts', 'supabase/functions/submit-business-application/index.ts'].map(read).join('\n');
    const allTags = CATEGORY_GROUPS.flatMap((g) => g.tags).map((t) => t.toLowerCase());
    for (const w of EXCLUDED_CAPABILITIES) {
      expect(CAPABILITIES.map((c) => c.key)).not.toContain(w);
      expect(BUSINESS_ATTRIBUTE_OPTIONS.map((o) => o.key)).not.toContain(w);
      expect(allTags).not.toContain(w);
      expect(blob).not.toMatch(new RegExp(`'${w}'|"${w}"`));
    }
    expect(read('src/constants/businessCapabilities.js').replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/'delivery'\s*,\s*label|'takeout'\s*,\s*label/);
  });
  it('Reservations stay the booking mode, not a capability', () => {
    expect(CAPABILITIES.map((c) => c.key)).not.toContain('reservations');
    expect(CAPABILITY_ATTRIBUTE_KEYS).not.toContain('reservation_required');
    expect(BOOKING_MODE_KEYS).toEqual(expect.arrayContaining(['reservation_recommended', 'reservation_required']));
  });
  it('no new taxonomy or store: only the vocabulary widening, one column and one setter', () => {
    const sql = read(MIG).replace(/^\s*--.*$/gm, '');
    expect(sql).not.toMatch(/create table/i);
    expect((sql.match(/add column/gi) ?? []).length).toBe(1);
  });
});

describe('largest group a business can host', () => {
  it('accepts whole numbers 1-5000; blank is unknown; nothing is guessed', () => {
    expect(cleanMaxGroupSize(30)).toBe(30);
    expect(cleanMaxGroupSize('12')).toBe(12);
    for (const v of ['', '  ', null, undefined]) expect(cleanMaxGroupSize(v)).toBeNull();
    for (const v of [0, -3, 5001, 2.5, 'abc']) expect(cleanMaxGroupSize(v)).toBeNull();
    expect(maxGroupSizeProblem('')).toBeNull();
    expect(maxGroupSizeProblem('0')).toMatch(/1 to 5000/);
    expect(capabilitiesOf({ attributes: ['group_friendly'] }).map((c) => c.key)).toEqual(['groups']);
  });
  it('the DB mirrors it: nullable integer, CHECK 1-5000, owner-only setter', () => {
    const sql = read(MIG);
    expect(sql).toMatch(/add column if not exists max_group_size integer;/);
    expect(sql).toMatch(/max_group_size between 1 and 5000/);
    expect(sql).toMatch(/managed_partner_id = partner_id_param/);
    expect(sql).toMatch(/revoke all on function public\.set_business_max_group_size\(uuid, integer\) from public, anon/);
    expect(sql).not.toMatch(/max_group_size\s*=\s*coalesce|default\s+\d/i);
  });
  it('covers the party = +2, too small = strongly down, unknown = neutral; total people, never +1', () => {
    expect(capacityFit(20, 20)).toEqual({ delta: CAPACITY_FIT_POINTS, reason: 'Can host your group' });
    expect(capacityFit(19, 20)).toEqual({ delta: CAPACITY_TOO_SMALL_POINTS, reason: null });
    expect(capacityFit(null, 20)).toEqual({ delta: 0, reason: null });
    expect(capacityFit(30, null)).toEqual({ delta: 0, reason: null });
    expect(CAPACITY_TOO_SMALL_POINTS).toBeLessThan(-CAPACITY_FIT_POINTS);
    expect(read('src/constants/businessCapabilities.js').replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/partySize\s*\+\s*1|size\s*\+\s*1/);
  });
  it('ranking: fits first, unknown kept, too small last but never removed', () => {
    const out = applyCapabilitiesToCandidates(
      [biz('small', { attributes: [], max_group_size: 8 }), biz('unknown', { attributes: [] }), biz('big', { attributes: [], max_group_size: 40 })],
      { partySize: 20, text: 'somewhere for a 20-person birthday' },
    ).sort((a, b) => b.score - a.score);
    expect(out.map((c) => c.id)).toEqual(['big', 'unknown', 'small']);
    expect(out).toHaveLength(3);
    expect(out.find((c) => c.id === 'unknown').score).toBe(5);
  });
  it('the routing function uses it (too small last, covering ahead of unknown) and reads the party size as stored', () => {
    const sql = read(MIG);
    expect(sql).toMatch(/e\.max_group_size < v_req_party\) asc/);
    expect(sql).toMatch(/e\.max_group_size >= v_req_party\) desc/);
    expect(sql).not.toMatch(/v_req_party\s*\+\s*1/);
  });
});

describe('private events: only from explicit words', () => {
  it.each(['a private room for 20', 'private dining for our anniversary', 'a private party for my birthday', 'host a private event',
    'a venue for a private birthday', 'private space for our anniversary', 'private anniversary dinner', 'private event for 30'])(
    '"%s" asks for private events', (t) => expect(privateEventAsk(t)).toBe(true));
  it.each(['birthday dinner for 12', 'anniversary for 12', 'I need somewhere for a 20-person birthday', 'a big group dinner for 25',
    'birthday party', 'private', 'no private room needed', 'my private life'])('"%s" does not', (t) => expect(privateEventAsk(t)).toBe(false));

  it('an AI-inferred private_dining / catering is dropped unless the words say it', () => {
    expect(wordsBackedAttributes(['private_dining', 'group_friendly'], 'birthday dinner for 12')).toEqual(['group_friendly']);
    expect(wordsBackedAttributes(['private_dining'], 'private room for 12')).toEqual(['private_dining']);
    expect(wordsBackedAttributes(['catering'], 'party for 20')).toEqual([]);
    expect(resolveAsk('birthday dinner for 12', { attributes: ['private_dining'] }).attributes).not.toContain('private_dining');
  });

  it('a declared Private events business gets a modest labeled lift, only when asked', () => {
    const p = { attributes: ['private_dining'] };
    const [asked] = applyCapabilitiesToCandidates([biz('a', p)], { text: 'private room for a birthday' });
    expect(asked.score).toBe(5 + PRIVATE_EVENTS_POINTS);
    expect(asked.subtitle).toBe('Hosts private events');
    for (const text of ['birthday dinner for 12', 'anniversary for 12', 'a 20-person birthday']) {
      const [c] = applyCapabilitiesToCandidates([biz('a', p)], { text, partySize: 12 });
      expect(c.subtitle).not.toBe('Hosts private events');
      expect(c.score).toBe(5);
    }
    // asked but not declared: nothing, and never removed
    const out = applyCapabilitiesToCandidates([biz('a', p), biz('b', { attributes: [] })], { text: 'private room' });
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.id === 'b').score).toBe(5);
  });

  it('catering: words + declared = "Offers catering"; never from a party alone', () => {
    expect(cateringAsk('can someone cater our party')).toBe(true);
    expect(cateringAsk('birthday party for 30')).toBe(false);
    const [c] = applyCapabilitiesToCandidates([biz('a', { attributes: ['catering'] })], { text: 'catering for a birthday' });
    expect(c.subtitle).toBe('Offers catering');
  });
});

describe('the owner\'s example end to end (words only, no AI)', () => {
  it('"somewhere for a 20-person birthday" = party 20 + birthday, no private-event ask', () => {
    const r = resolveAsk('I need somewhere for a 20-person birthday', null);
    expect(r.group.partySize).toBe(20);
    expect(r.occasion).toBe('birthday');
    expect(r.attributes).not.toContain('private_dining');
    expect(privateEventAsk('I need somewhere for a 20-person birthday')).toBe(false);
  });
});

describe('privacy and scope', () => {
  it('the largest-group number and capabilities never enter a business-facing payload', () => {
    const migs = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).sort();
    for (const fn of ['get_business_opportunities', 'get_partner_demand_signals', 'business_safe_request_summary']) {
      const last = migs.filter((m) => new RegExp(`function\\s+public\\.${fn}\\b`, 'i').test(read(`supabase/migrations/${m}`))).pop();
      expect([fn, /max_group_size/.test(read(`supabase/migrations/${last}`))]).toEqual([fn, false]);
    }
    // the capability module talks to no server and no AI
    expect(read('src/constants/businessCapabilities.js').replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/fetch\(|supabase|functions\.invoke|anthropic/i);
  });
  it('typed asks only: the resolvers use it, feeds and people discovery do not', () => {
    const users = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })
      .filter((f) => /\.js$/.test(f) && !/test\.js$/.test(f) && /from '[^']*businessCapabilities'/.test(read(`src/${f}`)))
      .map((f) => f.split(path.sep).join('/')).sort();
    expect(users).toEqual(['screens/BusinessDashboardScreen.js', 'services/intentResolver.js', 'utils/askResolver.js']);
  });
});
