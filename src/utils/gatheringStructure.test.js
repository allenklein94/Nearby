import { whatStepProblem, canSkipWhatStep } from './gatheringStructure';

describe('gathering structure (item 64)', () => {
  it('title and a real category are both required', () => {
    expect(whatStepProblem({ title: '', interestTag: 'Coffee' })).toBe('title');
    expect(whatStepProblem({ title: '  ', interestTag: 'Coffee' })).toBe('title');
    expect(whatStepProblem({ title: 'Sunday coffee', interestTag: null })).toBe('category');
    expect(whatStepProblem({ title: 'Sunday coffee', interestTag: 'Not A Category' })).toBe('category');
    expect(whatStepProblem({ title: 'Sunday coffee', interestTag: 'Coffee' })).toBeNull();
  });
  it('a quick pick skips What only with a title AND a real category', () => {
    expect(canSkipWhatStep({ fromQuickPick: true, quickStartTitle: 'Coffee', quickStartCategory: 'Coffee' })).toBe(true);
    expect(canSkipWhatStep({ fromQuickPick: true, quickStartTitle: 'Coffee', quickStartCategory: null })).toBe(false);
    expect(canSkipWhatStep({ fromQuickPick: false, quickStartTitle: 'Coffee', quickStartCategory: 'Coffee' })).toBe(false);
    expect(canSkipWhatStep(undefined)).toBe(false);
  });
});

describe('filling a missing category (item 64 follow-up)', () => {
  const fs = require('fs');
  const path = require('path');
  it('is fill-only: the update is guarded by interest_tag is null and the Edit picker shows only when none is set', () => {
    const svc = fs.readFileSync(path.join(__dirname, '../services/gatherings.js'), 'utf8');
    const fn = svc.slice(svc.indexOf('export async function setGatheringCategoryIfMissing'));
    expect(fn.slice(0, 700)).toMatch(/\.is\('interest_tag', null\)/);
    const edit = fs.readFileSync(path.join(__dirname, '../screens/EditGatheringScreen.js'), 'utf8');
    expect(edit).toMatch(/const missingCategory = !gathering\.interest_tag/);
    expect(edit).toMatch(/\{missingCategory && \(/);
  });
});
