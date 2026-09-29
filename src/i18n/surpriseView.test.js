// Surprise Me in every language: the same decisions the engine makes, worded through translations.<lang>.surprise.
import fs from 'fs';
import path from 'path';
import { translations } from './translations';
import { valueForms } from './translate';
import { surpriseView, surpriseText, surpriseBasisText, surpriseHeaderText, planPartKey } from './surpriseView';
import { surpriseBasis, surpriseBasisParts, undecidedHeader, UNDECIDED_LANES, WHEN_OPTIONS, MOOD_OPTIONS, THINGS_TO_DO_GROUPS } from '../services/surpriseMeLogic';
import { EXPERIENCE_TEMPLATES, CONTEXT_TEMPLATES } from '../constants/experienceTemplates';
import { ENERGY_LEVELS } from '../constants/energyLevel';

const LANGS = Object.keys(translations);
const OTHER = LANGS.filter((l) => l !== 'en');
const EN = translations.en.surprise;
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const leaves = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [`${p}${k}`] : leaves(v, `${p}${k}.`)));
const get = (o, k) => k.split('.').reduce((v, p) => v?.[p], o);
const ph = (s) => (String(s).match(/\{\w+\}/g) ?? []).sort();

const BASIS_CASES = [
  {},
  { usedInterests: true },
  { usedInterests: true, dateWindow: 'tonight', budgetMax: 30, partyType: 'date' },
  { scope: { level: 'cuisine', cuisine: 'italian' }, dateWindow: 'weekend', priceLevel: 'free' },
  { scope: { level: 'tags', tags: ['Coffee', 'Movies'] }, priceLevel: '$$', partyType: 'friends' },
  { scope: { level: 'energy', energies: ['active'] }, dateWindow: 'now' },
  { scope: { level: 'groups', groups: [...THINGS_TO_DO_GROUPS] }, partyType: 'solo' },
  { scope: { level: 'groups', groups: ['food_drink'] }, dateWindow: 'tomorrow', partyType: 'groups' },
];

describe('English is the engine\'s own wording, byte for byte', () => {
  it.each(BASIS_CASES.map((c, i) => [i, c]))('basis case %s', (i, opts) => {
    expect(surpriseBasisText(surpriseBasisParts(opts), 'en')).toBe(surpriseBasis(opts));
  });
  it('headers, lane labels, sheet options and energies are the constants', () => {
    for (const w of ['now', 'today', 'tonight', 'tomorrow', 'weekend', null, 'flexible']) expect(surpriseHeaderText(w, 'en')).toBe(undecidedHeader(w));
    for (const lane of UNDECIDED_LANES) expect(EN.lanes[lane.key]).toBe(lane.label);
    for (const o of WHEN_OPTIONS) expect(EN.sheet.whenOptions[o.key]).toBe(o.label);
    for (const o of MOOD_OPTIONS) expect(`${o.label.split(' ')[0]} ${EN.sheet.moods[o.key]}`).toBe(o.label);
    for (const e of ENERGY_LEVELS) expect(EN.energies[e.key]).toBe(e.display);
  });
  it('every plan-part name a recipe can produce has a key, and the English key text is that name', () => {
    const labels = new Set(['Coffee', 'Dinner or Coffee']);
    for (const t of [...Object.values(EXPERIENCE_TEMPLATES), ...Object.values(CONTEXT_TEMPLATES)]) {
      for (const c of t.components ?? []) labels.add(c.label.replace(/^\S+\s+/, ''));
    }
    for (const l of labels) expect([l, EN.planParts[planPartKey(l)]]).toEqual([l, l]);
  });
  it('the full view in English matches what the screens printed before', () => {
    const r = {
      dateWindow: 'tonight', basisParts: surpriseBasisParts({ usedInterests: true, dateWindow: 'tonight', budgetMax: 30 }),
      lanes: [{ key: 'best', label: 'Best Pick', plan: 'Dinner + Entertainment', planParts: ['Dinner', 'Entertainment'], items: [] }, { key: 'friends', label: 'With Friends', plan: null, items: [] }],
      connectedPerson: { name: 'Sam', forTitle: 'Jazz night' }, calendarHint: { title: 'Dentist', dateLabel: 'Fri, Oct 2', startDate: new Date(2026, 9, 2) },
    };
    const v = surpriseView(r, 'en');
    expect(v.header).toBe('Tonight near you');
    expect(v.basis).toBe('Picked from your interests · tonight · under $30');
    expect(v.lanes.map((l) => l.heading)).toEqual(['Best Pick · Dinner + Entertainment', 'With Friends']);
    expect(v.connectedLine).toBe('You could go with Sam to Jazz night 👋');
    expect(v.calendarLine).toBe('📅 You also have "Dentist" coming up (Fri, Oct 2)');
  });
});

describe('every language carries every Surprise Me string with the same placeholders', () => {
  it.each(OTHER)('%s', (lang) => {
    for (const key of leaves(EN)) {
      const mine = get(translations[lang].surprise, key);
      expect([lang, key, typeof mine]).toEqual([lang, key, 'string']);
      for (const form of valueForms(mine)) expect([lang, key, ph(form)]).toEqual([lang, key, ph(get(EN, key))]);
    }
  });
  it.each(OTHER)('%s: nothing user-facing is left as the English text', (lang) => {
    // names that really are the same word in that language (checked by hand)
    const SAME = new Set(['de.sheet.moods.date', 'de.planParts.professional', 'es.energies.social', 'es.sheet.moods.social', 'pt.energies.social',
      'pt.sheet.moods.social', 'tl.sheet.moods.date', 'es.planParts.professional']);
    const left = leaves(EN).filter((k) => get(translations[lang].surprise, k) === get(EN, k) && !SAME.has(`${lang}.${k}`));
    expect([lang, left]).toEqual([lang, []]);
  });
});

describe('dynamic values are composed from localized parts', () => {
  const full = {
    dateWindow: 'weekend',
    basisParts: surpriseBasisParts({ usedInterests: true, dateWindow: 'weekend', budgetMax: 25, partyType: 'friends' }),
    lanes: [{ key: 'best', label: 'Best Pick', planParts: ['Something to Do', 'Dinner'], items: [] }, { key: 'easy', label: 'Something Easy', items: [] }],
    connectedPerson: { name: 'Sam', forTitle: 'Board game night' },
    calendarHint: { title: 'Dentist', dateLabel: 'Fri, Oct 2', startDate: new Date(2026, 9, 2) },
  };
  it.each(OTHER)('%s: no placeholder or English part leaks, names and titles kept as written', (lang) => {
    const v = surpriseView(full, lang);
    const all = [v.header, v.basis, ...v.lanes.map((l) => l.heading), v.connectedLine, v.calendarLine].join(' | ');
    expect(all).not.toMatch(/\{\w+\}|surprise\./);
    expect(all).not.toMatch(/Picked from your interests|this weekend|with friends|Best Pick|Something to Do|Something Easy|You could go|You also have/);
    expect(v.basis).toContain('25');
    expect(v.connectedLine).toContain('Sam');
    expect(v.connectedLine).toContain('Board game night');
    expect(v.calendarLine).toContain('Dentist');
    expect(v.calendarLine).not.toContain('Fri, Oct 2'); // the date is in the person's language too
  });
  it('German, Spanish and Korean read naturally', () => {
    expect(surpriseView(full, 'de').basis).toBe('Nach deinen Interessen ausgewählt · dieses Wochenende · unter $25 · mit Freunden');
    expect(surpriseView(full, 'de').lanes[0].heading).toBe('Beste Wahl · Etwas unternehmen + Abendessen');
    expect(surpriseView(full, 'de').connectedLine).toBe('Du könntest mit Sam zu Board game night gehen 👋');
    expect(surpriseView(full, 'es').header).toBe('Este fin de semana cerca de ti');
    expect(surpriseView(full, 'ko').basis).toBe('관심사에 맞춰 골랐어요 · 이번 주말 · $25 이하 · 친구와 함께');
  });
  it('a scope keeps its meaning: cuisine and energy translated, category tags and groups translated', () => {
    expect(surpriseBasisText(surpriseBasisParts({ scope: { level: 'cuisine', cuisine: 'italian' } }), 'es')).toBe(translations.es.vocab.cuisines.italian);
    expect(surpriseBasisText(surpriseBasisParts({ scope: { level: 'energy', energies: ['active'] } }), 'fr')).toBe('Actif');
    expect(surpriseBasisText(surpriseBasisParts({ scope: { level: 'groups', groups: [...THINGS_TO_DO_GROUPS] } }), 'ru')).toBe('Чем заняться');
    expect(surpriseBasisText(surpriseBasisParts({ scope: { level: 'tags', tags: ['Coffee', 'Movies'] } }), 'de')).toBe('Kaffee + Kino');
    expect(surpriseBasisText(surpriseBasisParts({ scope: { level: 'groups', groups: ['food_drink'] } }), 'es')).toBe('Comida y bebida');
  });
  it('missing parts stay missing in every language', () => {
    for (const lang of LANGS) {
      expect(surpriseView(null, lang)).toBeNull();
      const v = surpriseView({ lanes: [], basisParts: [] }, lang);
      expect([lang, v.basis, v.connectedLine, v.calendarLine]).toEqual([lang, null, null, null]);
      expect(v.header).toBe(surpriseText(lang, 'headers.none'));
      expect(surpriseView({ lanes: [{ key: 'best', planParts: [] }] }, lang).lanes[0].heading).toBe(surpriseText(lang, 'lanes.best'));
    }
  });
  it('an unknown plan part keeps its own name instead of a key path', () => {
    expect(surpriseView({ lanes: [{ key: 'best', planParts: ['Karaoke Corner', 'Dinner'] }] }, 'es').lanes[0].heading).toBe('Mejor opción · Karaoke Corner + Cena');
  });
});

describe('wiring', () => {
  it('Home, Discover and the sheet render the localized view, no hard-coded Surprise Me English', () => {
    const home = read('screens/HomeScreen.js');
    const homeBlock = home.slice(home.indexOf('{surprise && !surpriseLoading && ('), home.indexOf('{intentResults && ('));
    expect(homeBlock.length).toBeGreaterThan(1000);
    for (const [f, src] of [['HomeScreen (Surprise Me block)', homeBlock], ['screens/DiscoverHubScreen.js', read('screens/DiscoverHubScreen.js')], ['components/SurpriseMeSheet.js', read('components/SurpriseMeSheet.js')]]) {
      expect([f, src.match(/>(?:✨ Surprise Me|🔀 Shuffle Again|Try something else|Nothing real to suggest right now|When\?|Mood\?|Cancel)</g)]).toEqual([f, null]);
      expect(src).not.toMatch(/You could go with|That's everything nearby|You also have "|Picking a few ideas|Press search and Nearby/);
      expect(src).not.toMatch(/`\$\{lane\.label\} · \$\{lane\.plan\}`/);
    }
    expect(read('screens/HomeScreen.js')).toMatch(/surpriseView\(surprise, language\)/);
    expect(read('screens/DiscoverHubScreen.js')).toMatch(/surpriseView\(discoverSurprise, language\)/);
  });
  it('the Picked For You attending count uses the shared translated count', () => {
    const home = read('screens/HomeScreen.js');
    expect(home).not.toMatch(/\} attending`/);
    expect(home).toMatch(/translate\(language, 'reasons\.attendingCount', \{ count: attendeeTotal\(g\) \}\)/);
  });
});
