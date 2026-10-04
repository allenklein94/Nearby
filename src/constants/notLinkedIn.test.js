// Item 184 (owner, 2026-10-03, LOCKED): Nearby finds nearby business-related places, services and events; it is not a
// professional social network. No professional people search, connection graph, employer / résumé / skills / endorsement
// fields, job listings or applications, and the optional Job Title basic is never searched, matched, ranked, learned from
// or exposed as a discovery signal. Career Events and Networking are ordinary gatherings.
const fs = require('fs');
const path = require('path');
const { generateCompatibilityReport, NEVER_COMPARED_BASICS } = require('../services/compatibility');

const ROOT = path.join(__dirname, '../..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const sources = [
  ...walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')),
  ...walk(path.join(ROOT, 'supabase/migrations')),
  ...walk(path.join(ROOT, 'supabase/functions')).filter((f) => /\.(ts|js)$/.test(f)),
];
const rel = (f) => path.relative(ROOT, f);

describe('Nearby is not LinkedIn', () => {
  it('Job Title is read only where it is declared, labeled and explicitly excluded from comparison', () => {
    const readers = sources.filter((f) => fs.readFileSync(f, 'utf8').includes('job_title')).map(rel).sort();
    expect(readers).toEqual(['src/constants/basicsFields.js', 'src/i18n/ui/basicsVocab.js', 'src/services/compatibility.js']);
    expect(NEVER_COMPARED_BASICS).toContain('job_title');
  });

  it('the same job title never makes two people more compatible', () => {
    const me = { interests: ['Coffee'], basics: { job_title: 'Software Engineer', drinking: 'Socially' } };
    const same = { interests: ['Coffee'], basics: { job_title: 'Software Engineer', drinking: 'Socially' } };
    const other = { interests: ['Coffee'], basics: { job_title: 'Nurse', drinking: 'Socially' } };
    const a = generateCompatibilityReport(me, same);
    const b = generateCompatibilityReport(me, other);
    expect(a.score).toBe(b.score);
    expect([...a.matchingFields, ...a.differingFields, ...b.differingFields].some((f) => f.key === 'job_title')).toBe(false);
  });

  it('no professional-network fields or objects exist', () => {
    const banned = /\b(employer|endorsements?|resume_url|job_listings?|job_applications?|linkedin_url)\b/i;
    const hits = sources.filter((f) => banned.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(hits).toEqual([]);
  });
});
