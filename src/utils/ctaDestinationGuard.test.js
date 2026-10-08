import fs from 'fs';
import path from 'path';

// Rule 7, form 4: a button's label predicts where it goes. The day-of buttons (once the separate Gathering Hub, now the
// attending section on GatheringDetail) open the group chat; the old "Details" button (and the even older "Questions") is
// gone because the section IS on the detail screen, so nothing there navigates to GatheringDetail itself.
test('the attending section\'s during-event buttons name their real destinations', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'GatheringAttendingSection.js'), 'utf8');
  expect(src).not.toMatch(/❓ Questions/);
  expect(src).not.toMatch(/navigate\('GatheringDetail'/);
  expect(src).toContain("t('ui.gatheringHub.sayHi')");
  expect(src).toContain("t('ui.gatheringHub.photos')");
  const en = require('../i18n/ui/gatheringHub').default.en;
  expect(en.details).toBeUndefined();
  expect(Object.values(en).join(' ')).not.toMatch(/Questions/);
});
