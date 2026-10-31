// User-content screening (migration 20270373): the app's half and the guards that keep the app, the edge function and the
// database on ONE rule. The protection itself is the database (journey ugcModeration).
const fs = require('fs');
const path = require('path');

jest.mock('./supabase', () => ({
  supabase: { auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: 'tok' } } })) }, rpc: jest.fn() },
  functionUrl: (name) => `https://example.invalid/functions/v1/${name}`,
}));
jest.mock('./textModeration', () => ({ checkTextModeration: jest.fn(async (text) => ({ safe: !/bad/.test(text) })) }));

const { screenUserContent, blockedByScreening, handledScreeningRefusal } = require('./userContentScreening');
const { normalizeUgcText, ugcRefusalOf, UGC_KINDS } = require('../utils/ugcText');
const { BASICS_FIELDS } = require('../constants/basicsFields');
const { MULTILINGUAL_SAMPLES } = require('../utils/ugcMultilingualSamples');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MIGRATION = read('supabase/migrations/20270373_user_content_screening.sql');
const EDGE = read('supabase/functions/screen-user-content/index.ts');
const CLASSIFIER = read('supabase/functions/_shared/userContentClassifier.ts');

function respond(status, body) {
  global.fetch = jest.fn(async () => ({ status, ok: status >= 200 && status < 300, json: async () => body }));
}

describe('screenUserContent: the app never writes public text the server could not check', () => {
  afterEach(() => { delete global.fetch; });

  test('passes the server outcome through; empty text needs no call', async () => {
    respond(200, { outcome: 'hold', results: [] });
    expect(await screenUserContent([{ text: ' Hi ', kind: 'bio' }])).toEqual({ outcome: 'hold' });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ texts: [{ text: 'Hi', kind: 'bio' }] });
    global.fetch = jest.fn();
    expect(await screenUserContent([{ text: '   ', kind: 'bio' }])).toEqual({ outcome: 'publish' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('fails closed: service down, malformed answer or a network error = unavailable; the limit = limit', async () => {
    respond(503, { code: 'screening_unavailable' });
    expect((await screenUserContent([{ text: 'x', kind: 'bio' }])).outcome).toBe('unavailable');
    respond(200, { outcome: 'maybe' });
    expect((await screenUserContent([{ text: 'x', kind: 'bio' }])).outcome).toBe('unavailable');
    global.fetch = jest.fn(async () => { throw new Error('offline'); });
    expect((await screenUserContent([{ text: 'x', kind: 'bio' }])).outcome).toBe('unavailable');
    respond(429, { code: 'usage_limit' });
    expect((await screenUserContent([{ text: 'x', kind: 'bio' }])).outcome).toBe('limit');
  });

  test("before 20270373 is live (function missing / not installed) the app keeps today's check", async () => {
    respond(404, null);
    expect((await screenUserContent([{ text: 'fine', kind: 'bio' }])).outcome).toBe('publish');
    respond(200, { code: 'not_installed' });
    expect((await screenUserContent([{ text: 'bad words', kind: 'bio' }])).outcome).toBe('refuse');
  });

  test('blockedByScreening stops the save for refuse / unavailable / limit, never for publish / hold', () => {
    const Alert = { alert: jest.fn() };
    const t = (k) => k;
    const words = { notAllowedTitle: 'T', notAllowedBody: 'B' };
    expect(blockedByScreening(Alert, t, { outcome: 'publish' }, words)).toBe(false);
    expect(blockedByScreening(Alert, t, { outcome: 'hold' }, words)).toBe(false);
    expect(blockedByScreening(Alert, t, { outcome: 'refuse' }, words)).toBe(true);
    expect(Alert.alert).toHaveBeenLastCalledWith('T', 'B');
    expect(blockedByScreening(Alert, t, { outcome: 'unavailable' }, words)).toBe(true);
    expect(Alert.alert).toHaveBeenLastCalledWith('ui.shared.errors.contentCheckUnavailableTitle', 'ui.shared.errors.contentCheckUnavailable');
    expect(blockedByScreening(Alert, t, { outcome: 'limit' }, words)).toBe(true);
  });

  test("the database's refusals map to the person's words (and nothing else does)", () => {
    const Alert = { alert: jest.fn() };
    const t = (k) => k;
    expect(ugcRefusalOf({ hint: 'screening_required' })).toBe('screening_required');
    expect(ugcRefusalOf({ hint: 'rate_limited' })).toBeNull();
    expect(handledScreeningRefusal(Alert, t, { hint: 'rate_limited' })).toBe(false);
    expect(handledScreeningRefusal(Alert, t, { hint: 'content_not_allowed' }, { notAllowedTitle: 'T', notAllowedBody: 'B' })).toBe(true);
    expect(Alert.alert).toHaveBeenLastCalledWith('T', 'B');
    expect(handledScreeningRefusal(Alert, t, { hint: 'content_held' })).toBe(true);
    expect(Alert.alert).toHaveBeenLastCalledWith('ui.shared.contentHeldTitle', 'ui.onboarding.nameNeedsReview');
  });
});

describe('one rule across the app, the edge function and the database', () => {
  test('the trim rule is the same pattern in all three, and behaves as the database does', () => {
    expect(EDGE).toContain(String.raw`text.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '')`);
    expect(MIGRATION).toContain(String.raw`regexp_replace(coalesce(p_text, ''), '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g')`);
    expect(normalizeUgcText('  hi there \n\t')).toBe('hi there');
    expect(normalizeUgcText(' hi ')).toBe(' hi '); // only ASCII whitespace, like the database
  });

  test('the free-text basics keys the database screens = BASICS_FIELDS type text', () => {
    const sqlKeys = /ugc_basics_text[\s\S]*?unnest\(array\[([^\]]+)\]/.exec(MIGRATION)[1].match(/'([a-z_]+)'/g).map((k) => k.slice(1, -1));
    expect(sqlKeys.sort()).toEqual(BASICS_FIELDS.filter((f) => f.type === 'text').map((f) => f.key).sort());
  });

  test('risk categories: classifier list = the database check constraint', () => {
    const edge = /USER_RISK_CATEGORIES = \[([\s\S]*?)\]/.exec(CLASSIFIER)[1].match(/'([a-z_]+)'/g).map((k) => k.slice(1, -1));
    const sql = /categories <@ array\[([\s\S]*?)\]/.exec(MIGRATION)[1].match(/'([a-z_]+)'/g).map((k) => k.slice(1, -1));
    expect(edge.sort()).toEqual(sql.sort());
  });

  test('languages: the 11 app languages = the classifier list = the calibration rows (+ und, names), all pending', () => {
    const app = /SUPPORTED_LANGUAGES = \[([^\]]+)\]/.exec(read('src/context/LanguageContext.js'))[1].match(/'([a-z]+)'/g).map((k) => k.slice(1, -1));
    const edge = /APP_LANGUAGES = \[([^\]]+)\]/.exec(CLASSIFIER)[1].match(/'([a-z]+)'/g).map((k) => k.slice(1, -1));
    const seed = /insert into private\.ugc_language_calibration \(language\)\s*values ([^;]+);/.exec(MIGRATION)[1].match(/'([a-z]+)'/g).map((k) => k.slice(1, -1));
    expect(edge.sort()).toEqual([...app].sort());
    expect(seed.sort()).toEqual([...app, 'und', 'names'].sort());
    expect(MIGRATION).not.toMatch(/update private\.ugc_language_calibration/); // nothing calibrated by the migration
    expect(MULTILINGUAL_SAMPLES.map(([l]) => l).sort()).toEqual([...app].sort());
  });

  test('every kind the app sends is a kind the edge function accepts', () => {
    const kinds = /TEXT_KINDS = \[([\s\S]*?)\]/.exec(CLASSIFIER)[1].match(/'([a-z_]+)'/g).map((k) => k.slice(1, -1));
    for (const k of Object.values(UGC_KINDS)) expect(kinds).toContain(k);
    expect(EDGE).toMatch(/NAME_KINDS = \['name', 'community_name'\]/);
  });

  test('the edge function never decides the outcome and never fails open', () => {
    expect(EDGE).toMatch(/record_ugc_screening/);
    expect(EDGE).not.toMatch(/safe:\s*true/);
    expect(EDGE).toMatch(/catch \(err\)[\s\S]*return unavailable\(\)/);
  });
});

describe('scope: public screens go through screening; private conversations never do', () => {
  const PUBLIC = ['src/screens/CreateGatheringScreen.js', 'src/screens/EditGatheringScreen.js', 'src/screens/CompleteProfileScreen.js',
    'src/screens/ProfileScreen.js', 'src/screens/CreateCommunityScreen.js', 'src/screens/EditCommunityScreen.js',
    'src/components/GatheringQnA.js', 'src/components/PhotoLightbox.js'];
  test.each(PUBLIC)('%s screens through screen-user-content', (file) => {
    const src = read(file);
    expect(src).toMatch(/screenUserContent\(/);
    expect(src).not.toMatch(/checkTextModeration/);
  });

  test('1:1 chat, group-plan chat and private notes never call screen-user-content (owner: no routine AI inspection)', () => {
    for (const file of ['src/screens/ChatScreen.js', 'src/services/planChat.js', 'src/screens/TogetherNotesScreen.js',
      'src/screens/MemoryVaultScreen.js']) {
      expect(read(file)).not.toMatch(/screenUserContent|screen-user-content/);
    }
    expect(MIGRATION).not.toMatch(/on public\.(messages|plan_messages)\b/);
  });
});
