// Want vs Need (owner item 162, 2026-10-03, LOCKED). "I want something fun tonight" is a WANT (discovery, personalization,
// inspiration: the existing ranking, unchanged). "I need a car wash today" is a NEED: the person has a task to get done, so
// within the results the ask ALREADY returned, the order is strictly:
//   1 availability: the existing usable-now tiers (available > open > unknown > closed) at the time the words give, by the
//     timing hierarchy in needAvailabilityWindow below (item 163). A time is never invented.
//   2 proximity: measured distance, nearest first; an unknown distance after every measured one. The existing closeness
//     signal is continuous, so no buckets are invented: any measured difference decides.
//   3 reliability: the "Our pick" record (utils/reliabilityRecord.js). Established record > no record. No record is NEUTRAL;
//     no penalty bucket exists below it.
//   4 personalization (declared interests + learned affinity), a literal TIE-BREAKER: reached only when 1-3 are tied.
//   then the existing order.
// Lexicographic: a later key only decides when every earlier key is in the same bucket. Nothing is removed, filtered or
// routed differently; no business eligibility changes; no new bucket, threshold or score.
//
// Classification (rule-based, deterministic, never AI or learned) needs BOTH:
//   A. the resolved category is a need/service category (isNeedCategory: NEED_GROUP_KEYS + NEED_TAG_KEYS), and
//   B. the person's own words put a TASK verb in front of that category's words ("I need a haircut", "find a florist",
//      "where can I get a haircut", "book me a car wash"): the verb comes at most NEED_FRAMING_GAP words before the category
//      phrase. A plain or discovery ask stays a WANT ("haircut", "haircuts near me", "best florist"), and so does "need"
//      without a need category ("I need coffee", "I need a drink"). Urgency, time, distance, booking rules, price, history
//      and AI never create a need. English task words only.
// No existing table held task verbs (constants/intentRoutes.js has only service-specific ones: fix/repair, hire/book,
// appointment), so NEED_FRAMING below is the one list.
import { CATEGORY_GROUPS, groupForTag, isNeedCategory } from '../constants/gatheringCategories';
import { tagsInText, normalizedWords } from '../constants/categorySynonyms';
import { usableNowTier, usableTierInSpan } from './operatingStatus';
import { hasEstablishedRecord } from './reliabilityRecord';

export const NEED_CAPTION = "Showing what's available and close by";

// Task verbs, matched on the SAME normalized words as the category phrases (plural trim and all), multi-word first.
const NEED_FRAMING_PHRASES = [
  'need to get', 'need to find', 'want to get', 'looking for', 'look for', 'have to', 'has to', 'pick up',
  'need', 'needs', 'get', 'getting', 'find', 'finding', 'must', 'book', 'booking', 'schedule', 'scheduling', 'arrange',
  'fix', 'repair', 'replace', 'pickup', 'buy', 'buying', 'purchase',
];
export const NEED_FRAMING = NEED_FRAMING_PHRASES.map((p) => normalizedWords(p)).sort((a, b) => b.length - a.length);
export const NEED_FRAMING_GAP = 4; // words allowed between the task verb and the category phrase ("get my dog groomed" style)

function categoryTagsOf(category) {
  if (CATEGORY_GROUPS.some((g) => g.key === category)) {
    const g = CATEGORY_GROUPS.find((x) => x.key === category);
    return new Set([...g.tags, ...(g.businessOnlyTags ?? [])]);
  }
  return new Set([category]);
}

export function hasNeedFraming(rawText, category) {
  if (!category || typeof rawText !== 'string') return false;
  const words = normalizedWords(rawText);
  const wanted = categoryTagsOf(category);
  const spans = tagsInText(rawText).filter((h) => wanted.has(h.tag));
  if (!spans.length) return false;
  const verbEnds = [];
  for (let i = 0; i < words.length; i++) {
    for (const f of NEED_FRAMING) {
      if (f.every((w, j) => words[i + j] === w)) { verbEnds.push(i + f.length); break; }
    }
  }
  return spans.some((h) => verbEnds.some((end) => end <= h.start && h.start - end <= NEED_FRAMING_GAP));
}

export function askKind({ category = null, rawText = '' } = {}) {
  return isNeedCategory(category) && hasNeedFraming(rawText, category) ? 'need' : 'want';
}

// WHEN availability is judged for a NEED (owner item 163, 2026-10-03, LOCKED). Timing never classifies an ask; it only ranks a
// need that askKind already found. From the person's own words, strongest first:
//   1 an explicit day or clock time: "at 4 PM" (today if still ahead, never moved to another day), a clock on one named day
//     ("tomorrow after 2 PM" = that moment, "by 4 PM today" = until then), a named day with no clock ("tomorrow", "Saturday",
//     "this weekend", "tonight" = 5-11 PM, the app's existing evening) = anywhere inside it. "Today" keeps its existing meaning
//     (now). A stated day always beats "no rush" ("no rush, tomorrow is fine" = tomorrow).
//   2 explicit urgency: now / ASAP / right away = now (open right now can beat a closer place that isn't).
//   3 explicit flexibility: "no rush", "this week", "next week" = no moment, so availability ties and proximity leads.
//   4 no timing: the existing no-time meaning, now.
// Returns { startMs, endMs, basis } (startMs === endMs = one moment) or null (availability ties for everyone).
const NOT_NOW = ['no_rush', 'this_week', 'plan_ahead'];
const DAY_MS = 24 * 3600 * 1000;
const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const isSameDay = (a, b) => dayStart(a) === dayStart(b);

export function needAvailabilityWindow({ dateWindow = null, clockWindow = null, dateAnchor = null, pointClock = null, spontaneity = null } = {}, now = new Date()) {
  const nowMs = now.getTime();
  const point = (t) => (t >= nowMs - 60000 ? { startMs: t, endMs: t, basis: 'stated' } : null);
  const span = (a, b) => { const s = Math.max(a, nowMs); return b > s ? { startMs: s, endMs: b, basis: 'stated' } : null; };
  const oneDay = dateAnchor?.kind === 'day' && dateAnchor.dates?.length === 1 ? dayStart(dateAnchor.dates[0]) : null;
  // 1a. a clock on one named day
  if (oneDay != null && clockWindow && (clockWindow.after != null || clockWindow.before != null)) {
    if (clockWindow.after != null) return point(oneDay + clockWindow.after * 60000);
    return span(oneDay, oneDay + clockWindow.before * 60000);
  }
  // 1b. one stated clock time ("at 4 PM"): on the named day, else today
  if (pointClock != null && (oneDay != null || !dateAnchor)) return point((oneDay ?? dayStart(now)) + pointClock * 60000);
  // 1c. a named day / period with no clock (today keeps its existing meaning below)
  if (dateWindow === 'tonight' && oneDay != null) return span(oneDay + 17 * 3600000, oneDay + 23 * 3600000) ?? { startMs: nowMs, endMs: nowMs, basis: 'stated' };
  if (oneDay != null && !isSameDay(oneDay, now)) return span(oneDay, oneDay + DAY_MS);
  if (dateAnchor?.kind === 'period' && dateAnchor.dates?.length) {
    const days = dateAnchor.dates.map(dayStart).sort((a, b) => a - b);
    return span(days[0], days[days.length - 1] + DAY_MS);
  }
  // 2. explicit urgency
  if (dateWindow === 'now') return { startMs: nowMs, endMs: nowMs, basis: 'now' };
  // 3. explicit flexibility (a stated day was handled above)
  if (NOT_NOW.includes(spontaneity) && dateWindow !== 'today') return null;
  // 4. no timing / today: the existing meaning
  return !dateWindow || dateWindow === 'today' || dateWindow === 'flexible' ? { startMs: nowMs, endMs: nowMs, basis: 'now' } : null;
}

// The one caption a need shows, describing what was applied: availability (at a stated time or now) and closeness, or, when
// nothing named a moment, closeness alone. Never the ranking ladder itself.
export const NEED_CLOSE_CAPTION = 'Showing what\'s close by first';
export function needCaption(window) {
  return window ? NEED_CAPTION : NEED_CLOSE_CAPTION;
}

const AVAILABILITY_RANK = { available: 3, open: 2, unknown: 1, closed: 0 };

// `window` from needAvailabilityWindow (or `at`, one moment); neither = availability ties for everyone.
export function needKeys(c, { toEntity, at, window, reputations }) {
  const w = window ?? (at ? { startMs: at.getTime(), endMs: at.getTime() } : null);
  const tier = !w ? null : w.endMs > w.startMs ? usableTierInSpan(toEntity(c), w.startMs, w.endMs) : usableNowTier(toEntity(c), w.startMs);
  const avail = tier ? (AVAILABILITY_RANK[tier] ?? 1) : 1;
  const d = c?.distanceMiles;
  const distance = typeof d === 'number' && Number.isFinite(d) && d >= 0 ? d : Infinity;
  const rel = c?.partnerId && hasEstablishedRecord(reputations?.get?.(c.partnerId)) ? 1 : 0;
  const num = (v) => (Number.isFinite(v) ? v : 0);
  // declared interests + learned affinity, wherever they sit (still in the score, or already moved to a tie-break)
  const personal = num(c?.historyScore) + num(c?.historyTieBreak) + num(c?.learnedTieBreak);
  return { avail, distance, rel, personal };
}

export function compareNeedKeys(a, b) {
  if (a.avail !== b.avail) return b.avail - a.avail;
  if (a.distance !== b.distance) return a.distance < b.distance ? -1 : 1;
  if (a.rel !== b.rel) return b.rel - a.rel;
  return b.personal - a.personal;
}

// Reorders only (same items, same objects); ties at every level keep the incoming (existing) order.
export function orderNeedResults(items, ctx) {
  if (!Array.isArray(items)) return items;
  return items
    .map((c, i) => ({ c, i, k: needKeys(c, ctx) }))
    .sort((x, y) => compareNeedKeys(x.k, y.k) || x.i - y.i)
    .map((x) => x.c);
}
