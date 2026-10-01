// The public business profile's owner-declared facts in the person's language (localization pass 5). English returns the
// existing helpers' output unchanged (byte-identical; the business dashboard keeps calling those helpers directly and stays
// English, owner decision 2026-09-29). Other languages compose the SAME decisions from ui.businessProfile.v.* and the shared
// vocab (attributes, dietary, cuisines). Display only: nothing here is stored, compared or ranked.
import { translate } from './translate';
import { localClock, localNumber, vocabValue } from './format';
import { attributeLabel, dietaryOptionLabel } from './optionLabels';
import { hoursStatusParts, businessHoursLabel, weekHoursLines, DAY_ORDER } from '../utils/operatingStatus';
import { bookingModeOf, bookingModeOption, NEEDS_BOOKING_FIRST } from '../constants/bookingMode';
import { maxGroupLine, cleanMaxGroupSize, spaceCapacityLines, SPACES, spaceCapacity } from '../constants/businessCapabilities';
import { notAccommodatedLine, notAccommodatedOf, NOT_ACCOMMODATED_OPTIONS } from '../constants/businessRestrictions';
import { dietaryOptionsLine, dietaryOptionsOf, dietarySafetyNote, BUSINESS_DIETARY_OPTIONS, SAFETY_SENSITIVE_DIETARY } from '../constants/dietaryOptions';
import { businessPriceLine, BUSINESS_PRICE_LEVELS } from '../constants/businessPrice';
import { businessAttributeLabel, cuisineLabel, availabilityPulseLabel, experiencePartyTypeLabel, CUISINE_OPTIONS } from '../constants/businessAttributes';
import { thingsToDoHere } from '../constants/activityLayer';
import { ageRangeLabel, cleanAgeRange, ageBandOf } from '../utils/suitedAges';

const isEnglish = (language) => !language || language === 'en';
const v = (language, key, vars) => translate(language, `ui.businessProfile.v.${key}`, vars);
const sep = ' · ';
const toMin = (hhmm) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const clock = (minutes, language) => localClock(((minutes % 1440) + 1440) % 1440, language);

export function followerCountLine(count, language) {
  return v(language, 'followers', { count: count ?? 0 });
}

// Same rules as formatPartnerReliabilityLine (services/businessFulfillment.js), composed from keys in every language (the English
// keys are that function's wording; businessProfileDisplay.test.js keeps them equal).
export function reliabilityLine(reputation, responseTime, language) {
  if (!reputation || reputation.total_opportunities < 5) return null;
  const parts = [];
  if (responseTime?.median_response_minutes != null && responseTime.response_sample_size >= 3) {
    const mins = Number(responseTime.median_response_minutes);
    parts.push(mins < 60 ? v(language, 'respondsMinutes', { count: mins }) : v(language, 'respondsHours', { count: Math.round(mins / 60) }));
  }
  if (reputation.acceptance_rate != null) parts.push(v(language, 'pctAccepted', { pct: Math.round(reputation.acceptance_rate) }));
  if (reputation.completion_rate != null) parts.push(v(language, 'pctCompleted', { pct: Math.round(reputation.completion_rate) }));
  if (reputation.rated_count >= 3 && reputation.pct_would_repeat != null) parts.push(v(language, 'pctWouldRepeat', { pct: Math.round(reputation.pct_would_repeat) }));
  return parts.length > 0 ? `⭐ ${parts.join(sep)}` : null;
}

// "Open now · until 5 PM" / "Within today's hours · until 5 PM · booking needed" (the same decision as businessHoursLabel).
export function hoursLine(partner, language, at = new Date()) {
  if (isEnglish(language)) return businessHoursLabel(partner, at);
  const p = hoursStatusParts(partner?.operating_hours ?? null, at);
  if (!p.kind) return null;
  const until = p.kind === 'until' ? clock(p.until, language) : null;
  if (p.status === 'open' && NEEDS_BOOKING_FIRST.includes(bookingModeOf(partner))) {
    return until ? v(language, 'withinHoursUntil', { time: until }) : v(language, 'withinHours');
  }
  if (p.kind === 'until') return v(language, 'openUntil', { time: until });
  return v(language, { temporarily_closed: 'temporarilyClosed', all_day: 'open24', closed: 'closedNow' }[p.kind]);
}

const WEEKDAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
// Mon..Sun rows [{ key, day, text }], only when weekHoursLines accepts the declaration (same validity rule).
export function weekHoursRows(hours, language) {
  const en = weekHoursLines(hours);
  if (!en) return null;
  if (isEnglish(language)) return en.map((l, i) => ({ key: DAY_ORDER[i], ...l }));
  const days = vocabValue(language, 'date.weekdays') ?? [];
  return DAY_ORDER.map((d) => {
    const val = hours.week[d];
    let text = null;
    if (val === 'closed') text = v(language, 'closed');
    else if (val === 'all_day') text = v(language, 'open24');
    else if (Array.isArray(val) && val.length) {
      text = val.map(([o, c]) => {
        const om = toMin(o);
        const cm = toMin(c);
        return om == null || cm == null ? null : `${clock(om, language)} – ${clock(cm, language)}`;
      }).filter(Boolean).join(', ');
    }
    return { key: d, day: days[WEEKDAY_INDEX[d]] ?? d, text };
  });
}

// "📅 Reservation required" (the booking mode as the owner declared it), or null.
export function bookingModeLine(partner, language) {
  const opt = bookingModeOption(bookingModeOf(partner));
  if (!opt) return null;
  return `${opt.icon} ${isEnglish(language) ? opt.customerLine : v(language, `booking.${opt.key}`)}`;
}

export function priceLine(level, spend, language) {
  if (isEnglish(language)) return businessPriceLine(level, spend);
  const parts = [];
  if (BUSINESS_PRICE_LEVELS.includes(level)) parts.push(level);
  if (Number.isInteger(spend) && spend > 0) parts.push(v(language, 'typicalSpend', { amount: `$${localNumber(spend, language)}` }));
  return parts.length ? parts.join(sep) : null;
}

const upTo = (n, language) => (n === null ? null : v(language, 'upToPeople', { count: n }));
export function largestGroupLine(value, language) {
  return isEnglish(language) ? maxGroupLine(value) : upTo(cleanMaxGroupSize(value), language);
}
// [{ key, label, line }] for declared spaces with a size.
export function spaceLines(partner, language) {
  if (isEnglish(language)) return spaceCapacityLines(partner);
  return SPACES.map((s) => ({ key: s.key, label: v(language, `space.${s.key}`), line: upTo(spaceCapacity(partner, s.key), language) })).filter((x) => x.line);
}

export function restrictionsLine(partner, language) {
  if (isEnglish(language)) return notAccommodatedLine(partner);
  const keys = notAccommodatedOf(partner);
  if (keys.length === 0) return null;
  return NOT_ACCOMMODATED_OPTIONS.filter((o) => keys.includes(o.key)).map((o) => v(language, `restriction.${o.key}`)).join(sep);
}

export function dietaryLine(partner, language) {
  if (isEnglish(language)) return dietaryOptionsLine(partner);
  const keys = dietaryOptionsOf(partner);
  if (keys.length === 0) return null;
  return BUSINESS_DIETARY_OPTIONS.filter((o) => keys.includes(o.key)).map((o) => dietaryOptionLabel(o.key, o.label, language)).join(sep);
}
export function dietaryNote(partner, language) {
  const en = dietarySafetyNote(dietaryOptionsOf(partner));
  if (!en || isEnglish(language)) return en;
  return dietaryOptionsOf(partner).some((k) => SAFETY_SENSITIVE_DIETARY.includes(k)) ? v(language, 'dietarySafety') : null;
}

export function pulseLabel(key, language) {
  return isEnglish(language) ? availabilityPulseLabel(key) : (['open', 'limited', 'full'].includes(key) ? v(language, `pulse.${key}`) : key);
}
export function cuisineName(key, language) {
  if (isEnglish(language) || !CUISINE_OPTIONS.some((o) => o.key === key)) return cuisineLabel(key);
  return translate(language, `vocab.cuisines.${key}`);
}
export function businessAttributeName(key, language) {
  return attributeLabel(key, businessAttributeLabel(key), language);
}
export function partyTypeName(key, language) {
  const en = experiencePartyTypeLabel(key);
  if (isEnglish(language) || en === key) return en;
  return v(language, `partyType.${key}`);
}
// [{ key, icon, label }] -- the same activities thingsToDoHere derives, labels in the person's language.
export function thingsToDoLabels(row, language) {
  const list = thingsToDoHere(row);
  return isEnglish(language) ? list : list.map((a) => ({ ...a, label: v(language, `activity.${a.key}`) }));
}

// Suited ages ("Ages 3–8", "All ages", "Kids (up to 12)"): descriptive, never a restriction. Shared with AgeRangePicker and the
// gathering practical facts.
export function suitedAgesLabel(min, max, language) {
  if (isEnglish(language)) return ageRangeLabel(min, max);
  const { min: a, max: b } = cleanAgeRange(min, max);
  if (a == null && b == null) return null;
  const band = ageBandOf(a, b);
  const s = (key, vars) => translate(language, `ui.suitedAges.${key}`, vars);
  if (band) return s(`band.${band.key}`);
  if (a != null && b != null) return a === b ? s('exactly', { age: a }) : s('range', { min: a, max: b });
  return a != null ? s('from', { min: a }) : s('upTo', { max: b });
}
