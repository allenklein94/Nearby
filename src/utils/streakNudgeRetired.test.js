// Owner item 53 (2026-10-12): the "Keep your streak going" push (momentum_streak_nudge) is retired; Nearby never nudges a
// person to protect a streak. The streak DISPLAY on Your Activity stays (Momentum decision pending usage evidence).
// Live proof: scripts/live-verify/streak-nudge-retired.sql. This guard keeps any sending path from coming back.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const migrations = path.join(root, 'supabase/migrations');
const files = fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort();
const RETIRE = '20270300_retire_streak_nudge.sql';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|ts|tsx)$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('the streak push is retired (item 53)', () => {
  it('the retiring migration exists and is the last to define send_momentum_nudges()', () => {
    expect(files).toContain(RETIRE);
    const definers = files.filter((f) => /create or replace function (public\.)?send_momentum_nudges\(/i.test(fs.readFileSync(path.join(migrations, f), 'utf8')));
    expect(definers[definers.length - 1]).toBe(RETIRE);
  });

  // Its reward-tier branch was kept here; idea 186 later retired that push and dropped the function (20270329).
  it('its send_momentum_nudges() never sends the streak push, and keeps the reward-tier push', () => {
    const sql = fs.readFileSync(path.join(migrations, RETIRE), 'utf8');
    const body = sql.slice(sql.indexOf('create or replace function public.send_momentum_nudges()'), sql.indexOf('$function$;'));
    expect(body).not.toMatch(/momentum_streak_nudge|Keep your streak/);
    expect(body).toMatch(/'reward_tier_nudge'/);
  });

  it('a streak push still waiting in the outbox is failed so it never goes out late', () => {
    const sql = fs.readFileSync(path.join(migrations, RETIRE), 'utf8');
    expect(sql).toMatch(/update public\.push_outbox\s+set status = 'failed'[\s\S]*data->>'type' = 'momentum_streak_nudge' and status in \('pending', 'retry'\)/);
  });

  it('no later migration sends it again', () => {
    for (const f of files.filter((x) => x > RETIRE)) {
      expect(fs.readFileSync(path.join(migrations, f), 'utf8')).not.toMatch(/'momentum_streak_nudge'\)/);
    }
  });

  it('no app code or edge function sends it (only the tap/priority tables for an old push already delivered)', () => {
    const allowed = new Set([
      'src/constants/notificationTier.js', 'src/constants/notificationActions.js', 'src/constants/notificationPreferences.js',
      'src/navigation/notificationDestinations.js', 'supabase/functions/send-push/index.ts',
    ]);
    const hits = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'supabase/functions'))]
      .filter((p) => /momentum_streak_nudge/.test(fs.readFileSync(p, 'utf8')))
      .map((p) => path.relative(root, p));
    expect(hits.filter((h) => !allowed.has(h))).toEqual([]);
  });

  it('the streak display on Your Activity is kept as it was', () => {
    const screen = fs.readFileSync(path.join(root, 'src/screens/MomentumScreen.js'), 'utf8');
    expect(screen).toMatch(/momentum\.currentStreak/);
  });
});
