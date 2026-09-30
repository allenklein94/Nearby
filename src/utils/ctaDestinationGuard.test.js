import fs from 'fs';
import path from 'path';

// Rule 7, form 4: a button's label predicts where it goes. The Gathering Hub's
// "Questions" button opened GatheringDetail, which has no questions surface;
// it is now labelled "Details".
test('Gathering Hub during-event buttons name their real destinations', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'screens', 'GatheringHubScreen.js'), 'utf8');
  expect(src).not.toMatch(/❓ Questions/);
  expect(src).toContain("t('ui.gatheringHub.details')");
  const en = require('../i18n/ui/gatheringHub').default.en;
  expect(en.details).toBe('ℹ️ Details');
  expect(Object.values(en).join(' ')).not.toMatch(/Questions/);
});
