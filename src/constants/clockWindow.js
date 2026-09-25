// Clock windows in the ask (item 68, owner decisions 2026-09-25, LOCKED): "before 3 PM", "until 5", "after 6 PM", "between 2
// and 5 PM". Read from the person's own words by deterministic rules, never AI.
// Three separate things, never converted into one another silently: AVAILABLE TIME ("I have two hours", timeBudget.js), a
// TIME WINDOW (a clock boundary or range, this file) and a result's USUAL LENGTH (lengthOf). A window is used ONLY once it is
// anchored to a calendar date the person gave ("today", "tonight", "tomorrow", "this weekend", "Saturday"); with no date anchor
// it constrains nothing (no date is chosen to make it fit). The current clock is never used as a start time. "Until 5" is an
// end boundary only; nothing invents when the plan starts. "This weekend" is a PERIOD (every remaining weekend day, no day
// preferred); a named day ("Saturday") is that day. Ranking only: nothing is removed.
// Clock reading: AM/PM, noon/midnight and 24-hour hours are read as said; a bare hour 1-7 ("until 5", "before 3") is read as PM
// (nobody means 5 in the morning); a bare 8-11 is ambiguous and is NOT guessed.
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
  } else if (h >= 1 && h <= 7) {
    h += 12; // "until 5" / "before 3": a bare 1-7 is the afternoon/evening
  } else if (h < 13 && h !== 12) {
    return null; // "before 9": ambiguous, not guessed
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

// ---- date anchor: which calendar day(s) a window applies to, from the person's own words only ----
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// { kind: 'day' | 'period', dates: [Date...] } or null. `now` only locates "today" on the calendar; it is never a start time.
export function dateAnchorFromText(text, now = new Date()) {
  if (typeof text !== 'string' || !text) return null;
  const t = text.toLowerCase();
  const today = startOfDay(now);
  const dow = today.getDay();
  if (/\bnext\s+weekend\b/.test(t)) return null; // not defined in this product; never guessed
  const weekendWords = /\b(this\s+weekend|weekend)\b/.test(t);
  const sat = /\bsaturday\b/.test(t);
  const sun = /\bsunday\b/.test(t);
  const tonightOrToday = /\b(tonight|tonite|this\s+evening|today|right\s+now|now)\b/.test(t);
  // This weekend's Saturday/Sunday (on a Sunday, Saturday is already past).
  const thisSat = dow === 0 ? addDays(today, -1) : addDays(today, 6 - dow);
  const thisSun = addDays(thisSat, 1);
  if (sat || sun) {
    if (sat && sun) return null;
    const day = sat ? thisSat : thisSun;
    return day >= today ? { kind: 'day', dates: [day] } : null;
  }
  if (weekendWords && tonightOrToday) {
    // "this weekend tonight": only a real date relationship (today IS a weekend day), else nothing is chosen.
    return dow === 0 || dow === 6 ? { kind: 'day', dates: [today] } : null;
  }
  if (weekendWords) return { kind: 'period', dates: [thisSat, thisSun].filter((d) => d >= today) };
  if (/\btomorrow\b/.test(t)) return { kind: 'day', dates: [addDays(today, 1)] };
  if (tonightOrToday) return { kind: 'day', dates: [today] };
  return null;
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// 'fit' | 'miss' | null (unknown / not applicable). Only a gathering's real start is compared (business supply is unchanged
// by decision: no posting duration or room-window matching yet). A start on a day outside the anchor is a miss; with a known
// usual length, "before 3 PM" also means over by 3 PM; with an unknown length only the start is judged.
export function windowFit(c, w, anchor) {
  if (!w || !anchor || !anchor.dates?.length) return null;
  const start = toDate(c?.startsAt);
  if (!start) return null;
  if (!anchor.dates.some((d) => sameDay(d, start))) return 'miss';
  const lo = w.after ?? 0;
  const hi = w.before ?? 24 * 60;
  const s = minutesOfDay(start);
  if (s < lo || s >= hi) return 'miss';
  if (w.before == null) return 'fit';
  const len = lengthOf(c)?.minutes ?? null;
  if (len == null) return null;
  return s + len <= hi ? 'fit' : 'miss';
}

// No date anchor = no constraint at all (returns the same array).
export function applyClockWindowToCandidates(candidates, w, anchor) {
  if (!w || !anchor) return candidates;
  const phrase = windowPhrase(w);
  return candidates.map((c) => {
    const fit = windowFit(c, w, anchor);
    if (fit === 'fit') return { ...c, score: (c.score ?? 0) + WINDOW_FIT_POINTS, subtitle: c.subtitle ?? `🕒 Fits ${phrase}` };
    if (fit === 'miss') return { ...c, score: (c.score ?? 0) + WINDOW_MISS_POINTS };
    return c;
  });
}

export function clockWindowCaption(w, anchor) {
  const p = anchor ? windowPhrase(w) : null;
  return p ? `Keeping it ${p}` : null;
}

// The length of an anchored clock RANGE ("between 6 and 8 PM" = 120), compared with a multi-part plan's usual total. A one-sided
// window ("before 3 PM") has no start, so it has no length; nothing is invented.
export function windowSpan(w, anchor) {
  return anchor && w && w.after != null && w.before != null ? w.before - w.after : null;
}
