// Staged web pages (staged-docs/) are build 88 wording that is NOT live yet. This keeps that visible: every staged page must
// still differ from the published one (once published, delete the staged copy) and be named in staged-docs/README.md.
const fs = require('fs');
const path = require('path');
const { stagedPages } = require('./publishedPage');
const root = path.resolve(__dirname, '..', '..');
const readme = fs.readFileSync(path.join(root, 'staged-docs', 'README.md'), 'utf8');
test.each(stagedPages())('staged %s still waits for publication and is documented', (name) => {
  const staged = fs.readFileSync(path.join(root, 'staged-docs', name), 'utf8');
  const live = fs.readFileSync(path.join(root, 'docs', name), 'utf8');
  expect(staged).not.toBe(live);
  expect(readme).toContain('`' + name + '`');
});
