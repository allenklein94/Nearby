// "You're ready" card Why (owner, 2026-10-04, LOCKED): only a real declared-interest match, else no Why at all.
import fs from 'fs';
import path from 'path';
import { readyCardWhy } from './recommendationFacts';

describe("You're ready card Why", () => {
  test('declared-interest match names the gathering\'s own category', () => {
    expect(readyCardWhy({ interest_tag: 'Coffee', interestMatched: true })).toBe('Because you like Coffee');
  });

  test('no match = no Why line, whatever else the row carries', () => {
    expect(readyCardWhy({ interest_tag: 'Coffee', interestMatched: false })).toBeNull();
    expect(readyCardWhy({ interest_tag: 'Coffee' })).toBeNull(); // category alone is not a reason
    expect(readyCardWhy({ interest_tag: 'Coffee', matchScore: 1 })).toBeNull(); // only the explicit flag counts
    expect(readyCardWhy({ interest_tag: 'Coffee', reasons: ['Trending nearby', 'Happening today', '0.8 mi away', 'Recommended for you'] })).toBeNull();
    expect(readyCardWhy({ interestMatched: true })).toBeNull(); // nothing to name = nothing claimed
  });

  test('the screen reads only readyCardWhy and never a generic fallback', () => {
    const src = fs.readFileSync(path.join(__dirname, '../screens/OnboardingRecommendationsScreen.js'), 'utf8');
    expect(src).toMatch(/readyCardWhy\(r\)/);
    expect(src).not.toMatch(/recommendationFacts\(|Matches your interests|Recommended for you|matchesInterests/);
  });

  test('the service sets interestMatched only from an explicitly picked interest', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/homeDashboard.js'), 'utf8');
    expect(src).toMatch(/interestMatched: matchesInterest/);
  });
});
