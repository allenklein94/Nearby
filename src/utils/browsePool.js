// Dating Browse candidate pool (owner, 2026-11-14, Option A; optimization pass the same day).
//
// Browse used to fetch 20 rows by id, filter them on the phone and rank only those; a page whose 20 rows all failed the
// person's filters came back empty and the screen read that as "no more people". Now the pool is built in WINDOWS:
// up to BROWSE_POOL_WINDOW raw rows (keyset paging by id: no row is ever skipped or read twice), filtered and ranked as
// one set, and the screen reveals BROWSE_PAGE_SIZE at a time. The order is global WITHIN a window, not across the whole
// Dating pool: when a window is used up and the view still had rows, the next window is fetched, ranked, and APPENDED
// (earlier positions never move, so paging never duplicates, skips or reshuffles anyone already shown). A window that
// filters down to nobody is never the end: only a window that came back short (the view ran out) is.
//
// Narrow read (optimization pass): a window carries only what eligibility and ranking need. The full card details
// (name, photo path, bio, verification badges) are read only for the page about to show, by `hydrate`, and that same
// read is the server re-check: anyone who blocked or was blocked, left Dating or disappeared since the window was read
// comes back missing and is dropped, and the page refilled.
//
// Exclusions (friends, matches) are re-read at the start of EVERY page (`loadExcluded`), so a new friend or match never
// waits for the pool to expire; anyone newly excluded is dropped from the not-yet-shown part of the pool only (positions
// already shown never move, so the screen's offset stays exact).
//
// A failed read (window, exclusions or details) throws and leaves the pool exactly as it was: the same page can be
// asked again and continues where it left off. It is never reported as "no more people".
//
// BROWSE_POOL_WINDOW is a performance safeguard, not a product limit: people beyond it are still reached, in the next
// window. The pool is reused for BROWSE_POOL_TTL_MS when the person comes back to Browse with the same inputs.

export const BROWSE_PAGE_SIZE = 20;
export const BROWSE_POOL_WINDOW = 300;
export const BROWSE_POOL_TTL_MS = 5 * 60 * 1000;

const defaultMerge = (candidate, row) => ({ ...candidate, profiles: { ...(candidate.profiles ?? {}), ...row } });

// fetchWindow(afterId, size) -> raw narrow rows ordered by id ascending, ids > afterId (afterId null = from the start).
// rankWindow(rawRows) -> the eligible, ranked candidates ({ id, ... }) of that window.
// hydrate(ids) -> Map id -> full row, only for the ids the server still returns AND that still pass the hard filters.
// loadExcluded() -> Set of ids never to show (friends, matches); optional.
export function createBrowsePool({
  fetchWindow, rankWindow, hydrate, loadExcluded, merge = defaultMerge, windowSize = BROWSE_POOL_WINDOW, now = Date.now,
}) {
  const items = [];
  const seen = new Set();
  let excluded = new Set();
  let lastId = null;
  let exhausted = false;
  const builtAt = now();

  // Drops excluded people from positions >= from (never from what was already shown).
  function dropExcludedFrom(from) {
    for (let i = items.length - 1; i >= from; i -= 1) {
      if (excluded.has(items[i].id)) items.splice(i, 1);
    }
  }

  async function fill(count) {
    while (items.length < count && !exhausted) {
      // eslint-disable-next-line no-await-in-loop
      const raw = (await fetchWindow(lastId, windowSize)) ?? [];
      const ranked = rankWindow(raw);
      // State moves only after the window was read and ranked: a throw above leaves the pool untouched.
      if (raw.length > 0) lastId = raw[raw.length - 1].id;
      if (raw.length < windowSize) exhausted = true;
      for (const candidate of ranked) {
        if (candidate?.id == null || seen.has(candidate.id) || excluded.has(candidate.id)) continue;
        seen.add(candidate.id);
        items.push(candidate);
      }
    }
  }

  // Exclusions as they are now, applied to the not-yet-shown part from `from`.
  async function refreshExclusions(from) {
    if (!loadExcluded) return;
    excluded = new Set(await loadExcluded());
    dropExcludedFrom(from);
  }

  async function page(offset, size = BROWSE_PAGE_SIZE) {
    await refreshExclusions(offset);
    // Re-check what would be shown; drop anyone the server no longer returns and refill, until the page is settled.
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      await fill(offset + size);
      const shown = items.slice(offset, offset + size);
      if (shown.length === 0 || !hydrate) break;
      // eslint-disable-next-line no-await-in-loop
      const rows = await hydrate(shown.map((c) => c.id));
      const gone = shown.filter((c) => !rows.has(c.id));
      for (const c of shown) {
        if (rows.has(c.id)) items[items.indexOf(c)] = merge(c, rows.get(c.id));
      }
      if (gone.length === 0) break;
      for (const c of gone) {
        const at = items.findIndex((x) => x.id === c.id);
        if (at >= offset) items.splice(at, 1);
      }
    }
    return {
      items: items.slice(offset, offset + size),
      hasMore: items.length > offset + size || !exhausted,
    };
  }

  // The screen's own check when it comes back into view: which of the people already on screen must go now
  // (newly excluded, or no longer returned by the server). Never moves positions; the screen removes them from its list.
  async function recheckShown(ids) {
    if (!ids?.length) return new Set();
    await refreshExclusions(items.length);
    const stillVisible = hydrate ? await hydrate(ids) : new Map(ids.map((i) => [i, {}]));
    return new Set(ids.filter((i) => excluded.has(i) || !stillVisible.has(i)));
  }

  return {
    page,
    recheckShown,
    isFresh: (ttlMs = BROWSE_POOL_TTL_MS) => now() - builtAt < ttlMs,
    // For tests / diagnostics only.
    get size() { return items.length; },
    get exhausted() { return exhausted; },
  };
}
