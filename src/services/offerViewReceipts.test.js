// The customer's read receipt on a business reply (owner, 2026-11-15; 20270422): merged from business_offer_views on the
// customer side, never readable by the business. Guards the client merge, the old-database fallback and the business side.
const fs = require('fs');
const path = require('path');

let mockReceipts = { data: [], error: null };
let mockHeads = [];
const mockCalls = [];
jest.mock('./supabase', () => {
  const chain = (table) => {
    const q = { table, filters: [] };
    const self = {
      select: (cols, opts) => { q.cols = cols; q.head = !!opts?.head; return self; },
      in: (c, v) => { q.filters.push(['in', c, v]); return self; },
      eq: (c, v) => { q.filters.push(['eq', c, v]); return self; },
      not: (c, o, v) => { q.filters.push(['not', c, o, v]); return self; },
      then: (resolve, reject) => {
        mockCalls.push(q);
        const r = q.head ? mockHeads.shift() : mockReceipts;
        return Promise.resolve(r instanceof Error ? Promise.reject(r) : r).then(resolve, reject);
      },
    };
    return self;
  };
  return { supabase: { from: (t) => chain(t) } };
});

const { mergeViewReceipts, withViewReceipts, hasOpenedAnyReply } = require('./offerViewReceipts');

beforeEach(() => { mockCalls.length = 0; mockReceipts = { data: [], error: null }; mockHeads = []; });

describe('mergeViewReceipts', () => {
  it('a receipt row wins; no receipt keeps the row as it is', () => {
    const rows = [{ id: 'a', viewed_at: null }, { id: 'b', viewed_at: 'old' }, { id: 'c', viewed_at: null }];
    expect(mergeViewReceipts(rows, [{ offer_id: 'a', viewed_at: 't1' }, { offer_id: 'zz', viewed_at: 't9' }])).toEqual([
      { id: 'a', viewed_at: 't1' }, { id: 'b', viewed_at: 'old' }, { id: 'c', viewed_at: null },
    ]);
  });
  it('empty input stays empty', () => {
    expect(mergeViewReceipts(null, null)).toEqual([]);
  });
});

describe('withViewReceipts', () => {
  it('reads only the receipts for these offers and merges them', async () => {
    mockReceipts = { data: [{ offer_id: 'a', viewed_at: 't1' }], error: null };
    const out = await withViewReceipts([{ id: 'a', viewed_at: null }, { id: 'b', viewed_at: null }]);
    expect(out).toEqual([{ id: 'a', viewed_at: 't1' }, { id: 'b', viewed_at: null }]);
    expect(mockCalls[0]).toMatchObject({ table: 'business_offer_views', cols: 'offer_id, viewed_at', filters: [['in', 'offer_id', ['a', 'b']]] });
  });
  it('before 20270422 (table missing) keeps the offer row\'s own viewed_at', async () => {
    mockReceipts = { data: null, error: { code: '42P01', message: 'relation does not exist' } };
    const rows = [{ id: 'a', viewed_at: 'old' }];
    expect(await withViewReceipts(rows)).toBe(rows);
  });
  it('no rows = no read', async () => {
    expect(await withViewReceipts([])).toEqual([]);
    expect(mockCalls).toHaveLength(0);
  });
});

describe('hasOpenedAnyReply', () => {
  it('a receipt on one of the person\'s own requests = true, without the legacy read', async () => {
    mockHeads = [{ count: 1, error: null }];
    expect(await hasOpenedAnyReply('u1')).toBe(true);
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0].filters).toEqual([['eq', 'business_request_offers.business_requests.requester_id', 'u1']]);
  });
  it('no receipt: falls back to the offer row (old database), false when neither', async () => {
    mockHeads = [{ count: 0, error: null }, { count: 0, error: null }];
    expect(await hasOpenedAnyReply('u1')).toBe(false);
    mockHeads = [{ count: null, error: { code: 'PGRST200' } }, { count: 2, error: null }];
    expect(await hasOpenedAnyReply('u1')).toBe(true);
  });
  it('both reads failing = unknown (null), so the caller shows the normal wording', async () => {
    mockHeads = [{ count: null, error: { code: 'x' } }, { count: null, error: { code: 'x' } }];
    expect(await hasOpenedAnyReply('u1')).toBeNull();
  });
});

describe('the business side never reads a view receipt', () => {
  const root = path.join(__dirname, '..');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const migration = fs.readFileSync(path.join(root, '..', 'supabase/migrations/20270422_business_offer_view_privacy.sql'), 'utf8');
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('business screens and services never mention viewed_at / viewed_count', () => {
    for (const f of ['screens/BusinessDashboardScreen.js', 'utils/offerPerformanceView.js', 'services/businessIntelligence.js']) {
      if (!fs.existsSync(path.join(root, f))) continue;
      expect(code(read(f))).not.toMatch(/\bviewed_at|\bviewed_count|\bviewedCount/);
    }
  });
  it('the customer readers merge receipts from business_offer_views', () => {
    expect(read('services/offerArrivalSource.js')).toMatch(/withViewReceipts\(data/);
    expect(read('services/offerArrivalSource.js')).toMatch(/hasOpenedAnyReply\(userId\)/);
    expect(read('services/businessFulfillment.js')).toMatch(/await withViewReceipts\(offers/);
  });
  it('20270422 removes the field from both business functions and keeps it off the offer row', () => {
    const gbo = migration.slice(migration.indexOf('FUNCTION public.get_business_opportunities'), migration.indexOf('drop function public.get_partner_offer_performance'));
    expect(gbo).toMatch(/bro\.availability_id, bro\.decline_reason/);
    expect(gbo).not.toMatch(/viewed/);
    const perf = migration.slice(migration.indexOf('create function public.get_partner_offer_performance'));
    expect(perf).not.toMatch(/viewed/);
    expect(migration).toMatch(/check \(viewed_at is null\)/);
    expect(migration).toMatch(/is distinct from public\.my_managed_partner_id\(\)/);
    expect(migration).not.toMatch(/grant (insert|update|delete|all)[^;]*business_offer_views to authenticated/i);
  });
});
