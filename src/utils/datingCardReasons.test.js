const fs = require('fs');
const path = require('path');
const { datingCardFacts } = require('./datingCardReasons');
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

describe('Dating cards explain themselves (item 77)', () => {
  test('shared interests are the WHY; the crossing is the WHERE/WHEN', () => {
    const f = datingCardFacts({ sharedInterests: ['Live Music', 'Coffee'] }, { crossedPathsTime: '2 hours ago' });
    expect(f.reason).toEqual({ kind: 'shared_interests', tags: ['Live Music', 'Coffee'] });
    expect(f.where).toBe('📍 Within about 35 feet · 2 hours ago');
  });
  test('a shared gathering replaces the crossing text', () => {
    expect(datingCardFacts({ sharedInterests: [] }, { gatheringText: 'You both went to Trivia' }).where).toBe('🗓️ You both went to Trivia');
  });
  test('Crossed Paths with no shared interest lets the crossing be the reason (no invented one)', () => {
    expect(datingCardFacts({ sharedInterests: [] }, { mode: 'crossedPaths' }).reason).toBeNull();
  });
  test('Browse says the one true thing and never a bare "Matches your filters" or an invented mileage', () => {
    const f = datingCardFacts({ sharedInterests: [] }, { mode: 'browse' });
    expect(f.reason).toEqual({ kind: 'preferences', text: 'Fits your dating preferences' });
    expect(f.where).toBe('📍 In your area');
    expect(f.where).not.toMatch(/\d+(\.\d+)? mi/);
  });
  test('no availability claim is ever made for a stranger', () => {
    const src = read('./datingCardReasons.js').replace(/\/\/[^\n]*/g, '');
    expect(src).not.toMatch(/available/i);
  });
  test('both the list card and the swipe deck render through the one helper', () => {
    expect(read('../screens/DiscoveryScreen.js')).toMatch(/datingCardFacts\(item/);
    expect(read('../components/SwipeableDiscoveryCards.js')).toMatch(/datingCardFacts\(item/);
    expect(read('../screens/DiscoveryScreen.js')).not.toMatch(/Matches your filters/);
    expect(read('../components/SwipeableDiscoveryCards.js')).not.toMatch(/Matches your filters/);
  });
  test('the reason sits above the proximity line on the list card', () => {
    const src = read('../screens/DiscoveryScreen.js');
    expect(src.indexOf('facts.reason &&')).toBeGreaterThan(-1);
    expect(src.indexOf('facts.reason &&')).toBeLessThan(src.indexOf('{facts.where}'));
  });
});

const { sharedDatingFacts, datingReasonText, DATING_REASON_BASICS, MAX_DATING_REASONS, lifestyleReasonKey, intentionReasonKey } = require('./datingCardReasons');
const { BASICS_FIELDS } = require('../constants/basicsFields');
const { INTENTION_OPTIONS } = require('../constants/intentionOptions');
const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko'];
const { translate } = require('../i18n/translate');
const en = (key, vars) => translate('en', key, vars);
const browseCard = (mine, theirs) => datingCardFacts(sharedDatingFacts(mine, theirs), { mode: 'browse' });
const texts = (facts, t = en) => facts.reasons.map((r) => datingReasonText(r, t));

describe('Dating Browse reasons (owner, 2026-11-14)', () => {
  const me = { interests: ['Hiking', 'Coffee'], relationship_intention: ['serious', 'unsure'], basics: { weekend_style: 'Homebody', family_plans: 'Want children', hair_color: 'Brown' } };

  test('accurate: interests first, then the same intention, at most two reasons', () => {
    const them = { interests: ['Coffee'], relationship_intention: ['serious'], basics: { weekend_style: 'Homebody', family_plans: 'Want children' } };
    const f = browseCard(me, them);
    expect(f.reasons.map((r) => r.kind)).toEqual(['shared_interests', 'shared_intention']);
    expect(f.reasons.length).toBeLessThanOrEqual(MAX_DATING_REASONS);
    expect(texts(f)).toEqual(['✨ You both like Coffee', "💍 You're both looking for something serious"]);
  });
  test('accurate: with no shared interest, intention + the first lifestyle answer in priority order', () => {
    const them = { interests: ['Golf'], relationship_intention: ['serious'], basics: { weekend_style: 'Homebody', family_plans: 'Want children' } };
    expect(texts(browseCard(me, them))).toEqual(["💍 You're both looking for something serious", '👶 You both want children']);
  });
  test('only answers BOTH gave count; a different answer is never a reason', () => {
    const them = { interests: [], relationship_intention: ['casual'], basics: { weekend_style: 'Always out and about', family_plans: "Don't want children" } };
    expect(browseCard(me, them).reasons).toEqual([{ kind: 'preferences', text: 'Fits your dating preferences' }]);
  });
  test('missing data: no profile, no basics or empty arrays fall back to the existing wording', () => {
    expect(browseCard(me, {}).reasons.map((r) => r.kind)).toEqual(['preferences']);
    expect(browseCard({}, { interests: ['Coffee'], basics: { weekend_style: 'Homebody' } }).reasons.map((r) => r.kind)).toEqual(['preferences']);
    expect(browseCard(null, null).reasons.map((r) => r.kind)).toEqual(['preferences']);
    expect(datingCardFacts({}, { mode: 'browse' }).reason.kind).toBe('preferences');
  });
  test('"Still figuring it out" and noncommittal answers are never reasons', () => {
    const mine = { relationship_intention: ['unsure'], basics: { family_plans: 'Not sure yet', social_energy: 'Depends on the day', independence_preference: 'Somewhere in between', communication_style: 'Balanced', workout: 'Sometimes' } };
    expect(sharedDatingFacts(mine, mine)).toEqual({ sharedInterests: [], sharedIntentions: [], sharedLifestyle: [] });
  });
  test('legacy or free-text values outside the field options never count', () => {
    const mine = { basics: { weekend_style: 'Out every night!!', pets: 'Dog' } };
    expect(sharedDatingFacts(mine, mine).sharedLifestyle).toEqual([{ key: 'pets', value: 'Dog' }]);
  });
  test('privacy: appearance, ethnicity, religion, diet, substances, status and free text never become reasons', () => {
    const sensitive = { hair_color: 'Brown', eye_color: 'Blue', height: "5'10\"", tattoos: 'Has tattoos', piercings: 'Has piercings', religion: 'Jewish', diet: 'Kosher', cultural_background: 'x', drinking: 'Yes', smoking: 'No', cannabis: 'No', education: 'Grad degree', financial_priority: 'Building wealth', job_title: 'Engineer', school: 'FAU', zodiac: 'Leo', living_in: 'Delray', languages_spoken: 'English' };
    const p = { basics: sensitive, ethnicity: 'Asian', height_inches: 70 };
    expect(sharedDatingFacts(p, p).sharedLifestyle).toEqual([]);
    for (const k of Object.keys(sensitive)) expect(DATING_REASON_BASICS).not.toContain(k);
  });
  test('Crossed Paths keeps its own rule: interests or nothing (no lifestyle/intention reasons)', () => {
    const f = datingCardFacts({ sharedInterests: [], sharedIntentions: ['serious'], sharedLifestyle: [{ key: 'pets', value: 'Dog' }] }, { mode: 'crossedPaths' });
    expect(f.reasons).toEqual([]);
    expect(f.reason).toBeNull();
  });
  test('never a percentage, score or "strong match" in any reason wording', () => {
    const them = { interests: ['Coffee'], relationship_intention: ['serious'], basics: { weekend_style: 'Homebody' } };
    for (const s of texts(browseCard(me, them))) {
      expect(s).not.toMatch(/%|\bscore\b|strong match|compatib/i);
    }
  });
  const reasonFields = DATING_REASON_BASICS.map((k) => BASICS_FIELDS.find((f) => f.key === k));
  const noncommittal = /^(prefer not to say|other|not sure|figuring out|depends on the day|somewhere in between|a mix of both|balanced|mix of cooking and ordering|sometimes)/i;
  test('every supported answer has its own natural sentence, and is a reason when both chose it', () => {
    let count = 0;
    for (const field of reasonFields) {
      for (const value of field.options) {
        const facts = sharedDatingFacts({ basics: { [field.key]: value } }, { basics: { [field.key]: value } });
        if (noncommittal.test(value)) {
          expect(facts.sharedLifestyle).toEqual([]);
          continue;
        }
        count += 1;
        expect(facts.sharedLifestyle).toEqual([{ key: field.key, value }]);
        const [line] = texts(datingCardFacts(facts, { mode: 'browse' }));
        expect(line.startsWith(`${field.icon} `)).toBe(true);
        expect(line).not.toMatch(/chose|“|ui\.|\{/);
        expect(line).toMatch(/^\S+ (You|Neither of you)\b/);
      }
    }
    expect(count).toBe(41);
  });
  test('every relationship goal except "Still figuring it out" has its own sentence', () => {
    for (const { value, icon } of INTENTION_OPTIONS) {
      const facts = sharedDatingFacts({ relationship_intention: [value] }, { relationship_intention: [value] });
      if (value === 'unsure') { expect(facts.sharedIntentions).toEqual([]); continue; }
      const [line] = texts(datingCardFacts(facts, { mode: 'browse' }));
      expect(line).toBe(`${icon} ${en(intentionReasonKey(value))}`);
      expect(line).not.toMatch(/:|ui\./);
    }
  });
  test('sentences say exactly what was chosen (spot checks against the answer)', () => {
    const say = (key, value) => en(lifestyleReasonKey(key, value));
    expect(say('family_plans', "Don't want children")).toBe('Neither of you wants children');
    expect(say('family_plans', "Have children, don't want more")).toBe("You both have children and don't want more");
    expect(say('workout', 'Often')).toBe('You both work out often');
    expect(say('pets', 'Pet-free')).toBe("You're both pet-free");
    // The Pets field asks no question ("Pets: Dog"), so an animal answer is never read as owning or liking one.
    for (const v of ['Dog', 'Cat', 'Reptile', 'Bird', 'Fish']) {
      expect(say('pets', v)).toMatch(/^You both picked \w+ as pets$/);
      for (const lang of LANGS) expect(translate(lang, lifestyleReasonKey('pets', v))).not.toMatch(/\bhave\b|\blike\b|\blove\b/i);
    }
    expect(say('love_style', 'Quality time')).toBe('You share a love language: quality time');
  });
  test('two shared goals show one sentence, in the options\' order', () => {
    const p = { relationship_intention: ['marriage', 'serious'] };
    expect(texts(browseCard(p, p))).toEqual(["💍 You're both looking for something serious"]);
  });
  test('localization: every sentence exists in all 11 languages, never the English or a raw key', () => {
    const keys = [
      ...reasonFields.flatMap((f) => f.options.filter((v) => !noncommittal.test(v)).map((v) => lifestyleReasonKey(f.key, v))),
      ...INTENTION_OPTIONS.filter((o) => o.value !== 'unsure').map((o) => intentionReasonKey(o.value)),
    ];
    expect(keys).toHaveLength(45);
    for (const lang of LANGS) {
      for (const key of keys) {
        const s = translate(lang, key);
        expect(typeof s).toBe('string');
        expect(s).not.toMatch(/^ui\.|\{/);
        if (lang !== 'en') expect(s).not.toBe(translate('en', key));
      }
    }
  });
  test('localization: the card renders the viewer\'s language', () => {
    const es = (key, vars) => translate('es', key, vars);
    const facts = { sharedIntentions: ['serious'], sharedLifestyle: [{ key: 'family_plans', value: 'Want children' }] };
    expect(texts(datingCardFacts(facts, { mode: 'browse' }), es)).toEqual(['💍 Ambos buscan algo serio', '👶 Ambos quieren tener hijos']);
  });
  test('wiring: Browse computes reasons from the fresh row the card shows, and both cards render through datingReasonText', () => {
    const svc = read('../services/proximity.js');
    expect(svc).toMatch(/merge: \(candidate, row\)[\s\S]{0,200}sharedDatingFacts\(myProfile, profiles\)/);
    expect(svc).toMatch(/BROWSE_PROFILE_COLUMNS = '[^']*relationship_intention/);
    for (const f of ['../screens/DiscoveryScreen.js', '../components/SwipeableDiscoveryCards.js']) {
      expect(read(f)).toMatch(/facts\.reasons\.map\(\(reason\) =>[\s\S]{0,120}datingReasonText\(reason, t\)/);
      expect(read(f)).not.toMatch(/facts\.reason\.kind === 'shared_interests'/);
    }
  });
});
