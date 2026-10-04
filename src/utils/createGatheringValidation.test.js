import fs from 'fs';
import path from 'path';
import { stepProblems, publishProblems } from './createGatheringValidation';

const NOW = new Date(2026, 9, 4, 12).getTime();
const valid = {
  now: NOW, title: 'Coffee with friends', interestTag: 'Coffee', whenPreset: 'tonight', scheduledAt: new Date(NOW + 3600e3),
  locationMode: 'near_me', customLocation: null, recurrenceRule: null, priceLevel: null, durationMinutes: null, format: null,
  effortLevel: null, genre: null, partyType: null, features: [], ageMin: null, ageMax: null, visibility: 'everyone',
  communityId: null, capacity: null, hasCommunities: true,
};
const fields = (list) => list.map((p) => p.field);

describe('step validation: only what is needed to leave the step', () => {
  test('a valid form passes every step and the publish check', () => {
    for (const k of ['what', 'whenWhere', 'who', 'business', 'publish']) expect(stepProblems(k, valid)).toEqual([]);
    expect(publishProblems(valid)).toEqual([]);
  });
  test('What: title, then a real activity', () => {
    expect(fields(stepProblems('what', { ...valid, title: '  ' }))).toEqual(['title']);
    expect(fields(stepProblems('what', { ...valid, interestTag: null }))).toEqual(['activity']);
    expect(fields(stepProblems('what', { ...valid, interestTag: 'Not A Tag' }))).toEqual(['activity']);
  });
  test('When: a chosen time in the future; an invalid date blocks', () => {
    expect(fields(stepProblems('whenWhere', { ...valid, whenPreset: null }))).toEqual(['time']);
    expect(fields(stepProblems('whenWhere', { ...valid, scheduledAt: new Date(NOW - 1) }))).toEqual(['time']);
    expect(fields(stepProblems('whenWhere', { ...valid, scheduledAt: new Date('nope') }))).toEqual(['time']);
  });
  test('Where: a place only when "choose a place" was picked; near me needs nothing', () => {
    expect(fields(stepProblems('whenWhere', { ...valid, locationMode: 'choose_place' }))).toEqual(['place']);
    expect(stepProblems('whenWhere', { ...valid, locationMode: 'choose_place', customLocation: { lat: 1, lng: 2 } })).toEqual([]);
  });
  test('Details: empty optional fields never block; only an out-of-list value does', () => {
    expect(stepProblems('what', valid)).toEqual([]);
    expect(stepProblems('what', { ...valid, recurrenceRule: 'weekly', priceLevel: '$$', durationMinutes: 60, format: 'class', features: ['quiet'], ageMin: 3, ageMax: 8, partyType: 'friends' })).toEqual([]);
    expect(fields(stepProblems('what', { ...valid, recurrenceRule: 'daily' }))).toEqual(['repeats']);
    expect(fields(stepProblems('what', { ...valid, priceLevel: '$$$$' }))).toEqual(['price']);
    expect(fields(stepProblems('what', { ...valid, features: ['made_up'] }))).toEqual(['features']);
    expect(fields(stepProblems('what', { ...valid, ageMin: 9, ageMax: 4 }))).toEqual(['ages']);
    // genre is only a field for music categories
    expect(stepProblems('what', { ...valid, genre: 'polka' })).toEqual([]);
    expect(fields(stepProblems('what', { ...valid, interestTag: 'Live Music', genre: 'polka' }))).toEqual(['genre']);
  });
  test('Settings: community needs a pick; capacity, when set, is a whole number >= 1; nothing is inferred', () => {
    expect(fields(stepProblems('who', { ...valid, visibility: 'community' }))).toEqual(['community']);
    expect(stepProblems('who', { ...valid, visibility: 'community', hasCommunities: false })[0].code).toBe('noCommunities');
    expect(fields(stepProblems('who', { ...valid, capacity: 0 }))).toEqual(['capacity']);
    expect(stepProblems('who', { ...valid, capacity: 1 })).toEqual([]);
    expect(stepProblems('who', { ...valid, capacity: null })).toEqual([]);
    expect(stepProblems('who', { ...valid, womenOnly: true, requiresApproval: true })).toEqual([]);
  });
  test('the business connection step is optional', () => { expect(stepProblems('business', valid)).toEqual([]); expect(stepProblems('business', { ...valid, askLocalBusinesses: false })).toEqual([]); });
});

describe('publish check re-runs everything', () => {
  test('collects problems from every step, in step order, each tagged with its step', () => {
    const p = publishProblems({ ...valid, title: '', whenPreset: null, visibility: 'community' });
    expect(p.map((x) => `${x.step}.${x.field}`)).toEqual(['what.title', 'whenWhere.time', 'who.community']);
  });
  test('a skipped What step is still checked', () => {
    expect(fields(publishProblems({ ...valid, interestTag: null }, ['whenWhere', 'who', 'business']))).toEqual(['activity']);
  });
  test('time that passed while the person sat on Review blocks Publish', () => {
    expect(fields(publishProblems({ ...valid, now: NOW + 7200e3 }))).toEqual(['time']);
  });
});

describe('five grouped steps, not a field per screen', () => {
  const src = fs.readFileSync(path.join(__dirname, '../screens/CreateGatheringScreen.js'), 'utf8');
  const defs = src.slice(src.indexOf('const STEP_DEFS = ['), src.indexOf('];', src.indexOf('const STEP_DEFS = [')));
  test('What -> When & where -> Who -> Business -> Review, always five', () => {
    expect([...defs.matchAll(/key: '(\w+)'/g)].map((m) => m[1])).toEqual(['what', 'whenWhere', 'who', 'business', 'publish']);
    expect(defs).not.toMatch(/filter|\.\.\./);
  });
  test('each step renders its grouped fields', () => {
    expect(src).toMatch(/stepKey === 'whenWhere' && \(\s*<>\s*<Text style=\{styles\.label\}>\{t\('ui\.gatheringForm\.whenQ'\)\}/);
    expect(src).toMatch(/stepKey === 'whenWhere' && \(\s*<>\s*<Text style=\{styles\.label\}>\{t\('ui\.gatheringForm\.whereQ'\)\}/);
    expect(src).toMatch(/stepKey === 'who' && askInvite && \(/); // the friend picker still appears only when the ask said who (item 109)
    expect(src).toMatch(/stepKey === 'business' && \(\s*<>\s*<Text[^>]*>\{t\('ui\.gatheringForm\.businessRequests'\)\}/);
  });
});

describe('screen wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../screens/CreateGatheringScreen.js'), 'utf8');
  const goNext = src.slice(src.indexOf('function goNext()'), src.indexOf('function goBack()'));
  test('Next shows inline errors, never an alert, and never moves forward on a problem', () => {
    expect(goNext).not.toMatch(/Alert\.alert/);
    expect(goNext).toMatch(/stepProblems\(stepKey, validationForm\)\.length > 0\)\s*{\s*setAttemptedStep/);
  });
  test('Publish is disabled while the full check fails, and submit re-runs it first', () => {
    expect(src).toMatch(/disabled=\{submitting \|\| finalProblems\.length > 0\}/);
    const submit = src.slice(src.indexOf('async function submit()'));
    expect(submit.indexOf('publishProblems(')).toBeLessThan(submit.indexOf('createGathering('));
  });
  test('the only step change from the Publish check is the person tapping "Go to"', () => {
    expect(src).toMatch(/onPress=\{\(\) => goToStep\(p\.step\)\}/);
  });
});
