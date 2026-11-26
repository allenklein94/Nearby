// The wording a web page WILL be published with: staged-docs/<name> while it waits for its publish approval, else docs/<name>.
// See staged-docs/README.md. Never point a test at docs/ directly for a page that has a staged copy.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
function pageToPublish(name) {
  const staged = path.join(root, 'staged-docs', name);
  return fs.readFileSync(fs.existsSync(staged) ? staged : path.join(root, 'docs', name), 'utf8');
}
function stagedPages() {
  const dir = path.join(root, 'staged-docs');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.html')) : [];
}
module.exports = { pageToPublish, stagedPages };
