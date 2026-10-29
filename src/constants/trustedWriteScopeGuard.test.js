// Trusted-write flag scope (migration 20270359, owner option 1 "restore in each body"): every function that turns
// `app.trusted_update` on must save the caller's value on entry (`v_caller_trusted`) and put it back after its trusted
// write; none may reset it to a bare 'false' (that drops a trusted caller's own scope). Supabase refuses a function-level
// `SET app.trusted_update`, so the pattern lives in each body and any later migration that (re)defines such a function
// must keep it. The live catalog is checked by journey `trustedWriteScope` and by 20270359's own DO block.
// 20270360: a guard that protects columns unless the flag is 'true' must run as the caller (no SECURITY DEFINER) and also
// protect when `current_user in ('anon', 'authenticated')`, so a client that forges the flag gains nothing.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FIX = '20270359';
const SETS_FLAG = /set_config\(\s*'app\.trusted_update'/i;
const TURNS_ON = /set_config\(\s*'app\.trusted_update'\s*,\s*'true'/i;
const SAVES = /v_caller_trusted\s+text\s*:=\s*current_setting\(\s*'app\.trusted_update'\s*,\s*true\s*\)/i;
const RESTORES = /set_config\(\s*'app\.trusted_update'\s*,\s*coalesce\(\s*v_caller_trusted\s*,\s*'false'\s*\)\s*,\s*true\s*\)/i;
const BARE_OFF = /set_config\(\s*'app\.trusted_update'\s*,\s*'false'/i;
// Saves the caller's value under its own name and restores it itself (unchanged by 20270359).
const OWN_RESTORE = new Set(['_rate_limit_commercial_post']);

function unscoped(fn) {
  if (OWN_RESTORE.has(fn.name)) return false;
  if (TURNS_ON.test(fn.text) && !(SAVES.test(fn.text) && RESTORES.test(fn.text))) return true;
  return BARE_OFF.test(fn.text);
}

function functionsIn(sql) {
  const out = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    const start = m.index;
    const tag = /as\s+(\$[\w]*\$)/i.exec(sql.slice(start));
    if (!tag) continue;
    const bodyStart = start + tag.index + tag[0].length;
    const bodyEnd = sql.indexOf(tag[1], bodyStart);
    if (bodyEnd < 0) continue;
    const end = sql.indexOf(';', bodyEnd);
    out.push({ name: m[1].replace(/"/g, '').replace(/^public\./, ''), text: sql.slice(start, end < 0 ? undefined : end) });
    re.lastIndex = bodyEnd;
  }
  return out;
}

const FIX_FORGE = '20270360';
const GUARD_TEST = /current_setting\(\s*'app\.trusted_update'\s*,\s*true\s*\)\s*,\s*''\s*\)\s*<>\s*'true'/i;
const CLIENT_ROLES = /current_user\s+in\s*\(\s*'anon'\s*,\s*'authenticated'\s*\)/i;
const forgeable = (fn) => GUARD_TEST.test(fn.text) && (/security\s+definer/i.test(fn.text) || !CLIENT_ROLES.test(fn.text));

describe('trusted-write flag scope', () => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  it('20270359 exists, every function in it restores the caller\'s value, and it checks the catalog', () => {
    const fix = files.find((f) => f.startsWith(FIX));
    expect(fix).toBeTruthy();
    const sql = fs.readFileSync(path.join(dir, fix), 'utf8');
    const fns = functionsIn(sql);
    expect(fns.length).toBe(24);
    expect(fns.filter(unscoped).map((fn) => fn.name)).toEqual([]);
    expect(sql).toMatch(/trusted-write functions without a scoped flag/);
  });

  it('every later function that sets the flag keeps the save-and-restore pattern', () => {
    const bad = [];
    for (const f of files.filter((x) => x.slice(0, 8) > FIX)) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const fn of functionsIn(sql)) {
        if (SETS_FLAG.test(fn.text) && unscoped(fn)) bad.push(`${f}: ${fn.name}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the pattern check catches a leak and a bare reset (self-check)', () => {
    const leak = { name: 'x', text: "perform set_config('app.trusted_update', 'true', true); update profiles set x = 1;" };
    const bare = { name: 'y', text: "v_caller_trusted text := current_setting('app.trusted_update', true); perform set_config('app.trusted_update', 'true', true); update t set a = 1; perform set_config('app.trusted_update', 'false', true);" };
    const ok = { name: 'z', text: "v_caller_trusted text := current_setting('app.trusted_update', true); perform set_config('app.trusted_update', 'true', true); update t set a = 1; perform set_config('app.trusted_update', coalesce(v_caller_trusted, 'false'), true);" };
    expect(unscoped(leak)).toBe(true);
    expect(unscoped(bare)).toBe(true);
    expect(unscoped(ok)).toBe(false);
  });

  it('20270360 makes all 12 guards invokers that ignore the flag for client roles', () => {
    const fix = files.find((f) => f.startsWith(FIX_FORGE));
    expect(fix).toBeTruthy();
    const sql = fs.readFileSync(path.join(dir, fix), 'utf8');
    const fns = functionsIn(sql);
    expect(fns.length).toBe(12);
    expect(fns.filter(forgeable).map((fn) => fn.name)).toEqual([]);
    expect(fns.every((fn) => /security\s+invoker/i.test(fn.text))).toBe(true);
    expect(sql).toMatch(/guards that trust a forgeable flag/);
  });

  it('every later guard keeps the client-role clause and runs as the caller', () => {
    const bad = [];
    for (const f of files.filter((x) => x.slice(0, 8) > FIX_FORGE)) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const fn of functionsIn(sql)) if (forgeable(fn)) bad.push(`${f}: ${fn.name}`);
    }
    expect(bad).toEqual([]);
  });

  it('the function scanner sees a flag-setting function (self-check)', () => {
    const sample = `create or replace function public.x() returns void language plpgsql as $$ begin perform set_config('app.trusted_update', 'true', true); end $$;`;
    const fns = functionsIn(sample);
    expect(fns).toHaveLength(1);
    expect(SETS_FLAG.test(fns[0].text)).toBe(true);
  });
});
