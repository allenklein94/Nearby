// Dating Browse candidate pool (owner, 2026-11-14, Option A).
//
// Browse used to fetch 20 rows by id, filter them on the phone and rank only those; a page whose 20 rows all failed the
// person's filters came back empty and the screen read that as "no more people". Now the pool is built in WINDOWS:
// up to BROWSE_POOL_WINDOW raw rows (keyset paging by id: no row is ever skipped or read twice), filtered and ranked as
// one set, and the screen reveals BROWSE_PAGE_SIZE at a time. Within one window the order is global; when a window is
// used up and the view still had rows, the next window is fetched, ranked, and APPENDED (earlier positions never move,
// so paging never duplicates or skips anyone). A window that filters down to nobody is never the end: only a window
// that came back short (the view ran out) is.
//
// Before a page is shown, its people are re-checked against the server (`confirmVisible`): anyone who blocked or was
// blocked, left Dating or disappeared since the window was read is dropped and the page refilled, so a reused pool
// never shows someone the server no longer returns.
//
// BROWSE_POOL_WINDOW is a performance safeguard, not a product limit: people beyond it are still reached, in the next
// window. The pool is reused for BROWSE_POOL_TTL_MS when the person comes back to Browse with the same inputs.

export const BROWSE_PAGE_SIZE = 20;
export const BROWSE_POOL_WINDOW = 300;
export const BROWSE_POOL_TTL_MS = 5 * 60 * 1000;

// fetchWindow(afterId, size) -> raw rows ordered by id ascending, ids > afterId (afterId null = from the start).
// rankWindow(rawRows) -> the eligible, ranked candidates ({ id, ... }) of that window.
// confirmVisible(ids) -> Set of the ids the server still returns.
export function createBrowsePool({ fetchWindow, rankWindow, confirmVisible, windowSize = BROWSE_POOL_WINDOW, now = Date.now }) {
  const items = [];
  const seen = new Set();
  let lastId = null;
  let exhausted = false;
  const builtAt = now();

  async function fill(count) {
    while (items.length < count && !exhausted) {
      // eslint-disable-next-line no-await-in-loop
      const raw = (await fetchWindow(lastId, windowSize)) ?? [];
      if (raw.length > 0) lastId = raw[raw.length - 1].id;
      if (raw.length < windowSize) exhausted = true;
      for (const candidate of rankWindow(raw)) {
        if (candidate?.id == null || seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        items.push(candidate);
      }
    }
  }

  async function page(offset, size = BROWSE_PAGE_SIZE) {
    // Re-check what would be shown; drop anyone the server no longer returns and refill, until the page is settled.
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      await fill(offset + size);
      const shown = items.slice(offset, offset + size);
      if (shown.length === 0 || !confirmVisible) break;
      // eslint-disable-next-line no-await-in-loop
      const visible = await confirmVisible(shown.map((c) => c.id));
      const gone = shown.filter((c) => !visible.has(c.id));
      if (gone.length === 0) break;
      for (const c of gone) items.splice(items.indexOf(c), 1);
    }
    return {
      items: items.slice(offset, offset + size),
      hasMore: items.length > offset + size || !exhausted,
    };
  }

  return {
    page,
    isFresh: (ttlMs = BROWSE_POOL_TTL_MS) => now() - builtAt < ttlMs,
    // For tests / diagnostics only.
    get size() { return items.length; },
    get exhausted() { return exhausted; },
  };
}
