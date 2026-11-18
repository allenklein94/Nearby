// Guard: every public web address comes from src/constants/webAddresses.js (one source).
const fs = require('fs');
const path = require('path');
const { SITE_BASE, PRIVACY_URL, TERMS_URL, BUSINESS_WEB_BASE } = require('./webAddresses');

const ROOT = path.join(__dirname, '..', '..');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.(js|ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

test('the addresses are on thisisnearby.com', () => {
  expect(SITE_BASE).toBe('https://thisisnearby.com');
  expect(PRIVACY_URL).toBe('https://thisisnearby.com/privacy.html');
  expect(TERMS_URL).toBe('https://thisisnearby.com/terms.html');
  expect(BUSINESS_WEB_BASE).toBe('https://thisisnearby.com/business/');
});

test('no app or edge-function source hard-codes the old GitHub Pages address', () => {
  const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'supabase', 'functions'))]
    .filter((f) => !f.endsWith(path.join('constants', 'webAddresses.js')));
  const hits = files.filter((f) => /allenklein94\.github\.io/.test(fs.readFileSync(f, 'utf8')));
  expect(hits.map((f) => path.relative(ROOT, f))).toEqual([]);
});

test('the Pages custom domain, app config and legal contact agree', () => {
  expect(fs.readFileSync(path.join(ROOT, 'docs', 'CNAME'), 'utf8').trim()).toBe('thisisnearby.com');
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  expect(appJson.expo.extra.turnstileHost).toBe(SITE_BASE);
  for (const page of ['privacy.html', 'terms.html']) {
    const html = fs.readFileSync(path.join(ROOT, 'docs', page), 'utf8');
    expect(html).not.toMatch(/@gmail\.com/);
    expect(html).toMatch(/support@thisisnearby\.com/);
  }
});
