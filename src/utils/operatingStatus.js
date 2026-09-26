// "Open now" (owner item 71, 2026-09-26): the ONE operating-status resolver. Every surface (the Discover chip, typed asks,
// the business profile line) asks this file; no category has its own open-now logic.
//
// Two separate questions, never collapsed into one boolean:
//   getOperatingStatus(entity, at)    -> open | closed | unknown            (is it inside its known hours / live window?)
//   getAvailabilityStatus(entity, at) -> available | unavailable | unknown  (is there real usable room right now?)
// Open never implies bookable: a business open 10-10 with no posting is open + availability unknown.
//
// Sources, each used only where it is real (nothing is inferred from a category, a profile, past activity or "usually"):
//   Nearby business  owner-declared weekly hours (brand_partners.operating_hours, evaluated in the BUSINESS'S timezone, with
//                    special days, overnight and split intervals, 24 h, closed days, a temporary-closure switch)
//                    + a live availability posting (window + remaining capacity)
//                    + the self-reported availability pulse (open / limited / full), only while fresh
//   Google place     Google's own open_now, only while the search that returned it is fresh
//   Gathering        its real start (+ host-declared duration); no duration = live for the shared 30 minutes only
//   Perk             not expired, inside its own time-of-day window (in its business's timezone), and its business's status
//   Anything else    unknown (communities, a friend's request, ...)
//
// usableNowTier(): 'available' > 'open' > 'unknown' | 'closed' (the last two get no lift). The explicit Open-now filter keeps
// only 'available' and 'open'; without it, unknown stays eligible and nothing is hidden.
import { timeWindowState, windowEnd } from './timeWindow';
import { isGatheringFull } from './gatheringFullness';

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const MAX_INTERVALS_PER_DAY = 4;
export const MAX_SPECIAL_DAYS = 60;
// Google's open_now is a snapshot taken when the search ran; after this it is stale and reads as unknown.
export const PLACE_OPEN_NOW_FRESH_MS = 30 * 60 * 1000;
// The pulse is shown on a profile for 24 h, but as a "right now" signal it only counts for 2 h.
export const PULSE_NOW_FRESH_MS = 2 * 60 * 60 * 1000;
const JUST_STARTED_MS = 30 * 60 * 1000;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function ms(v) {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}
function nowMs(at) {
  return ms(at ?? new Date()) ?? Date.now();
}
export function toMinutes(hhmm) {
  const m = typeof hhmm === 'string' ? TIME_RE.exec(hhmm.slice(0, 5)) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
// An interval as minutes from the day's midnight; a close at or before the open runs past midnight (00:00 close = midnight).
function span([open, close]) {
  const o = toMinutes(open);
  const c = toMinutes(close);
  if (o == null || c == null || o === c) return null;
  return { o, c: c <= o ? c + 1440 : c };
}

// The wall clock at `at` in an IANA time zone: { dateKey 'YYYY-MM-DD', day 'mon', minutes }. null for an unknown zone.
export function localClock(at, timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return null;
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
    }).formatToParts(new Date(nowMs(at)));
  } catch (e) {
    return null;
  }
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const hour = Number(get('hour')) % 24;
  const dateKey = `${get('year')}-${get('month')}-${get('day')}`;
  const day = String(get('weekday') ?? '').slice(0, 3).toLowerCase();
  if (!DATE_RE.test(dateKey) || !DAY_KEYS.includes(day)) return null;
  return { dateKey, day, minutes: hour * 60 + Number(get('minute')) };
}

function previousDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}
function previousDay(day) {
  return DAY_KEYS[(DAY_KEYS.indexOf(day) + 6) % 7];
}

// ---- Validation (the owner editor uses this; the server re-checks the same rules in set_business_operating_hours) ----

function dayProblem(value, label) {
  if (value === 'closed' || value === 'all_day') return null;
  if (!Array.isArray(value) || value.length === 0) return `${label}: choose Closed, 24 hours, or add hours.`;
  if (value.length > MAX_INTERVALS_PER_DAY) return `${label}: at most ${MAX_INTERVALS_PER_DAY} time ranges.`;
  const spans = [];
  for (const iv of value) {
    if (!Array.isArray(iv) || iv.length !== 2 || toMinutes(iv[0]) == null || toMinutes(iv[1]) == null) return `${label}: pick an opening and a closing time.`;
    const s = span(iv);
    if (!s) return `${label}: opening and closing can't be the same time (use 24 hours instead).`;
    spans.push(s);
  }
  spans.sort((a, b) => a.o - b.o);
  for (let i = 1; i < spans.length; i += 1) if (spans[i].o < spans[i - 1].c) return `${label}: time ranges overlap.`;
  return null;
}
const DAY_LABEL = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };

// The first reason the hours cannot be saved, or null. Never "fixes" them silently.
export function operatingHoursProblem(hours) {
  if (hours == null) return null;
  if (typeof hours !== 'object') return 'Hours are not readable.';
  if (!hours.timezone || typeof hours.timezone !== 'string' || !localClock(new Date(), hours.timezone)) return 'Pick a valid time zone.';
  const week = hours.week ?? {};
  for (const d of DAY_KEYS) {
    const p = dayProblem(week[d], DAY_LABEL[d]);
    if (p) return p;
  }
  // An overnight range may not run into the next day's first range.
  for (const d of DAY_KEYS) {
    const today = week[d];
    const next = week[DAY_KEYS[(DAY_KEYS.indexOf(d) + 1) % 7]];
    if (!Array.isArray(today) || !Array.isArray(next)) continue;
    const tail = Math.max(0, ...today.map(span).filter(Boolean).map((s) => s.c - 1440));
    if (tail > 0 && next.map(span).filter(Boolean).some((s) => s.o < tail)) return `${DAY_LABEL[d]}'s late hours run into the next day's hours.`;
  }
  const special = hours.special ?? [];
  if (!Array.isArray(special) || special.length > MAX_SPECIAL_DAYS) return `At most ${MAX_SPECIAL_DAYS} special days.`;
  const seen = new Set();
  for (const s of special) {
    if (!s || !DATE_RE.test(s.date ?? '')) return 'A special day needs a date.';
    if (seen.has(s.date)) return `${s.date} is listed twice.`;
    seen.add(s.date);
    const p = dayProblem(s.hours, s.date);
    if (p) return p;
  }
  if (hours.temporarily_closed != null && typeof hours.temporarily_closed !== 'boolean') return 'Temporary closure must be on or off.';
  return null;
}

// ---- Hours evaluation ----

function hoursFor(hours, dateKey, day) {
  const special = (hours.special ?? []).find((s) => s?.date === dateKey);
  return special ? special.hours : hours.week?.[day];
}
function clockLabel(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

// { status: open|closed|unknown, label } from owner-declared hours at `at`, in the hours' own timezone.
export function hoursStatus(hours, at = new Date()) {
  if (!hours || operatingHoursProblem(hours)) return { status: 'unknown', label: null };
  if (hours.temporarily_closed === true) return { status: 'closed', label: 'Temporarily closed' };
  const clock = localClock(at, hours.timezone);
  if (!clock) return { status: 'unknown', label: null };
  const today = hoursFor(hours, clock.dateKey, clock.day);
  if (today === 'all_day') return { status: 'open', label: 'Open 24 hours' };
  if (Array.isArray(today)) {
    for (const s of today.map(span).filter(Boolean)) {
      if (clock.minutes >= s.o && clock.minutes < s.c) return { status: 'open', label: `Open now · until ${clockLabel(s.c)}` };
    }
  }
  // Last night's hours that run past midnight.
  const yesterday = hoursFor(hours, previousDate(clock.dateKey), previousDay(clock.day));
  if (Array.isArray(yesterday)) {
    for (const s of yesterday.map(span).filter(Boolean)) {
      if (s.c > 1440 && clock.minutes < s.c - 1440) return { status: 'open', label: `Open now · until ${clockLabel(s.c)}` };
    }
  }
  return { status: 'closed', label: 'Closed now' };
}

// ---- Entities ----
// Callers build an entity with one of the adapters below (never a hand-rolled shape), so every surface reads the same fields.

export function businessEntity(partner = {}, { posting = null } = {}) {
  return {
    kind: 'business',
    hours: partner.operating_hours ?? partner.operatingHours ?? null,
    pulse: partner.availability_pulse ?? null,
    pulseUpdatedAt: partner.availability_pulse_updated_at ?? null,
    posting,
  };
}
export function placeEntity(place = {}) {
  return { kind: 'place', openNow: typeof place.openNow === 'boolean' ? place.openNow : null, fetchedAt: place.fetchedAt ?? null };
}
export function gatheringEntity(g = {}) {
  return {
    kind: 'gathering',
    startsAt: g.scheduled_at ?? g.startsAt ?? null,
    durationMinutes: g.duration_minutes ?? g.durationMinutes ?? null,
    isFull: typeof g.isFull === 'boolean' ? g.isFull : (g.capacity != null ? isGatheringFull(g) : false),
    open: g.requiresApproval !== true && g.requires_approval !== true && g.invite_only !== true,
  };
}
export function perkEntity(offer = {}, partner = null) {
  const p = partner ?? offer.brand_partners ?? {};
  return {
    kind: 'perk',
    expiresAt: offer.expires_at ?? offer.expiresAt ?? null,
    fromTime: offer.valid_from_time ?? offer.validFromTime ?? null,
    toTime: offer.valid_to_time ?? offer.validToTime ?? null,
    business: businessEntity(p),
  };
}
// A typed-ask candidate (intentResolver). `partnerInfo`: Map partnerId -> brand_partners row with hours/pulse.
export function candidateEntity(c, partnerInfo = new Map()) {
  if (!c) return { kind: 'other' };
  const partner = c.partnerId ? partnerInfo.get(c.partnerId) ?? {} : {};
  switch (c.type) {
    case 'gathering': return gatheringEntity(c);
    case 'perk': return perkEntity({ expires_at: c.expiresAt, valid_from_time: c.validFromTime, valid_to_time: c.validToTime }, partner);
    case 'business_availability': return businessEntity(partner, {
      posting: { startsAt: c.postingStartsAt ?? null, endsAt: c.postingEndsAt ?? null, remainingCapacity: c.matchedAvailability?.remainingCapacity ?? null },
    });
    case 'business_policy_match':
    case 'business_occasion_package': return businessEntity(partner);
    default: return { kind: 'other' };
  }
}

function postingLive(posting, t) {
  if (!posting) return null;
  const s = ms(posting.startsAt);
  const e = ms(posting.endsAt);
  if (s == null || e == null) return null;
  return s <= t && t < e;
}

export function getOperatingStatus(entity, at = new Date()) {
  const t = nowMs(at);
  switch (entity?.kind) {
    case 'business': return hoursStatus(entity.hours, t).status;
    case 'place': {
      const f = ms(entity.fetchedAt);
      if (entity.openNow == null || f == null || t - f > PLACE_OPEN_NOW_FRESH_MS || f > t + 60000) return 'unknown';
      return entity.openNow ? 'open' : 'closed';
    }
    case 'gathering': {
      const s = ms(entity.startsAt);
      if (s == null) return 'unknown';
      if (s > t) return 'closed';
      const hasEnd = windowEnd({ start: entity.startsAt, durationMinutes: entity.durationMinutes }) != null;
      if (!hasEnd && t - s > JUST_STARTED_MS) return 'unknown'; // it may still be going; never claim either way
      const phase = timeWindowState({ start: entity.startsAt, durationMinutes: entity.durationMinutes }, new Date(t), 'event').phase;
      return phase === 'live' || phase === 'ending_soon' ? 'open' : phase === 'unknown' ? 'unknown' : 'closed';
    }
    case 'perk': {
      const exp = ms(entity.expiresAt);
      if (exp != null && exp <= t) return 'closed';
      const biz = getOperatingStatus(entity.business, t);
      if (biz === 'closed') return 'closed';
      if (entity.fromTime && entity.toTime) {
        const tz = entity.business?.hours?.timezone;
        const clock = tz ? localClock(t, tz) : null;
        const s = span([String(entity.fromTime).slice(0, 5), String(entity.toTime).slice(0, 5)]);
        if (!clock || !s) return 'unknown'; // a time window we cannot place in a timezone confirms nothing
        const inside = (clock.minutes >= s.o && clock.minutes < s.c) || (s.c > 1440 && clock.minutes < s.c - 1440);
        if (!inside) return 'closed';
      }
      return biz;
    }
    default: return 'unknown';
  }
}

export function getAvailabilityStatus(entity, at = new Date()) {
  const t = nowMs(at);
  switch (entity?.kind) {
    case 'business': {
      const live = postingLive(entity.posting, t);
      if (live === true) return entity.posting.remainingCapacity === 0 ? 'unavailable' : 'available';
      const p = ms(entity.pulseUpdatedAt);
      if (entity.pulse && p != null && t - p <= PULSE_NOW_FRESH_MS && p <= t + 60000 && getOperatingStatus(entity, t) !== 'closed') {
        if (entity.pulse === 'full') return 'unavailable';
        if (entity.pulse === 'open' || entity.pulse === 'limited') return 'available';
      }
      return 'unknown';
    }
    case 'gathering': {
      if (getOperatingStatus(entity, t) !== 'open') return 'unknown';
      if (entity.isFull) return 'unavailable';
      return entity.open ? 'available' : 'unknown';
    }
    case 'perk': {
      if (getOperatingStatus(entity, t) === 'closed') return 'unknown';
      return getAvailabilityStatus(entity.business, t);
    }
    default: return 'unknown';
  }
}

// 'available' | 'open' | 'closed' | 'unknown'. A live posting with room makes a business usable even outside its hours (the owner
// posted it for now); a fresh "full" pulse or a full gathering makes an open thing unusable.
export function usableNowTier(entity, at = new Date()) {
  const avail = getAvailabilityStatus(entity, at);
  if (avail === 'available') return 'available';
  const op = getOperatingStatus(entity, at);
  if (avail === 'unavailable') return 'closed';
  return op === 'open' ? 'open' : op;
}
export function isConfirmedUsableNow(entity, at = new Date()) {
  const tier = usableNowTier(entity, at);
  return tier === 'available' || tier === 'open';
}

// The explicit filter: keeps only confirmed-usable items. Unknown and closed are both excluded, on purpose.
export function filterOpenNow(items, toEntity, at = new Date()) {
  return (items ?? []).filter((item) => isConfirmedUsableNow(toEntity(item), at));
}

// Ranking lift for a "right now" ask without the filter: available +2, open +1, unknown/closed 0 (never a penalty, never hidden).
export const OPEN_NOW_LIFT = { available: 2, open: 1 };
export function openNowLift(entity, at = new Date()) {
  return OPEN_NOW_LIFT[usableNowTier(entity, at)] ?? 0;
}

// ---- Typed asks ----
// Only language about operating/usability ("what's open", "still open", "somewhere I can go right now") turns the filter on.
// "now", "tonight", "open mic", "open play", "open bar", "open to anything" do not.
const NOT_HOURS = '(?!\\s*(?:-|mic\\b|play\\b|bar\\b|house\\b|air\\b|to\\b|minded\\b|studio\\b|gym\\b|water\\b|field\\b|court\\b|swim\\b|seating\\b|format\\b|invite\\b|call\\b|space\\b|kitchen\\b|jam\\b|skate\\b|late\\b|until\\b|at\\b|on\\b|tomorrow\\b))';
const ASK_PATTERNS = [
  new RegExp(`\\bopen\\s+(?:right\\s+)?now\\b`),
  new RegExp(`\\bstill\\s+open\\b${NOT_HOURS}`),
  new RegExp(`\\b(?:what|whats|what's|what is|anything|anywhere|somewhere|something|places?|who|where)(?:'s|s| is)?\\s+(?:still\\s+)?open\\b${NOT_HOURS}`),
  /\b(?:somewhere|where|places?)\s+(?:i|we)\s+can\s+(?:go|get in|walk in)\s+(?:to\s+)?(?:right\s+)?now\b/,
  /\bwhere\s+can\s+(?:i|we)\s+go\s+(?:right\s+)?now\b/,
];
// "open tonight" means open right now only once it already is evening where the person is.
const EVENING_FROM_HOUR = 17;

export function openNowAskFromText(text, now = new Date()) {
  const t = String(text ?? '').toLowerCase().replace(/[’`]/g, "'");
  if (!t.trim()) return false;
  if (/\b(?:not|isn't|aren't|doesn't|don't|no need to be)\b[^.?!]{0,20}\bopen\b/.test(t)) return false;
  if (ASK_PATTERNS.some((re) => re.test(t))) return true;
  if (new RegExp(`\\bopen\\s+tonight\\b${NOT_HOURS}`).test(t)) return new Date(nowMs(now)).getHours() >= EVENING_FROM_HOUR;
  return false;
}

export const OPEN_NOW_CAPTION = 'Showing only what is open right now';

// ---- Display (owner editor + public business profile) ----
export const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_SHORT = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };

// "09:30" -> "9:30 AM", "00:00" -> "12 AM"; null for anything unreadable.
export function formatClock(hhmm) {
  const m = toMinutes(hhmm);
  return m == null ? null : clockLabel(m);
}

export function dayHoursText(value) {
  if (value === 'closed') return 'Closed';
  if (value === 'all_day') return 'Open 24 hours';
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map(([o, c]) => {
    const om = toMinutes(o);
    const cm = toMinutes(c);
    return om == null || cm == null ? null : `${clockLabel(om)} – ${clockLabel(cm)}`;
  }).filter(Boolean).join(', ');
}

// Mon..Sun rows, only for a valid declaration (null otherwise, so nothing half-read is ever shown).
export function weekHoursLines(hours) {
  if (!hours || operatingHoursProblem(hours)) return null;
  return DAY_ORDER.map((d) => ({ day: DAY_SHORT[d], text: dayHoursText(hours.week[d]) }));
}

// A starting week for the owner editor: every day unset until the owner picks. Never pre-filled with guessed hours.
export function blankWeek() {
  return Object.fromEntries(DAY_KEYS.map((d) => [d, null]));
}
