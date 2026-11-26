// User-content screening calibration (20270373): the set covers every language the database knows, and the pass rule
// never lets a language through on a missed harmful sample, a failed call or the wrong reported language.
const fs = require('fs');
const path = require('path');
const { CALIBRATION_SET, CALIBRATION_LANGUAGES, evaluateCalibration, activationSql } = require('./ugcCalibration');
const { loadClassifier } = require('../../scripts/trust-safety/ugc-calibration');

const MIGRATION = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20270373_user_content_screening.sql'), 'utf8');

const run = (verdictFor, filter = () => true) => CALIBRATION_SET.filter(filter).map((s) => ({
  language: s.language, expect: s.expect, label: s.label, verdict: verdictFor(s),
}));
const perfect = (s) => ({ riskTier: s.expect === 'harmful' ? 'high' : 'low', languages: [s.language] });

describe('calibration set', () => {
  test('covers exactly the languages of private.ugc_language_calibration', () => {
    const seeded = MIGRATION.match(/insert into private\.ugc_language_calibration \(language\)\s*values ([^;]+);/)[1]
      .match(/'([a-z]+)'/g).map((q) => q.slice(1, -1));
    expect([...CALIBRATION_LANGUAGES].sort()).toEqual([...seeded].sort());
  });
  test('every language has benign and harmful samples, all non-empty, no duplicates', () => {
    for (const l of CALIBRATION_LANGUAGES) {
      const mine = CALIBRATION_SET.filter((s) => s.language === l);
      expect(mine.some((s) => s.expect === 'benign')).toBe(true);
      expect(mine.some((s) => s.expect === 'harmful')).toBe(true);
    }
    expect(CALIBRATION_SET.every((s) => typeof s.text === 'string' && s.text.trim())).toBe(true);
    expect(new Set(CALIBRATION_SET.map((s) => s.text)).size).toBe(CALIBRATION_SET.length);
  });
  test('only reserved fictional phone numbers', () => {
    for (const s of CALIBRATION_SET) for (const m of s.text.match(/\d{3}[ -]?\d{3}[ -]?\d{4}/g) || []) {
      expect(m.replace(/\D/g, '')).toMatch(/^5615550[01]\d\d$/);
    }
  });
});

describe('pass rule', () => {
  test('a perfect run passes every language', () => {
    const r = evaluateCalibration(run(perfect));
    expect(Object.values(r).every((x) => x.passed)).toBe(true);
  });
  test('one harmful sample scored low fails that language only', () => {
    const r = evaluateCalibration(run((s) => (s.language === 'ht' && s.label === 'spam_scam' ? { riskTier: 'low', languages: ['ht'] } : perfect(s))));
    expect(r.ht.passed).toBe(false);
    expect(r.ht.reasons.join()).toMatch(/spam_scam/);
    expect(r.en.passed).toBe(true);
  });
  test('a failed call fails the language', () => {
    const r = evaluateCalibration(run((s) => (s.language === 'ko' && s.label === 'flirt' ? null : perfect(s))));
    expect(r.ko.passed).toBe(false);
  });
  test('the wrong reported language fails it (the database would look up another row)', () => {
    const r = evaluateCalibration(run((s) => (s.language === 'tl' ? { ...perfect(s), languages: ['en'] } : perfect(s))));
    expect(r.tl.passed).toBe(false);
  });
  test('names and und never need a language match', () => {
    const r = evaluateCalibration(run((s) => ({ ...perfect(s), languages: ['und'] })));
    expect(r.names.passed).toBe(true);
    expect(r.und.passed).toBe(true);
  });
  test('too many benign holds fail it', () => {
    const r = evaluateCalibration(run((s) => (s.language === 'vi' && s.expect === 'benign' ? { riskTier: 'medium', languages: ['vi'] } : perfect(s))));
    expect(r.vi.passed).toBe(false);
  });
  test('a language with no runs never passes', () => {
    const r = evaluateCalibration(run(perfect, (s) => s.language !== 'ru'));
    expect(r.ru.passed).toBe(false);
  });
  test('activation lists only passing languages and only moves pending rows', () => {
    const r = evaluateCalibration(run((s) => (s.language === 'zh' && s.expect === 'harmful' ? { riskTier: 'low', languages: ['zh'] } : perfect(s))));
    const sql = activationSql(r, "run 'x'");
    expect(sql).not.toMatch(/'zh'/);
    expect(sql).toMatch(/'en'/);
    expect(sql).toMatch(/status = 'pending';/);
    expect(sql).toMatch(/'run ''x'''/);
    expect(activationSql(evaluateCalibration([]), 'x')).toBeNull();
  });
});

describe('runner', () => {
  test('loads the edge classifier itself (same model, same categories as the migration)', () => {
    const c = loadClassifier({});
    expect(typeof c.classifyUserText).toBe('function');
    expect(c.USER_CONTENT_MODEL).toMatch(/^claude-/);
    for (const cat of c.USER_RISK_CATEGORIES) expect(MIGRATION).toContain(`'${cat}'`);
  });
});
