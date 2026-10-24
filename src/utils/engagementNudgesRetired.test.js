// Owner idea "186" (2026-10-18): Nearby brings people back only when something relevant happened. The two scheduled
// engagement nudges, "Your mission is still waiting" (first_mission_reminder) and "Almost at {tier}" (reward_tier_nudge),
// are retired like item 53's streak push. Live proof: scripts/live-verify/engagement-nudges-retired.sql. This guard keeps
// any sending path or schedule from coming back.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const migrations = path.join(root, 'supabase/migrations');
const files = fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort();
const RETIRE = '20270329_retire_engagement_nudges.sql';
const read = (f) => fs.readFileSync(path.join(migrations, f), 'utf8');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|ts|tsx)$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('the engagement nudges are retired (idea 186)', () => {
  const sql = read(RETIRE);

  it('the retiring migration unschedules both jobs and drops both senders', () => {
    expect(sql).toMatch(/cron\.unschedule\(jobid\) from cron\.job\s+where jobname in \('send-first-mission-reminders', 'send-momentum-reward-nudges'\)/);
    expect(sql).toMatch(/drop function if exists public\.send_first_mission_reminders\(\);/);
    expect(sql).toMatch(/drop function if exists public\.send_momentum_nudges\(\);/);
  });

  it('a retired push still waiting in the outbox is failed so it never goes out late', () => {
    expect(sql).toMatch(/update public\.push_outbox\s+set status = 'failed'[\s\S]*data->>'type' in \('first_mission_reminder', 'reward_tier_nudge'\) and status in \('pending', 'retry'\)/);
  });

  it('no later migration brings back a sender, a schedule or either push', () => {
    for (const f of files.filter((x) => x > RETIRE)) {
      const later = read(f);
      expect(later).not.toMatch(/function (public\.)?(send_first_mission_reminders|send_momentum_nudges)\(/i);
      expect(later).not.toMatch(/send-first-mission-reminders|send-momentum-reward-nudges/);
      expect(later).not.toMatch(/'(first_mission_reminder|reward_tier_nudge)'\)/);
    }
  });

  it('no app code or edge function sends either push (only the tap/priority tables for an old push already delivered)', () => {
    const allowed = new Set([
      'src/constants/notificationTier.js', 'src/constants/notificationActions.js', 'src/constants/notificationPreferences.js',
      'src/navigation/notificationDestinations.js', 'supabase/functions/send-push/index.ts',
      'src/qa/lifecycleMatrix.js', // idea 391's generated reference only labels it retired; it sends nothing
    ]);
    const hits = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'supabase/functions'))]
      .filter((p) => /first_mission_reminder|reward_tier_nudge/.test(fs.readFileSync(p, 'utf8')))
      .map((p) => path.relative(root, p));
    expect(hits.filter((h) => !allowed.has(h))).toEqual([]);
  });

  it('touches nothing it keeps: match, birthday, occasion and stalled-plan reminders', () => {
    expect(sql).not.toMatch(/send_match_reminders|send_birthday|send_occasion|send_gathering_reminders/);
  });
});
