jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));
const Haptics = require('expo-haptics');
const { playHaptic, HAPTIC_MOMENTS } = require('./haptics');

beforeEach(() => jest.clearAllMocks());

test('match and friendAccepted are subtle light impacts', () => {
  playHaptic(HAPTIC_MOMENTS.match);
  playHaptic(HAPTIC_MOMENTS.friendAccepted);
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
  expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});

test('success is a success notification haptic', () => {
  playHaptic(HAPTIC_MOMENTS.success);
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
});

test('unknown moments do nothing, and failures never throw', () => {
  playHaptic('nope');
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
  Haptics.impactAsync.mockImplementationOnce(() => { throw new Error('no engine'); });
  expect(() => playHaptic(HAPTIC_MOMENTS.match)).not.toThrow();
  Haptics.notificationAsync.mockImplementationOnce(() => Promise.reject(new Error('x')));
  expect(() => playHaptic(HAPTIC_MOMENTS.success)).not.toThrow();
});
