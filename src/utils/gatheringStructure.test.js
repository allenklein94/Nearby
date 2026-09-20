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
