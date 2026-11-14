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

const { sharedDatingFacts, datingReasonText, DATING_REASON_BASICS, MAX_DATING_REASONS } = require('./datingCardReasons');
const { translate } = require('../i18n/translate');
const en = (key, vars) => translate('en', key, vars);
const browseCard = (mine, theirs) => datingCardFacts(sharedDatingFacts(mine, theirs), { mode: 'browse' });
const texts = (facts, t = en, lang = 'en') => facts.reasons.map((r) => datingReasonText(r, t, lang));

describe('Dating Browse reasons (owner, 2026-11-14)', () => {
  const me = { interests: ['Hiking', 'Coffee'], relationship_intention: ['serious', 'unsure'], basics: { weekend_style: 'Homebody', family_plans: 'Want children', hair_color: 'Brown' } };

  test('accurate: interests first, then the same intention, at most two reasons', () => {
    const them = { interests: ['Coffee'], relationship_intention: ['serious'], basics: { weekend_style: 'Homebody', family_plans: 'Want children' } };
    const f = browseCard(me, them);
    expect(f.reasons.map((r) => r.kind)).toEqual(['shared_interests', 'shared_intention']);
    expect(f.reasons.length).toBeLessThanOrEqual(MAX_DATING_REASONS);
    expect(texts(f)).toEqual(['✨ You both like Coffee', "✨ You're both looking for: 💍 Serious relationship"]);
  });
  test('accurate: with no shared interest, intention + the first lifestyle answer in priority order', () => {
    const them = { interests: ['Golf'], relationship_intention: ['serious'], basics: { weekend_style: 'Homebody', family_plans: 'Want children' } };
    expect(texts(browseCard(me, them))).toEqual(["✨ You're both looking for: 💍 Serious relationship", '👶 You both chose “Want children” for Family Plans']);
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
  test('localization: the reason strings exist in all 11 languages and fill both placeholders', () => {
    for (const lang of ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko']) {
      const a = translate(lang, 'ui.crossedPaths.bothLookingFor', { what: 'X' });
      const b = translate(lang, 'ui.crossedPaths.bothChose', { value: 'V', field: 'F' });
      expect(a).toContain('X'); expect(a).not.toMatch(/\{|ui\./);
      expect(b).toContain('V'); expect(b).toContain('F'); expect(b).not.toMatch(/\{|ui\./);
      if (lang !== 'en') expect(b).not.toBe(translate('en', 'ui.crossedPaths.bothChose', { value: 'V', field: 'F' }));
    }
  });
  test('localization: values and field labels are shown in the viewer\'s language', () => {
    const es = (key, vars) => translate('es', key, vars);
    const [line] = texts(datingCardFacts({ sharedLifestyle: [{ key: 'weekend_style', value: 'Homebody' }] }, { mode: 'browse' }), es, 'es');
    expect(line).not.toMatch(/Homebody|Weekend Style/);
    const [intent] = texts(datingCardFacts({ sharedIntentions: ['serious'] }, { mode: 'browse' }), es, 'es');
    expect(intent).not.toMatch(/Serious relationship/);
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
