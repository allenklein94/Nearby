// Guards for the owner's UX P0/P1 fixes (2026-11-21): one keyboard rule for chats, Create reveals the first problem,
// primary actions are coral (never a category colour), content never starts under a transparent header.
const fs = require('fs');
const path = require('path');
const { keyboardOffsetFor } = require('../utils/keyboardOffset');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('KeyboardSafeView', () => {
  test('iOS offsets by the header height; Android never pads', () => {
    expect(keyboardOffsetFor('ios', 96)).toBe(96);
    expect(keyboardOffsetFor('ios', undefined)).toBe(0);
    expect(keyboardOffsetFor('android', 96)).toBe(0);
  });
  test.each(['GatheringChatScreen', 'PlanChatScreen', 'CommunityChatScreen', 'BusinessConversationScreen', 'ChatScreen'])(
    '%s uses the shared keyboard view, never its own KeyboardAvoidingView',
    (name) => {
      const src = read(`screens/${name}.js`);
      expect(src).toContain("import KeyboardSafeView from '../components/KeyboardSafeView'");
      expect(src).not.toMatch(/KeyboardAvoidingView/);
    },
  );
});

describe('Create Gathering', () => {
  const src = read('screens/CreateGatheringScreen.js');
  test('a blocked Next / Go to step scrolls to the topmost error and focuses a missing title', () => {
    expect(src).toMatch(/setAttemptedStep\(stepKey\);[\s\S]{0,200}setRevealToken/);
    expect(src).toMatch(/function goToStep[\s\S]{0,300}setRevealToken/);
    expect(src).toContain('measureLayout(content');
    expect(src).toContain('titleInputRef.current?.focus()');
    expect(src).toContain('ref={titleInputRef}');
  });
  test('Next and Publish are the coral primary action, never the category colour', () => {
    expect(src).not.toMatch(/nextButton,\s*selectedStyle/);
  });
});

test('GatheringDetail join button is coral, never the category colour', () => {
  expect(read('screens/GatheringDetailScreen.js')).not.toMatch(/joinButton, \{ backgroundColor: categoryStyle\.color \}/);
});

test('BusinessProfile + CommunityDetail never draw their content under a transparent header', () => {
  for (const nav of ['navigation/RootNavigator.js', 'navigation/BusinessWebNavigator.js']) {
    const src = read(nav);
    for (const name of ['BusinessProfile', 'CommunityDetail']) {
      const line = src.split('\n').find((l) => l.includes(`name="${name}"`));
      if (line) expect(line).not.toContain('headerTransparent: true');
    }
  }
});
