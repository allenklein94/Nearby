// Item 148 (owner, 2026-10-17, D1-D4 LOCKED): Nearby never stores a story's or a sighting's precise location. Migration
// 20270321 makes the database store only a stable, secret-keyed pin (stories.latitude/longitude, sightings.approx_area),
// stores no location on a business moment, drops get_sighting_fuzzed_coords and removes client SELECT on those columns
// (defence in depth; journey `storySightingLocation` proves it per role). This guard keeps the client and later
// migrations in line:
//   1. every client read of stories / sightings names its columns, never a location column, only granted columns;
//   2. nothing calls the dropped get_sighting_fuzzed_coords;
//   3. uploadStory asks for a location only for a public, non-business story and rounds it before sending;
//   4. FORWARD RULE: a later migration adding a stories/sightings column must grant SELECT on it in the same file;
//      none may replace the pin triggers away or read the old md5 offset again.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const MIGRATION = '20270321_story_sighting_location_privacy.sql';
const PRIVATE = { stories: ['latitude', 'longitude'], sightings: ['approx_area'] };

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'journeys') walk(p, out); } else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
}
const sources = walk(ROOT).map((f) => ({ f: path.relative(ROOT, f), src: fs.readFileSync(f, 'utf8') }));
const migrationSql = fs.readFileSync(path.join(MIGRATIONS, MIGRATION), 'utf8');

function granted(table) {
  const m = new RegExp(`grant select \\(([^)]*)\\)\\s+on public\\.${table} to anon, authenticated;`).exec(migrationSql);
  return m ? m[1].split(',').map((c) => c.trim()).filter(Boolean) : [];
}

function topLevelColumns(select) {
  const out = [];
  let depth = 0; let cur = '';
  for (const ch of select) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((c) => !c.includes('(')).map((c) => c.split(':').pop().trim());
}

// Every `.select(...)` chained onto `.from('<table>')` (up to the next `.from(` or statement end); null = bare select().
function selectsOf(table) {
  const found = [];
  for (const { f, src } of sources) {
    const re = new RegExp(`\\.from\\('${table}'\\)`, 'g');
    let m;
    while ((m = re.exec(src))) {
      const rest = src.slice(m.index + m[0].length);
      const end = rest.search(/\.from\(|;\s*\n/);
      const chain = end === -1 ? rest : rest.slice(0, end);
      const sel = /\.select\((['"`])([\s\S]*?)\1/.exec(chain);
      if (sel) found.push({ f, text: sel[2] });
      else if (/\.select\(\s*\)/.test(chain)) found.push({ f, text: null });
    }
  }
  return found;
}

describe('item 148: stories and sightings never store or expose a precise location', () => {
  test.each(['stories', 'sightings'])('every client read of %s names granted columns, never a location column', (table) => {
    const reads = selectsOf(table);
    expect(reads.length).toBeGreaterThan(0);
    const allowed = granted(table);
    expect(allowed.length).toBeGreaterThan(0);
    for (const { f, text } of reads) {
      expect({ f, text }).toEqual({ f, text: expect.any(String) });
      const cols = topLevelColumns(text);
      expect({ f, cols: cols.filter((c) => c === '*' || PRIVATE[table].includes(c) || !allowed.includes(c)) }).toEqual({ f, cols: [] });
    }
  });

  test('no embed reads stories(...) or sightings(...) location columns or *', () => {
    for (const { f, src } of sources) {
      for (const m of src.matchAll(/\b(stories|sightings)\(([^)]*)\)/g)) {
        if (/^\s*['"`]/.test(m[2])) continue; // a call like uploadStory('...'), not an embed
        const cols = m[2].split(',').map((c) => c.trim());
        expect({ f, bad: cols.filter((c) => c === '*' || PRIVATE[m[1]].includes(c)) }).toEqual({ f, bad: [] });
      }
    }
  });

  test('the grants leave out exactly the location columns', () => {
    for (const [table, cols] of Object.entries(PRIVATE)) {
      for (const c of cols) expect(granted(table)).not.toContain(c);
    }
    expect(migrationSql).toMatch(/revoke select on public\.stories from anon, authenticated;/);
    expect(migrationSql).toMatch(/revoke select on public\.sightings from anon, authenticated;/);
  });

  test('nothing calls the dropped get_sighting_fuzzed_coords', () => {
    expect(sources.filter(({ src }) => src.includes('get_sighting_fuzzed_coords')).map((s) => s.f)).toEqual([]);
    expect(migrationSql).toMatch(/drop function if exists public\.get_sighting_fuzzed_coords\(uuid\[\]\);/);
  });

  test('uploadStory asks for a location only for a public personal story and rounds it before sending', () => {
    const src = fs.readFileSync(path.join(ROOT, 'services', 'stories.js'), 'utf8');
    const body = src.slice(src.indexOf('export async function uploadStory'), src.indexOf('export async function uploadBusinessMoment'));
    expect(body).toMatch(/if \(isPublic && !partnerId\) \{\s*const location = await getUserLocation\(\);/);
    expect(body).toMatch(/latitude = Math\.round\(location\.coords\.latitude \* 1000\) \/ 1000;/);
    expect(body).toMatch(/longitude = Math\.round\(location\.coords\.longitude \* 1000\) \/ 1000;/);
    expect(body).not.toMatch(/latitude = location\.coords\.latitude;/);
  });

  test('the pin is stable (keyed by person + cell, server secret), and stored by triggers on both tables', () => {
    expect(migrationSql).toMatch(/create trigger story_location_to_pin\s+before insert or update of latitude, longitude, partner_id, user_id on public\.stories/);
    expect(migrationSql).toMatch(/create trigger sighting_area_to_pin\s+before insert or update of approx_area, user_a, user_b on public\.sightings/);
    expect(migrationSql).toMatch(/private\.location_pin\('story', new\.user_id::text/);
    expect(migrationSql).toMatch(/from private\.pin_secret s/);
    expect(migrationSql).toMatch(/if new\.partner_id is not null/);
  });

  test('FORWARD RULE: later migrations grant SELECT on new stories/sightings columns, keep the triggers, never the md5 offset', () => {
    const later = fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql') && n > MIGRATION).sort();
    for (const n of later) {
      const sql = fs.readFileSync(path.join(MIGRATIONS, n), 'utf8');
      for (const table of ['stories', 'sightings']) {
        const adds = [...sql.matchAll(new RegExp(`alter table (?:public\\.)?${table}\\s+add column (?:if not exists )?(\\w+)`, 'gi'))].map((m) => m[1]);
        for (const c of adds) {
          expect({ n, c, granted: new RegExp(`grant select \\([^)]*\\b${c}\\b[^)]*\\) on public\\.${table} to anon, authenticated`).test(sql) })
            .toEqual({ n, c, granted: true });
        }
      }
      expect({ n, dropsTrigger: /drop trigger (if exists )?(story_location_to_pin|sighting_area_to_pin)/i.test(sql) }).toEqual({ n, dropsTrigger: false });
      expect({ n, md5: /md5\(s\.id::text \|\| 'lat'\)/.test(sql) }).toEqual({ n, md5: false });
    }
  });
});
