const fs = require('fs');
const path = require('path');

// Idea 356 (owner, 2026-10-23): Interested marks reach a business's anonymous demand figures ONLY for people who turned the
// Settings switch on. A missing or default value is OFF everywhere: the column default, the one server reader (latest
// definition across all migrations), the client reads, and the first-Interested explanation never turns sharing on.
const root = path.join(__dirname, '../..');
const dir = path.join(root, 'supabase/migrations');
const files = fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function latestDefinition(name) {
  let found = null;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const re = /create or replace function\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi;
    const starts = [...sql.matchAll(re)];
    starts.forEach((m, i) => {
      if (m[1].toLowerCase() !== name) return;
      const end = i + 1 < starts.length ? starts[i + 1].index : sql.length;
      found = { file: f, body: sql.slice(m.index, end) };
    });
  }
  return found;
}

describe('Interested reaches business demand only by opt-in (idea 356)', () => {
  it('the last migration to set the column default sets it to false', () => {
    const defaults = files.flatMap((f) => [...fs.readFileSync(path.join(dir, f), 'utf8')
      .matchAll(/share_interest_in_demand\s+(?:boolean\s+not\s+null\s+)?(?:set\s+)?default\s+(true|false)/gi)].map((m) => m[1].toLowerCase()));
    expect(defaults.length).toBeGreaterThan(0);
    expect(defaults[defaults.length - 1]).toBe('false');
  });

  it('the one server reader treats a missing value as OUT', () => {
    const def = latestDefinition('get_partner_demand_signals');
    expect(def.file >= '20270340').toBe(true);
    expect(def.body).toMatch(/coalesce\(p\.share_interest_in_demand,\s*false\)/);
    expect(def.body).not.toMatch(/coalesce\([^)]*share_interest_in_demand[^)]*,\s*true\)/i);
  });

  it('no other function reads the switch', () => {
    const readers = new Set();
    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      const re = /create or replace function\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi;
      const starts = [...sql.matchAll(re)];
      // a function ends where the next function or view starts (a restated view column list is not a function reading it)
      const others = [...sql.matchAll(/create\s+(?:or\s+replace\s+)?(?:function|view)\s/gi)].map((x) => x.index);
      starts.forEach((m) => {
        const end = Math.min(sql.length, ...others.filter((x) => x > m.index));
        if (/share_interest_in_demand/.test(sql.slice(m.index, end))) readers.add(m[1].toLowerCase());
      });
    }
    expect([...readers].sort()).toEqual(['_record_interest_demand_consent', 'get_partner_demand_signals']);
  });

  it('every change of the switch is recorded with its time, in a table no client can read', () => {
    const sql = read('supabase/migrations/20270340_interest_demand_opt_in.sql');
    expect(sql).toMatch(/create table if not exists private\.interest_demand_consent/);
    expect(sql).toMatch(/at timestamptz not null default now\(\)/);
    expect(sql).toMatch(/revoke all on table private\.interest_demand_consent from public, anon, authenticated/);
    expect(sql).toMatch(/after insert or update of share_interest_in_demand on public\.profiles/);
    expect(sql).toMatch(/update public\.profiles set share_interest_in_demand = false/);
  });

  it('the client reads a missing value as OFF', () => {
    const svc = read('src/services/gatherings.js');
    const settings = read('src/screens/SettingsScreen.js');
    for (const src of [svc, settings]) expect(src).not.toMatch(/share_interest_in_demand\s*\?\?\s*true/);
    expect(svc).toMatch(/share: data\?\.share_interest_in_demand === true/);
    expect(svc).toMatch(/if \(!userId\) return \{ share: false/);
    expect(settings).toMatch(/useState\(false\);\s*\n?.*|const \[shareInterestInDemand, setShareInterestInDemand\] = useState\(false\)/);
    expect(settings).toMatch(/const \[shareInterestInDemand, setShareInterestInDemand\] = useState\(false\)/);
  });

  it('the first-Interested explanation shows whether or not the person opted in, and acknowledging never turns sharing on', () => {
    const screen = read('src/screens/GatheringDetailScreen.js');
    expect(screen).toMatch(/if \(prefs && !prefs\.acknowledged\) \{/);
    expect(screen).not.toMatch(/prefs\.share && !prefs\.acknowledged/);
    expect(screen).toMatch(/demandSharingOn \? 'ui\.gatheringDetail\.demandDisclosure' : 'ui\.gatheringDetail\.demandDisclosureOptional'/);
    const svc = read('src/services/gatherings.js');
    const ack = svc.slice(svc.indexOf('export async function acknowledgeInterestedDisclosure'), svc.indexOf('// Host-only count'));
    expect(ack).toMatch(/interested_demand_disclosure_ack_at/);
    expect(ack).not.toMatch(/share_interest_in_demand/);
  });

  it('the optional explanation exists in every language and says it is off unless turned on', () => {
    const src = read('src/i18n/ui/gatheringDetail.js');
    const lines = src.split('\n').filter((l) => l.trim().startsWith('demandDisclosureOptional:'));
    expect(lines).toHaveLength(src.split('\n').filter((l) => l.trim().startsWith('demandDisclosure:')).length);
    expect(lines[0]).toMatch(/off unless you turn it on/);
    expect(lines[0]).toMatch(/at least 5 people/);
  });
});
