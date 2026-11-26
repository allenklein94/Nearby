// Social activity never buys trust (owner, 2026-11-09). Static guard, no database: the newest definition of every gate must keep
// reading only what it reads today. Journey `coordinatedCredibility` proves the behaviour under real roles.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../supabase/migrations');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

function newestBody(name) {
  const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+(?:public\\.|private\\.)?${name}\\s*\\(`, 'i');
  let found = null;
  files.forEach((f) => {
    const text = fs.readFileSync(path.join(DIR, f), 'utf8');
    let at = -1;
    let m;
    const g = new RegExp(re.source, 'gi');
    while ((m = g.exec(text))) at = m.index;
    if (at >= 0) {
      const rest = text.slice(at);
      const end = rest.search(/\$(function|\$)?\$?\s*;/i);
      const second = rest.indexOf('$function$', rest.indexOf('$function$') + 1);
      found = { file: f, body: rest.slice(0, second > 0 ? second : end > 0 ? end + 400 : 4000) };
    }
  });
  return found;
}

const SOCIAL = /(friendships|\bmatches\b|gathering_interest|social_invites|gathering_feedback|referral|bonus_notices|checked_in_at|community_members|get_host_reputation|get_host_stats)/i;

describe('social activity never buys trust', () => {
  it('the trust level has one definition and reads only suspension, phone and account age', () => {
    const defs = files.filter((f) => /function\s+private\.trust_level\s*\(/i.test(fs.readFileSync(path.join(DIR, f), 'utf8')));
    expect(defs).toEqual(['20270356_progressive_trust_rate_limits.sql']);
    const { body } = newestBody('trust_level');
    expect(body).not.toMatch(SOCIAL);
    expect(body).toMatch(/private\.account_suspended/);
    expect(body).toMatch(/private\.has_verified_phone/);
    expect(body).toMatch(/established_min_account_age/);
  });

  it.each(['enforce_rate_limit', '_rate_limit_insert', '_rate_limit_gathering_create', 'enforce_notice_daily_limit', 'enforce_friend_request_daily_limit'])(
    '%s reads no relationship, attendance, feedback or referral', (name) => {
      const found = newestBody(name);
      expect(found).not.toBeNull();
      expect(found.body).not.toMatch(SOCIAL);
    });

  it('limit rules key only on action + level', () => {
    const sql = fs.readFileSync(path.join(DIR, '20270356_progressive_trust_rate_limits.sql'), 'utf8');
    expect(sql).toMatch(/primary key \(action, trust_level, window_seconds\)/);
    files.forEach((f) => {
      const text = fs.readFileSync(path.join(DIR, f), 'utf8');
      expect({ f, addsColumn: /alter table private\.rate_limit_rules\s+add column/i.test(text) }).toEqual({ f, addsColumn: false });
    });
  });

  it('no client role can reach the trust functions or rules', () => {
    const sql = fs.readFileSync(path.join(DIR, '20270356_progressive_trust_rate_limits.sql'), 'utf8');
    expect(sql).toMatch(/revoke all on function private\.trust_level\(uuid\) from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on private\.trust_settings, private\.rate_limit_rules, private\.limited_action_log from public, anon, authenticated/);
  });
});
