// Every staged migration has a rollback file and a post-deploy plan whose journeys and live tests exist.
const fs = require('fs');
const path = require('path');
const { STEPS, OTHERS, plan } = require('./post-deploy');

const ROOT = path.resolve(__dirname, '../..');
const staged = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).map((f) => Number(f.slice(0, 8)))
  .filter((v) => v >= 20270348 && v <= 20279999);

test('every staged migration (0348 onward) has a rollback file and a post-deploy step', () => {
  expect(staged.length).toBeGreaterThanOrEqual(19);
  staged.forEach((v) => {
    expect(STEPS[v]).toBeDefined();
    expect(plan().find((p) => p.version === v).rollback).toMatch(new RegExp(`^${v}_.*\\.rollback\\.sql$`));
  });
});

test('every journey, live test and SQL check named exists', () => {
  plan().forEach((p) => {
    p.journeys.forEach((j) => expect(fs.existsSync(path.join(ROOT, `src/journeys/${j}.journey.js`))).toBe(true));
    (p.live || []).forEach((l) => expect(fs.existsSync(path.join(ROOT, `src/qa/${l.split(' ')[0]}`))).toBe(true));
    (p.sql || []).forEach((s) => expect(fs.existsSync(path.join(ROOT, `scripts/live-verify/${s.split(' ')[0]}`))).toBe(true));
  });
});

test('edge functions and Auth settings staged alongside each have a rollback and a check', () => {
  ['review-login', 'report-presence', 'moderate-photo', 'b5-auth-settings', 'captcha-settings'].forEach((k) => {
    expect(OTHERS[k].rollback).toBeTruthy();
    expect(OTHERS[k].check).toBeTruthy();
  });
});
