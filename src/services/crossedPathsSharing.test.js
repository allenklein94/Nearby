// Crossed Paths consent client (20270384): server answers only; missing function = no switch; only Settings turns it on.
const fs = require('fs');
jest.mock('./supabase', () => ({ supabase: {} }));
const path = require('path');
const { getMyCrossedPathsSharing, setCrossedPathsSharing, isMissingFunction } = require('./crossedPathsSharing');

const fake = (result) => ({ calls: [], rpc(name, args) { this.calls.push([name, args]); return Promise.resolve(result); } });

describe('crossed paths sharing client', () => {
  test('reads the server answer', async () => {
    expect(await getMyCrossedPathsSharing(fake({ data: true, error: null }))).toBe(true);
    expect(await getMyCrossedPathsSharing(fake({ data: false, error: null }))).toBe(false);
    expect(await getMyCrossedPathsSharing(fake({ data: null, error: null }))).toBe(false);
  });
  test('an older database without the switch = null (Settings shows no switch)', async () => {
    expect(await getMyCrossedPathsSharing(fake({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }))).toBeNull();
    expect(await getMyCrossedPathsSharing(fake({ data: null, error: { code: '42883', message: 'function does not exist' } }))).toBeNull();
    await expect(getMyCrossedPathsSharing(fake({ data: null, error: { code: '500', message: 'boom' } }))).rejects.toBeTruthy();
    expect(isMissingFunction(null)).toBe(false);
  });
  test('set sends a plain boolean and returns the server state', async () => {
    const c = fake({ data: true, error: null });
    expect(await setCrossedPathsSharing('yes', c)).toBe(true);
    expect(c.calls).toEqual([['set_crossed_paths_sharing', { enabled: true }]]);
    await expect(setCrossedPathsSharing(false, fake({ data: null, error: { message: 'x' } }))).rejects.toBeTruthy();
  });
});

describe('only the Settings switch can turn Crossed Paths on', () => {
  const SRC = path.join(__dirname, '..');
  // journeys/ and qa/ are server-side test code, not the app
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'journeys', 'qa'].includes(e.name)) walk(p); } else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) files.push(p);
  });
  walk(SRC);
  test('setCrossedPathsSharing is called only by SettingsScreen, only from its switch handler', () => {
    const callers = files.filter((f) => /setCrossedPathsSharing\(/.test(fs.readFileSync(f, 'utf8')) && !f.endsWith('crossedPathsSharing.js'))
      .map((f) => path.relative(SRC, f));
    expect(callers).toEqual([path.join('screens', 'SettingsScreen.js')]);
    const s = fs.readFileSync(path.join(SRC, 'screens', 'SettingsScreen.js'), 'utf8');
    expect(s.match(/setCrossedPathsSharing\(/g)).toHaveLength(1);
    expect(s).toMatch(/onValueChange=\{toggleCrossedPaths\}/);
  });
  test('no client code writes the consent table or calls the RPC directly', () => {
    for (const f of files) {
      const t = fs.readFileSync(f, 'utf8');
      expect(t).not.toMatch(/crossed_paths_consent/);
      if (!f.endsWith('crossedPathsSharing.js')) expect(t).not.toMatch(/set_crossed_paths_sharing/);
    }
  });
});
