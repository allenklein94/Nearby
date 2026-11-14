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
// hydrate = the detail read of the shown page: every asked id still visible, details merged in.
const allVisible = async (ids) => new Map(ids.map((x) => [x, { display_name: `name-${x}` }]));

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
    const pool = createBrowsePool({ ...view, rankWindow: rankBy((r) => r.ok), hydrate: allVisible, windowSize: 20 });
    const first = await pool.page(0);
    expect(first.items).toHaveLength(20);
    expect(first.items.every((r) => r.ok)).toBe(true);
  });

  test('several empty windows in a row are skipped until someone eligible or the end', async () => {
    const rows = rowsOf(100, (i) => ({ ok: i === 95 }));
    const pool = createBrowsePool({ ...fakeView(rows), rankWindow: rankBy((r) => r.ok), hydrate: allVisible, windowSize: 10 });
    const { items, hasMore } = await pool.page(0);
    expect(items.map((r) => r.id)).toEqual([id(95)]);
    expect(hasMore).toBe(false);
  });

  test('nobody eligible at all = an honest empty end', async () => {
    const pool = createBrowsePool({ ...fakeView(rowsOf(30)), rankWindow: rankBy(() => false), hydrate: allVisible, windowSize: 20 });
    expect(await pool.page(0)).toEqual({ items: [], hasMore: false });
  });
});

describe('global ranking + stable pages', () => {
  test('within one window the order is global: the best of all 300 comes first', async () => {
    const rows = rowsOf(300, (i) => ({ score: i === 250 ? 1000 : i % 50 }));
    const pool = createBrowsePool({ ...fakeView(rows), rankWindow: rankBy(), hydrate: allVisible });
    const { items } = await pool.page(0);
    expect(items[0].id).toBe(id(250)); // old per-batch ranking would have shown it on page 13
  });

  test('every eligible person exactly once, across page and window boundaries', async () => {
    const rows = rowsOf(1234, (i) => ({ ok: i % 3 !== 0 }));
    const pool = createBrowsePool({ ...fakeView(rows), rankWindow: rankBy((r) => r.ok), hydrate: allVisible });
    const seen = await readAll(pool);
    const expected = rows.filter((r) => r.ok).map((r) => r.id).sort();
    expect(seen.map((r) => r.id).sort()).toEqual(expected);
    expect(new Set(seen.map((r) => r.id)).size).toBe(seen.length);
  });

  test('reading the same page twice gives the same people (stable)', async () => {
    const pool = createBrowsePool({ ...fakeView(rowsOf(700)), rankWindow: rankBy(), hydrate: allVisible });
    const a = await pool.page(20);
    const b = await pool.page(20);
    expect(b.items.map((r) => r.id)).toEqual(a.items.map((r) => r.id));
  });

  test('pages that straddle a window boundary are filled from the next window, order preserved', async () => {
    const pool = createBrowsePool({ ...fakeView(rowsOf(45)), rankWindow: rankBy(), hydrate: allVisible, windowSize: 30 });
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
    const pool = createBrowsePool({ ...view, rankWindow: rankBy(), hydrate: allVisible });
    const seen = await readAll(pool);
    expect(seen).toHaveLength(301);
    expect(view.calls.map((c) => c.afterId)).toEqual([null, id(299)]); // keyset: continues after the last id read
  });

  test('exactly 300 rows: one more (empty) read confirms the end; never ends on a full window', async () => {
    const view = fakeView(rowsOf(300));
    const pool = createBrowsePool({ ...view, rankWindow: rankBy(), hydrate: allVisible });
    const last = await pool.page(280);
    expect(last.hasMore).toBe(true);
    const after = await pool.page(300);
    expect(after).toEqual({ items: [], hasMore: false });
    expect(view.calls).toHaveLength(2);
  });

  test('reads only as many windows as the pages asked for', async () => {
    const view = fakeView(rowsOf(5000));
    const pool = createBrowsePool({ ...view, rankWindow: rankBy(), hydrate: allVisible });
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
      hydrate: async (ids) => new Map(ids.filter((x) => !hidden.has(x)).map((x) => [x, {}])),
    });
    const before = await pool.page(0);
    hidden = new Set([before.items[0].id, before.items[5].id]);
    const nextPage = await pool.page(20);
    expect(nextPage.items.some((r) => hidden.has(r.id))).toBe(false);
    const fresh = createBrowsePool({ ...fakeView(rows), rankWindow: rankBy(), hydrate: async (ids) => new Map(ids.filter((x) => !hidden.has(x)).map((x) => [x, {}])) });
    const p0 = await fresh.page(0);
    expect(p0.items).toHaveLength(20);
    expect(p0.items.some((r) => hidden.has(r.id))).toBe(false);
  });

  test('re-checks only the people about to be shown', async () => {
    const asked = [];
    const pool = createBrowsePool({ ...fakeView(rowsOf(300)), rankWindow: rankBy(), hydrate: async (ids) => { asked.push(ids.length); return new Map(ids.map((x) => [x, {}])); } });
    await pool.page(0);
    expect(asked).toEqual([20]);
  });
});

describe('reuse', () => {
  test('fresh for 5 minutes, then stale', () => {
    let t = 1000;
    const pool = createBrowsePool({ ...fakeView([]), rankWindow: rankBy(), hydrate: allVisible, now: () => t });
    t += BROWSE_POOL_TTL_MS - 1;
    expect(pool.isFresh()).toBe(true);
    t += 1;
    expect(pool.isFresh()).toBe(false);
  });
});

describe('narrow windows, details only for the shown page (optimization pass, 2026-11-14)', () => {
  test('the shown page carries the detail row; the pool never asks details for unshown people', async () => {
    const asked = [];
    const pool = createBrowsePool({
      ...fakeView(rowsOf(300)),
      rankWindow: rankBy(),
      hydrate: async (ids) => { asked.push(...ids); return new Map(ids.map((x) => [x, { display_name: `name-${x}`, photo_url: `${x}.jpg` }])); },
    });
    const { items } = await pool.page(0);
    expect(items.every((c) => c.profiles.display_name === `name-${c.id}` && c.profiles.photo_url === `${c.id}.jpg`)).toBe(true);
    expect(asked).toHaveLength(20);
    expect(new Set(asked)).toEqual(new Set(items.map((c) => c.id)));
  });

  test('the narrow fields used for ranking are kept beside the details', async () => {
    const pool = createBrowsePool({ ...fakeView(rowsOf(5).map((r) => ({ ...r, profiles: { age: 30 } }))), rankWindow: rankBy(), hydrate: allVisible });
    const { items } = await pool.page(0);
    expect(items[0].profiles).toMatchObject({ age: 30, display_name: `name-${items[0].id}` });
  });
});

describe('friends and matches leave at once (no 5-minute wait)', () => {
  test('exclusions are re-read on every page; a new friend in the unshown part never shows', async () => {
    const rows = rowsOf(100);
    let excluded = new Set();
    let reads = 0;
    const pool = createBrowsePool({ ...fakeView(rows), rankWindow: rankBy(), hydrate: allVisible, loadExcluded: async () => { reads += 1; return excluded; } });
    const p0 = await pool.page(0);
    const probe = await createBrowsePool({ ...fakeView(rows), rankWindow: rankBy(), hydrate: allVisible }).page(20);
    excluded = new Set([probe.items[0].id, probe.items[7].id]); // became friends / matched after page 1 was shown
    const p1 = await pool.page(20);
    expect(reads).toBe(2);
    expect(p1.items.some((c) => excluded.has(c.id))).toBe(false);
    expect(p1.items).toHaveLength(20);
    // positions already shown never move
    expect((await pool.page(0)).items.map((c) => c.id)).toEqual(p0.items.map((c) => c.id));
  });

  test('an excluded person is never ranked into a later window', async () => {
    const rows = rowsOf(40);
    const pool = createBrowsePool({ ...fakeView(rows), rankWindow: rankBy(), hydrate: allVisible, loadExcluded: async () => new Set([id(35)]), windowSize: 20 });
    const all = await readAll(pool);
    expect(all.map((c) => c.id)).not.toContain(id(35));
    expect(all).toHaveLength(39);
  });

  test('recheckShown names who must leave the screen now (excluded or no longer returned); positions untouched', async () => {
    let excluded = new Set();
    let hidden = new Set();
    const pool = createBrowsePool({
      ...fakeView(rowsOf(60)),
      rankWindow: rankBy(),
      hydrate: async (ids) => new Map(ids.filter((x) => !hidden.has(x)).map((x) => [x, {}])),
      loadExcluded: async () => excluded,
    });
    const p0 = await pool.page(0);
    const shownIds = p0.items.map((c) => c.id);
    excluded = new Set([shownIds[2]]);
    hidden = new Set([shownIds[4]]);
    expect(await pool.recheckShown(shownIds)).toEqual(new Set([shownIds[2], shownIds[4]]));
    const p1 = await pool.page(20);
    expect(p1.items).toHaveLength(20);
    expect(new Set([...shownIds, ...p1.items.map((c) => c.id)]).size).toBe(40); // no duplicates, nothing reshuffled
  });
});

describe('a failed read is never "no more people"', () => {
  test('a window read that fails leaves the pool as it was; asking again continues exactly where it stopped', async () => {
    const rows = rowsOf(700);
    const view = fakeView(rows);
    let failNext = false;
    const pool = createBrowsePool({
      fetchWindow: async (afterId, size) => { if (failNext) { failNext = false; throw new Error('Network request failed'); } return view.fetchWindow(afterId, size); },
      rankWindow: rankBy(),
      hydrate: allVisible,
    });
    const shown = [];
    for (let offset = 0; offset < 300; offset += 20) shown.push(...(await pool.page(offset)).items); // window 1 used up
    failNext = true;
    await expect(pool.page(300)).rejects.toThrow('Network request failed');
    expect(pool.exhausted).toBe(false);
    const retry = await pool.page(300);
    expect(retry.items).toHaveLength(20);
    expect(retry.hasMore).toBe(true);
    const ids = [...shown, ...retry.items].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('a detail read that fails changes nothing; the retry shows the same page', async () => {
    let fail = true;
    const pool = createBrowsePool({
      ...fakeView(rowsOf(50)),
      rankWindow: rankBy(),
      hydrate: async (ids) => { if (fail) throw new Error('500'); return new Map(ids.map((x) => [x, {}])); },
    });
    await expect(pool.page(0)).rejects.toThrow('500');
    fail = false;
    const expected = await createBrowsePool({ ...fakeView(rowsOf(50)), rankWindow: rankBy(), hydrate: allVisible }).page(0);
    expect((await pool.page(0)).items.map((c) => c.id)).toEqual(expected.items.map((c) => c.id));
  });

  test('an exclusions read that fails throws (Browse never shows people it could not check)', async () => {
    const pool = createBrowsePool({ ...fakeView(rowsOf(50)), rankWindow: rankBy(), hydrate: allVisible, loadExcluded: async () => { throw new Error('offline'); } });
    await expect(pool.page(0)).rejects.toThrow('offline');
  });
});

describe('stable pagination', () => {
  test('loading the next window appends: the first 300 positions never reshuffle even when window 2 ranks higher', async () => {
    const rows = rowsOf(600, (i) => ({ score: i >= 300 ? 10000 + i : i % 50 })); // everyone in window 2 outranks window 1
    const pool = createBrowsePool({ ...fakeView(rows), rankWindow: rankBy(), hydrate: allVisible });
    const firstPages = [];
    for (let offset = 0; offset < 300; offset += 20) firstPages.push(...(await pool.page(offset)).items.map((c) => c.id));
    await pool.page(300);
    const again = [];
    for (let offset = 0; offset < 300; offset += 20) again.push(...(await pool.page(offset)).items.map((c) => c.id));
    expect(again).toEqual(firstPages);
  });
});

describe('wiring guard', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const prox = read('services/proximity.js');
  const screen = read('screens/DiscoveryScreen.js');

  test('Browse reads narrow windows in id-keyset order and details only for the shown page', () => {
    expect(prox).toMatch(/createBrowsePool\(/);
    expect(prox).toMatch(/query\.gt\('id', afterId\)/);
    expect(prox).toMatch(/order\('id', \{ ascending: true \}\)\.limit\(size\)/);
    expect(prox).toMatch(/\}, BROWSE_RANK_COLUMNS\);/);
    expect(prox).toMatch(/hydrate: async \(ids\) => \{[\s\S]*?\.from\('dating_candidates_visible_to_me'\)[\s\S]*?\.in\('id', chunk\)[\s\S]*?DATING_CANDIDATE_COLUMNS\);/);
    expect(prox).toMatch(/loadExcluded: \(\) => readBrowseExclusions\(userId\)/);
    expect(prox).not.toMatch(/\.range\(offset, offset \+ BROWSE_BATCH_SIZE - 1\)/);
  });

  test('the narrow columns carry no card details (name, photo, bio, badges)', () => {
    const cols = prox.match(/export const BROWSE_RANK_COLUMNS = '([^']*)'/)[1].split(', ');
    for (const c of ['display_name', 'photo_url', 'bio', 'photo_verified', 'id_verified']) expect(cols).not.toContain(c);
    for (const c of ['id', 'age', 'ethnicity', 'interests', 'basics', 'height_inches', 'relationship_intention', 'gender_identity', 'interested_in_genders', 'show_me', 'discovery_gender', 'dating_opted_in']) expect(cols).toContain(c);
  });

  test('ranking uses the shared compatibility + appearance rule; the same hard filters gate windows and fresh rows', () => {
    expect(prox).toMatch(/rankWindow: \(rows\) => rankDatingCandidates\(/);
    expect(prox).toMatch(/compatibilityScore: calculateCompatibility\(myProfile, p\)/);
    expect(prox).toMatch(/passesGenderMatch\(myProfile, p\)/);
    expect(prox).toMatch(/age < minAge \|\| age > maxAge/);
    expect(prox).toMatch(/\.filter\(eligible\)/);
    expect(prox).toMatch(/if \(eligible\(row\)\) rows\.set\(row\.id, row\)/);
  });

  test('failures are reported as failed (never an exhausted pool) and leave the pool in place', () => {
    expect(prox).toMatch(/return \{ items: \[\], hasMore: true, failed: true, reset: false \};/);
    const getBody = prox.slice(prox.indexOf('export async function getBrowseMatches'), prox.indexOf('export async function recheckBrowseOnReturn'));
    expect(getBody).not.toMatch(/browsePoolCache = null/);
  });

  test('the screen: hasMore from the pool, failure state with Try Again, offset only moves on a shown page, no auto retry loop', () => {
    expect(screen).toMatch(/const \{ items: results, hasMore, failed, reset \} = await getBrowseMatches\(offset\)/);
    expect(screen).toMatch(/setBrowseHasMore\(hasMore\)/);
    expect(screen).not.toMatch(/setBrowseHasMore\(results\.length > 0\)/);
    expect(screen).toMatch(/if \(discoveryMode === 'browse' && browseLoadFailed\) \{\s*return <LoadErrorState onRetry=\{retryBrowse\} \/>;/);
    expect(screen).toMatch(/if \(auto && browseLoadFailed\) return;/);
    expect(screen).toMatch(/if \(result\.status === 'shown' \|\| result\.status === 'empty'\) setBrowseOffset\(result\.offset\);/);
    expect(screen).toMatch(/onEndReached=\{discoveryMode === 'browse' \? \(\) => loadMoreBrowse\(\{ auto: true \}\) : undefined\}/);
  });

  test('the screen counts and signs only the shown page, refreshes Browse as Browse, rechecks on return', () => {
    expect(screen).toMatch(/checkAndCountBrowseView\(myUserId, results\.map\(\(item\) => item\.id\)\)/);
    expect(screen).toMatch(/if \(discoveryMode === 'browse'\) \{\s*(\/\/[^\n]*\n\s*)+resetBrowsePool\(\);/);
    expect(screen).toMatch(/await recheckBrowseOnReturn\(shownIds\)/);
  });
});
