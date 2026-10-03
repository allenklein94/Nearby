// Item 153: the business-request funnel is internal analysis over request_journey only. No new tracking, no client,
// business or edge-function access, cohort by creation week, intent_funnel_summary untouched.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const raw = fs.readFileSync(path.join(root, 'supabase/migrations/20270270_request_funnel_summary.sql'), 'utf8');
const code = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

describe('request funnel (item 153)', () => {
  it('only views, internal only, no new tracking', () => {
    expect(code).toMatch(/create or replace view public\.request_journey as/);
    expect(code).toMatch(/create or replace view public\.request_funnel_summary as/);
    expect(code).toMatch(/revoke all on public\.request_journey from public, anon, authenticated/);
    expect(code).toMatch(/revoke all on public\.request_funnel_summary from public, anon, authenticated/);
    expect(code).not.toMatch(/\bgrant\b/i);
    expect(code).not.toMatch(/create (table|function|or replace function|trigger)|alter table|\binsert into\b|\bupdate public\.|\bdelete from\b/i);
    expect(code).not.toMatch(/intent_funnel/);
  });

  it('keeps every existing request_journey column and only appends', () => {
    const order = ['request_id', 'journey_outcome', 'offers_made', 'first_offer_at', 'request_week'];
    const at = order.map((c) => code.search(new RegExp(`AS ${c}\\b`)));
    at.slice(1).forEach((i, k) => expect(i).toBeGreaterThan(at[k]));
    expect(code.indexOf('r.id AS request_id')).toBeGreaterThan(-1);
  });

  it('cohorts by the request creation week, never a later event', () => {
    expect(code).toMatch(/date_trunc\('week'::text, r\.created_at AT TIME ZONE 'UTC'::text\)::date AS request_week/);
    expect(code).not.toMatch(/interval '(7|30) days'/);
  });

  it('a decline is never an offer received', () => {
    expect(code).toMatch(/o\.responded_at IS NOT NULL AND o\.status <> 'declined'::text/);
  });

  it('is not read by the app or any edge function', () => {
    const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'supabase/functions'))]
      .filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith('.test.js') && !f.endsWith('.journey.js'));
    for (const f of files) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/request_funnel_summary|request_journey/);
  });
});
