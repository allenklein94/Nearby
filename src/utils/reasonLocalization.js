// Showing a recommendation reason (and a result row's status note) in the person's language. Every reason is built in its
// canonical English form from the templates in i18n/translations.js (`en.reasons`, `en.resultNotes`, via reasonText /
// resultNoteText) and ranking classifies that English text, so the text itself is never changed upstream. At presentation,
// localizeReason reads the English sentence back into its template key + values and renders the same key in the person's
// language through the ONE lookup (i18n/translate.js):
//   the askedFor sentence for a category X -> { key: 'reasons.askedFor', vars: { category: X } } -> the Spanish askedFor sentence
//
// Values are localized FIRST, then the sentence is composed from them (never a translated English fragment):
//   typed placeholders only match values from their own closed vocabulary (a format, skill, genre, attribute or dietary label,
//   a cuisine, an activity phrase) or their own shape (a duration, a clock time, a distance, a price, a weekday list, a number),
//   and each is rendered from the language's vocab (translations.<lang>.vocab) through i18n/format.js.
//   Sentences whose grammar changes with the value (German adjective endings, "Fits a low-key plan") are one key per value
//   (reasons.energyFit.low_key), never an adjective dropped into a frame. A count-bearing sentence picks its plural form from
//   the number (translate.js), including a clock hour (Spanish "la 1" / "las 3") and an age (Russian "1 года" / "5 лет").
// Category tags, occasion names, business titles and people's names are inserted as stored (the app has no per-tag
// translations; a business's own words are its own). Anything that is not a registered template is returned unchanged:
// English is the app's fallback. English in = English out, byte for byte (tested), so 'en' never changes what is shown.
import { translations } from '../i18n/translations';
import { translate, DEFAULT_LANGUAGE } from '../i18n/translate';
import { localClock, clockCount, localDuration, localNumber, localMoney, vocabValue } from '../i18n/format';
import { ACTIVITIES } from '../constants/activityLayer';
import { ACTIVITY_FORMATS } from '../constants/activityFormat';
import { SKILL_LEVELS } from '../constants/skillLevel';
import { GENRE_OPTIONS } from './gatheringPractical';
import { BUSINESS_DIETARY_OPTIONS } from '../constants/dietaryOptions';
import { BUSINESS_ATTRIBUTE_OPTIONS, CUISINE_OPTIONS } from '../constants/businessAttributes';

export const LOCALIZED_NAMESPACES = ['reasons', 'resultNotes'];

// Most specific first: a longer sentence that contains a shorter template's shape must be tried before it; typed templates
// (closed vocabularies) before generic ones.
export const REASON_PARSE_ORDER = [
  'reasons.friendGoingManyOne', 'reasons.friendGoingMany', 'reasons.aFriendGoing', 'reasons.friendsGoingCount', 'reasons.friendGoingTwo', 'reasons.friendGoingOne',
  'reasons.friendIntoManyOne', 'reasons.friendIntoMany', 'reasons.aFriendInto', 'reasons.friendsIntoCount', 'reasons.friendIntoTwo', 'reasons.friendIntoOne',
  'reasons.aFriendHosting', 'reasons.aFriendHosted', 'reasons.friendHosting', 'reasons.friendHosted',
  'reasons.friendsPlanActivity', 'reasons.activity', 'reasons.becauseYouLike', 'reasons.askedForCuisine', 'reasons.askedFor',
  'reasons.occasionOffered', 'reasons.genreInterest', 'reasons.relatedInterest', 'reasons.recentActivity',
  'reasons.trendingGoing', 'reasons.trendingNearby', 'reasons.startingSoon', 'reasons.happeningToday',
  'reasons.onePersonAttending', 'reasons.peopleAttending', 'reasons.oneFriendAttending', 'reasons.friendsAttending', 'reasons.oneFirstTimer', 'reasons.firstTimers', 'reasons.attendingCount',
  'reasons.lovedHost', 'reasons.lovedKind', 'reasons.lovedBusiness', 'reasons.inCategoryYouLike', 'reasons.weatherIndoor', 'reasons.weatherOutdoor',
  'reasons.closeBy', 'reasons.hangOutStyle', 'reasons.likeWhatYouJoined', 'reasons.greatWeatherForIt', 'reasons.canHostGroup', 'reasons.privateRoomFits', 'reasons.outdoorAreaFits',
  'reasons.welcomesGroups', 'reasons.hostsPrivateEvents', 'reasons.offersCatering', 'reasons.easyDropIn', 'reasons.lowCommitment', 'reasons.worthSettingTime', 'reasons.suitedAllAges',
  'reasons.suitedKids', 'reasons.suitedTeens', 'reasons.accommodatesGroup', 'reasons.beenHereBefore', 'reasons.businessYouFollow', 'reasons.meetNewPeople', 'reasons.alreadyMember',
  'reasons.publicCommunity',
  'reasons.format', 'reasons.skill', 'reasons.timeAbout', 'reasons.timeUsually', 'reasons.clockBetween', 'reasons.clockBefore', 'reasons.clockAfter',
  'reasons.suitedAgesRange', 'reasons.suitedAge', 'reasons.suitedAgesFrom', 'reasons.suitedAgesUpTo',
  'reasons.dietaryDeclared', 'reasons.dietaryList', 'reasons.attributeList', 'reasons.whoForLikes', 'reasons.theyLike', 'reasons.whoForTaste', 'reasons.theirTaste',
  'reasons.distanceAway',
  'reasons.energyFit.low_key', 'reasons.energyFit.social', 'reasons.energyFit.active', 'reasons.energyFit.high_energy', 'reasons.energyFit.romantic', 'reasons.energyFit.adventurous',
  'reasons.intensityPace.low_key', 'reasons.intensityPace.moderate', 'reasons.intensityPace.high_energy',
  'reasons.effortLevel.light', 'reasons.effortLevel.moderate', 'reasons.effortLevel.challenging',
  'reasons.socialFit.solo', 'reasons.socialFit.one_on_one', 'reasons.socialFit.small_group', 'reasons.socialFit.group',
  'resultNotes.fullWaitlistCount', 'resultNotes.fullWaitlist', 'resultNotes.mayBeAvailable', 'resultNotes.askWhatTheyCan', 'resultNotes.friendDiscovery',
  'resultNotes.pricePerPerson', 'resultNotes.price', 'resultNotes.minGuest', 'resultNotes.minGuests', 'resultNotes.days',
  'reasons.atBusiness',
];

// ---- typed placeholders: English value <-> localized value ----
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (values) => `(?:${[...values].sort((a, b) => b.length - a.length).map(escape).join('|')})`;
const vocabOf = (options, ns) => ({ map: new Map(options.map((o) => [o.label, o.key])), ns });
const oneOf = ({ map, ns }) => ({ re: alt(map.keys()), render: (value, lang) => (map.has(value) ? translate(lang, `vocab.${ns}.${map.get(value)}`) : value) });
const listOf = ({ map, ns }, sep) => ({
  re: `${alt(map.keys())}(?:${escape(sep)}${alt(map.keys())})*`,
  render: (value, lang) => value.split(sep).map((p) => (map.has(p) ? translate(lang, `vocab.${ns}.${map.get(p)}`) : p)).join(sep),
});

const FORMAT_VOCAB = { map: new Map(ACTIVITY_FORMATS.map((f) => [`${f.icon} ${f.label}`, f.key])), ns: 'formats' };
const FORMAT_ICON = new Map(ACTIVITY_FORMATS.map((f) => [f.key, f.icon]));
const CUISINES = CUISINE_OPTIONS.filter((c) => c.key);
const DAY_MIN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']; // occasionPackageFormatting's own day labels

// "3 PM", "3:30 PM", "noon", "midnight" (constants/clockWindow.js clockLabel) -> minutes after midnight
export function clockMinutes(text) {
  if (text === 'noon') return 12 * 60;
  if (text === 'midnight') return 0;
  const m = String(text).match(/^(\d{1,2})(?::(\d{2}))? (AM|PM)$/);
  if (!m) return null;
  const h = (Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0);
  return h * 60 + Number(m[2] ?? 0);
}
const CLOCK_RE = '\\d{1,2}(?::\\d{2})? (?:AM|PM)|noon|midnight';
const clock = { re: CLOCK_RE, render: (value, lang) => localClock(clockMinutes(value), lang, { words: true }) ?? value };

// "45 min" / "1.5 hr" (gatheringPractical.durationLabel) -> minutes
const durationMinutes = (text) => {
  const m = String(text).match(/^(\d+(?:\.\d+)?) (min|hr)$/);
  return m ? Math.round(Number(m[1]) * (m[2] === 'hr' ? 60 : 1)) : null;
};

// "Under 100 ft" / "800 ft" / "1.2 mi" (utils/formatDistance.js) -> the same figure in the language's words (miles kept)
function localDistanceText(text, lang) {
  if (text === 'Under 100 ft') return translate(lang, 'vocab.units.underFeet', { n: localNumber(100, lang), count: 100 });
  const m = String(text).match(/^(\d+(?:\.\d)?) (ft|mi)$/);
  if (!m) return text;
  const n = Number(m[1]);
  const decimal = m[1].includes('.');
  return translate(lang, `vocab.units.${m[2] === 'ft' ? 'feet' : 'miles'}`, { n: localNumber(n, lang, decimal ? 1 : null), count: decimal ? 0.5 : n });
}

const NUMBER = { re: '\\d+', render: (value) => value };

const TYPES = {
  count: NUMBER, min: NUMBER, max: NUMBER, age: NUMBER, going: NUMBER, capacity: NUMBER,
  activity: { re: alt(ACTIVITIES.map((a) => a.label)), render: (value, lang) => { const a = ACTIVITIES.find((x) => x.label === value); return a ? translate(lang, `reasons.activities.${a.key}`) : value; } },
  format: oneOf(FORMAT_VOCAB),
  skill: oneOf(vocabOf(SKILL_LEVELS, 'skills')),
  genre: oneOf(vocabOf(GENRE_OPTIONS.filter((o) => o.key), 'genres')),
  cuisine: oneOf(vocabOf(CUISINES, 'cuisines')),
  cuisineFood: oneOf({ map: new Map(CUISINES.map((c) => [`${c.label} food`, c.key])), ns: 'cuisineFood' }),
  attributes: listOf(vocabOf(BUSINESS_ATTRIBUTE_OPTIONS, 'attributes'), ' · '),
  dietary: listOf(vocabOf(BUSINESS_DIETARY_OPTIONS, 'dietary'), ' · '),
  duration: { re: '\\d+ min|\\d+(?:\\.\\d+)? hr', render: (value, lang) => localDuration(durationMinutes(value), lang) ?? value },
  time: clock, time1: clock, time2: clock,
  distance: { re: 'Under 100 ft|\\d+ ft|\\d+(?:\\.\\d)? mi', render: localDistanceText },
  price: { re: '\\$\\d+(?:\\.\\d{2})?', render: (value, lang) => localMoney(Number(value.slice(1)), lang) ?? value },
  days: {
    re: `${alt(DAY_MIN)}(?:/${alt(DAY_MIN)})*`,
    render: (value, lang) => value.split('/').map((d) => (vocabValue(lang, 'date.weekdays') ?? [])[DAY_MIN.indexOf(d)] ?? d).join('/'),
  },
};

// Which number a sentence's plural form agrees with, when it is not {count}.
const PLURAL_FROM = {
  'reasons.suitedAge': (v) => v.age, 'reasons.suitedAgesFrom': (v) => v.min, 'reasons.suitedAgesUpTo': (v) => v.max, 'reasons.suitedAgesRange': (v) => v.max,
};
const CLOCK_PLURAL = ['reasons.clockBefore', 'reasons.clockAfter'];

const englishTemplate = (keyPath) => keyPath.split('.').reduce((v, p) => v?.[p], translations[DEFAULT_LANGUAGE]);

function compile(keyPath) {
  const template = englishTemplate(keyPath);
  const names = [];
  const source = template.split(/(\{\w+\})/).map((part) => {
    const m = part.match(/^\{(\w+)\}$/);
    if (!m) return escape(part);
    names.push(m[1]);
    return TYPES[m[1]] ? `(${TYPES[m[1]].re})` : '(.+?)';
  }).join('');
  return { key: keyPath, re: new RegExp(`^${source}$`), names };
}

const COMPILED = REASON_PARSE_ORDER.map(compile);

// The template a canonical English reason or note was built from, or null. `key` is the full path ('reasons.askedFor').
export function parseReason(text) {
  if (typeof text !== 'string' || !text) return null;
  for (const { key, re, names } of COMPILED) {
    const m = text.match(re);
    if (m) return { key, vars: Object.fromEntries(names.map((n, i) => [n, m[i + 1]])) };
  }
  return null;
}

export function localizeReason(text, language = DEFAULT_LANGUAGE) {
  if (!text || !language || language === DEFAULT_LANGUAGE) return text;
  const parsed = parseReason(text);
  if (!parsed) return text;
  const raw = parsed.vars;
  const vars = {};
  for (const [name, value] of Object.entries(raw)) vars[name] = TYPES[name] ? TYPES[name].render(value, language) : value;
  if (raw.count !== undefined) vars.count = Number(raw.count);
  else if (PLURAL_FROM[parsed.key]) vars.count = Number(PLURAL_FROM[parsed.key](raw));
  else if (CLOCK_PLURAL.includes(parsed.key)) vars.count = clockCount(clockMinutes(raw.time), language);
  if (parsed.key === 'reasons.format') {
    const key = FORMAT_VOCAB.map.get(raw.format);
    if (key) vars.format = `${FORMAT_ICON.get(key)} ${translate(language, `vocab.formats.${key}`)}`;
  }
  return translate(language, parsed.key, vars);
}

export function localizeReasons(list, language = DEFAULT_LANGUAGE) {
  return (Array.isArray(list) ? list : []).map((r) => localizeReason(r, language));
}

// A result row's detail line: each " · " part is its own note (a status line, a price, a registered reason); unregistered
// parts (a business's own posting title) are kept as written.
export function localizeNote(text, language = DEFAULT_LANGUAGE) {
  if (!text || !language || language === DEFAULT_LANGUAGE) return text;
  const whole = localizeReason(text, language);
  if (whole !== text) return whole;
  return String(text).split(' · ').map((p) => localizeReason(p, language)).join(' · ');
}
