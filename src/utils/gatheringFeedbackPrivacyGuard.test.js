// Gathering ratings are private to their writer (owner, 2026-11-09, migration 20270408). The server enforces it (journey
// `gatheringFeedbackPrivacy`, scripts/replay/gathering-feedback-api-local.js); these keep the app and later migrations from drifting back.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return ['node_modules', 'journeys', 'qa'].includes(e.name) ? [] : walk(full);
  return /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [full] : [];
});

describe('"What people loved"', () => {
  it('no screen, service or string shows it', () => {
    ['src/screens/GatheringDetailScreen.js', 'src/screens/BusinessProfileScreen.js', 'src/services/gatherings.js'].forEach((f) => {
      expect(read(f)).not.toMatch(/[Ll]ovedTags|GREAT_BECAUSE_LABELS|lovedList|whatPeopleLoved|whatPeopleSay/);
    });
    ['src/i18n/ui/gatheringDetail.js', 'src/i18n/ui/businessProfile.js', 'scripts/i18n/strings/businessProfile.json'].forEach((f) => {
      expect(read(f)).not.toMatch(/lovedList|whatPeopleLoved|whatPeopleSay|\bloved: \{|v\.loved\./);
    });
  });

  it('the person can still say what made it great: that feedback stays private', () => {
    expect(read('src/components/GatheringFeedbackInline.js')).toMatch(/GREAT_BECAUSE_OPTIONS/);
    expect(read('src/services/gatherings.js')).toMatch(/great_because: greatBecause/);
  });
});

describe('the app reads gathering_feedback only for the signed-in person', () => {
  const files = walk(path.join(ROOT, 'src'));
  const uses = files.flatMap((f) => {
    const text = fs.readFileSync(f, 'utf8');
    return [...text.matchAll(/\.from\('gathering_feedback'\)([\s\S]*?);/g)].map((m) => ({ f: path.relative(ROOT, f), chain: m[1] }));
  });

  it('there are exactly the three own-row uses: save, unrated, have I rated', () => {
    expect(uses).toHaveLength(3);
  });

  it.each([0, 1, 2])('use %i is scoped to the person', (i) => {
    expect(uses[i].chain).toMatch(/\.eq\('reviewer_id', myId\)|reviewer_id: myId/);
  });

  it('no edge function reads the table', () => {
    const fnDir = path.join(ROOT, 'supabase/functions');
    const hits = fs.readdirSync(fnDir, { recursive: true }).filter((p) => /\.ts$/.test(p))
      .filter((p) => /gathering_feedback/.test(fs.readFileSync(path.join(fnDir, p), 'utf8')));
    expect(hits).toEqual([]);
  });
});

describe('the database rule', () => {
  const mig = read('supabase/migrations/20270408_gathering_feedback_private.sql');

  it('is a row rule on the writer, never a column grant (builds up to 87 save with upsert, which needs column SELECT)', () => {
    expect(mig).toMatch(/drop policy if exists "Anyone can view feedback"/);
    expect(mig).toMatch(/using \(reviewer_id = auth\.uid\(\)\)/);
    expect(mig).not.toMatch(/^\s*(revoke|grant)\s+select\s*\(/im);
    expect(mig).toMatch(/revoke select on public\.gathering_feedback from anon/);
  });

  it('adds no replacement function or view that could re-expose ratings', () => {
    expect(mig).not.toMatch(/create\s+(or\s+replace\s+)?(function|view)/i);
  });

  it('no later migration reopens the table', () => {
    const dir = path.join(ROOT, 'supabase/migrations');
    fs.readdirSync(dir).filter((n) => n > '20270408_').forEach((n) => {
      const s = fs.readFileSync(path.join(dir, n), 'utf8');
      expect(s.match(/on public\.gathering_feedback[\s\S]{0,120}using \(true\)/)).toBeNull();
    });
  });
});
