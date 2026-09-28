// Showing a recommendation reason in the person's language (shared context layer, 2026-09-28). Every reason is built in its
// canonical English form from the templates in i18n/translations.js (`en.reasons`, via reasonText) and ranking classifies that
// English text, so the text itself is never changed upstream. At presentation, localizeReason reads the English sentence back
// into its template key + values and renders the same key in the person's language through the ONE lookup (i18n/translate.js):
//   the askedFor sentence for a category X -> { key: 'askedFor', vars: { category: X } } -> the Spanish askedFor sentence
// Activity names are part of the sentence, so they are translated too (reasons.activities.<key>, from constants/activityLayer.js).
// Category tags, occasion names, cuisine and people's names are inserted as stored (the app has no per-tag translations).
// Anything that is not a registered template (a surface-specific fact, a ranking-pass detail) is returned unchanged: English is
// the app's fallback. English in = English out, byte for byte (tested), so 'en' never changes what is shown.
import { translations } from '../i18n/translations';
import { translate, DEFAULT_LANGUAGE } from '../i18n/translate';
import { ACTIVITIES } from '../constants/activityLayer';

// Most specific first: a longer sentence that contains a shorter template's shape must be tried before it.
export const REASON_PARSE_ORDER = [
  'friendGoingManyOne', 'friendGoingMany', 'aFriendGoing', 'friendsGoingCount', 'friendGoingTwo', 'friendGoingOne',
  'friendIntoManyOne', 'friendIntoMany', 'aFriendInto', 'friendsIntoCount', 'friendIntoTwo', 'friendIntoOne',
  'aFriendHosting', 'aFriendHosted', 'friendHosting', 'friendHosted',
  'friendsPlanActivity', 'activity', 'becauseYouLike', 'askedFor', 'occasionOffered', 'relatedInterest', 'recentActivity',
  'trendingGoing', 'trendingNearby', 'startingSoon', 'happeningToday',
  'onePersonAttending', 'peopleAttending', 'oneFriendAttending', 'friendsAttending', 'oneFirstTimer', 'firstTimers', 'attendingCount',
  'lovedHost', 'lovedKind', 'lovedBusiness', 'inCategoryYouLike', 'weatherIndoor', 'weatherOutdoor',
  'closeBy', 'hangOutStyle', 'likeWhatYouJoined', 'greatWeatherForIt', 'canHostGroup', 'privateRoomFits', 'outdoorAreaFits',
  'welcomesGroups', 'hostsPrivateEvents', 'offersCatering', 'easyDropIn', 'lowCommitment', 'worthSettingTime', 'suitedAllAges',
  'suitedKids', 'suitedTeens', 'accommodatesGroup', 'beenHereBefore', 'businessYouFollow', 'meetNewPeople', 'alreadyMember',
  'publicCommunity', 'atBusiness',
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(template) {
  const names = [];
  const source = template.split(/(\{\w+\})/).map((part) => {
    const m = part.match(/^\{(\w+)\}$/);
    if (!m) return escape(part);
    names.push(m[1]);
    return m[1] === 'count' ? '(\\d+)' : '(.+?)';
  }).join('');
  return { re: new RegExp(`^${source}$`), names };
}

const EN = translations[DEFAULT_LANGUAGE].reasons;
const COMPILED = REASON_PARSE_ORDER.map((key) => ({ key, ...compile(EN[key]) }));
const ACTIVITY_KEY_BY_LABEL = new Map(ACTIVITIES.map((a) => [a.label, a.key]));

// The template a canonical English reason was built from, or null.
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
  const vars = { ...parsed.vars };
  if (vars.activity) {
    const k = ACTIVITY_KEY_BY_LABEL.get(vars.activity);
    if (k) vars.activity = translate(language, `reasons.activities.${k}`);
  }
  return translate(language, `reasons.${parsed.key}`, vars);
}

export function localizeReasons(list, language = DEFAULT_LANGUAGE) {
  return (Array.isArray(list) ? list : []).map((r) => localizeReason(r, language));
}
