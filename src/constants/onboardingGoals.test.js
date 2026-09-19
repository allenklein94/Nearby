import { motivationsFromAnswers, wantsCelebrationsStep, ONBOARDING_GOALS, LOOKING_FOR_OPTIONS } from './onboardingGoals';
import { subModeFromMotivations } from '../utils/peopleSubModePreference';

test('looking-for maps onto the tokens the rest of the app already reads', () => {
  expect(subModeFromMotivations(motivationsFromAnswers({ goals: ['Meet people'], lookingFor: 'friends' }))).toBe('friends');
  expect(subModeFromMotivations(motivationsFromAnswers({ lookingFor: 'dating' }))).toBe('dating');
  expect(subModeFromMotivations(motivationsFromAnswers({ lookingFor: 'both' }))).toBe('dating');
  expect(subModeFromMotivations(motivationsFromAnswers({ goals: ['Discover places'], lookingFor: 'skip' }))).toBe('dating');
});

test('friends / both opt into Friend Discovery tokens; skip adds nothing', () => {
  expect(motivationsFromAnswers({ lookingFor: 'both' })).toEqual(['Go on dates', 'Make new friends']);
  expect(motivationsFromAnswers({ goals: ['Make plans'], lookingFor: 'skip' })).toEqual(['Make plans']);
  expect(motivationsFromAnswers({})).toEqual([]);
});

test('celebrations step only for that goal', () => {
  expect(wantsCelebrationsStep(motivationsFromAnswers({ goals: ['Plan celebrations'] }))).toBe(true);
  expect(wantsCelebrationsStep(['Make plans'])).toBe(false);
  expect(wantsCelebrationsStep(null)).toBe(false);
});

test('the six goals and four looking-for options are the specified set', () => {
  expect(ONBOARDING_GOALS.map((g) => g.label)).toEqual(['Meet people', 'Find things to do', 'Make plans', 'Discover places', 'Plan celebrations', 'Find businesses and offers']);
  expect(LOOKING_FOR_OPTIONS.map((o) => o.key)).toEqual(['dating', 'friends', 'both', 'skip']);
});
