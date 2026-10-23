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
import { appendReason, reasonText } from './recommendationReasonVocabulary';

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

// A single stated clock time ("at 4 PM", "at 4:30", "at noon"), in minutes after midnight, or null. Read ONLY for a need's
// availability moment (item 163); gathering windows keep using clockWindowFromText. A bare 8-11 is not guessed (parseClock).
export function pointClockFromText(text) {
  if (typeof text !== 'string' || !text) return null;
  const m = text.toLowerCase().match(new RegExp(String.raw`\bat\s+${TIME}(?![\w:])`));
  if (!m) return null;
  const raw = m[1].trim();
  return parseClock(raw);
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

// "🕒 Fits before 3 PM" (the same phrase as windowPhrase, one template per shape so it can be worded in any language).
export function windowFitReason(w) {
  if (!w) return null;
  if (w.after != null && w.before != null) return reasonText('clockBetween', { time1: clockLabel(w.after), time2: clockLabel(w.before) });
  if (w.before != null) return reasonText('clockBefore', { time: clockLabel(w.before) });
  return reasonText('clockAfter', { time: clockLabel(w.after) });
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

// Named weekdays (owner, 2026-10-23, LOCKED rule): deterministic, from the person's own words and the device's local date only.
//   "Friday"          -> the next Friday within 7 days, today included (said on a Friday = today).
//   "this Friday"     -> the Friday of the current Monday-Sunday week; already past = none (never rolled forward).
//   "next Friday"     -> the Friday of the following Monday-Sunday week.
// None (null) when two different weekdays are named ("Saturday or Sunday"), the same day is named two ways, or the words also say
// tonight/today/tomorrow and that is a different day. Full day names only ("sat" is also a verb; "fridays" = recurring, deferred).
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_RE = /\b(?:(this|next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g;
const ANY_WEEKDAY_RE = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/;

function weekdayMentions(t) {
  return [...t.matchAll(WEEKDAY_RE)].map((m) => ({ mod: m[1] ?? null, day: WEEKDAYS.indexOf(m[2]) }));
}

function weekdayDate(mentions, today) {
  const { mod, day } = mentions[0];
  if (mentions.some((m) => m.day !== day || m.mod !== mod)) return null;
  const dow = today.getDay();
  if (mod === null) return addDays(today, (day - dow + 7) % 7);
  const monday = addDays(today, -((dow + 6) % 7));
  const date = addDays(monday, (day + 6) % 7 + (mod === 'next' ? 7 : 0));
  return date < today ? null : date;
}

// Explicit calendar dates (owner, 2026-10-23, LOCKED rule): month NAMES only ("November 4", "Nov 4th", "4 November", "the 4th of
// November", optionally ", 2027"); a number-only date ("11/4") means different days in different languages, so its presence
// makes the whole ask carry no date. With a year: that date (past = none). Without: this year's if not past, else next year's
// only if it falls within the next 6 months ("January 5" said in December), else none (never nearly a year ahead). An invalid
// day ("February 30"), two different dates, or a named weekday that is not that date's weekday = none: never resolved silently.
const MONTH_WORD = String.raw`(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\.?`;
const MONTH_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const DAY_NUM = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
// A number after a month word that is a count, a clock or a distance is not a day ("may 4 people", "march 5 miles", "nov 4:30").
const NOT_A_DAY = String.raw`(?!\d|\s*(?:[:.]\d|a\.?m\b|p\.?m\b|o'?clock|people|persons|of\s+us|friends|guests|adults|kids|children|hours?|hrs?|minutes?|mins?|miles?|mi\b|km\b|%))`;
const YEAR = String.raw`(?:,?\s+(20\d{2})\b)?`;
const MONTH_FIRST_RE = new RegExp(String.raw`\b${MONTH_WORD}\s+${DAY_NUM}\b${NOT_A_DAY}${YEAR}`, 'g');
const DAY_FIRST_RE = new RegExp(String.raw`\b(?:the\s+)?${DAY_NUM}(?:\s+of)?\s+${MONTH_WORD}(?![a-z])${YEAR}`, 'g');
const NUMERIC_DATE_RE = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/;

function explicitDates(t) {
  const out = [];
  for (const m of t.matchAll(MONTH_FIRST_RE)) out.push({ month: MONTH_INDEX[m[1].slice(0, 3)], day: Number(m[2]), year: m[3] ? Number(m[3]) : null });
  for (const m of t.matchAll(DAY_FIRST_RE)) out.push({ month: MONTH_INDEX[m[2].slice(0, 3)], day: Number(m[1]), year: m[3] ? Number(m[3]) : null });
  return out;
}

const validDate = (y, m, d) => { const x = new Date(y, m, d); return x.getMonth() === m && x.getDate() === d ? x : null; };

function explicitDate(found, today) {
  const { month, day, year } = found[0];
  if (found.some((f) => f.month !== month || f.day !== day || (f.year != null && year != null && f.year !== year))) return null;
  const y = found.find((f) => f.year != null)?.year ?? null;
  if (y != null) { const d = validDate(y, month, day); return d && d >= today ? d : null; }
  const thisYear = validDate(today.getFullYear(), month, day);
  if (thisYear && thisYear >= today) return thisYear;
  const nextYear = validDate(today.getFullYear() + 1, month, day);
  const sixMonths = new Date(today.getFullYear(), today.getMonth() + 6, today.getDate());
  return nextYear && nextYear <= sixMonths ? nextYear : null;
}

// True when the words name a month-name calendar date ("November 4"), readable or not.
export function namesCalendarDate(text) {
  return typeof text === 'string' && explicitDates(text.toLowerCase()).length > 0;
}

// True when the words name a calendar day this file reads (a weekday, a month-name date, or an unreadable number-only date).
export function mentionsStatedDate(text) {
  if (typeof text !== 'string' || !text) return false;
  const t = text.toLowerCase();
  return ANY_WEEKDAY_RE.test(t) || NUMERIC_DATE_RE.test(t) || explicitDates(t).length > 0;
}

// The ONE stated-date rule (owner, 2026-10-23): the calendar day a named weekday or an explicit date in the words gives, or null.
// Every consumer reads it (search's date anchor, the WHEN chip, Create, Ask Nearby Businesses). Also none when the words name
// tonight/today/tomorrow or this weekend and the stated date is a different day.
export function statedDateFromText(text, now = new Date()) {
  if (typeof text !== 'string' || !text) return null;
  const t = text.toLowerCase();
  if (NUMERIC_DATE_RE.test(t)) return null;
  const today = startOfDay(now);
  const found = explicitDates(t);
  const mentions = weekdayMentions(t);
  let date;
  if (found.length) {
    date = explicitDate(found, today);
    if (!date) return null;
    if (mentions.some((m) => m.day !== date.getDay())) return null;
    if (mentions.some((m) => m.mod) && weekdayDate(mentions, today)?.getTime() !== date.getTime()) return null;
  } else if (mentions.length) {
    date = weekdayDate(mentions, today);
    if (!date) return null;
  } else return null;
  if (/\btomorrow\b/.test(t) && date.getTime() !== addDays(today, 1).getTime()) return null;
  if (/\b(tonight|tonite|this\s+evening|today)\b/.test(t) && date.getTime() !== today.getTime()) return null;
  if (/\bweekend\b/.test(t) && !isThisWeekend(date, now)) return null;
  return date;
}

// The weekday rule alone (a stated date read only from a named weekday), for callers and tests that ask about weekdays.
export function namedDayFromText(text, now = new Date()) {
  return typeof text === 'string' && ANY_WEEKDAY_RE.test(text.toLowerCase()) && !explicitDates(text.toLowerCase()).length ? statedDateFromText(text, now) : null;
}

// True when a date is this weekend's Saturday or Sunday (on a Sunday, only today).
export function isThisWeekend(date, now = new Date()) {
  const today = startOfDay(now);
  const dow = today.getDay();
  const sat = dow === 0 ? addDays(today, -1) : addDays(today, 6 - dow);
  const d = startOfDay(date).getTime();
  return d >= today.getTime() && (d === sat.getTime() || d === addDays(sat, 1).getTime());
}

// { kind: 'day' | 'period', dates: [Date...] } or null. `now` only locates "today" on the calendar; it is never a start time.
export function dateAnchorFromText(text, now = new Date()) {
  if (typeof text !== 'string' || !text) return null;
  const t = text.toLowerCase();
  const today = startOfDay(now);
  const dow = today.getDay();
  if (/\bnext\s+weekend\b/.test(t)) return null; // not defined in this product; never guessed
  const weekendWords = /\b(this\s+weekend|weekend)\b/.test(t);
  const tonightOrToday = /\b(tonight|tonite|this\s+evening|today|right\s+now|now)\b/.test(t);
  // This weekend's Saturday/Sunday (on a Sunday, Saturday is already past).
  const thisSat = dow === 0 ? addDays(today, -1) : addDays(today, 6 - dow);
  const thisSun = addDays(thisSat, 1);
  if (mentionsStatedDate(t)) {
    const day = statedDateFromText(t, now);
    return day ? { kind: 'day', dates: [day] } : null;
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

// Two readings of an hour said without AM/PM that parseClock will not guess ("at 9" -> [9 AM, 9 PM]), or null. Never picks
// one: the person chooses (Create's When step offers both). Only an "at"-style single time; a window is never a start.
export function pointClockChoicesFromText(text) {
  if (typeof text !== 'string' || !text) return null;
  const m = text.toLowerCase().match(new RegExp(String.raw`\bat\s+${TIME}(?![\w:])`));
  if (!m) return null;
  const raw = m[1].trim();
  if (parseClock(raw) != null) return null;
  const hm = raw.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!hm) return null;
  const h = Number(hm[1]);
  const min = hm[2] ? Number(hm[2]) : 0;
  if (h < 8 || h > 11 || min > 59) return null;
  return [h * 60 + min, (h + 12) * 60 + min];
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
  const reason = windowFitReason(w);
  return candidates.map((c) => {
    const fit = windowFit(c, w, anchor);
    if (fit === 'fit') return { ...c, score: (c.score ?? 0) + WINDOW_FIT_POINTS, subtitle: c.subtitle ?? reason, reasons: appendReason(c.reasons, reason) };
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
