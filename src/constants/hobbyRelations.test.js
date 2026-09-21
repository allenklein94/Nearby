import { HOBBY_RELATIONS, relatedHobbyFor, relatedInterestReason, RELATED_POINTS } from './hobbyRelations';
import { INTEREST_OPTIONS } from './gatheringCategories';
import { blendedCategoryScore, relatedHobbyNudge, broadGroupNudge, forYouBlend, EXPLICIT_POINTS } from './blendedRanking';
import { interestMatch } from '../utils/interestMatch';
import { reasonKind, reasonTier, SIGNAL_TIERS } from './signalPriority';
import { recommendationConfidence } from '../utils/recommendationConfidence';
import { categorizeReasonText, REASON_CATEGORIES } from './recommendationReasonVocabulary';

describe('hobby relations', () => {
  test('every hobby and every related tag is a real canonical tag; no self relation or duplicates', () => {
    for (const [hobby, related] of Object.entries(HOBBY_RELATIONS)) {
      expect(INTEREST_OPTIONS).toContain(hobby);
      expect(related).not.toContain(hobby);
      expect(new Set(related).size).toBe(related.length);
      related.forEach((t) => expect(INTEREST_OPTIONS).toContain(t));
    }
  });
  test('the hobbies the owner named exist as tags', () => {
    ['Photography', 'Cars', 'Gaming', 'Cooking', 'Gardening', 'Collecting', 'Crafts', 'Board Games', 'D&D', 'Running', 'Golf', 'Fishing', 'Music', 'Fashion', 'Technology']
      .forEach((t) => expect(INTEREST_OPTIONS).toContain(t));
  });
  test('related lookup is directional, and a declared tag is never "related"', () => {
    expect(relatedHobbyFor('Museums', ['Photography'])).toBe('Photography');
    expect(relatedHobbyFor('Photography', ['Museums'])).toBeNull();
    expect(relatedHobbyFor('Photography', ['Photography'])).toBeNull();
    expect(relatedHobbyFor('Coffee', ['Cars'])).toBeNull();
    expect(relatedHobbyFor(null, ['Photography'])).toBeNull();
  });
  test('ranking: related is weaker than declared, equals a broad group, never stacks with it', () => {
    const ctx = { declared: ['Photography'] };
    expect(blendedCategoryScore('Photography', ctx)).toBeGreaterThanOrEqual(EXPLICIT_POINTS);
    expect(blendedCategoryScore('Museums', ctx)).toBe(RELATED_POINTS);
    expect(RELATED_POINTS).toBeLessThan(EXPLICIT_POINTS);
    const both = { declared: ['Photography'], declaredGroups: ['attractions_things_to_see'] };
    expect(blendedCategoryScore('Museums', both)).toBe(RELATED_POINTS);
    expect(relatedHobbyNudge('Museums', both) + broadGroupNudge('Museums', both)).toBe(RELATED_POINTS);
    expect(blendedCategoryScore('Coffee', ctx)).toBe(0);
  });
  test('For You includes related tags, after the declared ones', () => {
    const list = forYouBlend(['Photography'], {}, null, 50, []);
    expect(list[0]).toBe('Photography');
    expect(list).toContain('Museums');
  });
  test('the reason names the hobby honestly, never "you like"', () => {
    const m = interestMatch('Museums', { declared: ['Photography'] });
    expect(m.match_type).toBe('related_interest');
    expect(m.match_reason).toBe('Related to your interest in Photography');
    expect(m.match_reason).not.toMatch(/you like/i);
    expect(m.confidence).toBe('low');
    expect(interestMatch('Museums', { declared: ['Cooking'] }).match_reason).toBeNull();
    expect(interestMatch('Photography', { declared: ['Photography'] }).match_reason).toBe('Because you like Photography');
    expect(relatedInterestReason(null)).toBeNull();
  });
  test('a related reason is personalized but weak: not tier-4 interest, not strong evidence', () => {
    const text = relatedInterestReason('Photography');
    expect(categorizeReasonText(text)).toBe(REASON_CATEGORIES.INTEREST);
    expect(reasonKind(text)).toBe('personalized');
    expect(reasonTier(text)).toBeGreaterThan(SIGNAL_TIERS.interest);
    expect(recommendationConfidence([{ text }])).toBe('low');
    expect(recommendationConfidence([{ text: 'Because you like Photography' }])).toBe('medium');
  });
  test('client-side only: no server or business file reads the map', () => {
    const fs = require('fs'); const path = require('path');
    const dir = path.join(__dirname, '../../supabase');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    walk(dir).filter((f) => /\.(sql|ts)$/.test(f)).forEach((f) => expect(fs.readFileSync(f, 'utf8')).not.toMatch(/hobbyRelations|HOBBY_RELATIONS/));
  });
});
