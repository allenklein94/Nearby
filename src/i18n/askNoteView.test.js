// The typed-ask caption line in every language (2026-10-02, owner). EVERY caption every builder can produce is generated here
// from the builders themselves; each must be recognized, re-render byte-identical in English (so the strings can never drift
// from the builders), and render in all 10 other languages with no placeholder, key path or English template left.
import { localizeAskNote, parseAskNotePart, renderAskNotePart } from './askNoteView';
import { translations } from './translations';
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { OPEN_NOW_CAPTION } from '../utils/operatingStatus';
import { planCaption } from '../utils/planAsk';
import { openEndedCaption } from '../utils/openEndedAsk';
import { spontaneityCaption } from '../constants/spontaneity';
import { timeBudgetCaption } from '../constants/timeBudget';
import { clockWindowCaption } from '../constants/clockWindow';
import { distanceWillingnessCaption, DISTANCE_WILLINGNESS_KEYS } from '../constants/distanceWillingness';
import { transportModeCaption, TRANSPORT_MODE_KEYS } from '../constants/transportMode';
import { askWeatherCaption } from '../utils/askWeather';
import { askFacetsCaption, parseAskFacets } from '../constants/askFacets';
import { applyRestrictionsToCandidates } from '../constants/businessRestrictions';

const LANGS = Object.keys(translations).filter((l) => l !== 'en');

function allCaptions() {
  const out = new Set([OPEN_NOW_CAPTION]);
  const add = (c) => { if (c) out.add(c); };
  ['now', 'next_hours', 'plan_ahead'].forEach((k) => add(spontaneityCaption(k)));
  DISTANCE_WILLINGNESS_KEYS.forEach((k) => add(distanceWillingnessCaption(k)));
  TRANSPORT_MODE_KEYS.forEach((k) => add(transportModeCaption(k)));
  for (let m = 1; m <= 12 * 60; m += 1) add(timeBudgetCaption(m));
  const clockMins = [];
  for (let m = 0; m <= 24 * 60; m += 15) clockMins.push(m);
  for (const a of clockMins) {
    add(clockWindowCaption({ after: a, before: null }, { kind: 'day' }));
    add(clockWindowCaption({ after: null, before: a }, { kind: 'day' }));
    for (const b of [a + 60, a + 135]) if (b <= 24 * 60) add(clockWindowCaption({ after: a, before: b }, { kind: 'day' }));
  }
  const texts = ['dinner and a movie', 'lunch and drinks', 'brunch then dessert', 'a bite and a show', 'eat and drinks', 'drinks and dessert',
    'breakfast and a walk', 'restaurant and live music', 'supper and something fun', 'eating and bowling', 'food and wine', 'dinner, drinks and dessert'];
  for (const text of texts) for (const occasion of [null, 'date_night', 'first_date', 'anniversary', 'birthday', 'graduation']) {
    for (const dateWindow of [null, 'tonight', 'today', 'tomorrow', 'weekend', 'now']) add(planCaption(text, { occasion, dateWindow }));
  }
  const byGroup = CATEGORY_GROUPS.map((g) => ({ key: g.key, c: { category: g.tags[0] ?? g.key } }));
  for (let i = 0; i < byGroup.length; i += 1) {
    add(openEndedCaption([byGroup[i].c], [byGroup[i].key]));
    const j = (i + 1) % byGroup.length; const k = (i + 5) % byGroup.length;
    add(openEndedCaption([byGroup[i].c, byGroup[i].c, byGroup[j].c], [byGroup[i].key, byGroup[j].key]));
    add(openEndedCaption([byGroup[i].c, byGroup[i].c, byGroup[i].c, byGroup[j].c, byGroup[j].c, byGroup[k].c], [byGroup[i].key, byGroup[j].key, byGroup[k].key]));
  }
  const whens = ['right now', 'tonight', 'today', 'tomorrow', 'tomorrow evening',
    ...['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].flatMap((d) => [d, `${d} evening`])];
  const judgements = [['storm', 'Storms expected'], ['snow', 'Snow expected'], ['wet', 'Rain expected'], ['heat', 'Very warm'], ['cold', 'Cold out']]
    .map(([kind, label]) => ({ bias: 'indoor', kind, label })).concat([{ bias: 'outdoor', kind: 'outdoor_window', label: 'Good outdoor weather' }]);
  for (const when of whens) for (const j of judgements) {
    add(askWeatherCaption(j, { when }, { moved: true }));
    add(askWeatherCaption(j, { when }, { moved: false, explicitEnvironment: j.bias === 'indoor' ? 'outdoor' : 'indoor' }));
  }
  add(askWeatherCaption({ unknown: true }, { when: 'tonight' }, { explicitEnvironment: 'outdoor' }));
  for (const text of ['something outside', 'something indoors', 'no alcohol, nothing crowded', 'nothing outdoors', 'not too expensive',
    'something outside, no alcohol, not too expensive', 'nothing indoors and nothing crowded']) {
    const f = parseAskFacets(text);
    for (const [o, u] of [[false, false], [true, false], [false, true], [true, true]]) add(askFacetsCaption(f, o, u));
  }
  const reasons = ['children', 'pets', 'group', 'indoor_only', 'outdoor_only', 'booking', 'mystery'];
  for (let i = 0; i < reasons.length; i += 1) {
    for (const set of [[reasons[i]], [reasons[i], reasons[(i + 1) % reasons.length]], [reasons[i], reasons[(i + 2) % reasons.length], reasons[(i + 4) % reasons.length]]]) {
      const declined = new Map(set.map((r, n) => [`p${n}`, r]));
      add(applyRestrictionsToCandidates(set.map((_r, n) => ({ partnerId: `p${n}` })), declined).caption);
    }
  }
  return [...out];
}

const CAPTIONS = allCaptions();

test('the generator really covers every builder (sanity)', () => {
  expect(CAPTIONS.length).toBeGreaterThan(900);
  for (const prefix of ['Looking across', 'Picking things', 'Keeping it between', 'Keeping it before', 'Keeping it after', 'Planning',
    'Leaving out', 'Rain expected', 'Good outdoor weather', 'Weather data unavailable', 'Showing only what is open']) {
    expect(CAPTIONS.some((c) => c.startsWith(prefix))).toBe(true);
  }
});

test('every caption is recognized and re-renders byte-identical in English', () => {
  const unrecognized = CAPTIONS.filter((c) => !parseAskNotePart(c));
  expect(unrecognized).toEqual([]);
  const drift = CAPTIONS.filter((c) => renderAskNotePart(parseAskNotePart(c), 'en') !== c);
  expect(drift).toEqual([]);
});

test.each(LANGS)('%s: every caption renders, with no placeholder, key path or English template left', (lang) => {
  const bad = [];
  for (const c of CAPTIONS) {
    const out = localizeAskNote(c, lang);
    if (!out || out === c || /[{}]|ui\.askNotes|vocab\./.test(out) || /\b(Leaving out|Looking across|Keeping it|Picking things|Planning|expected|options are higher)\b/.test(out)) bad.push([c, out]);
  }
  expect(bad).toEqual([]);
});

test('a whole line: each part translated; English and an unknown part left exactly as they were', () => {
  const line = "Looking across Outdoors & Nature · Keeping it before 3 PM · Rain expected tonight — indoor options are higher · Leaving out indoor options and places that haven't said";
  expect(localizeAskNote(line, 'en')).toBe(line);
  expect(localizeAskNote(line, 'es')).toBe('Buscando en Aire libre y naturaleza · Antes de las 3 PM · Se espera lluvia esta noche: las opciones bajo techo suben · Dejamos fuera opciones bajo techo y lugares que no lo indican'
    .replace('Aire libre y naturaleza', localizeAskNote('Looking across Outdoors & Nature', 'es').replace('Buscando en ', '')).replace('3 PM', localizeAskNote('Keeping it before 3 PM', 'es').replace('Antes de las ', '')));
  expect(localizeAskNote('Something nobody builds · Keeping it nearby', 'de')).toBe('Something nobody builds · In der Nähe');
  expect(localizeAskNote(null, 'de')).toBeNull();
});

test('values are localized, not copied: groups, clocks, durations and weekdays', () => {
  expect(localizeAskNote('Looking across Food & Drink', 'de')).not.toMatch(/Food & Drink/);
  expect(localizeAskNote('Keeping it between 6 PM and 8 PM', 'de')).toMatch(/18/);
  expect(localizeAskNote('Picking things that fit in about 2 hours', 'fr')).not.toMatch(/hours/);
  expect(localizeAskNote('Rain expected Saturday evening', 'es')).toBe('Se espera lluvia el sábado por la noche');
});

test('Home and Discover render the caption line through localizeAskNote', () => {
  const fs = require('fs');
  const path = require('path');
  for (const f of ['HomeScreen.js', 'DiscoverHubScreen.js']) {
    expect(fs.readFileSync(path.join(__dirname, '..', 'screens', f), 'utf8')).toMatch(/localizeAskNote\(intent\w+\.openEndedNote, language\)/);
  }
});
