// Category, group and occasion names in every language, keyed by their permanent key.
import fs from 'fs';
import path from 'path';
import { translations } from './translations';
import { categoryName, categoryNames, deriveCategoryKey, tagKey } from './categoryNames';
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { OCCASION_OPTIONS } from '../constants/businessAttributes';
import { localizeReason } from '../utils/reasonLocalization';
import { becauseYouLikeReason, askedForReason, occasionOfferedReason, resultTitleText } from '../constants/recommendationReasonVocabulary';

const LANGS = Object.keys(translations);
const OTHER = LANGS.filter((l) => l !== 'en');
const EN = translations.en.vocab.categories;
const ALL_TAGS = CATEGORY_GROUPS.flatMap((g) => [...g.tags, ...(g.businessOnlyTags ?? [])]); // business-only tags too (a business names itself)
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('one English source, keyed by the permanent key', () => {
  it('every category the app knows has an entry under its key, whose English is the category name', () => {
    expect(ALL_TAGS.length).toBeGreaterThanOrEqual(241);
    for (const t of ALL_TAGS) expect([t, EN.tags[deriveCategoryKey(t)]]).toEqual([t, t]);
    expect(Object.keys(EN.tags)).toHaveLength(new Set(ALL_TAGS).size);
  });
  it('every group and occasion is its own label', () => {
    for (const g of CATEGORY_GROUPS) expect(EN.groups[g.key]).toBe(g.label);
    for (const o of OCCASION_OPTIONS) expect(EN.occasions[o.key]).toBe(o.label);
  });
  it('the key rule matches the database\'s _category_key_from_name', () => {
    expect(deriveCategoryKey('Dessert & Ice Cream')).toBe('dessert_and_ice_cream');
    expect(deriveCategoryKey('D&D')).toBe('d_and_d');
    expect(deriveCategoryKey('Pop-Ups')).toBe('pop_ups');
    expect(deriveCategoryKey('Arts, Culture & Learning')).toBe('arts_culture_and_learning');
  });
});

describe('every language names every category, group and occasion', () => {
  it.each(OTHER)('%s', (lang) => {
    const mine = translations[lang].vocab.categories;
    for (const ns of ['tags', 'groups', 'occasions']) {
      for (const k of Object.keys(EN[ns])) expect([lang, ns, k, typeof mine[ns][k], (mine[ns][k] ?? '').trim().length > 0]).toEqual([lang, ns, k, 'string', true]);
    }
    // most names really are translated (loanwords such as Yoga, Golf or Karaoke may stay as they are)
    const same = Object.keys(EN.tags).filter((k) => mine.tags[k] === EN.tags[k]).length;
    expect([lang, same / Object.keys(EN.tags).length < 0.3]).toEqual([lang, true]);
    for (const k of Object.keys(EN.groups)) expect([lang, k, mine.groups[k] === EN.groups[k] && !['shopping', 'business_networking', 'pets'].includes(k)]).toEqual([lang, k, false]);
  });
});

describe('the lookup', () => {
  it('English is returned exactly as given', () => {
    for (const v of ['Coffee', 'Food & Drink', 'Birthday', 'Something unknown', '', null]) expect(categoryName(v, 'en')).toBe(v);
  });
  it('tags, groups (by label or key) and occasions are translated', () => {
    expect(categoryName('Coffee', 'de')).toBe('Kaffee');
    expect(categoryName('Live Music', 'es')).toBe('Música en vivo');
    expect(categoryName('Food & Drink', 'fr')).toBe('Cuisine et boissons');
    expect(categoryName('food_drink', 'ko')).toBe('음식 & 음료');
    expect(categoryName('Birthday', 'ru')).toBe('День рождения');
    expect(categoryNames(['Coffee', 'Movies'], 'zh')).toBe('咖啡 + 电影');
  });
  it('a name the app does not know (added after this release, or a person\'s own words) is shown as stored', () => {
    expect(categoryName('Axe Throwing', 'de')).toBe('Axe Throwing');
    expect(categoryName('Taco Tuesday at the park', 'es')).toBe('Taco Tuesday at the park');
  });
  it('an admin rename keeps its translation: the key comes from the synced taxonomy, not the new name', () => {
    jest.isolateModules(() => {
      const reg = require('../constants/categoryRegistry');
      const names = require('./categoryNames');
      reg.applyTaxonomySnapshot({ version: 99, tags: [{ id: 42, key: 'coffee', tag: 'Coffee & Tea', group_key: 'food_drink', business_only: false, retired: false }],
        former_names: [{ name: 'Coffee', current_tag: 'Coffee & Tea', retired: false }] });
      expect(names.tagKey('Coffee & Tea')).toBe('coffee');
      expect(names.categoryName('Coffee & Tea', 'de')).toBe('Kaffee');
      expect(names.categoryName('Coffee', 'es')).toBe('Café'); // an old stored name follows the rename to the same key
      expect(names.categoryName('Coffee & Tea', 'en')).toBe('Coffee & Tea');
    });
  });
});

describe('composed into the translated sentences', () => {
  it('reasons carry the translated name in every language, and no placeholder leaks', () => {
    for (const lang of OTHER) {
      const out = localizeReason(becauseYouLikeReason('Live Music'), lang);
      expect([lang, out.includes(translations[lang].vocab.categories.tags.live_music)]).toEqual([lang, true]);
      expect(out).not.toMatch(/\{\w+\}|vocab\./);
      expect(localizeReason(askedForReason('Coffee'), lang)).toContain(translations[lang].vocab.categories.tags.coffee);
      expect(localizeReason(occasionOfferedReason('Birthday'), lang)).toContain(translations[lang].vocab.categories.occasions.birthday);
    }
  });
  it('German names an occasion without a mechanical compound, French quotes it', () => {
    expect(localizeReason(occasionOfferedReason('Anniversary'), 'de')).toBe('Bietet Erlebnisse zum Anlass „Jahrestag“ an');
    expect(localizeReason(resultTitleText('offersOccasion', { business: 'Coastal Coffee', occasion: 'Birthday' }), 'fr')).toBe('Coastal Coffee propose des expériences « Anniversaire »');
  });
  it('English reasons are unchanged', () => {
    expect(localizeReason(becauseYouLikeReason('Coffee'), 'en')).toBe('Because you like Coffee');
  });
});

describe('the Nearby Pick label', () => {
  it('is in every language and the badge and screen-reader label use it', () => {
    for (const lang of LANGS) expect(typeof translations[lang].vocab.labels.nearbyPick).toBe('string');
    expect(translations.en.vocab.labels.nearbyPick).toBe('Nearby Pick');
    expect(read('motion/NearbyPickBadge.js')).toMatch(/translate\(language, 'vocab\.labels\.nearbyPick'\)/);
    expect(read('motion/NearbyPickBadge.js')).not.toMatch(/✨ Nearby Pick</);
    expect(read('screens/DiscoverHubScreen.js')).not.toMatch(/'Nearby Pick'/);
  });
});
