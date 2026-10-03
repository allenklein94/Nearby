// Item 126: the intent funnel is analysis only. Two read-only views over existing records, internal (no client or business
// grant), nothing new tracked, and nothing in the app or an edge function reads or writes them.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const MIGRATION = fs.readFileSync(path.join(root, 'supabase/migrations/20270249_intent_funnel.sql'), 'utf8');
const code = MIGRATION.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

describe('intent funnel (item 126)', () => {
  it('creates only the two views and keeps them internal', () => {
    expect(code).toMatch(/create or replace view public\.intent_funnel as/);
    expect(code).toMatch(/create or replace view public\.intent_funnel_summary as/);
    expect(code).toMatch(/revoke all on public\.intent_funnel from public, anon, authenticated/);
    expect(code).toMatch(/revoke all on public\.intent_funnel_summary from public, anon, authenticated/);
    expect(code).not.toMatch(/\bgrant\b/i);
    // no new tracking: no table, column, function, trigger, insert/update/delete
    expect(code).not.toMatch(/create (table|function|or replace function|trigger)|alter table|\binsert into\b|\bupdate public\.|\bdelete from\b/i);
  });

  it('carries no person identity, words or full interpretation', () => {
    const selectList = code.split(/\nfrom asks a/)[0].split(/\)\s*\nselect\n/)[1];
    expect(selectList).toBeDefined();
    expect(selectList).not.toMatch(/\bas user_id\b|a\.user_id,|raw_text|a\.interpretation,|requester_id,/);
  });

  it('is not read or written by the app or any edge function', () => {
    const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'supabase/functions'))]
      .filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith('.test.js') && !f.endsWith('.journey.js'));
    for (const f of files) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/(^|[^a-z_])intent_funnel(_summary)?\b/);
  });

  it('keeps Interested-before-join history private and read only by the funnel (follow-up, 20270250)', () => {
    const dir = path.join(root, 'supabase/migrations');
    const follow = fs.readFileSync(path.join(dir, '20270250_interested_to_attending.sql'), 'utf8');
    expect(follow).toMatch(/alter table public\.gathering_interested_joins enable row level security/);
    expect(follow).toMatch(/revoke all on public\.gathering_interested_joins from public, anon, authenticated/);
    expect(follow).not.toMatch(/\bgrant\b/i);
    // joining still clears the current Interested mark
    expect(follow).toMatch(/delete from gathering_interested where gathering_id = new\.gathering_id and user_id = new\.user_id/);
    // no other migration, app file or edge function touches the history table
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql') && x !== '20270250_interested_to_attending.sql')) {
      expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/gathering_interested_joins/);
    }
    const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'supabase/functions'))]
      .filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith('.test.js') && !f.endsWith('.journey.js'));
    for (const f of files) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/gathering_interested_joins/);
  });

  it('reports drop-off as a count before the next stage, never a fraction (20270269)', () => {
    const dir = path.join(root, 'supabase/migrations');
    const mig = fs.readFileSync(path.join(dir, '20270269_intent_funnel_drop_off_counts.sql'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(mig).not.toMatch(/\b\w+_drop_off\b(?!_)/);         // the old fraction columns are gone
    expect(mig).not.toMatch(/1\s*-\s*\w+::numeric/);           // no 1 - rate anywhere
    expect(mig).toMatch(/shown - viewed as drop_off_before_viewed/);
    expect(mig).toMatch(/reached - lead\(reached\) over w as drop_off_before_next_stage/);
    expect(mig).toMatch(/revoke all on public\.intent_funnel_summary from public, anon, authenticated/);
    expect(mig).toMatch(/revoke all on public\.intent_funnel_stages from public, anon, authenticated/);
    expect(mig).not.toMatch(/\bgrant\b/i);
    for (const f of walk(path.join(root, 'src')).filter((x) => /\.(js|ts)$/.test(x) && !x.endsWith('.test.js') && !x.endsWith('.journey.js'))) {
      expect(fs.readFileSync(f, 'utf8')).not.toMatch(/intent_funnel_stages/);
    }
  });
});
