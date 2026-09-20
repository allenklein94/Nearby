// A new user must never be trapped after tapping Get Started: every pre-account
// onboarding screen has a visible way back, and the flow keeps their answers.
const fs = require('fs');
const read = (f) => fs.readFileSync(require.resolve(`./${f}`), 'utf8');

test.each(['OnboardingQuestionsScreen.js', 'OnboardingLocationScreen.js', 'OnboardingNotificationsScreen.js'])(
  '%s has the back/sign-in bar',
  (f) => {
    expect(read(f)).toContain('<OnboardingTopBar');
  }
);

test('Login has a Back path when it can go back', () => {
  const s = read('LoginScreen.js');
  expect(s).toContain('navigation.goBack()');
});

test('top bar offers Back and a persistent Sign in', () => {
  const s = fs.readFileSync(require.resolve('../components/OnboardingTopBar.js'), 'utf8');
  expect(s).toMatch(/navigation\.goBack\(\)/);
  expect(s).toMatch(/navigate\('Login'\)/);
});

test('Questions persists a draft and the draft is cleared at signup', () => {
  expect(read('OnboardingQuestionsScreen.js')).toContain('ONBOARDING_DRAFT_KEY');
  expect(read('CompleteProfileScreen.js')).toContain('removeItem(ONBOARDING_DRAFT_KEY)');
});

test('the pre-session stack registers the Login screen every escape points at', () => {
  const nav = fs.readFileSync(require.resolve('../navigation/RootNavigator.js'), 'utf8');
  expect(nav).toMatch(/name="Login" component=\{LoginScreen\}/);
});
