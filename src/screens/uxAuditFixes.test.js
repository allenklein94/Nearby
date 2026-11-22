// Guards for the owner-approved UX audit fixes (2026-11-21): keyboard on full screens vs sheets, primary CTAs coral,
// no content under a transparent header, community gatherings open, inline missing-field errors, a11y roles/labels.
const fs = require('fs');
const path = require('path');
const { keyboardOffsetFor } = require('../utils/keyboardOffset');
const { firstFormProblem, formErrorScrollY, FORM_ERROR_SCROLL_CONTEXT } = require('../utils/formErrors');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('keyboard: full screens (header offset)', () => {
  test.each(['BusinessAIAssistant', 'RehearsalRoom', 'AskBusiness', 'CelebrateSomething', 'DateProposal', 'RequestBusinessPartner',
    'Occasions', 'TogetherNotes', 'MemoryVault', 'RelationshipLegacy', 'EditGathering', 'CreateCommunity', 'EditCommunity',
    'CompleteProfile', 'BusinessPartnerApply', 'Profile'])('%s uses KeyboardSafeView', (name) => {
    const src = read(`screens/${name}Screen.js`);
    expect(src).toContain("import KeyboardSafeView from '../components/KeyboardSafeView'");
    expect(src).toContain('<KeyboardSafeView>');
  });
  test.each(['BusinessAIAssistant', 'RehearsalRoom', 'AskBusiness', 'CelebrateSomething', 'DateProposal', 'RequestBusinessPartner',
    'Occasions', 'TogetherNotes', 'MemoryVault', 'RelationshipLegacy'])('%s has no offset-less KeyboardAvoidingView left', (name) => {
    expect(read(`screens/${name}Screen.js`)).not.toMatch(/KeyboardAvoidingView/);
  });
});

describe('keyboard: sheets and Modals (offset 0)', () => {
  test('a sheet never uses a header offset', () => {
    expect(keyboardOffsetFor('ios', 0)).toBe(0);
    const sheet = read('components/KeyboardSafeSheet.js');
    expect(sheet).toContain('keyboardOffsetFor(Platform.OS, 0)');
    expect(sheet).not.toMatch(/HeaderHeightContext/);
  });
  test.each(['components/ReportBlockModal.js', 'components/OfferOutcomeModal.js', 'components/FiltersModal.js',
    'components/DatingPreferencesPromptModal.js', 'screens/CommunityDetailScreen.js'])('%s wraps its Modal content in KeyboardSafeSheet', (p) => {
    const src = read(p);
    expect(src).toMatch(/<KeyboardSafeSheet( style=\{styles\.(overlay|modalOverlay)\})?>/);
    expect(src).not.toMatch(/import KeyboardSafeView/);
  });
});

test('primary CTAs are coral with white text, never the category colour', () => {
  for (const p of ['screens/CreateCommunityScreen.js', 'screens/EditCommunityScreen.js']) {
    expect(read(p)).not.toMatch(/styles\.button, selectedStyle/);
  }
  const attending = read('components/GatheringAttendingSection.js');
  expect(attending).not.toMatch(/growthAction, \{ backgroundColor: categoryStyle\.color \}/);
  expect(attending).not.toMatch(/iAmOnMyWay \? colors\.surface : categoryStyle\.color/);
  expect(attending).toMatch(/growthActionText: \{ color: '#fff'/);
  expect(attending).toMatch(/bigButtonText: \{ color: '#fff'/);
  expect(read('screens/GatheringDetailScreen.js')).toMatch(/joinButtonText: \{ color: '#fff'/);
});

test('no content under a transparent header', () => {
  const line = read('navigation/RootNavigator.js').split('\n').find((l) => l.includes('name="FriendDiscovery"'));
  expect(line).not.toContain('headerTransparent: true');
  const detail = read('screens/GatheringDetailScreen.js');
  expect(detail).toContain('useContext(HeaderHeightContext)');
  expect(detail).toMatch(/<GatheringPublishedPanel\s*topInset=\{transparentHeaderHeight\}/);
  expect(read('components/GatheringPublishedPanel.js')).toContain('paddingTop: topInset + spacing.md');
});

test('community gathering rows open that gathering by id', () => {
  const src = read('screens/CommunityDetailScreen.js');
  expect(src).toMatch(/style=\{styles\.gatheringCard\}\s*onPress=\{\(\) => navigation\.navigate\('GatheringDetail', \{ gatheringId: g\.id \}\)\}/);
  expect(src).not.toMatch(/<View key=\{g\.id\} style=\{styles\.gatheringCard\}>/);
});

describe('inline missing-field errors', () => {
  test('the first problem in form order wins; unknown fields last', () => {
    const order = ['name', 'birthdate', 'photo'];
    expect(firstFormProblem([{ field: 'photo', message: 'p' }, { field: 'name', message: 'n' }], order)).toEqual({ field: 'name', message: 'n' });
    expect(firstFormProblem([{ field: 'x', message: 'x' }, { field: 'photo', message: 'p' }], order).field).toBe('photo');
    expect(firstFormProblem([], order)).toBeNull();
    expect(firstFormProblem([{ field: 'name', message: '' }], order)).toBeNull();
  });
  test('scrolls the field a little below the top, never negative', () => {
    expect(formErrorScrollY(500)).toBe(500 - FORM_ERROR_SCROLL_CONTEXT);
    expect(formErrorScrollY(10)).toBe(0);
    expect(formErrorScrollY(undefined)).toBeNull();
  });
  const forms = {
    EditGathering: ['title', 'when', 'description'],
    CreateCommunity: ['name', 'description'],
    EditCommunity: ['name', 'description'],
    CompleteProfile: ['name', 'birthdate', 'photo', 'terms'],
    BusinessPartnerApply: ['name', 'description'],
    Profile: ['name', 'bio'],
  };
  test.each(Object.entries(forms))('%s shows each problem inline under its field', (name, fields) => {
    const src = read(`screens/${name}Screen.js`);
    expect(src).toContain('useFormErrors(');
    for (const f of fields) {
      expect(src).toContain(`form.show('${f}'`);
      expect(src).toContain(`form.anchor('${f}')`);
      expect(src).toContain(`form.errorFor('${f}')`);
    }
  });
  test('AskBusiness: a blocked Send also explains under the field (item 84 alert + marks kept)', () => {
    const src = read('screens/AskBusinessScreen.js');
    expect(src).toMatch(/form\.show\(missing\.key[^\n]*\n\s*Alert\.alert\(t\(`ui\.askBusiness\.missing\./);
    expect(src).toContain('styles.missingMark');
    for (const k of ['text', 'category', 'day', 'party']) expect(src).toContain(`{missingMark('${k}')}`);
  });
  test('the old alert-only checks are gone', () => {
    expect(read('screens/EditGatheringScreen.js')).not.toMatch(/Alert\.alert\(t\('ui\.gatheringForm\.alert\.titleRequired'\)/);
    expect(read('screens/CreateCommunityScreen.js')).not.toMatch(/Alert\.alert\(t\('ui\.community\.nameRequired'\)/);
    expect(read('screens/CompleteProfileScreen.js')).not.toMatch(/Alert\.alert\(t\('ui\.onboarding\.(nameRequired|birthdateRequired|photoRequired|agreementRequired)'\)/);
    expect(read('screens/BusinessPartnerApplyScreen.js')).not.toMatch(/Alert\.alert\('Business name required'/);
  });
});

test('accessibility: Report/Block buttons and the two switches are announced', () => {
  const report = read('components/ReportBlockModal.js');
  expect(report).toMatch(/onPress=\{submitReport\} disabled=\{submitting\} accessibilityRole="button"/);
  expect(report).toMatch(/onPress=\{blockUser\} accessibilityRole="button"/);
  expect(read('screens/FriendDiscoveryScreen.js')).toMatch(/onValueChange=\{handleDisable\}[^>]*accessibilityLabel=/);
  expect(read('components/BusinessAIAutomationPanel.js')).toMatch(/onValueChange=\{setEnabledInput\}[^>]*accessibilityLabel=/);
});
