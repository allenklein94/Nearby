// Item 154: gathering social conversion is internal analysis over existing records only. Gatherings only, views only,
// no client/business/edge-function access, cohort by the gathering's creation week, no person ids exposed.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const raw = fs.readFileSync(path.join(root, 'supabase/migrations/20270271_gathering_social_conversion.sql'), 'utf8');
const code = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const VIEWS = ['gathering_social_people', 'gathering_social_conversion', 'gathering_social_conversion_summary'];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

describe('gathering social conversion (item 154)', () => {
  it('only views, internal only, no behavior change', () => {
    for (const v of VIEWS) {
      expect(code).toMatch(new RegExp(`create or replace view public\\.${v} as`));
      expect(code).toMatch(new RegExp(`revoke all on public\\.${v} from public, anon, authenticated`));
    }
    expect(code).not.toMatch(/\bgrant\b/i);
    expect(code).not.toMatch(/create (table|function|or replace function|trigger)|alter table|\binsert into\b|\bupdate public\.|\bdelete from\b/i);
  });

  it('gatherings only: never group plans or occasion plans', () => {
    expect(code).not.toMatch(/group_plan|occasion/);
    expect(code).toMatch(/si\.invite_type = 'gathering'/);
  });

  it('cohorts by the gathering creation week, never a later event, no rolling windows', () => {
    expect(code.match(/date_trunc\('week', g\.created_at at time zone 'UTC'\)::date as gathering_week/g)).toHaveLength(2);
    expect(code).not.toMatch(/interval '\d+ days'|now\(\)/);
  });

  it('friend joined = current accepted friend whose request came before the join', () => {
    expect(code).toMatch(/coalesce\(p\.joined_at is not null and hf\.created_at < p\.joined_at, false\) as friend_joined/);
    expect(code).toMatch(/f\.status = 'accepted'/);
  });

  it('invitation denominator = unique recipients first invited before joining, never the host', () => {
    expect(code).toMatch(/group by si\.target_id, si\.invitee_id/);
    expect(code).toMatch(/si\.invitee_id <> g\.host_id/);
    expect(code).toMatch(/\(p\.first_invited_at is not null and \(p\.joined_at is null or p\.first_invited_at < p\.joined_at\)\) as invited_recipient/);
    expect(code).toMatch(/gi\.status = 'approved'/);
  });

  it('became friends after = requested after the start and after both joined', () => {
    expect(code).toMatch(/f\.created_at > greatest\(g\.scheduled_at, a\.joined_at, b\.joined_at\)/);
  });

  it('empty denominators give NULL rates', () => {
    expect(code).toMatch(/nullif\(sum\(attendees\), 0\)/);
    expect(code).toMatch(/nullif\(sum\(invited_recipients\), 0\)/);
  });

  it('is not read by the app or any edge function', () => {
    const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'supabase/functions'))]
      .filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith('.test.js') && !f.endsWith('.journey.js'));
    for (const f of files) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/gathering_social_(people|conversion)/);
  });
});
