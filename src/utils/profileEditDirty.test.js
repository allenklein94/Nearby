// Item 35 follow-up (owner, 2026-10-08): Back from Edit Profile with no changes returns at once; with changes it asks
// "Discard changes" / "Keep editing". Same guard wherever Edit Profile was opened from.
const fs = require('fs');
const path = require('path');
const { profileFormSnapshot, isProfileFormDirty, guardProfileLeave } = require('./profileEditDirty');

const LOADED = {
  displayName: 'Sam', bio: 'Coffee person', interests: ['Coffee', 'Hiking'], cuisinePreferences: ['italian'], venuePreferences: [],
  pronouns: '', gender: '', sexualOrientation: '', genderIdentity: [], interestedInGenders: [], myEthnicity: null,
  heightFeet: '5', heightInchesVal: '10', basics: { work: 'Nurse' }, prompts: [{ question: 'Q1', answer: 'A1' }], connectionGoal: 'Date',
};
const base = profileFormSnapshot(LOADED);
const dirty = (patch) => isProfileFormDirty(base, profileFormSnapshot({ ...LOADED, ...patch }));

describe('is the form dirty?', () => {
  test('clean: untouched, or changed and changed back', () => {
    expect(dirty({})).toBe(false);
    expect(dirty({ interests: ['Hiking', 'Coffee'] })).toBe(false); // toggled off and on again: same set
    expect(dirty({ basics: { work: 'Nurse', school: '' } })).toBe(false); // a basics answer typed then cleared
  });
  test('dirty: any field Save writes', () => {
    for (const patch of [
      { displayName: 'Sammy' }, { bio: '' }, { interests: ['Coffee'] }, { cuisinePreferences: [] }, { venuePreferences: ['quiet'] },
      { pronouns: 'they/them' }, { genderIdentity: ['Woman'] }, { myEthnicity: 'Asian' }, { heightInchesVal: '11' },
      { basics: { work: 'Doctor' } }, { prompts: [] }, { prompts: [{ question: 'Q1', answer: 'A2' }] }, { connectionGoal: '' },
    ]) expect({ patch, dirty: dirty(patch) }).toEqual({ patch, dirty: true });
  });
  test('prompt order matters (it is shown in that order)', () => {
    const two = { ...LOADED, prompts: [{ question: 'Q1', answer: 'A1' }, { question: 'Q2', answer: 'A2' }] };
    expect(isProfileFormDirty(profileFormSnapshot(two), profileFormSnapshot({ ...two, prompts: [...two.prompts].reverse() }))).toBe(true);
  });
  test('before the profile has loaded nothing counts as dirty', () => {
    expect(isProfileFormDirty(null, profileFormSnapshot({ displayName: 'x' }))).toBe(false);
  });
});

function attempt({ dirty: isDirty, allowLeave = false }) {
  const event = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
  const proceed = jest.fn();
  let buttons = null;
  const result = guardProfileLeave({ dirty: isDirty, allowLeave, event, proceed, confirm: (b) => { buttons = b; } });
  return { result, event, proceed, buttons };
}

describe('leaving Edit Profile', () => {
  test('clean state: Back returns immediately, no prompt', () => {
    const a = attempt({ dirty: false });
    expect(a.result).toBe('left');
    expect(a.event.preventDefault).not.toHaveBeenCalled();
    expect(a.buttons).toBeNull();
  });
  test('dirty state: Back is held and the prompt offers Keep editing / Discard changes', () => {
    const a = attempt({ dirty: true });
    expect(a.result).toBe('asked');
    expect(a.event.preventDefault).toHaveBeenCalledTimes(1);
    expect(Object.keys(a.buttons).sort()).toEqual(['onDiscard', 'onKeepEditing']);
  });
  test('Keep editing stays on the screen with every change intact (nothing navigates)', () => {
    const a = attempt({ dirty: true });
    a.buttons.onKeepEditing();
    expect(a.proceed).not.toHaveBeenCalled();
  });
  test('Discard changes continues the original Back, to whatever screen opened Edit Profile', () => {
    const a = attempt({ dirty: true });
    a.buttons.onDiscard();
    expect(a.proceed).toHaveBeenCalledWith({ type: 'GO_BACK' });
  });
  test('right after Save, leaving never asks (Save is unchanged: saves and returns)', () => {
    const a = attempt({ dirty: true, allowLeave: true });
    expect(a.result).toBe('left');
    expect(a.event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('wiring in ProfileScreen (edit mode, every entry point)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../screens/ProfileScreen.js'), 'utf8');
  test('one beforeRemove guard, registered only in edit mode, independent of where the screen was opened from', () => {
    expect(src.match(/addListener\('beforeRemove'/g)).toHaveLength(1);
    expect(src).toMatch(/if \(!editing \|\| !navigation\?\.addListener\) return undefined;/);
    expect(src).not.toMatch(/route\?\.params\?\.(from|origin)/);
  });
  test('the prompt buttons are Keep editing (cancel) and Discard changes (destructive), in 11 languages', () => {
    expect(src).toMatch(/t\('ui\.profile\.keepEditing'\), style: 'cancel'/);
    expect(src).toMatch(/t\('ui\.profile\.discardChanges'\), style: 'destructive'/);
    const strings = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/i18n/strings/profile.json'), 'utf8'));
    expect(Object.keys(strings)).toHaveLength(11);
    for (const v of Object.values(strings)) for (const k of ['discardTitle', 'discardBody', 'discardChanges', 'keepEditing']) expect(typeof v[k]).toBe('string');
    expect(strings.en.discardChanges).toBe('Discard changes');
    expect(strings.en.keepEditing).toBe('Keep editing');
  });
  test('Save resets the baseline and lets the return through; photo actions never reset typed fields', () => {
    expect(src).toMatch(/baselineRef\.current = currentSnapshot;\n    if \(editing && navigation\.canGoBack\?\.\(\)\) \{\n      allowLeaveRef\.current = true;\n      navigation\.goBack\(\);/);
    const photoFns = src.slice(src.indexOf('async function changePhoto'), src.indexOf('const usedQuestions'));
    expect(photoFns).not.toMatch(/\bload\(\)/);
    expect(photoFns.match(/reloadPhotos\(\)/g).length).toBeGreaterThanOrEqual(4);
  });
});
