const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const mig = read('../../supabase/migrations/20270172_attendee_identity_friends_only.sql');
const { attendeeSummary } = require('./gatheringAttendeeDisplay');

const att = (id, name) => ({ user_id: id, status: 'approved', profiles: { display_name: name, photo_url: `${id}.jpg` } });

describe('attendee identities: friends see names, strangers see counts (item 75)', () => {
  describe('server boundary (migration)', () => {
    it('replaces the broad policy; an approved row is visible only to self, members or accepted friends', () => {
      expect(mig).toMatch(/drop policy if exists "Anyone can see approved attendees"/);
      expect(mig).toMatch(/user_id = auth\.uid\(\)\s+or public\.viewer_is_gathering_member\(gathering_id\)\s+or public\.viewer_is_friend_of\(user_id\)/);
      expect(mig).toMatch(/not public\.viewer_blocked_either_way\(user_id\)/);
      expect(mig).toMatch(/to authenticated/);
    });
    it('friend means an ACCEPTED friendship (not a match, not merely connected)', () => {
      const fn = mig.slice(mig.indexOf('viewer_is_friend_of(other_user uuid)'), mig.indexOf('viewer_is_gathering_member(gathering_id_param uuid)'));
      expect(fn).toMatch(/f\.status = 'accepted'/);
      expect(fn).not.toMatch(/matches/);
    });
    it('membership = host or APPROVED attendee (pending/waitlisted are not members)', () => {
      const fn = mig.slice(mig.indexOf('viewer_is_gathering_member(gathering_id_param uuid)'), mig.indexOf('revoke all'));
      expect(fn).toMatch(/g\.host_id = auth\.uid\(\)/);
      expect(fn).toMatch(/gi\.status = 'approved'/);
    });
    it('helpers are definer + authenticated-only (policy cannot recurse into its own table)', () => {
      expect(mig.match(/security definer/g).length).toBeGreaterThanOrEqual(4);
      expect(mig).toMatch(/revoke all on function public\.viewer_is_friend_of\(uuid\) from public, anon/);
    });
    it('first-timer identities are member-only; the other function is an aggregate', () => {
      const ids = mig.slice(mig.indexOf('get_gathering_first_timer_ids(gathering_id_param uuid)'), mig.indexOf('get_gathering_first_timer_count(gathering_id_param uuid)'));
      expect(ids).toMatch(/viewer_is_gathering_member/);
      expect(mig.slice(mig.indexOf('get_gathering_first_timer_count(gathering_id_param uuid)'))).toMatch(/returns integer/);
    });
    it('the join model is untouched', () => {
      expect(mig).not.toMatch(/join_gathering|requires_approval|capacity/);
    });
  });

  describe('what the client says with what the server returned', () => {
    const g = (approvedAttendees, approvedCount) => ({ approvedAttendees, approvedCount });
    it('stranger viewer + one stranger attendee: count only, no name, no avatar', () => {
      const s = attendeeSummary(g([], 1));
      expect(s.text).toBe('1 person going');
      expect(s.avatars).toEqual([]);
    });
    it('several stranger attendees: count only', () => {
      const s = attendeeSummary(g([], 4), { verb: 'attending' });
      expect(s.text).toBe('4 people attending');
      expect(s.avatars).toHaveLength(0);
    });
    it('a single friend attendee reads "Sam is going"', () => {
      expect(attendeeSummary(g([att('f', 'Sam')], 1)).text).toBe('Sam is going');
    });
    it('a single visible row is NOT "X is going" when the total says others exist', () => {
      expect(attendeeSummary(g([att('f', 'Sam')], 3)).text).toBe('3 people going · including Sam');
    });
    it('mixed friends + strangers: friend identity + aggregate count, never a stranger', () => {
      const s = attendeeSummary(g([att('f', 'Sam'), att('h', 'Alex')], 5));
      expect(s.text).toBe('5 people going · including Sam and Alex');
      expect(s.avatars.map((a) => a.user_id)).toEqual(['f', 'h']);
    });
    it('a member sees everyone: plain count', () => {
      expect(attendeeSummary(g([att('a', 'A'), att('b', 'B'), att('c', 'C')], 3)).text).toBe('3 people going');
    });
    it('no attendees = nothing to say', () => {
      expect(attendeeSummary(g([], 0))).toBeNull();
    });
  });

  describe('every render path goes through the one summary and the server-narrowed rows', () => {
    const feed = read('../screens/GatheringsScreen.js');
    const detail = read('../screens/GatheringDetailScreen.js');
    it('feed and detail no longer print a single attendee name inline', () => {
      expect(feed).not.toMatch(/is attending`/);
      expect(detail).not.toMatch(/\} is going`/);
      expect(feed).toMatch(/attendeeSummary\(item/);
      expect(detail).toMatch(/attendeeSummary\(gathering/);
    });
    it('the Who\'s Going block shows on a count, not on visible rows, so a hidden-only crowd is still a count', () => {
      expect(detail).toMatch(/attendeeTotal\(gathering\) > 0 && \(\s*<View style=\{styles\.section\}>\s*<Text style=\{styles\.sectionLabel\}>Who's Going/);
    });
    it('capacity and fullness come from the server count, never the visible rows', () => {
      expect(read('./primaryAction.js')).toMatch(/Math\.max\(attendeeTotal\(gathering\), visibleApproved\) >= gathering\.capacity/);
    });
    it('"New here" reads member-only / aggregate RPCs, not other people\'s attendance rows', () => {
      const svc = read('../services/gatherings.js');
      expect(svc).toMatch(/rpc\('get_gathering_first_timer_ids'/);
      expect(svc).toMatch(/rpc\('get_gathering_first_timer_count'/);
      const i = svc.indexOf('export async function getFirstTimerAttendeeIds');
      expect(svc.slice(i, i + 900)).not.toMatch(/from\('gathering_interest'\)/);
    });
    it('the Hub still lists approved attendees (Who You\'ll Meet unchanged)', () => {
      const hub = read('../screens/GatheringHubScreen.js');
      expect(hub).toMatch(/Who You'll Meet/);
      expect(hub).toMatch(/gathering\.approvedAttendees\.filter/);
    });
    it('no other screen renders an attendee\'s name or photo from a gathering payload', () => {
      const screens = fs.readdirSync(path.join(__dirname, '../screens')).filter((f) => f.endsWith('.js') && !f.includes('.test.'));
      const offenders = screens.filter((f) => {
        if (['GatheringsScreen.js', 'GatheringDetailScreen.js', 'GatheringHubScreen.js', 'GatheringChatScreen.js'].includes(f)) return false;
        return /approvedAttendees[^\n]*(display_name|photo_url)/.test(read(`../screens/${f}`));
      });
      expect(offenders).toEqual([]);
    });
  });
});
