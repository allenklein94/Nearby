// Idea 9 (20270382): Dating Browse reads strangers through browse_dating_candidates; the view is only the pre-deploy
// fallback, and no other error ever falls back (a refused / limited call must never be retried as a wider read).
const mockCalls = [];
const mockViewQuery = {
  select: jest.fn(function select(c) { mockCalls.push(['select', c]); return this; }),
  in: jest.fn(function inFn(col, v) { mockCalls.push(['in', col, v]); return this; }),
  order: jest.fn(function order() { return this; }),
  range: jest.fn(async (a, b) => { mockCalls.push(['range', a, b]); return { data: [{ id: 'v1', age: 30 }], error: null }; }),
};
jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn(() => mockViewQuery) } }));
const { supabase } = require('./supabase');
const { browseDatingCandidates, isMissingFunction } = require('./datingBrowse');

const args = { buckets: ['26.5,-80.1'], offset: 20, limit: 20, columns: 'id, age' };

beforeEach(() => { mockCalls.length = 0; supabase.rpc.mockReset(); supabase.from.mockClear(); });

test('uses the server function with the page it was asked for', async () => {
  supabase.rpc.mockResolvedValue({ data: [{ id: 'a' }], error: null });
  const res = await browseDatingCandidates(args);
  expect(supabase.rpc).toHaveBeenCalledWith('browse_dating_candidates', { buckets_param: ['26.5,-80.1'], offset_param: 20, limit_param: 20 });
  expect(res).toEqual({ data: [{ id: 'a' }], error: null });
  expect(supabase.from).not.toHaveBeenCalled();
});

test('falls back to the view only when the function does not exist yet', async () => {
  supabase.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } });
  const res = await browseDatingCandidates(args);
  expect(supabase.from).toHaveBeenCalledWith('dating_candidates_visible_to_me');
  expect(mockCalls).toContainEqual(['range', 20, 39]);
  expect(res.data).toEqual([{ id: 'v1', age: 30 }]);
});

test('any other error is returned, never retried as a view read', async () => {
  supabase.rpc.mockResolvedValue({ data: null, error: { code: '22023', hint: 'discovery_page_limit' } });
  const res = await browseDatingCandidates(args);
  expect(supabase.from).not.toHaveBeenCalled();
  expect(res.error.hint).toBe('discovery_page_limit');
});

test('missing-function codes', () => {
  expect(isMissingFunction({ code: 'PGRST202' })).toBe(true);
  expect(isMissingFunction({ code: '42883' })).toBe(true);
  expect(isMissingFunction({ code: '42501' })).toBe(false);
  expect(isMissingFunction(null)).toBe(false);
});
