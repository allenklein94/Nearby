import fs from 'fs';
import path from 'path';
import { nextRespondingCheckMs } from './offerResponding';
import { respondingLine } from '../utils/offerCopy';
import { SEQUENCES, settleMs, MOTION_BUDGET } from '../motion/motionBudget';
import offerCopyStrings from '../i18n/ui/offerCopy';

jest.mock('./supabase', () => ({ supabase: {} }));

const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const screen = src('screens/BusinessRequestDetailScreen.js');
const migration = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase/migrations/20270292_offer_responding_status.sql'), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n'); // code only

describe('owner item 16: "Coastal Coffee is responding…"', () => {
  it('wording: one name, two names, a count; nothing in flight = no line', () => {
    expect(respondingLine([{ name: 'Coastal Coffee' }])).toBe('Coastal Coffee is responding…');
    expect(respondingLine([{ name: 'Coastal Coffee' }, { name: 'Brew Lab' }])).toBe('Coastal Coffee and Brew Lab are responding…');
    expect(respondingLine([{ name: 'A' }, { name: 'B' }, { name: 'C' }])).toBe('3 businesses are responding…');
    expect(respondingLine([])).toBeNull();
    expect(respondingLine(null)).toBeNull();
  });
  it('every language has the three lines with their placeholders', () => {
    for (const [lang, s] of Object.entries(offerCopyStrings)) {
      expect([lang, s.respondingOne.includes('{name}')]).toEqual([lang, true]);
      expect([lang, s.respondingTwo.includes('{a}') && s.respondingTwo.includes('{b}')]).toEqual([lang, true]);
      expect([lang, s.respondingMany.includes('{count}')]).toEqual([lang, true]);
    }
  });
  it('the only timer re-reads at the server\'s own stall boundary', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    expect(nextRespondingCheckMs([{ staleAt: '2026-10-10T12:02:00Z' }, { staleAt: '2026-10-10T12:01:00Z' }], now)).toBe(60000 + 250);
    expect(nextRespondingCheckMs([], now)).toBeNull();
    expect(nextRespondingCheckMs([{ staleAt: '2026-10-10T11:00:00Z' }], now)).toBe(250);
  });

  it('server: driven only by a SENT reply being checked, never by viewing (item 39)', () => {
    expect(migration).toMatch(/s\.status = 'reviewing'/);
    expect(migration).toMatch(/s\.updated_at > now\(\) - interval '3 minutes'/);
    expect(migration).toMatch(/br\.requester_id = auth\.uid\(\)/);
    expect(migration).toMatch(/br\.status = 'open'/);
    expect(migration).not.toMatch(/viewed_at|opened_at|composing|typing/);
    expect(migration).toMatch(/after insert or update of status, updated_at, dismissed_at on public\.business_offer_submissions/);
    // submissions stay closed to clients; only the requester-scoped ping table is readable
    expect(migration).not.toMatch(/grant select on public\.business_offer_submissions/);
  });

  it('screen: requester only, open request only, re-reads on a ping, removed on blur', () => {
    expect(screen).toMatch(/const watchResponding = !!request && request\.status === 'open' && !!myId && request\.requester_id === myId;/);
    expect(screen).toMatch(/subscribeToRespondingChanges\(requestId, \(\) => \{/);
    expect(screen).toMatch(/unsubscribe\(\);/);
    expect(screen).toMatch(/if \(dropped\) \{ liveReloadRef\.current = true; load\(\); \}/);
    expect(screen).toMatch(/watchResponding && respondingLine\(responding\) \?/);
  });
  it('a reply published while open builds itself in: the card remounts when it leaves pending', () => {
    expect(screen).toMatch(/<OfferAssembly key=\{`\$\{o\.id\}:\$\{o\.status === 'pending' \? 'pending' : 'reply'\}`\} offer=\{o\}>/);
  });

  it('motion: one small pulse, no loop, no haptic, Reduce Motion respected, inside the small tier', () => {
    const c = src('motion/RespondingStatus.js');
    expect(c).toMatch(/useReduceMotion/);
    expect(c).not.toMatch(/Animated\.loop|spring|playHaptic|expo-haptics|confetti/);
    const ms = settleMs('responding');
    expect(SEQUENCES.responding.tier).toBe('small');
    expect(ms).toBeGreaterThanOrEqual(MOTION_BUDGET.small.min);
    expect(ms).toBeLessThanOrEqual(MOTION_BUDGET.small.max);
  });
});
