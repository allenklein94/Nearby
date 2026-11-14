import fs from 'fs';
import path from 'path';
import { createBrowsePool, BROWSE_PAGE_SIZE, BROWSE_POOL_WINDOW, BROWSE_POOL_TTL_MS } from './browsePool';

// A fake view: rows with ids 'p0001'.. in id order; `eligible(row)` = passes the hard filters; score = ranking.
function fakeView(rows) {
  const calls = [];
  return {
    calls,
    fetchWindow: async (afterId, size) => {
      calls.push({ afterId, size });
      return rows.filter((r) => afterId == null || r.id > afterId).slice(0, size);
    },
  };
}
const id = (n) => `p${String(n).padStart(4, '0')}`;
const rowsOf = (n, f = () => ({})) => Array.from({ length: n }, (_, i) => ({ id: id(i), score: i % 97, ...f(i) }));
const rankBy = (eligible = () => true) => (raw) => raw.filter(eligible).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
const allVisible = async (ids) => new Set(ids);

async function readAll(pool, size = BROWSE_PAGE_SIZE) {
  const out = [];
  let offset = 0;
  for (let guard = 0; guard < 1000; guard += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { items, hasMore } = await pool.page(offset, size);
    out.push(...items);
    if (!hasMore) return out;
    offset += size;
  }
  throw new Error('never ended');
}

describe('defaults', () => {
  test('page 20, window 300 (configurable), reuse 5 minutes', () => {
    expect(BROWSE_PAGE_SIZE).toBe(20);
    expect(BROWSE_POOL_WINDOW).toBe(300);
    expect(BROWSE_POOL_TTL_MS).toBe(5 * 60 * 1000);
  });
});

describe('the premature "no more people" bug', () => {
  test('a first window of 20 that filters down to nobody does not end Browse', async () => {
    // 40 rows; the first 20 fail the filters (old code: page 1 empty -> hasMore false -> Browse stopped).
    const rows = rowsOf(40, (i) => ({ ok: i >= 20 }));
    const view = fakeView(rows);
    const pool = createBrowsePool({ ...view, rankWindow: rankBy((r) => r.ok), confirmVisible: allVisible, windowSize: 20 });
    const first = await pool.page(0);
    expect(first.items).toHaveLength(20);
    expect(first.items.every((r) => r.ok)).toBe(true);
  });

  test('several empty windows in a row are skipped until someone eligible or the end', async () => {
    const rows = rowsOf(100, (i) => ({ ok: i === 95 }));
    const pool = createBrowsePool({ ...fakeView(rows), rankWindow: rankBy((r) => r.ok), confirmVisible: allVisible, windowSize: 10 });
    const { items, hasMore } = await pool.page(0);
    expect(items.map((r) => r.id)).toEqual([id(95)]);
    expect(hasMore).toBe(false);
  });

  test('nobody eligible at all = an honest empty end', async () => {
    const pool = createBrowsePool({ ...fakeView(rowsOf(30)), rankWindow: rankBy(() => false), confirmVisible: allVisible, windowSize: 20 });
    expect(await pool.page(0)).toEqual({ items: [], hasMore: false });
  });
});

describe('global ranking + stable pages', () => {
  test('within one window the order is global: the best of all 300 comes first', async () => {
    const rows = rowsOf(300, (i) => ({ score: i === 250 ? 1000 : i % 50 }));
    const pool = createBrowsePool({ ...fakeView(rows), rankWindow: rankBy(), confirmVisible: allVisible });
    const { items } = await pool.page(0);
    expect(items[0].id).toBe(id(250)); // old per-batch ranking would have shown it on page 13
  });

  test('every eligible person exactly once, across page and window boundaries', async () => {
    const rows = rowsOf(1234, (i) => ({ ok: i % 3 !== 0 }));
    const pool = createBrowsePool({ ...fakeView(rows), rankWindow: rankBy((r) => r.ok), confirmVisible: allVisible });
    const seen = await readAll(pool);
    const expected = rows.filter((r) => r.ok).map((r) => r.id).sort();
    expect(seen.map((r) => r.id).sort()).toEqual(expected);
    expect(new Set(seen.map((r) => r.id)).size).toBe(seen.length);
  });

  test('reading the same page twice gives the same people (stable)', async () => {
    const pool = createBrowsePool({ ...fakeView(rowsOf(700)), rankWindow: rankBy(), confirmVisible: allVisible });
    const a = await pool.page(20);
    const b = await pool.page(20);
    expect(b.items.map((r) => r.id)).toEqual(a.items.map((r) => r.id));
  });

  test('pages that straddle a window boundary are filled from the next window, order preserved', async () => {
    const pool = createBrowsePool({ ...fakeView(rowsOf(45)), rankWindow: rankBy(), confirmVisible: allVisible, windowSize: 30 });
    const p1 = await pool.page(20); // items 20-39: 10 from window 1, 10 from window 2
    expect(p1.items).toHaveLength(20);
    const p0 = await pool.page(0);
    expect(p0.items).toHaveLength(20); // earlier positions never moved
    expect(new Set([...p0.items, ...p1.items].map((r) => r.id)).size).toBe(40);
  });
});

describe('the window cap is a performance safeguard, not an end', () => {
  test('a full window always means "maybe more": people beyond 300 are still reached', async () => {
    const rows = rowsOf(301);
    const view = fakeView(rows);
    const pool = createBrowsePool({ ...view, rankWindow: rankBy(), confirmVisible: allVisible });
    const seen = await readAll(pool);
    expect(seen).toHaveLength(301);
    expect(view.calls.map((c) => c.afterId)).toEqual([null, id(299)]); // keyset: continues after the last id read
  });

  test('exactly 300 rows: one more (empty) read confirms the end; never ends on a full window', async () => {
    const view = fakeView(rowsOf(300));
    const pool = createBrowsePool({ ...view, rankWindow: rankBy(), confirmVisible: allVisible });
    const last = await pool.page(280);
    expect(last.hasMore).toBe(true);
    const after = await pool.page(300);
    expect(after).toEqual({ items: [], hasMore: false });
    expect(view.calls).toHaveLength(2);
  });

  test('reads only as many windows as the pages asked for', async () => {
    const view = fakeView(rowsOf(5000));
    const pool = createBrowsePool({ ...view, rankWindow: rankBy(), confirmVisible: allVisible });
    await pool.page(0);
    await pool.page(20);
    expect(view.calls).toHaveLength(1);
  });
});

describe('re-checked before showing', () => {
  test('someone the server stopped returning (block, left Dating) is dropped and the page refilled', async () => {
    const rows = rowsOf(30);
    let hidden = new Set();
    const pool = createBrowsePool({
      ...fakeView(rows),
      rankWindow: rankBy(),
      confirmVisible: async (ids) => new Set(ids.filter((x) => !hidden.has(x))),
    });
    const before = await pool.page(0);
    hidden = new Set([before.items[0].id, before.items[5].id]);
    const nextPage = await pool.page(20);
    expect(nextPage.items.some((r) => hidden.has(r.id))).toBe(false);
    const fresh = createBrowsePool({ ...fakeView(rows), rankWindow: rankBy(), confirmVisible: async (ids) => new Set(ids.filter((x) => !hidden.has(x))) });
    const p0 = await fresh.page(0);
    expect(p0.items).toHaveLength(20);
    expect(p0.items.some((r) => hidden.has(r.id))).toBe(false);
  });

  test('re-checks only the people about to be shown', async () => {
    const asked = [];
    const pool = createBrowsePool({ ...fakeView(rowsOf(300)), rankWindow: rankBy(), confirmVisible: async (ids) => { asked.push(ids.length); return new Set(ids); } });
    await pool.page(0);
    expect(asked).toEqual([20]);
  });
});

describe('reuse', () => {
  test('fresh for 5 minutes, then stale', () => {
    let t = 1000;
    const pool = createBrowsePool({ ...fakeView([]), rankWindow: rankBy(), confirmVisible: allVisible, now: () => t });
    t += BROWSE_POOL_TTL_MS - 1;
    expect(pool.isFresh()).toBe(true);
    t += 1;
    expect(pool.isFresh()).toBe(false);
  });
});

describe('wiring guard', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const prox = read('services/proximity.js');
  const screen = read('screens/DiscoveryScreen.js');

  test('Browse reads the Dating view in id-keyset windows and re-checks before showing', () => {
    expect(prox).toMatch(/createBrowsePool\(/);
    expect(prox).toMatch(/query\.gt\('id', afterId\)/);
    expect(prox).toMatch(/order\('id', \{ ascending: true \}\)\.limit\(size\)/);
    expect(prox).toMatch(/confirmVisible: async \(ids\) => \{\s*const \{ data, error \} = await supabase\.from\('dating_candidates_visible_to_me'\)/);
    expect(prox).not.toMatch(/\.range\(offset, offset \+ BROWSE_BATCH_SIZE - 1\)/);
  });

  test('ranking uses the shared compatibility + appearance rule; hard filters stay', () => {
    expect(prox).toMatch(/rankWindow: \(rows\) => rankDatingCandidates\(/);
    expect(prox).toMatch(/compatibilityScore: calculateCompatibility\(myProfile, p\)/);
    expect(prox).toMatch(/passesGenderMatch\(myProfile, p\)/);
    expect(prox).toMatch(/age < minAge \|\| age > maxAge/);
  });

  test('the screen takes hasMore from the pool, counts and signs only the shown page, and refreshes Browse as Browse', () => {
    expect(screen).toMatch(/const \{ items: results, hasMore \} = await getBrowseMatches\(offset\)/);
    expect(screen).toMatch(/setBrowseHasMore\(hasMore\)/);
    expect(screen).not.toMatch(/setBrowseHasMore\(results\.length > 0\)/);
    expect(screen).toMatch(/checkAndCountBrowseView\(myUserId, results\.length\)/);
    expect(screen).toMatch(/if \(discoveryMode === 'browse'\) \{\s*\/\/[^\n]*\n\s*resetBrowsePool\(\);/);
  });
});
