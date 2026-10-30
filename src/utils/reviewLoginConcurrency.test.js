// review-login under CONCURRENT failed attempts (owner, 2026-10-30). Runs the function's real source (Deno imports
// replaced by stand-ins) against an in-memory review_login_attempts table whose every call yields a random number of
// event-loop turns, so hundreds of requests interleave like parallel callers. This proves the counting logic, not the
// deployed function: the post-deploy check is the real endpoint (PRODUCT_AUDIT/TRUST_SAFETY_FIXES_2026-10-27.md).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FILE = 'supabase/functions/review-login/index.ts';
const ROOT = path.join(__dirname, '..', '..');
const PIN = '482913';

function rng(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

function fakeDb(rand) {
  const rows = [];
  let nextId = 1;
  const turn = async () => { const n = Math.floor(rand() * 4); for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
  const query = () => {
    const filters = [];
    let op = null; let payload = null; let selectOne = false;
    const q = {
      insert(obj) { op = 'insert'; payload = obj; return q; },
      select(_cols, opts) { if (op !== 'insert') op = opts?.head ? 'count' : 'select'; else selectOne = true; return q; },
      delete() { op = 'delete'; return q; },
      eq(col, v) { filters.push((r) => r[col] === v); return q; },
      gte(col, v) { filters.push((r) => r[col] >= v); return q; },
      single() { return q; },
      async then(res, rej) {
        try {
          await turn();
          let out;
          if (op === 'insert') {
            const row = { id: nextId++, attempted_at: new Date().toISOString(), ...payload };
            rows.push(row);
            out = { data: selectOne ? { id: row.id } : null, error: null };
          } else if (op === 'count') {
            out = { count: rows.filter((r) => filters.every((f) => f(r))).length, error: null };
          } else if (op === 'delete') {
            for (let i = rows.length - 1; i >= 0; i--) if (filters.every((f) => f(rows[i]))) rows.splice(i, 1);
            out = { error: null };
          }
          res(out);
        } catch (e) { rej(e); }
      },
    };
    return q;
  };
  return { rows, client: { from: () => query(), auth: { admin: { generateLink: async () => ({ data: { properties: { hashed_token: 'h' } }, error: null }) } } } };
}

function load(source, db, compared) {
  let handler;
  const body = source
    .replace(/^import .*$/gm, '')
    .replace(/function samePin\(a, b\) \{/, 'function samePin(a, b) { compared.n++;')
    .replace(/pin !== REVIEW_LOGIN_PIN/, '(compared.n++, pin !== REVIEW_LOGIN_PIN)');
  const env = { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', REVIEW_LOGIN_PIN: PIN, REVIEWER_EMAIL: 'review@example.com' };
  // eslint-disable-next-line no-new-func
  new Function('serve', 'createClient', 'Deno', 'Response', 'compared', body)(
    (h) => { handler = h; }, () => db.client, { env: { get: (k) => env[k] } },
    class { constructor(b, init) { this.status = init?.status ?? 200; this.body = b; } }, compared);
  return handler;
}

const request = (ip, pin) => ({ headers: { get: (k) => (k === 'x-forwarded-for' ? ip : null) }, json: async () => ({ pin }) });

async function attack(source, { n = 300, seed = 7, rotateIp = true } = {}) {
  const db = fakeDb(rng(seed));
  const compared = { n: 0 };
  const handler = load(source, db, compared);
  const res = await Promise.all(Array.from({ length: n }, (_, i) => handler(request(rotateIp ? `10.0.${i >> 8}.${i & 255}` : '10.9.9.9', String(100000 + i)))));
  const by = (s) => res.filter((r) => r.status === s).length;
  return { pinChecks: compared.n, invalid: by(401), tooMany: by(429), rows: db.rows.length, handlerFor: (h) => h, db, handler };
}

const current = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
const gitShow = (rev) => { try { return execSync(`git show ${rev}:${FILE}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
const live = gitShow('fd484fcc'); // the live v6 bundle as recovered (per-IP limit only)
const countFirst = gitShow('0a36bfe9'); // the first staged fix (global cap, count-then-record)

describe('review-login: failed PIN guesses under concurrency', () => {
  test.each([1, 2, 3, 4, 5])('300 parallel guesses from rotating addresses: at most 20 PIN checks (seed %i)', async (seed) => {
    const r = await attack(current, { seed });
    expect(r.pinChecks).toBeLessThanOrEqual(20);
    expect(r.invalid).toBe(r.pinChecks);
    expect(r.tooMany).toBe(300 - r.pinChecks);
    expect(r.rows).toBe(r.invalid); // refused requests leave no row: the table stays bounded under a flood
  });

  test('one address in parallel: at most 5 PIN checks', async () => {
    const r = await attack(current, { rotateIp: false, n: 100 });
    expect(r.pinChecks).toBeLessThanOrEqual(5);
  });

  test('the correct PIN still works when nobody is guessing, and leaves no row', async () => {
    const db = fakeDb(rng(1));
    const compared = { n: 0 };
    const handler = load(current, db, compared);
    const ok = await handler(request('1.2.3.4', PIN));
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).tokenHash).toBe('h');
    expect(db.rows).toHaveLength(0);
  });

  test('the earlier versions do NOT hold under concurrency (why the change)', async () => {
    if (live) expect((await attack(live)).pinChecks).toBe(300); // per-IP only: rotating the address = unlimited
    if (countFirst) expect((await attack(countFirst)).pinChecks).toBeGreaterThan(20); // count-first: parallel calls all see the old count
  });
});
