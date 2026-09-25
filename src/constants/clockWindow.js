// Clock windows in the ask (item 68 follow-up, 2026-09-25): "before 3 PM", "back by 5pm", "after 6 PM", "between 2 and 5 PM".
// Read from the person's own words by deterministic rules, never AI. A clock time needs AM/PM, noon/midnight or a 24-hour hour
// (13-23): "before 3" is ambiguous and is NOT guessed. It is a ranking signal only (it never sets a date or a time on anything,
// and nothing is removed): a result whose real start (a gathering's `scheduled_at`) or real room window (a business posting's
// starts_at/ends_at) fits lifts, a clear miss sinks, anything unknown keeps its rank. A result's length is the one `lengthOf`
// (host-declared, else the category's usual length) so "before 3 PM" also means "over by 3 PM" when the length is known.
import { lengthOf } from './timeBudget';

export const WINDOW_FIT_POINTS = 2;
export const WINDOW_MISS_POINTS = -2;

const TIME = String.raw`(noon|midnight|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)`;

// "3 pm" / "3:30pm" / "noon" / "15:00" -> minutes after midnight, or null when AM/PM is missing and the hour is ambiguous.
export function parseClock(raw, sharedMeridiem = null) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (t === 'noon') return 12 * 60;
  if (t === 'midnight') return 24 * 60;
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59 || h > 23) return null;
  const mer = m[3] ? m[3][0] : sharedMeridiem;
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === 'p' && h !== 12) h += 12;
    if (mer === 'a' && h === 12) h = 0;
  } else if (h < 13) {
    return null; // "before 3" or "by 5:30": no meridiem and not a 24-hour hour -> not guessed
  }
  return h * 60 + min;
}

const meridiemOf = (raw) => (raw && /(a|p)\.?m\.?\s*$/i.test(raw) ? raw.trim().toLowerCase().match(/(a|p)\.?m\.?\s*$/)[1] : null);

// { after, before } in minutes after midnight (either may be null), or null.
export function clockWindowFromText(text) {
  if (typeof text !== 'string' || !text) return null;
  const t = text.toLowerCase();
  const between = t.match(new RegExp(String.raw`\bbetween\s+${TIME}\s+(?:and|-|to)\s+${TIME}`));
  if (between) {
    const shared = meridiemOf(between[2]);
    const after = parseClock(between[1], shared);
    const before = parseClock(between[2]);
    if (after != null && before != null && before > after) return { after, before };
  }
  const beforeM = t.match(new RegExp(String.raw`\b(?:before|by|until|till|no later than)\s+${TIME}`));
  const afterM = t.match(new RegExp(String.raw`\b(?:after|not before|no earlier than|from)\s+${TIME}`));
  const before = beforeM ? parseClock(beforeM[1]) : null;
  let after = afterM ? parseClock(afterM[1]) : null;
  // "from 2 pm" alone is a start, not a constraint of its own; it counts only beside a "before/until".
  if (afterM && /^from\b/.test(t.slice(afterM.index)) && before == null) after = null;
  if (before == null && after == null) return null;
  if (before != null && after != null && before <= after) return null;
  return { after, before };
}

const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();
const toDate = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };

export function clockLabel(minutes) {
  if (!Number.isFinite(minutes)) return null;
  if (minutes === 12 * 60) return 'noon';
  if (minutes === 24 * 60 || minutes === 0) return 'midnight';
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

export function windowPhrase(w) {
  if (!w) return null;
  if (w.after != null && w.before != null) return `between ${clockLabel(w.after)} and ${clockLabel(w.before)}`;
  if (w.before != null) return `before ${clockLabel(w.before)}`;
  return `after ${clockLabel(w.after)}`;
}

// 'fit' | 'miss' | null (unknown). A gathering: its start (and end, when the length is known) against the window. A business
// posting: the part of its room window inside the asked window must be long enough for a visit (any length when unknown).
export function windowFit(c, w) {
  if (!w) return null;
  const len = lengthOf(c)?.minutes ?? null;
  const lo = w.after ?? 0;
  const hi = w.before ?? 24 * 60;
  const start = toDate(c?.startsAt);
  if (start) {
    const s = minutesOfDay(start);
    if (s < lo || s >= hi) return 'miss';
    if (w.before == null) return 'fit';
    if (len == null) return null;
    return s + len <= hi ? 'fit' : 'miss';
  }
  const ws = toDate(c?.windowStart);
  const we = toDate(c?.windowEnd);
  if (ws && we && we > ws) {
    if (we - ws >= 24 * 3600 * 1000) return 'fit';
    const a = minutesOfDay(ws);
    let b = minutesOfDay(we);
    if (b <= a) b += 24 * 60;
    const room = Math.min(b, hi) - Math.max(a, lo);
    return room >= (len ?? 1) ? 'fit' : 'miss';
  }
  return null;
}

export function applyClockWindowToCandidates(candidates, w) {
  if (!w) return candidates;
  const phrase = windowPhrase(w);
  return candidates.map((c) => {
    const fit = windowFit(c, w);
    if (fit === 'fit') return { ...c, score: (c.score ?? 0) + WINDOW_FIT_POINTS, subtitle: c.subtitle ?? `🕒 Fits ${phrase}` };
    if (fit === 'miss') return { ...c, score: (c.score ?? 0) + WINDOW_MISS_POINTS };
    return c;
  });
}

export function clockWindowCaption(w) {
  const p = windowPhrase(w);
  return p ? `Keeping it ${p}` : null;
}

// Minutes available between two stated clock times ("between 2 and 5 PM" = 180), for fitting a multi-part plan. A one-sided
// window gives no span (the start is not known), so it is not turned into a budget.
export function windowSpan(w) {
  return w && w.after != null && w.before != null ? w.before - w.after : null;
}
