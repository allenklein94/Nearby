const fs = require('fs');
const path = require('path');
const { SKILL_LEVEL_KEYS, SPORT_TAGS, SKILL_CONTEXT_LEVELS, skillContext, skillOptionsFor, cleanSkillLevel, beginnerFriendlyShown, skillLevelsFromText, applySkillToCandidates } = require('./skillLevel');
const { CATEGORY_GROUPS } = require('./gatheringCategories');
const { practicalFacts } = require('../utils/gatheringPractical');
const { resolveAsk } = require('../utils/askResolver');
const ROOT = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ALL_TAGS = new Set(CATEGORY_GROUPS.flatMap((g) => g.tags));

describe('skill level vocabulary (item 67)', () => {
  it('one list, equal to the database CHECK; the owner\'s three sets', () => {
    const sql = read('supabase/migrations/20270206_gathering_skill_level.sql');
    expect([...new Set([...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))].sort()).toEqual([...SKILL_LEVEL_KEYS].sort());
    expect(SKILL_CONTEXT_LEVELS).toEqual({
      class: ['beginner', 'intermediate', 'advanced'],
      sport: ['casual', 'competitive'],
      activity: ['beginner', 'intermediate', 'advanced', 'all_levels'],
    });
    SPORT_TAGS.forEach((t) => expect(ALL_TAGS.has(t) ? t : `unknown tag ${t}`).toBe(t));
  });
  it('asked only where relevant, with the choices that fit', () => {
    expect(skillContext({ tag: 'Pickleball' })).toBe('sport');
    expect(skillContext({ tag: 'Cooking Class' })).toBe('class');
    expect(skillContext({ tag: 'Yoga', format: 'class' })).toBe('class');
    expect(skillContext({ tag: 'Pickleball', format: 'workshop' })).toBe('class');
    expect(skillContext({ tag: 'Yoga' })).toBe('activity');
    expect(skillContext({ tag: 'Hiking' })).toBe('activity');
    expect(skillContext({ tag: 'Coffee' })).toBeNull();
    expect(skillContext({ tag: 'Live Music' })).toBeNull();
    expect(skillOptionsFor(null)).toBeNull();
    expect(skillOptionsFor('sport').map((o) => o.label)).toEqual(['Not specified', 'Casual', 'Competitive']);
  });
  it('a level that no longer fits the gathering is not saved', () => {
    expect(cleanSkillLevel('competitive', 'sport')).toBe('competitive');
    expect(cleanSkillLevel('competitive', 'class')).toBeNull();
    expect(cleanSkillLevel('beginner', null)).toBeNull();
    expect(cleanSkillLevel(null, 'sport')).toBeNull();
  });
});

describe('display', () => {
  it('shows a declared level after the format, nothing when undeclared', () => {
    expect(practicalFacts({ format: 'open_play', skill_level: 'casual' }).slice(0, 2)).toEqual(['🏓 Open play', '🎯 Casual']);
    expect(practicalFacts({ skill_level: 'advanced' })[0]).toBe('🎯 Advanced');
    expect(practicalFacts({ interest_tag: 'Pickleball' })).toEqual([]);
  });
  it('the default beginner_friendly badge never contradicts a declared level', () => {
    expect(beginnerFriendlyShown({ beginner_friendly: true })).toBe(true);
    expect(beginnerFriendlyShown({ beginner_friendly: true, skill_level: 'advanced' })).toBe(false);
    expect(beginnerFriendlyShown({ beginner_friendly: true, skill_level: 'competitive' })).toBe(false);
    expect(beginnerFriendlyShown({ beginner_friendly: true, skill_level: 'all_levels' })).toBe(true);
    expect(beginnerFriendlyShown({ beginner_friendly: false, skill_level: 'beginner' })).toBe(false);
    for (const f of ['src/screens/GatheringsScreen.js', 'src/screens/GatheringDetailScreen.js', 'src/services/gatherings.js']) {
      expect([f, /\b(item|gathering)\.beginner_friendly\s*(&&|\|\||\))/.test(read(f))]).toEqual([f, false]);
    }
  });
});

describe('recognition and ranking', () => {
  it('reads the person\'s own words', () => {
    expect(skillLevelsFromText('beginner pickleball')).toEqual(['beginner']);
    expect(skillLevelsFromText('I\'m new to climbing')).toEqual(['beginner']);
    expect(skillLevelsFromText('an advanced yoga class')).toEqual(['advanced']);
    expect(skillLevelsFromText('a casual game of basketball')).toEqual(['casual']);
    expect(skillLevelsFromText('competitive soccer')).toEqual(['competitive']);
    expect(skillLevelsFromText('nothing competitive, just for fun')).toEqual(['casual']);
    expect(skillLevelsFromText('all levels welcome')).toEqual(['all_levels']);
    expect(resolveAsk('beginner pickleball tonight').skillLevels).toEqual(['beginner']);
  });
  it('vague words create no level ("casual" alone is a casual date, "in advance" is not advanced)', () => {
    for (const t of ['a casual dinner', 'something casual tonight', 'book in advance', 'something fun', 'coffee', 'play pickleball']) {
      expect([t, skillLevelsFromText(t)]).toEqual([t, []]);
    }
  });
  it('ranking only: fit up, clear mismatch down, unknown untouched, nothing removed', () => {
    const cands = [
      { id: 'b', skillLevel: 'beginner', score: 0 },
      { id: 'a', skillLevel: 'all_levels', score: 0 },
      { id: 'c', skillLevel: 'competitive', score: 0 },
      { id: 'i', skillLevel: 'intermediate', score: 0 },
      { id: 'u', score: 0 },
    ];
    const out = applySkillToCandidates(cands, ['beginner']);
    expect(out.map((c) => [c.id, c.score])).toEqual([['b', 2], ['a', 2], ['c', -1], ['i', 0], ['u', 0]]);
    expect(out[4]).toBe(cands[4]);
    expect(applySkillToCandidates(cands, [])).toBe(cands);
    expect(applySkillToCandidates(cands, ['competitive']).find((c) => c.id === 'c').subtitle).toBe('🎯 Competitive');
  });
});

describe('wiring', () => {
  it('stored through the one gathering service, asked in Create and Edit only where relevant, read by the resolver', () => {
    expect(read('src/services/gatherings.js')).toMatch(/genre, format, skill_level, features/);
    for (const f of ['src/screens/CreateGatheringScreen.js', 'src/screens/EditGatheringScreen.js']) {
      const s = read(f);
      expect(s).toContain('Skill level');
      expect(s).toMatch(/skillOptionsFor\(skillContext\(/);
      expect(s).toMatch(/skillLevel: cleanSkillLevel\(skillLevel, skillContext\(/);
    }
    const r = read('src/services/intentResolver.js');
    expect(r).toContain('skillLevel: gathering.skill_level ?? null');
    expect(r).toContain('applySkillToCandidates(deduped, skillLevelsFromText(rawText))');
  });
  it('never uses AI or the network, and is not sent to businesses', () => {
    expect(read('src/constants/skillLevel.js').replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/fetch\(|supabase|functions\.invoke|anthropic/i);
    for (const m of fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((x) => x >= '20270206')) {
      expect([m, /get_business_opportunities[\s\S]*skill_level/i.test(read(`supabase/migrations/${m}`))]).toEqual([m, false]);
    }
  });
});
