// Owner task 9 (2026-11-27): every edge function has a deployment + recovery row in the release inventory.
// (Migrations: rollback file + packet row are checked in releaseGates.test.js.)
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const DOC = fs.readFileSync(path.join(REPO, 'PRODUCT_AUDIT/RELEASE_INVENTORY_2026-11-27.md'), 'utf8');
const fns = fs.readdirSync(path.join(REPO, 'supabase/functions'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name);

test.each(fns)('edge function %s has an inventory row', (f) => {
  const rows = DOC.split('\n').filter((l) => l.startsWith('| ') && l.split('|')[1].split(',').map((x) => x.trim()).includes(f));
  expect(rows).toHaveLength(1);
});
