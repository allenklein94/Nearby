import fs from 'fs';
import path from 'path';
import { isMissingIdVerified, withoutIdVerified, selectWithIdVerified } from './idVerifiedColumn';

// The Session B TestFlight build may run before the id_verified migration is live (owner, 2026-10-27: coordinated
// security deployment after Session B). The real server answer today (checked 2026-10-27 on production, read-only):
// {"code":"42703","message":"column dating_candidates_visible_to_me.id_verified does not exist"}.
const MISSING = { code: '42703', details: null, hint: null, message: 'column dating_candidates_visible_to_me.id_verified does not exist' };
const COLS = 'id, display_name, photo_verified, id_verified, open_to_friend_discovery';

describe('selectWithIdVerified', () => {
  it('recognises only a missing id_verified column', () => {
    expect(isMissingIdVerified(MISSING)).toBe(true);
    expect(isMissingIdVerified({ code: '42703', message: 'column profiles.bio does not exist' })).toBe(false);
    expect(isMissingIdVerified({ code: '42501', message: 'permission denied for id_verified' })).toBe(false);
    expect(isMissingIdVerified(null)).toBe(false);
  });

  it('drops exactly that column, never photo_verified', () => {
    expect(withoutIdVerified(COLS)).toBe('id, display_name, photo_verified, open_to_friend_discovery');
  });

  it('migration live: one read, rows as returned', async () => {
    const calls = [];
    const res = await selectWithIdVerified(async (c) => { calls.push(c); return { data: [{ id: 'a', id_verified: true }], error: null }; }, COLS);
    expect(calls).toEqual([COLS]);
    expect(res.data[0].id_verified).toBe(true);
  });

  it('migration not live: the same read again without the column; no badge (no id_verified on the rows)', async () => {
    const calls = [];
    const res = await selectWithIdVerified(async (c) => {
      calls.push(c);
      return c.includes('id_verified') ? { data: null, error: MISSING } : { data: [{ id: 'a', photo_verified: true }], error: null };
    }, COLS);
    expect(calls).toEqual([COLS, 'id, display_name, photo_verified, open_to_friend_discovery']);
    expect(res.error).toBeNull();
    expect(res.data[0].id_verified).toBeUndefined();
  });

  it('any other error is returned as is (no retry)', async () => {
    let n = 0;
    const err = { code: '42501', message: 'permission denied' };
    const res = await selectWithIdVerified(async () => { n += 1; return { data: null, error: err }; }, COLS);
    expect(n).toBe(1);
    expect(res.error).toBe(err);
  });

  // selectPeople (services/peopleRead.js, N6) wraps selectWithIdVerified, so a read through it counts too.
  it('guard: every client read that names id_verified goes through selectWithIdVerified', () => {
    const root = path.join(__dirname, '..');
    const offenders = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      if (!/\.js$/.test(e.name) || /\.(test|journey)\.js$/.test(e.name) || e.name === 'idVerifiedColumn.js') return;
      const src = fs.readFileSync(p, 'utf8');
      const namesColumn = /['"`][^'"`\n]*\bid_verified\b[^'"`\n]*['"`]/.test(src.replace(/^\s*\/\/.*$/gm, ''));
      if (namesColumn && !src.includes('selectWithIdVerified') && !src.includes('selectPeople(')) offenders.push(path.relative(root, p));
    });
    walk(root);
    expect(offenders).toEqual([]);
  });
});
