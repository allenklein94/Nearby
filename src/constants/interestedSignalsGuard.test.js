const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/20270150_interested_reminder_and_friend_joined.sql'), 'utf8');

describe('Interested reminder + friend-joined push (migration 20270150)', () => {
  it('reminds Interested people, skipping a host block and honoring notify_planning', () => {
    expect(sql).toMatch(/select gd\.user_id from gathering_interested gd/);
    expect(sql).toMatch(/notify_planning/);
  });
  it('friend-joined is friends-only, one push per person, and never notifies the host', () => {
    expect(sql).toMatch(/f\.status = 'accepted'/);
    expect(sql).not.toMatch(/matches m/);
    expect(sql).toMatch(/gathering_interested_friend_pushes[\s\S]*on conflict do nothing/);
    const friendFn = sql.slice(sql.indexOf('notify_interested_friend_joined()'));
    expect(friendFn).not.toMatch(/'recipient_id', g\.host_id/);
  });
  it('taps route to the gathering', () => {
    const n = fs.readFileSync(path.join(__dirname, '../services/notifications.js'), 'utf8');
    expect(n).toMatch(/case 'friend_joined_gathering':/);
  });
});
