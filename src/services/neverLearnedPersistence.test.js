// Item 183 follow-up (owner, LOCKED): a Faith & Spirituality search resolves normally but the app never sends its category,
// words or result title to the search/tap logs, and never sends a typed-ask audit for it. Coffee is logged as before.
const inserts = [];
const rpcs = [];
jest.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'u1' } } })) },
    from: jest.fn((table) => ({
      insert: jest.fn((row) => {
        inserts.push({ table, row });
        const done = Promise.resolve({ data: { id: 'sub1' }, error: null });
        return Object.assign(done, { select: () => ({ single: () => done }) });
      }),
    })),
    rpc: jest.fn((name, args) => { rpcs.push({ name, args }); return Promise.resolve({ error: null }); }),
  },
}));
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'denied' })) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000001' }));

const { recordIntentSubmission, recordIntentSelection } = require('./intentOutcomes');
const { recordTypedAsk } = require('./typedAskAudit');

beforeEach(() => { inserts.length = 0; rpcs.length = 0; });

describe('search logs', () => {
  it('a Faith search is logged with no category and no words', async () => {
    await recordIntentSubmission({ rawText: 'church near me', category: 'Faith & Spirituality', intentKind: 'gathering', hadAnyResult: true });
    expect(inserts[0].table).toBe('intent_submissions');
    expect(inserts[0].row.category).toBeNull();
    expect(inserts[0].row.raw_text).toBeNull();
    expect(inserts[0].row.had_any_result).toBe(true); // the search itself still happened and returned results
  });

  it('a Coffee search is logged normally', async () => {
    await recordIntentSubmission({ rawText: 'coffee near me', category: 'Coffee', intentKind: 'gathering', hadAnyResult: true });
    expect(inserts[0].row.category).toBe('Coffee');
    expect(inserts[0].row.raw_text).toBe('coffee near me');
  });

  it('a tap on a Faith result keeps no category, words or title', async () => {
    await recordIntentSelection({ rawText: 'church', category: 'Faith & Spirituality', resultType: 'gathering', resultId: 'g1', resultTitle: "St. Mary's" });
    expect(inserts[0].table).toBe('intent_outcomes');
    expect(inserts[0].row).toMatchObject({ category: null, raw_text: null, result_title: null });
    await recordIntentSelection({ rawText: 'coffee', category: 'Coffee', resultType: 'gathering', resultId: 'g2', resultTitle: 'Latte club' });
    expect(inserts[1].row).toMatchObject({ category: 'Coffee', raw_text: 'coffee', result_title: 'Latte club' });
  });
});

describe('typed-ask audit', () => {
  const result = (category) => ({ items: [{ type: 'gathering', id: 'g1', title: 'x' }], submissionId: null, audit: null, classifyResult: { category, intent: 'gathering' } });

  it('a Faith ask is shown but never audited', () => {
    const out = recordTypedAsk('home', result('Faith & Spirituality'));
    expect(out.snapshotId).toBeNull();
    expect(rpcs).toHaveLength(0);
  });

  it('a Coffee ask is audited', () => {
    recordTypedAsk('home', result('Coffee'));
    expect(rpcs.map((r) => r.name)).toEqual(['record_typed_ask_snapshot']);
  });
});

describe('declared interest is untouched', () => {
  it('nothing in the never-learned rule touches profile interests', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../constants/neverLearned.js'), 'utf8')
      + fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270281_never_learned_search_persistence.sql'), 'utf8');
    expect(src).not.toMatch(/profiles|interests\s*=/);
  });
});
