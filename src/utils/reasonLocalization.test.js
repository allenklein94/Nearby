// Translated recommendation reasons (2026-09-28). The wording lives ONCE in the existing localization system
// (i18n/translations.js `reasons`), is looked up through the ONE lookup LanguageContext's t() uses (i18n/translate.js), and every
// converted discovery surface renders the same key for the same match. Ranking, matching and selection run on the canonical
// English form; only the shown text changes with the language.
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));

import fs from 'fs';
import path from 'path';
import { translations } from '../i18n/translations';
import { translate, interpolate, hasOwnTranslation, DEFAULT_LANGUAGE } from '../i18n/translate';
import { parseReason, localizeReason, localizeReasons, REASON_PARSE_ORDER } from './reasonLocalization';
import { recommendationContext, contextItem, resultRowView, REASONLESS_KINDS } from './recommendationContext';
import { gatheringCardModel } from './recommendationCard';
import { recommendationRow, friendGoingReason } from './recommendationFacts';
import { friendsInterestReason } from './friendInterests';
import {
  reasonText, becauseYouLikeReason, askedForReason, activityReason, friendsPlanActivityReason, occasionOfferedReason,
} from '../constants/recommendationReasonVocabulary';
import { reasonTier } from '../constants/signalPriority';
import { ACTIVITIES } from '../constants/activityLayer';

const LANGS = Object.keys(translations);
const EN = translations.en.reasons;
const TEMPLATE_KEYS = Object.keys(EN).filter((k) => typeof EN[k] === 'string');
const placeholders = (s) => (s.match(/\{\w+\}/g) ?? []).sort();
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// A sample value per placeholder, so every template can be built, parsed and localized.
const SAMPLE = { category: 'Coffee', activity: 'grabbing a coffee', occasion: 'Birthday', interest: 'Photography', name: 'Sam', name1: 'Sam', name2: 'Alex', names: 'Sam, Alex', count: 3, business: 'Coastal Coffee' };
const sampleVars = (key) => Object.fromEntries(placeholders(EN[key]).map((p) => { const n = p.slice(1, -1); return [n, SAMPLE[n]]; }));

describe('the one lookup (i18n/translate.js)', () => {
  it('reads a key in the current language', () => {
    expect(translate('es', 'reasons.becauseYouLike', { category: 'Coffee' })).toBe('Porque te gusta Coffee');
    expect(translate('de', 'reasons.becauseYouLike', { category: 'Coffee' })).toBe('Weil du Coffee magst');
  });
  it('interpolates named placeholders, leaving a missing one visible (never silently dropped)', () => {
    expect(interpolate('{a} and {b}', { a: 'x', b: 2 })).toBe('x and 2');
    expect(interpolate('{a} and {b}', { a: 'x' })).toBe('x and {b}');
    expect(interpolate('plain', null)).toBe('plain');
  });
  it('falls back to English for a missing key or unknown language, then to the key path', () => {
    expect(translate('xx', 'reasons.startingSoon')).toBe('Starting soon');
    expect(translate('es', 'reasons.__nope__')).toBe('reasons.__nope__');
  });
  it('the default locale is unchanged (English) and LanguageContext uses this lookup', () => {
    expect(DEFAULT_LANGUAGE).toBe('en');
    const ctx = read('context/LanguageContext.js');
    expect(ctx).toMatch(/translate\(language, keyPath, vars\)/);
    expect(ctx).toMatch(/const DEFAULT_LANGUAGE|'en'/);
  });
  it('no new language was added: the reason wording lives only in the existing locales', () => {
    expect(LANGS).toEqual(['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko']);
  });
});

describe('coverage: every locale carries every reason with the same placeholders', () => {
  it.each(LANGS)('%s', (lang) => {
    for (const key of TEMPLATE_KEYS) {
      expect([lang, key, hasOwnTranslation(lang, `reasons.${key}`)]).toEqual([lang, key, true]);
      expect([lang, key, placeholders(translations[lang].reasons[key])]).toEqual([lang, key, placeholders(EN[key])]);
    }
    for (const a of ACTIVITIES) expect([lang, a.key, hasOwnTranslation(lang, `reasons.activities.${a.key}`)]).toEqual([lang, a.key, true]);
  });
  it('the English activity phrases are the activity layer labels (one wording)', () => {
    for (const a of ACTIVITIES) expect(EN.activities[a.key]).toBe(a.label);
  });
});

describe('parsing the canonical English reason back to its key', () => {
  it('every template is registered for parsing', () => {
    expect([...REASON_PARSE_ORDER].sort()).toEqual([...TEMPLATE_KEYS].sort());
  });
  it.each(TEMPLATE_KEYS)('%s round-trips to its own key', (key) => {
    const text = reasonText(key, sampleVars(key));
    expect(parseReason(text)?.key).toBe(key);
  });
  it('English in = English out, byte for byte', () => {
    for (const key of TEMPLATE_KEYS) {
      const text = reasonText(key, sampleVars(key));
      expect(localizeReason(text, 'en')).toBe(text);
    }
  });
  it('an unregistered reason is shown as written (English fallback)', () => {
    expect(parseReason('Fits a low-key plan')).toBeNull();
    expect(localizeReason('Fits a low-key plan', 'es')).toBe('Fits a low-key plan');
  });
});

describe('localizing dynamic reasons with interpolation', () => {
  it('category, activity, occasion and friend reasons', () => {
    expect(localizeReason(askedForReason('Coffee'), 'es')).toBe('Porque pediste Coffee');
    // the activity phrase is translated as part of the sentence, not left as an English fragment
    expect(localizeReason(activityReason('grabbing a coffee'), 'es')).toBe('Ideal para tomar un café');
    expect(localizeReason(friendsPlanActivityReason('meeting a friend'), 'es')).toBe('Un plan con amigos, ideal para ver a un amigo');
    expect(localizeReason(occasionOfferedReason('Birthday'), 'de')).toBe('Bietet Birthday-Erlebnisse an');
    expect(localizeReason(friendsInterestReason('Coffee', { friend_count: 1, sample_names: ['Sam'] }), 'es')).toBe('A Sam le gusta Coffee');
    expect(localizeReason(reasonText('friendsGoingCount', { count: 4 }), 'fr')).toBe(translate('fr', 'reasons.friendsGoingCount', { count: 4 }));
  });
  it('names and category tags are inserted as stored', () => {
    const g = { approvedAttendees: [{ user_id: 'f1', profiles: { display_name: 'Zoë' } }] };
    expect(localizeReason(friendGoingReason(g, new Set(['f1'])), 'es')).toBe('Zoë va');
  });
  it('a builder with nothing to name still yields no reason in any language', () => {
    expect(becauseYouLikeReason('')).toBeNull();
    expect(askedForReason(null)).toBeNull();
    expect(localizeReasons([null, becauseYouLikeReason(' ')].filter(Boolean), 'es')).toEqual([]);
    expect(localizeReason(null, 'es')).toBeNull();
  });
});

describe('the same match reads the same on every converted surface', () => {
  const NOW = new Date(2026, 8, 28, 15, 0);
  const g = { id: 'g1', title: 'Coffee meetup', interest_tag: 'Coffee', host_id: 'h', visibility: 'everyone', is_public: true,
    scheduled_at: new Date(2026, 8, 28, 18, 30).toISOString(), distanceMiles: 1.1, attendees: [], approvedCount: 0 };
  const reason = becauseYouLikeReason('Coffee');
  it.each(['es', 'ko', 'en'])('%s', (language) => {
    const expected = translate(language, 'reasons.becauseYouLike', { category: 'Coffee' });
    const card = gatheringCardModel(g, { signals: [{ kind: 'reason', text: reason }], myUserId: 'me', now: NOW.getTime(), language });
    const row = resultRowView({ type: 'gathering', ...g, startsAt: g.scheduled_at, reasons: [reason] }, { myUserId: 'me', now: NOW, language });
    const perk = recommendationContext(contextItem('perk', { id: 'p1', title: '10% off', distanceMiles: 0.3 }, { reasons: [reason] }), { language });
    const nearby = recommendationRow({ type: 'perk', reasons: [reason], data: { distanceMiles: 0.3 } }, { language });
    const nearbyNoContext = recommendationRow({ type: 'perk', reasons: [reason], data: {} }, { language });
    expect(card.why).toBe(expected);
    expect(row.reason).toBe(expected);
    expect(perk.reason).toBe(expected);
    expect(nearby.why).toBe(expected);
    expect(nearbyNoContext.why).toBe(expected);
    // selection happened on the canonical English reason, so ranking tiers are unaffected by the language
    expect(perk.canonicalReasons).toEqual([reason]);
    expect(reasonTier(perk.canonicalReasons[0])).toBe(reasonTier(reason));
  });
  it('social proof on a card is localized with the same rule', () => {
    const card = gatheringCardModel(g, { signals: [{ kind: 'going', text: reasonText('friendGoingOne', { name: 'Sam' }) }], myUserId: 'me', now: NOW.getTime(), language: 'es' });
    expect(card.social).toBe('Sam va');
  });
  it('a subtitle that restates a reason is still deduped when the reason is shown translated', () => {
    const row = resultRowView({ type: 'gathering', ...g, startsAt: g.scheduled_at, reasons: [reason], subtitle: `${reason} · Waitlist open` }, { myUserId: 'me', now: NOW, language: 'es' });
    expect(row.reason).toBe('Porque te gusta Coffee');
    expect(row.meta).toMatch(/Waitlist open$/);
    expect(row.meta).not.toMatch(/Because you like/);
  });
});

describe('informational, sponsored and transactional rows stay reasonless in every language', () => {
  it.each(REASONLESS_KINDS)('%s', (kind) => {
    const c = recommendationContext(contextItem(kind, { id: 'x', title: 'T', name: 'N' }, { reasons: [becauseYouLikeReason('Coffee')] }), { language: 'es' });
    expect(c.reason).toBeNull();
    expect(c.reasons).toEqual([]);
  });
});

describe('wiring guards', () => {
  it('Home, Discover and the Gatherings feed pass the person\'s language to the shared layer', () => {
    for (const f of ['screens/HomeScreen.js', 'screens/DiscoverHubScreen.js', 'screens/GatheringsScreen.js']) {
      expect([f, /const \{[^}]*\blanguage\b[^}]*\} = useLanguage\(\)/.test(read(f))]).toEqual([f, true]);
    }
    const home = read('screens/HomeScreen.js');
    expect(home).toMatch(/gatheringCardModel\(g, \{ signals, myUserId, language/);
    expect(home.match(/resultRowView\(item, \{ language \}\)/g)).toHaveLength(2);
    expect(home.match(/recommendationRow\(item, \{ language \}\)/g)).toHaveLength(2);
    const discover = read('screens/DiscoverHubScreen.js');
    expect(discover).toMatch(/resultRowView\(item, \{ language \}\)/);
    expect(discover.match(/\), \{ language \}\);/g).length).toBeGreaterThanOrEqual(3); // community, perk, business contexts
  });
  it('the Gatherings feed badges use the shared reason wording (no translated prefix + English tag)', () => {
    const src = read('screens/GatheringsScreen.js');
    expect(src).toMatch(/t\('reasons\.becauseYouLike', \{ category: item\.interest_tag \}\)/);
    expect(src).toMatch(/localizeReason\(relatedInterestReason\(item\.relatedHobby\), language\)/);
    expect(src).toMatch(/localizeReason\(friendReason, language\)/);
    expect(src).not.toMatch(/gatherings\.becauseYouLike/);
  });
  it('the converted reason builders no longer hand-type the template English', () => {
    const banned = {
      'services/gatherings.js': [/attendees are'\} also first-timers/, /of your friends \$\{/, /'person' : 'people'\} attending/],
      'services/homeRecommendations.js': [/'In a category you like'/, /'Close by'/, /'You loved /, /`At \$\{/],
      'screens/DiscoverHubScreen.js': [/'Great weather for it'/, /'In a category you like'/, /\} attending` : null/],
      'constants/businessCapabilities.js': [/'Can host your group'/, /'Hosts private events'/, /'Offers catering'/],
      'constants/commitmentLevel.js': [/'Easy to drop into'/, /'Low commitment'/],
      'services/intentResolverScoring.js': [/'Accommodates your group'/, /'A business you follow'/],
    };
    for (const [f, patterns] of Object.entries(banned)) {
      const src = read(f);
      for (const p of patterns) expect([f, String(p), p.test(src)]).toEqual([f, String(p), false]);
    }
  });
});
