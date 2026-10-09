// Screen-reduction audit B6 (2026-10-09): the five "notes we write together" screens are one TogetherNotes screen.
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

jest.mock('../services/supabase', () => ({ supabase: {} }));
const { TOGETHER_NOTES_KINDS, sectionA11yName } = require('../constants/togetherNotesKinds');

const OLD = ['TripPlanning', 'SharedDecisions', 'TimelinePlanner', 'StressTest', 'RelationshipConstitution'];

test('the old routes and screen files are gone', () => {
  const nav = read('navigation/RootNavigator.js');
  for (const name of OLD) {
    expect(nav).not.toMatch(new RegExp(`name="${name}"`));
    expect(fs.existsSync(path.join(__dirname, `${name}Screen.js`))).toBe(false);
  }
  expect(nav).toMatch(/name="TogetherNotes" component=\{TogetherNotesScreen\}/);
});

test("Chat's Do Something Together menu opens each kind", () => {
  const chat = read('screens/ChatScreen.js');
  for (const kind of Object.keys(TOGETHER_NOTES_KINDS)) {
    expect(chat).toMatch(new RegExp(`navigate\\('TogetherNotes', \\{ kind: '${kind}', matchId`));
  }
  for (const name of OLD) expect(chat).not.toMatch(new RegExp(`navigate\\('${name}'`));
});

test('every kind keeps its own table, services, sections and strings', () => {
  const t = (k, v) => (v ? `${k}|${JSON.stringify(v)}` : k);
  for (const [kind, cfg] of Object.entries(TOGETHER_NOTES_KINDS)) {
    expect(typeof cfg.load).toBe('function');
    expect(typeof cfg.add).toBe('function');
    expect(cfg.sections.length).toBeGreaterThan(1);
    expect(cfg.table).toMatch(/^[a-z_]+$/);
    expect(cfg.navTitleKey).toMatch(/^ui\.nav\.title\./);
    for (const s of cfg.sections) {
      expect(cfg.label(t, s)).toBeTruthy();
      expect(sectionA11yName(cfg, t, s)).toBeTruthy();
    }
    expect(!!(cfg.empty.emptyCopyId || cfg.empty.textKey)).toBe(true);
    expect(kind).toBeTruthy();
  }
  expect(Object.keys(TOGETHER_NOTES_KINDS).sort()).toEqual(['bigpicture', 'constitution', 'stresstest', 'timeline', 'trip']);
});

test('screen readers hear the section without its emoji', () => {
  const t = (k) => ({ 'ui.tripPlanning.section.budget': 'Budget' }[k] ?? k);
  expect(sectionA11yName(TOGETHER_NOTES_KINDS.trip, t, { key: 'budget', icon: '💰' })).toBe('Budget');
  const t2 = () => '🌅 Five years';
  expect(sectionA11yName(TOGETHER_NOTES_KINDS.timeline, t2, { key: 'year_3', labelKey: 'year3' })).toBe('Five years');
});
