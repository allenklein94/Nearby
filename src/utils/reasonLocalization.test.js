// Translated recommendation reasons, result-row notes and the context line (2026-09-28, passes 1 and 2). The wording lives ONCE
// in the existing localization system (i18n/translations.js `reasons`, `resultNotes`, `vocab`), is looked up through the ONE
// lookup LanguageContext's t() uses (i18n/translate.js), and every converted discovery surface renders the same key for the same
// match. Values (formats, skills, genres, attributes, dietary options, cuisines, durations, clock times, distances, prices, ages)
// are localized first and the sentence is composed from them. Ranking, matching and selection run on the canonical English form.
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));

import fs from 'fs';
import path from 'path';
import { translations } from '../i18n/translations';
import { translate, interpolate, hasOwnTranslation, valueForms, pluralCategory, DEFAULT_LANGUAGE } from '../i18n/translate';
import { localDistance, localDuration, localClock, localWhen, localWindow, localNumber, localDate } from '../i18n/format';
import { parseReason, localizeReason, localizeReasons, localizeNote, localizeTitle, REASON_PARSE_ORDER, LOCALIZED_NAMESPACES } from './reasonLocalization';
import { resultTitleText } from '../constants/recommendationReasonVocabulary';
import { categoryName } from '../i18n/categoryNames';
import { resultRowView as rowViewForTitles } from './recommendationContext';
import { recommendationContext, contextItem, resultRowView, REASONLESS_KINDS } from './recommendationContext';
import { gatheringCardModel } from './recommendationCard';
import { recommendationRow, friendGoingReason } from './recommendationFacts';
import { friendsInterestReason } from './friendInterests';
import { confidenceHeadline, CONFIDENCE_HEADLINE } from './recommendationConfidence';
import { formatDistance, formatDistanceAway } from './formatDistance';
import { timeWindowState } from './timeWindow';
import { whenLabel } from './timeContext';
import { suitedAgesReason } from './suitedAges';
import { formatOccasionPackageDetail } from './occasionPackageFormatting';
import { GENRE_OPTIONS, durationLabel } from './gatheringPractical';
import {
  reasonText, resultNoteText, becauseYouLikeReason, askedForReason, activityReason, friendsPlanActivityReason, occasionOfferedReason,
} from '../constants/recommendationReasonVocabulary';
import { reasonTier } from '../constants/signalPriority';
import { ACTIVITIES } from '../constants/activityLayer';
import { ACTIVITY_FORMATS, formatFit } from '../constants/activityFormat';
import { SKILL_LEVELS, skillFit } from '../constants/skillLevel';
import { BUSINESS_ATTRIBUTE_OPTIONS, CUISINE_OPTIONS } from '../constants/businessAttributes';
import { BUSINESS_DIETARY_OPTIONS } from '../constants/dietaryOptions';
import { energyFit } from '../constants/energyLevel';
import { intensityFit, effortFit } from '../constants/intensityEffort';
import { timeFit } from '../constants/timeBudget';
import { windowFitReason } from '../constants/clockWindow';
import { genreReason } from '../constants/genreMatch';

const LANGS = Object.keys(translations);
const OTHER_LANGS = LANGS.filter((l) => l !== 'en');
const EN = translations.en;
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const get = (obj, keyPath) => keyPath.split('.').reduce((v, p) => v?.[p], obj);
const isPlural = (v) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.other === 'string';

// every leaf key (a string or a plural object) under a namespace
function leafKeys(obj, prefix) {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = `${prefix}.${k}`;
    if (typeof v === 'string' || isPlural(v) || Array.isArray(v)) out.push(p);
    else if (v && typeof v === 'object') out.push(...leafKeys(v, p));
  }
  return out;
}
const TEMPLATE_KEYS = LOCALIZED_NAMESPACES.flatMap((ns) => leafKeys(EN[ns], ns)).filter((k) => !k.startsWith('reasons.activities.'));
const ALL_KEYS = [...LOCALIZED_NAMESPACES, 'vocab'].flatMap((ns) => leafKeys(EN[ns], ns));
const placeholders = (s) => (String(s).match(/\{\w+\}/g) ?? []).sort();

// A canonical English sample per placeholder, so every template can be built, parsed and localized.
const SAMPLE = {
  category: 'Coffee', activity: 'grabbing a coffee', occasion: 'Birthday', interest: 'Photography', name: 'Sam', name1: 'Sam', name2: 'Alex',
  names: 'Sam, Alex', count: 3, business: 'Coastal Coffee', format: '🏆 Tournament', skill: 'Beginner', genre: 'Jazz', cuisine: 'Italian',
  cuisineFood: 'Italian food', attributes: 'Quiet · Relaxed', dietary: 'Vegan options · Halal', duration: '45 min', time: '3 PM',
  time1: '6 PM', time2: '8:30 PM', distance: '1.2 mi', price: '$12.50', days: 'Fr/Sa', min: 5, max: 10, age: 4, going: 4, capacity: 4,
};
const sampleVars = (key) => Object.fromEntries(placeholders(get(EN, key)).map((p) => { const n = p.slice(1, -1); return [n, SAMPLE[n]]; }));
const sampleText = (key) => translate('en', key, sampleVars(key));

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
  it('plural forms follow each language\'s own rule', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => pluralCategory('ru', n))).toEqual(['one', 'few', 'many', 'many', 'one', 'few', 'many']);
    expect([0, 1, 2].map((n) => pluralCategory('fr', n))).toEqual(['one', 'one', 'other']);
    expect([1, 2].map((n) => pluralCategory('es', n))).toEqual(['one', 'other']);
    expect(pluralCategory('ko', 1)).toBe('other');
    expect(pluralCategory('ru', 1.5)).toBe('other'); // decimals take the fractional form
    expect(translate('ru', 'reasons.friendGoingMany', { name1: 'Сэм', name2: 'Алекс', count: 2 })).toBe('Сэм, Алекс и ещё 2 друга идут');
    expect(translate('ru', 'reasons.friendGoingMany', { name1: 'Сэм', name2: 'Алекс', count: 5 })).toBe('Сэм, Алекс и ещё 5 друзей идут');
  });
  it('the default locale is unchanged (English) and LanguageContext uses this lookup', () => {
    expect(DEFAULT_LANGUAGE).toBe('en');
    expect(read('context/LanguageContext.js')).toMatch(/translate\(language, keyPath, vars\)/);
  });
  it('no new language was added', () => {
    expect(LANGS).toEqual(['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko']);
  });
});

describe('coverage: every locale carries every reason, note and vocab entry with the same placeholders', () => {
  it.each(LANGS)('%s', (lang) => {
    for (const key of ALL_KEYS) {
      // a 24-hour clock has no AM/PM words
      if ((key === 'vocab.clock.am' || key === 'vocab.clock.pm') && get(translations[lang], 'vocab.clock.style') === '24') continue;
      const mine = get(translations[lang], key);
      expect([lang, key, mine !== undefined]).toEqual([lang, key, true]);
      if (Array.isArray(get(EN, key))) { expect([lang, key, mine.length]).toEqual([lang, key, get(EN, key).length]); continue; }
      if (typeof get(EN, key) !== 'string' && !isPlural(get(EN, key))) continue;
      let want = placeholders(valueForms(get(EN, key))[0]);
      if (key.startsWith('vocab.clock.') && get(translations[lang], 'vocab.clock.style') === '24') want = want.filter((p) => p !== '{period}');
      for (const form of valueForms(mine)) expect([lang, key, placeholders(form)]).toEqual([lang, key, want]);
    }
    for (const a of ACTIVITIES) expect([lang, a.key, hasOwnTranslation(lang, `reasons.activities.${a.key}`)]).toEqual([lang, a.key, true]);
  });
  it('the English vocabulary IS the app\'s own labels (one English source)', () => {
    for (const a of ACTIVITIES) expect(EN.reasons.activities[a.key]).toBe(a.label);
    for (const f of ACTIVITY_FORMATS) expect(EN.vocab.formats[f.key]).toBe(f.label);
    for (const s of SKILL_LEVELS) expect(EN.vocab.skills[s.key]).toBe(s.label);
    for (const g of GENRE_OPTIONS.filter((o) => o.key)) expect(EN.vocab.genres[g.key]).toBe(g.label);
    for (const o of BUSINESS_ATTRIBUTE_OPTIONS) expect(EN.vocab.attributes[o.key]).toBe(o.label);
    for (const o of BUSINESS_DIETARY_OPTIONS) expect(EN.vocab.dietary[o.key]).toBe(o.label);
    for (const c of CUISINE_OPTIONS.filter((o) => o.key)) { expect(EN.vocab.cuisines[c.key]).toBe(c.label); expect(EN.vocab.cuisineFood[c.key]).toBe(`${c.label} food`); }
    expect(EN.vocab.confidence).toEqual(CONFIDENCE_HEADLINE);
  });
  it('the English vocabulary is not a second copy of any label (no English fallbacks left in a language)', () => {
    const untranslated = [];
    for (const lang of OTHER_LANGS) for (const ns of ['formats', 'skills', 'attributes', 'dietary', 'cuisines', 'cuisineFood']) {
      for (const [k, v] of Object.entries(EN.vocab[ns])) if (translations[lang].vocab[ns][k] === v) untranslated.push(`${lang}.${ns}.${k}`);
    }
    // loanwords a language really uses as-is (checked by hand); everything else must be translated
    const LOANWORDS = new Set(['de.formats.workshop', 'de.formats.show', 'de.formats.festival', 'de.formats.party', 'fr.formats.festival', 'fr.formats.concert',
      'es.formats.festival', 'tl.formats.drop_in', 'tl.formats.meetup', 'tl.formats.tour', 'tl.formats.workshop', 'tl.formats.appointment', 'tl.formats.open_play',
      'tl.formats.party', 'ru.formats.show', 'de.attributes.catering', 'es.attributes.catering', 'es.attributes.social', 'es.attributes.wifi', 'de.attributes.wifi',
      'fr.attributes.wifi', 'pt.attributes.wifi', 'ht.attributes.wifi', 'zh.attributes.wifi', 'vi.attributes.wifi', 'tl.attributes.wifi', 'ru.attributes.wifi',
      'tl.attributes.catering', 'tl.attributes.corporate_events', 'pt.attributes.social', 'es.dietary.halal', 'es.dietary.kosher', 'de.dietary.halal',
      'fr.dietary.halal', 'pt.dietary.halal', 'pt.dietary.kosher', 'ht.dietary.halal', 'ht.dietary.kosher', 'vi.dietary.halal', 'vi.dietary.kosher',
      'tl.dietary.halal', 'tl.dietary.kosher', 'de.formats.show', 'de.skills.competitive', 'es.skills.casual',
      'pt.formats.festival', 'ht.formats.festival']);
    expect(untranslated.filter((k) => !LOANWORDS.has(k))).toEqual([]);
  });
});

describe('parsing the canonical English text back to its key', () => {
  it('every reason and note template is registered for parsing', () => {
    expect([...REASON_PARSE_ORDER].sort()).toEqual([...TEMPLATE_KEYS].sort());
  });
  it.each(TEMPLATE_KEYS)('%s round-trips to its own key', (key) => {
    expect(parseReason(sampleText(key))?.key).toBe(key);
  });
  it('English in = English out, byte for byte', () => {
    for (const key of TEMPLATE_KEYS) expect(localizeReason(sampleText(key), 'en')).toBe(sampleText(key));
  });
  it('an unregistered reason or a business\'s own words are shown as written', () => {
    expect(parseReason('Pour-over bar')).toBeNull();
    expect(localizeReason('Pour-over bar', 'es')).toBe('Pour-over bar');
    expect(localizeNote('Sunset espresso tasting · $12', 'de')).toBe('Sunset espresso tasting · $12');
  });
});

describe('every template in every language: filled, composed from localized values', () => {
  // identical output is only allowed where the whole sentence is a value that language writes the same way
  const SAME_OK = new Set(['resultNotes.price', 'resultNotes.days:zh', 'resultNotes.days:ko']);
  it.each(OTHER_LANGS)('%s', (lang) => {
    for (const key of TEMPLATE_KEYS) {
      const out = localizeReason(sampleText(key), lang);
      expect([lang, key, /\{\w+\}/.test(out)]).toEqual([lang, key, false]);
      if (!SAME_OK.has(key) && !SAME_OK.has(`${key}:${lang}`) && !(key === 'resultNotes.price' || key === 'resultNotes.pricePerPerson')) {
        expect([lang, key, out === sampleText(key)]).toEqual([lang, key, false]);
      }
      // no English vocabulary word survives inside a localized sentence
      for (const englishValue of ['Tournament', 'Beginner', 'Quiet', 'Relaxed', 'Vegan options', 'Italian', '45 min', '3 PM', '8:30 PM', '1.2 mi']) {
        if (sampleText(key).includes(englishValue) && !(englishValue === '45 min' && ['es', 'fr', 'pt', 'ht', 'tl'].includes(lang)) && !(englishValue === '1.2 mi' && ['es', 'tl', 'zh', 'ko'].includes(lang)) && !(['3 PM', '8:30 PM'].includes(englishValue) && ['ht', 'tl'].includes(lang))) {
          expect([lang, key, englishValue, out.includes(englishValue)]).toEqual([lang, key, englishValue, false]);
        }
      }
    }
  });
});

describe('dynamic values and grammar', () => {
  it('suited age ranges are templates, with the numbers localized into each language', () => {
    const cases = [[3, 8], [5, null], [null, 12], [4, 4]];
    const expected = {
      en: ['Suited to ages 3–8', 'Suited to ages 5+', 'Suited to ages up to 12', 'Suited to age 4'],
      es: ['Para edades de 3 a 8 años', 'Para mayores de 5 años', 'Para edades de hasta 12 años', 'Para niños de 4 años'],
      de: ['Geeignet für 3 bis 8 Jahre', 'Geeignet ab 5 Jahren', 'Geeignet bis 12 Jahre', 'Geeignet für 4-Jährige'],
      fr: ['Adapté aux 3–8 ans', 'Adapté dès 5 ans', 'Adapté jusqu’à 12 ans', 'Adapté aux enfants de 4 ans'],
      pt: ['Para idades de 3 a 8 anos', 'Para maiores de 5 anos', 'Para idades até 12 anos', 'Para crianças de 4 anos'],
      ht: ['Bon pou laj 3 rive 8 an', 'Bon pou 5 an ak plis', 'Bon pou jiska 12 an', 'Bon pou timoun 4 an'],
      zh: ['适合3–8岁', '适合5岁及以上', '适合12岁及以下', '适合4岁'],
      vi: ['Phù hợp độ tuổi 3–8', 'Phù hợp từ 5 tuổi trở lên', 'Phù hợp đến 12 tuổi', 'Phù hợp trẻ 4 tuổi'],
      tl: ['Angkop sa edad 3–8', 'Angkop sa edad 5 pataas', 'Angkop hanggang edad 12', 'Angkop sa edad 4'],
      ru: ['Для возраста 3–8 лет', 'Для возраста от 5 лет', 'Для возраста до 12 лет', 'Для детей 4 лет'],
      ko: ['3~8세에게 적합', '5세 이상에게 적합', '12세 이하에게 적합', '4세에게 적합'],
    };
    for (const lang of LANGS) expect([lang, cases.map(([a, b]) => localizeReason(suitedAgesReason(a, b), lang))]).toEqual([lang, expected[lang]]);
  });
  it('an age of 1 takes the singular where the language needs it', () => {
    expect(localizeReason(suitedAgesReason(1, 1), 'es')).toBe('Para niños de 1 año');
    expect(localizeReason(suitedAgesReason(1, 1), 'fr')).toBe('Adapté aux enfants de 1 an');
    expect(localizeReason(suitedAgesReason(1, 1), 'ru')).toBe('Для детей 1 года');
    expect(localizeReason(suitedAgesReason(null, 1), 'ru')).toBe('Для возраста до 1 года');
    expect(localizeReason(suitedAgesReason(1, null), 'ru')).toBe('Для возраста от 1 года');
  });
  it('German keeps its own word order and adjective endings (whole sentences, not frames)', () => {
    expect(localizeReason(energyFit('Coffee', ['low_key']).reason, 'de')).toBe('Passt zu einem entspannten Plan');
    expect(localizeReason(reasonText('askedForCuisine', { cuisineFood: 'Italian food' }), 'de')).toBe('Weil du nach italienischem Essen gefragt hast');
    expect(localizeReason(reasonText('whoForLikes', { name: 'Sam', cuisine: 'Italian' }), 'de')).toBe('Sam mag meist italienisches Essen');
    expect(localizeReason(becauseYouLikeReason('Coffee'), 'de')).toBe('Weil du Kaffee magst');
  });
  it('clock times follow each language\'s convention, and Spanish agrees "la 1" / "las 3"', () => {
    const w = (before) => windowFitReason({ before });
    expect(localizeReason(w(15 * 60), 'de')).toBe('🕒 Passt in die Zeit vor 15 Uhr');
    expect(localizeReason(w(15 * 60 + 30), 'fr')).toBe('🕒 Avant 15 h 30');
    expect(localizeReason(w(15 * 60), 'es')).toBe('🕒 Encaja antes de las 3 p. m.');
    expect(localizeReason(w(13 * 60), 'es')).toBe('🕒 Encaja antes de la 1 p. m.');
    expect(localizeReason(w(15 * 60), 'ko')).toBe('🕒 오후 3시 전에 맞아요');
    expect(localizeReason(w(15 * 60), 'zh')).toBe('🕒 在下午3点之前');
    expect(localizeReason(w(12 * 60), 'fr')).toBe('🕒 Avant midi');
    expect(localizeReason(windowFitReason({ after: 18 * 60, before: 20 * 60 + 30 }), 'ru')).toBe('🕒 Подходит: с 18:00 до 20:30');
  });
  it('durations, formats, skills, genres, intensity, effort, attributes, dietary and cuisine are translated values', () => {
    expect(localizeReason(timeFit({ durationMinutes: 90 }, 120).reason, 'de')).toBe('⏱️ Etwa 1,5 Std.');
    expect(localizeReason(timeFit({ category: 'Coffee' }, 120).reason, 'es')).toBe('⏱️ Suele durar unos 45 min');
    expect(localizeReason(formatFit({ format: 'tournament' }, ['tournament']).reason, 'fr')).toBe('🏆 Tournoi');
    expect(localizeReason(skillFit({ skillLevel: 'beginner' }, ['beginner']).reason, 'ko')).toBe('🎯 초급');
    expect(localizeReason(genreReason('jazz'), 'es')).toBe('Relacionado con tu interés en el jazz');
    expect(localizeReason(intensityFit({ hostEnergy: 1 }, ['low_key']).reason, 'pt')).toBe('⚡ Ritmo tranquilo');
    expect(localizeReason(effortFit({ effortLevel: 'challenging' }, ['challenging']).reason, 'vi')).toBe('💪 Thử thách');
    expect(localizeReason(reasonText('attributeList', { attributes: 'Quiet · Relaxed' }), 'de')).toBe('Ruhig · Entspannt');
    expect(localizeReason(reasonText('dietaryDeclared', { dietary: 'Gluten-free options · Halal' }), 'fr')).toBe('Selon l’établissement : Options sans gluten · Halal');
    expect(localizeReason(reasonText('askedForCuisine', { cuisineFood: 'Italian food' }), 'es')).toBe('Porque pediste comida italiana');
  });
  it('distances keep miles (the app\'s unit) with each language\'s words and decimal mark', () => {
    expect(localizeReason(formatDistanceAway(1.23), 'de')).toBe('1,2 Meilen entfernt');
    expect(localizeReason(formatDistanceAway(0.15), 'es')).toBe('A 800 pies');
    expect(localizeReason(formatDistanceAway(12.4), 'ru')).toBe('В 12 миль отсюда');
    expect(localizeReason(formatDistanceAway(21.2), 'ru')).toBe('В 21 миля отсюда');
    expect(localizeReason(formatDistanceAway(1.23), 'ru')).toBe('В 1,2 мили отсюда');
  });
  it('missing values still produce nothing in every language', () => {
    for (const lang of LANGS) {
      expect(suitedAgesReason(null, null)).toBeNull();
      expect(localDistance(null, lang)).toBeNull();
      expect(localDistance(-1, lang)).toBeNull();
      expect(localDuration(10, lang)).toBeNull();
      expect(localWhen('not a date', new Date(), lang)).toBeNull();
      expect(localizeReason(null, lang)).toBeNull();
      expect(confidenceHeadline([], { language: lang })).toBeNull();
    }
    expect(becauseYouLikeReason('')).toBeNull();
    expect(askedForReason(null)).toBeNull();
  });
  it('earlier dynamic reasons still localize (category, activity, friends)', () => {
    expect(localizeReason(askedForReason('Coffee'), 'es')).toBe('Porque pediste Café');
    expect(localizeReason(activityReason('grabbing a coffee'), 'es')).toBe('Ideal para tomar un café');
    expect(localizeReason(friendsPlanActivityReason('meeting a friend'), 'es')).toBe('Un plan con amigos, ideal para ver a un amigo');
    expect(localizeReason(occasionOfferedReason('Birthday'), 'de')).toBe('Bietet Erlebnisse zum Anlass „Geburtstag“ an');
    expect(localizeReason(friendsInterestReason('Coffee', { friend_count: 1, sample_names: ['Sam'] }), 'es')).toBe('A Sam le gusta Café');
    const g = { approvedAttendees: [{ user_id: 'f1', profiles: { display_name: 'Zoë' } }] };
    expect(localizeReason(friendGoingReason(g, new Set(['f1'])), 'es')).toBe('Zoë va');
  });
});

describe('the formatters mirror the English ones', () => {
  const NOW = new Date(2026, 8, 28, 15, 0); // Monday 3 PM local
  const at = (d, h, m = 0) => new Date(2026, 8, 28 + d, h, m).toISOString();
  it('distance: same thresholds as formatDistance in every language', () => {
    for (const miles of [0.005, 0.1, 0.15, 0.5, 1.23, 9.96, 12.4]) {
      const en = formatDistance(miles);
      for (const lang of LANGS) {
        const out = localDistance(miles, lang);
        expect([lang, miles, typeof out, /\{/.test(out)]).toEqual([lang, miles, 'string', false]);
        if (lang === 'en') expect(out).toBe(en);
      }
    }
    expect(localDistance(1.23, 'fr')).toBe('1,2 mi');
    expect(localDistance(0.15, 'zh')).toBe('800英尺');
    expect(localDistance(0.005, 'ko')).toBe('100피트 미만');
  });
  it('duration: same thresholds as durationLabel', () => {
    for (const m of [10, 15, 45, 60, 90, 150]) expect(localDuration(m, 'en')).toBe(durationLabel(m));
    expect(localDuration(90, 'zh')).toBe('1.5小时');
    expect(localDuration(45, 'ru')).toBe('45 мин');
  });
  it('clock: 12- or 24-hour by language, whole hours without :00', () => {
    expect(localClock(18 * 60 + 30, 'en')).toBe('6:30 PM');
    expect(localClock(19 * 60, 'de')).toBe('19 Uhr');
    expect(localClock(19 * 60 + 5, 'pt')).toBe('19h05');
    expect(localClock(9 * 60, 'ko')).toBe('오전 9시');
    expect(localClock(0, 'vi')).toBe('0:00');
  });
  it('when: the same decision as whenLabel, worded per language', () => {
    const cases = [at(0, 15, 10), at(0, 15, 40), at(0, 16, 30), at(0, 19), at(1, 19), at(4, 19, 15), 'bad'];
    for (const lang of LANGS) {
      for (const iso of cases) {
        const en = whenLabel(iso, NOW);
        const out = localWhen(iso, NOW, lang);
        expect([lang, iso, out === null]).toEqual([lang, iso, en === null]);
        if (lang === 'en' && en) expect(out.replace(/\s/g, ' ')).toBe(en.replace(/\s/g, ' ').replace(/^(\w+, \w+ \d+) · /, (m) => m));
      }
    }
    expect(localWhen(at(0, 19), NOW, 'de')).toBe('Heute Abend · 19 Uhr');
    expect(localWhen(at(1, 19), NOW, 'es')).toBe('Mañana · 7 p. m.');
    expect(localWhen(at(0, 15, 40), NOW, 'fr')).toBe('Commence dans 40 min');
    expect(localWhen(at(4, 19, 15), NOW, 'de')).toBe('Fr., 2. Okt. · 19:15 Uhr');
    expect(localWhen(at(4, 19, 15), NOW, 'ko')).toBe('10월 2일 (금) · 오후 7:15');
    expect(localDate(new Date(2026, 9, 2), 'pt')).toBe('sex., 2 de out.');
  });
  it('window: the same phases (and nulls) as timeWindowState', () => {
    const wins = [
      [{ start: at(0, 14, 50) }, 'event'], [{ start: at(0, 12) }, 'event'], [{ end: at(0, 15, 20) }, 'offer'], [{ end: at(0, 14) }, 'offer'],
      [{ start: at(0, 14), end: at(0, 21) }, 'event'], [{ end: at(0, 21) }, 'offer'], [{ start: at(0, 14), end: at(2, 9) }, 'availability'], [{}, 'event'],
    ];
    for (const lang of LANGS) for (const [win, kind] of wins) {
      const en = timeWindowState(win, NOW, kind).label;
      expect([lang, JSON.stringify(win), localWindow(win, NOW, kind, lang) === null]).toEqual([lang, JSON.stringify(win), en === null]);
    }
    expect(localWindow({ start: at(0, 14), end: at(0, 21) }, NOW, 'event', 'de')).toBe('Läuft gerade · bis 21 Uhr');
    expect(localWindow({ end: at(0, 21) }, NOW, 'offer', 'es')).toBe('Válido hasta las 9 p. m.');
    expect(localWindow({ end: at(0, 13) }, new Date(2026, 8, 28, 11), 'offer', 'es')).toBe('Válido hasta la 1 p. m.');
    expect(localWindow({ end: at(0, 14) }, NOW, 'offer', 'fr')).toBe('Expiré');
    expect(localWindow({ end: at(0, 15, 20) }, NOW, 'offer', 'ko')).toBe('20분 후 종료');
  });
  it('numbers use the language\'s decimal mark', () => {
    expect(localNumber(1.5, 'de')).toBe('1,5');
    expect(localNumber(1.5, 'es')).toBe('1.5');
  });
});

describe('the context line, notes and headline on the shared layer', () => {
  const NOW = new Date(2026, 8, 28, 15, 0);
  const g = { id: 'g1', title: 'Coffee meetup', interest_tag: 'Coffee', host_id: 'h', visibility: 'everyone', is_public: true,
    scheduled_at: new Date(2026, 8, 28, 18, 30).toISOString(), distanceMiles: 1.23, attendees: [], approvedCount: 0 };
  it('the distance/time line is composed from localized values', () => {
    const line = (language) => gatheringCardModel(g, { signals: [], myUserId: 'me', now: NOW.getTime(), language }).meta;
    expect(line('en')).toBe(`1.2 mi · ${whenLabel(g.scheduled_at, NOW)}`);
    expect(line('de')).toBe('1,2 Meilen · Heute Abend · 18:30 Uhr');
    expect(line('es')).toBe('1.2 mi · Esta noche · 6:30 p. m.');
    expect(line('zh')).toBe('1.2英里 · 今晚 · 下午6:30');
    const past = gatheringCardModel({ ...g, scheduled_at: new Date(2026, 8, 27, 10).toISOString() }, { signals: [], now: NOW.getTime(), language: 'fr' }).meta;
    expect(past).toBe('1,2 mi · Déjà passé');
  });
  it('a typed-search row\'s status note is localized, a business\'s own words are not', () => {
    const full = resultRowView({ type: 'gathering', ...g, startsAt: g.scheduled_at, reasons: [], subtitle: resultNoteText('fullWaitlistCount', { going: 4, capacity: 4 }) }, { now: NOW, language: 'es' });
    expect(full.meta).toMatch(/🔒 Completo — Únete a la lista de espera \(4\/4 lugares ocupados\)$/);
    const pkg = resultRowView({ type: 'business_package', id: 'p', title: 'Pkg', reasons: [], subtitle: formatOccasionPackageDetail({ pricePerPerson: 45, minGuests: 6, availableDays: [5, 6] }) }, { now: NOW, language: 'de' });
    expect(pkg.meta).toBe('$45/Person · mind. 6 Gäste · Fr./Sa.');
    const posting = resultRowView({ type: 'business_availability', id: 'b', title: 'x', reasons: [], subtitle: 'Sunset tasting · $12.50' }, { now: NOW, language: 'de' });
    expect(posting.meta).toBe('Sunset tasting · $12,50');
    expect(localizeNote(resultNoteText('mayBeAvailable'), 'ko')).toBe('가능할 수 있어요 — 업체 확인 필요');
  });
  it('the confidence headline is translated, decided on the same signals', () => {
    const signals = [{ text: becauseYouLikeReason('Coffee') }, { text: reasonText('friendGoingOne', { name: 'Sam' }) }];
    expect(confidenceHeadline(signals)).toBe('A strong match for you');
    for (const lang of OTHER_LANGS) expect(confidenceHeadline(signals, { language: lang })).toBe(translations[lang].vocab.confidence.high);
  });
  it.each(['es', 'ko', 'de', 'en'])('the same match reads the same on every converted surface (%s)', (language) => {
    const reason = becauseYouLikeReason('Coffee');
    const expected = translate(language, 'reasons.becauseYouLike', { category: categoryName('Coffee', language) });
    const card = gatheringCardModel(g, { signals: [{ kind: 'reason', text: reason }], myUserId: 'me', now: NOW.getTime(), language });
    const row = resultRowView({ type: 'gathering', ...g, startsAt: g.scheduled_at, reasons: [reason] }, { myUserId: 'me', now: NOW, language });
    const perk = recommendationContext(contextItem('perk', { id: 'p1', title: '10% off', distanceMiles: 0.3 }, { reasons: [reason] }), { language });
    const nearby = recommendationRow({ type: 'perk', reasons: [reason], data: { distanceMiles: 0.3 } }, { language });
    const nearbyNoContext = recommendationRow({ type: 'perk', reasons: [reason], data: {} }, { language });
    for (const shown of [card.why, row.reason, perk.reason, nearby.why, nearbyNoContext.why]) expect(shown).toBe(expected);
    expect(card.meta).toBe(row.meta); // one context line per object, whichever surface draws it
    expect(perk.canonicalReasons).toEqual([reason]);
    expect(reasonTier(perk.canonicalReasons[0])).toBe(reasonTier(reason));
  });
  it('social proof on a card is localized with the same rule', () => {
    const card = gatheringCardModel(g, { signals: [{ kind: 'going', text: reasonText('friendGoingOne', { name: 'Sam' }) }], myUserId: 'me', now: NOW.getTime(), language: 'es' });
    expect(card.social).toBe('Sam va');
  });
  it('a subtitle that restates a reason is still deduped when the reason is shown translated', () => {
    const reason = becauseYouLikeReason('Coffee');
    const row = resultRowView({ type: 'gathering', ...g, startsAt: g.scheduled_at, reasons: [reason], subtitle: `${reason} · 🔒 Full — Join Waitlist` }, { myUserId: 'me', now: NOW, language: 'es' });
    expect(row.reason).toBe('Porque te gusta Café');
    expect(row.meta).toMatch(/🔒 Completo — Únete a la lista de espera$/);
    expect(row.meta).not.toMatch(/Because you like/);
  });
});

describe('informational, sponsored and transactional rows stay reasonless in every language', () => {
  it.each(REASONLESS_KINDS)('%s', (kind) => {
    for (const language of LANGS) {
      const c = recommendationContext(contextItem(kind, { id: 'x', title: 'T', name: 'N' }, { reasons: [becauseYouLikeReason('Coffee')] }), { language });
      expect(c.reason).toBeNull();
      expect(c.reasons).toEqual([]);
    }
  });
});

describe('result titles Nearby composes around a name', () => {
  const titles = () => [
    resultTitleText('hasAvailability', { business: 'Coastal Coffee' }),
    resultTitleText('mayHelp', { business: 'Coastal Coffee' }),
    resultTitleText('offersOccasion', { business: 'Coastal Coffee', occasion: 'Birthday' }),
    resultTitleText('friendAlsoLooking', { name: 'Sam' }),
    resultTitleText('aFriendAlsoLooking'),
  ];
  it('the English is byte-identical to the titles the resolver wrote before', () => {
    expect(titles()).toEqual(['Coastal Coffee has availability', 'Coastal Coffee may be able to help', 'Coastal Coffee offers Birthday experiences',
      'Sam is also looking for this', 'A friend is also looking for this']);
    for (const t of titles()) expect(localizeTitle(t, 'en')).toBe(t);
  });
  it.each(OTHER_LANGS)('%s: every title is translated, the business/person name kept as written', (lang) => {
    const out = titles().map((t) => localizeTitle(t, lang));
    out.forEach((t, i) => expect([lang, i, t === titles()[i]]).toEqual([lang, i, false]));
    for (const t of out.slice(0, 3)) expect(t).toContain('Coastal Coffee');
    expect(out[3]).toContain('Sam');
    expect(out[3]).not.toMatch(/\{\w+\}/);
  });
  it('German and Tagalog put the name where their grammar wants it', () => {
    expect(localizeTitle('Coastal Coffee has availability', 'de')).toBe('Bei Coastal Coffee ist etwas frei');
    expect(localizeTitle('Coastal Coffee offers Birthday experiences', 'de')).toBe('Coastal Coffee bietet Erlebnisse zum Anlass „Geburtstag“ an');
    expect(localizeTitle('Sam is also looking for this', 'tl')).toBe('Hinahanap din ito ni Sam');
  });
  it('a title that is someone\'s own words is never re-read, whatever it says', () => {
    const gathering = { type: 'gathering', id: 'g1', title: 'Bob has availability' };
    expect(rowViewForTitles(gathering, { language: 'es' }).title).toBe('Bob has availability');
    const posting = { type: 'business_availability', id: 'p1', title: 'Coastal Coffee has availability' };
    expect(rowViewForTitles(posting, { language: 'es' }).title).toBe('Coastal Coffee tiene disponibilidad');
    expect(localizeTitle('Taco Tuesday at the park', 'fr')).toBe('Taco Tuesday at the park');
  });
  it('the resolver builds these titles through the templates, and the rows render the localized title', () => {
    const resolver = read('services/intentResolver.js');
    expect(resolver).not.toMatch(/has availability`|may be able to help`|is also looking for this`|experiences`,/);
    for (const f of ['screens/HomeScreen.js', 'screens/DiscoverHubScreen.js']) expect(read(f)).not.toMatch(/numberOfLines=\{1\}>\{item\.title\}<\/Text>\s*\{row\.reason/);
  });
});

describe('wiring guards', () => {
  it('Home, Discover and the Gatherings feed pass the person\'s language to the shared layer', () => {
    for (const f of ['screens/HomeScreen.js', 'screens/DiscoverHubScreen.js', 'screens/GatheringsScreen.js']) {
      expect([f, /const \{[^}]*\blanguage\b[^}]*\} = useLanguage\(\)/.test(read(f))]).toEqual([f, true]);
    }
    const home = read('screens/HomeScreen.js');
    expect(home).toMatch(/gatheringCardModel\(g, \{ signals, myUserId, language/);
    expect(home.match(/resultRowView\(item, \{ language, myUserId \}\)/g)).toHaveLength(2);
    expect(home.match(/recommendationRow\(item, \{ language \}\)/g)).toHaveLength(2);
    expect(home.match(/confidenceHeadline\((?:signals|attention\.hero\.reasons\.map\(\(text\) => \(\{ text \}\)\)), \{ language \}\)/g).length).toBe(4);
    const discover = read('screens/DiscoverHubScreen.js');
    expect(discover).toMatch(/resultRowView\(item, \{ language, myUserId \}\)/);
    expect(discover.match(/\), \{ language \}\);/g).length).toBeGreaterThanOrEqual(3);
  });
  it('the Gatherings feed badges use the shared reason wording (no translated prefix + English tag)', () => {
    const src = read('screens/GatheringsScreen.js');
    expect(src).toMatch(/t\('reasons\.becauseYouLike', \{ category: names\.tag\(item\.interest_tag\) \}\)/);
    expect(src).toMatch(/localizeReason\(relatedInterestReason\(item\.relatedHobby\), language\)/);
    expect(src).toMatch(/localizeReason\(friendReason, language\)/);
    expect(src).not.toMatch(/gatherings\.becauseYouLike/);
  });
  it('the reason builders no longer hand-type the template English', () => {
    const banned = {
      'services/gatherings.js': [/attendees are'\} also first-timers/, /of your friends \$\{/, /'person' : 'people'\} attending/],
      'services/homeRecommendations.js': [/'In a category you like'/, /'Close by'/, /'You loved /, /`At \$\{/],
      'screens/DiscoverHubScreen.js': [/'Great weather for it'/, /'In a category you like'/, /\} attending` : null/],
      'constants/businessCapabilities.js': [/'Can host your group'/, /'Hosts private events'/, /'Offers catering'/],
      'constants/commitmentLevel.js': [/'Easy to drop into'/, /'Low commitment'/],
      'services/intentResolverScoring.js': [/'Accommodates your group'/, /'A business you follow'/, /tends to like \$\{/, /`\$\{label\} food`\)\)/],
      'constants/energyLevel.js': [/`Fits a \$\{/],
      'constants/intensityEffort.js': [/\} pace`/, /\} effort`/],
      'constants/timeBudget.js': [/reason: `⏱️/],
      'constants/clockWindow.js': [/`🕒 Fits \$\{/],
      'constants/skillLevel.js': [/reason: `🎯/],
      'constants/genreMatch.js': [/`Related to your interest in/],
      'constants/dietaryOptions.js': [/`Business-declared: /],
      'utils/suitedAges.js': [/`Suited to \$\{/],
      'services/intentResolver.js': [/`🔒 Full — Join Waitlist/, /'May be available — business/, /'Ask what they can do/],
    };
    for (const [f, patterns] of Object.entries(banned)) {
      const src = read(f);
      for (const p of patterns) expect([f, String(p), p.test(src)]).toEqual([f, String(p), false]);
    }
  });
  it('the localized formatters never switch units: miles stay the app\'s unit', () => {
    const src = read('i18n/format.js') + read('utils/reasonLocalization.js');
    expect(src).not.toMatch(/\bkm\b|kilomet|1\.609/);
  });
});
