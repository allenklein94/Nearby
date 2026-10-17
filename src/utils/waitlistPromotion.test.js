// Owner item 143 (2026-10-16, approved): the waitlist promotion moment reuses item 31's row ("~~On waitlist~~ -> ✓ Attending",
// one glow), only for a real, persisted promotion the person has not seen, once per gathering.
import fs from 'fs';
import path from 'path';
import { waitlistPromotionMoment as m, waitlistPromotionA11y } from './waitlistPromotion';
import actions from '../i18n/ui/actions';

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const detail = read('screens/GatheringDetailScreen.js');
const service = read('services/gatherings.js');
const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270319_waitlist_promotion_moment.sql'), 'utf8');
const motion = read('motion/InterestedToAttending.js');

describe('the one rule', () => {
  const promoted = { promoted_at: '2026-10-16T18:00:00Z', seen_at: null };
  test('attending now + an unseen server record of the promotion = the moment', () => {
    expect(m({ storedStatus: 'approved', promotion: promoted })).toBe(true);
  });
  test('repeat visit: already seen = no moment', () => {
    expect(m({ storedStatus: 'approved', promotion: { ...promoted, seen_at: '2026-10-16T18:05:00Z' } })).toBe(false);
  });
  test('normal join / join request / no record = no moment (nothing is inferred)', () => {
    expect(m({ storedStatus: 'approved', promotion: null })).toBe(false); // normal join: the server records nothing
    expect(m({ storedStatus: 'pending', promotion: promoted })).toBe(false); // Requested
    expect(m({ storedStatus: 'waitlisted', promotion: promoted })).toBe(false);
    expect(m({ storedStatus: null, promotion: promoted })).toBe(false);
    expect(m({ storedStatus: 'approved', promotion: {} })).toBe(false);
    expect(m()).toBe(false);
  });
});

describe('screen wiring', () => {
  test('decided from the stored attendance + the server record, only for a non-host attendee, then marked seen', () => {
    const load = detail.slice(detail.indexOf('setGathering(g);'), detail.indexOf('setGathering(g);') + 600);
    expect(load).toMatch(/if \(!g\.isHost && g\.myStatus === 'approved'\) \{\s*getMyWaitlistPromotion\(gatheringId\)\.then\(\(promotion\) => \{\s*if \(!waitlistPromotionMoment\(\{ storedStatus: g\.myStatus, promotion \}\)\) return;\s*setWaitlistMoment\(true\);\s*markMyWaitlistPromotionSeen\(gatheringId\);/);
    // only ever set to true: a reload in the same visit never removes or replays it
    expect(detail.match(/setWaitlistMoment\(/g)).toHaveLength(1);
  });

  test('reuses item 31\'s component and existing labels inside the You\'re in panel; never alongside item 31\'s own moment', () => {
    const panel = detail.slice(detail.indexOf("gathering.myStatus === 'approved' ? ("), detail.indexOf("t('ui.gatheringDetail.youreIn')"));
    expect(panel).toMatch(/\{waitlistMoment && !interestedToAttendingMoment\(\{ \.\.\.ownJoin, storedStatus: gathering\.myStatus \}\) && \(\s*<InterestedToAttending\s*fromLabel=\{t\('ui\.actions\.onWaitlist'\)\}\s*toLabel=\{t\('ui\.actions\.attendingNow'\)\}/);
    // the screen still says You're in without the animation (the panel's title is unconditional)
    expect(detail).toMatch(/<Text style=\{styles\.youreInTitle\}>\{t\('ui\.gatheringDetail\.youreIn'\)\}<\/Text>/);
  });

  test('Reduce Motion and taps: the shared component settles at once and never takes touches', () => {
    expect(motion).toMatch(/const animate = useRef\(play && !reduceMotion\)\.current;/);
    expect(motion).toMatch(/pointerEvents="none"/);
    expect(motion).not.toMatch(/Haptics|playHaptic/); // no own tap here, so no vibration
  });

  test('services call the two RPCs only', () => {
    expect(service).toMatch(/rpc\('get_my_waitlist_promotion', \{ gathering_id_param: gatheringId \}\)/);
    expect(service).toMatch(/rpc\('mark_my_waitlist_promotion_seen', \{ gathering_id_param: gatheringId \}\)/);
  });
});

describe('no new strings', () => {
  test('every language has both labels, and the spoken line is built from them', () => {
    for (const [lang, a] of Object.entries(actions)) {
      expect([lang, typeof a.onWaitlist, typeof a.attendingNow]).toEqual([lang, 'string', 'string']);
    }
    expect(waitlistPromotionA11y(actions.en.onWaitlist, actions.en.attendingNow)).toBe('On waitlist, Attending');
  });
});

describe('migration 20270319', () => {
  test('recorded only by the trigger on waitlisted -> approved; any other status change removes it', () => {
    expect(migration).toMatch(/if old\.status = 'waitlisted' and new\.status = 'approved' then\s*insert into gathering_waitlist_promotions/);
    expect(migration).toMatch(/else\s*delete from gathering_waitlist_promotions where interest_id = new\.id;/);
    expect(migration).toMatch(/after update of status on public\.gathering_interest/);
    expect(migration).toMatch(/references public\.gathering_interest\(id\) on delete cascade/);
  });
  test('private: no client grants on the table; own rows only through the RPCs, which are closed to anon', () => {
    expect(migration).toMatch(/revoke all on public\.gathering_waitlist_promotions from public, anon, authenticated;/);
    expect(migration).toMatch(/p\.user_id = auth\.uid\(\)\s*and gi\.status = 'approved'/);
    expect(migration).toMatch(/where gathering_id = gathering_id_param and user_id = auth\.uid\(\) and seen_at is null;/);
    expect(migration).toMatch(/revoke all on function public\.get_my_waitlist_promotion\(uuid\) from public, anon;/);
    expect(migration).toMatch(/revoke all on function public\.mark_my_waitlist_promotion_seen\(uuid\) from public, anon;/);
  });
});
