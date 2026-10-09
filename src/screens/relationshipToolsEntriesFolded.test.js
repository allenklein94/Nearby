// Screen-reduction audit B9 (owner, 2026-10-09): keep all seven private relationship tools; fold an entry screen into its list
// where it only edits. The chemistry diary and goodbye archive "add" screens are now composers IN PLACE on their lists; the
// other five stay their own destinations (a distinct workspace or reading content), reachable from Settings.
const fs = require('fs');
const path = require('path');
const { RULE14_DECISIONS, SCREEN_REGISTRY } = require('../constants/screenRegistry');

const SRC = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? walk(path.join(d, e.name)) : (e.name.endsWith('.js') && !e.name.includes('.test.') ? [path.join(d, e.name)] : [])));

describe('relationship tools: entry screens folded, tools kept', () => {
  test('the two entry screens are gone and recorded as folded', () => {
    for (const r of ['ChemistryDiaryEntry', 'GoodbyeArchiveEntry']) {
      expect(fs.existsSync(path.join(__dirname, `${r}Screen.js`))).toBe(false);
      expect(RULE14_DECISIONS.folded[r]).toMatch(/IN PLACE/);
    }
    const offenders = walk(SRC).filter((f) => /navigate\(\s*'(ChemistryDiaryEntry|GoodbyeArchiveEntry)'|name="(ChemistryDiaryEntry|GoodbyeArchiveEntry)"/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  test('all seven tools still exist, are registered and stay reachable from Settings (no new tab)', () => {
    const tools = { rehearsal: 'RehearsalRoom', chemistry: 'ChemistryDiaryList', goodbye: 'GoodbyeArchiveList', legacy: 'LegacyLibrary', kit: 'RelationshipEmergencyKit' };
    const settings = read('screens/SettingsScreen.js');
    for (const [key, route] of Object.entries(tools)) {
      expect(SCREEN_REGISTRY[route]).toBeTruthy();
      expect(settings).toContain(`{ key: '${key}', icon:`);
      expect(settings).toContain(`route: '${route}' }`);
    }
  });
  test('each list adds in place: the composer replaces the add button, no name modal, no second screen', () => {
    for (const [list, comp] of [['ChemistryDiaryList', 'ChemistryEntryComposer'], ['GoodbyeArchiveList', 'GoodbyeEntryComposer']]) {
      const src = read(`screens/${list}Screen.js`);
      expect(src).toContain(`{composer ? (\n          <${comp}`);
      expect(src).not.toMatch(/<Modal|nameModalVisible|navigate\(/);
      expect(src).toMatch(/if \(route\?\.params\?\.returnAfterSave && navigation\.canGoBack\(\)\) \{ navigation\.goBack\(\); return; \}/);
    }
    // the composers keep the old screens' moderation and private save
    expect(read('components/ChemistryEntryComposer.js')).toMatch(/checkTextModeration\(noteText\)[\s\S]*submitChemistryEntry\(name\.trim\(\), signals, noteText\)/);
    expect(read('components/GoodbyeEntryComposer.js')).toMatch(/checkTextModeration\(field\)[\s\S]*submitGoodbyeEntry\(name\.trim\(\), answers\)/);
  });
  test('chat and profile open the list with the person named, and saving returns there', () => {
    expect(read('screens/ChatScreen.js')).toContain("navigation.navigate('ChemistryDiaryList', { composeFor: otherUser?.display_name ?? '', returnAfterSave: true })");
    expect(read('screens/ChatScreen.js')).toContain("navigation.navigate('GoodbyeArchiveList', { composeFor: otherPersonName ?? '', returnAfterSave: true })");
    expect(read('screens/ViewProfileScreen.js')).toContain("navigation.navigate('ChemistryDiaryList', { composeFor: profile.display_name ?? '', returnAfterSave: true })");
  });
});
