// Host command center (item 143 follow-up, owner): the group-chat message count is back, as a secondary pill on the
// Message action. One counting system (getGatheringMessageCount, RLS-scoped); the realtime event only triggers a
// re-count and its payload is never read. Authorization (blocked senders, non-members) is proven against production in
// scripts/live-verify/host-message-count.sql; this file drives the real service with the client mocked.
jest.mock('expo-crypto', () => ({ randomUUID: () => 'u' }));
jest.mock('expo-location', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('./friends', () => ({ getMyFriends: jest.fn() }));
jest.mock('./communities', () => ({ getMyCommunities: jest.fn() }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn(), requireUserLocation: jest.fn() }));

const mockDb = { count: 0, error: null, handlers: [], removed: 0, queries: [] };
jest.mock('./supabase', () => ({
  supabase: {
    from: (table) => ({
      select: (cols, opts) => ({
        eq: (col, val) => {
          mockDb.queries.push({ table, cols, opts, col, val });
          return Promise.resolve({ count: mockDb.error ? null : mockDb.count, error: mockDb.error });
        },
      }),
    }),
    channel: (name) => {
      const ch = {
        name,
        on: (kind, filter, handler) => { mockDb.handlers.push({ kind, filter, handler }); return ch; },
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: () => { mockDb.removed += 1; },
  },
}));

const fs = require('fs');
const path = require('path');
const { getGatheringMessageCount, subscribeToGatheringMessageChanges } = require('./gatherings');
const { messageBadge, MESSAGE_BADGE_MAX, hostStats } = require('../utils/hostCommandCenter');
const { translate } = require('../i18n/translate');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const detail = read('screens/GatheringDetailScreen.js');
const center = read('components/HostCommandCenter.js');

beforeEach(() => {
  mockDb.count = 0; mockDb.error = null; mockDb.handlers = []; mockDb.removed = 0; mockDb.queries = [];
});

describe('1. the Message button shows the correct count', () => {
  test('the count is the RLS-scoped count-only read of this gathering\'s chat (no rows, no bodies, no senders)', async () => {
    mockDb.count = 12;
    expect(await getGatheringMessageCount('g1')).toBe(12);
    expect(mockDb.queries).toEqual([{ table: 'gathering_messages', cols: 'id', opts: { count: 'exact', head: true }, col: 'gathering_id', val: 'g1' }]);
  });
  test('the pill shows that number; above 99 it reads 99+', () => {
    expect(messageBadge(12)).toBe('12');
    expect(messageBadge(1)).toBe('1');
    expect(messageBadge(MESSAGE_BADGE_MAX)).toBe('99');
    expect(messageBadge(250)).toBe('99+');
  });
  test('the label stays "Message"; the count is a separate secondary pill, never "Message (3)"', () => {
    expect(translate('en', 'ui.hostCenter.action.message')).toBe('Message');
    expect(center).toMatch(/\{actionLabel\(a\)\}<\/Text>\s*\{a === 'message' && msgBadge \? \(\s*<View style=\{styles\.countPill\}/);
    expect(center).not.toMatch(/Message \(/);
    // a neutral pill (a total, not an unread alert): never the red danger badge
    const pill = center.slice(center.indexOf('countPill: {'), center.indexOf('countPillText:'));
    expect(pill).toMatch(/backgroundColor: colors\.border/);
    expect(pill).not.toMatch(/danger|primary/);
  });
  test('screen readers hear the count with the action', () => {
    expect(translate('en', 'ui.hostCenter.messageCountA11y', { count: 12 })).toBe('Message, 12 messages in the group chat');
    expect(translate('en', 'ui.hostCenter.messageCountA11y', { count: 1 })).toBe('Message, 1 message in the group chat');
    for (const l of ['es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko']) {
      expect(translate(l, 'ui.hostCenter.messageCountA11y', { count: 3 })).not.toMatch(/^ui\./);
    }
  });
  test('the screen passes the loaded count to the command center', () => {
    expect(detail).toMatch(/getGatheringMessageCount\(gatheringId\),\s*\]\);\s*setHostMessageCount\(messageCount\);/);
    expect(detail).toMatch(/messageCount=\{hostMessageCount\}/);
  });
});

describe('2. the count updates when messages change', () => {
  test('a chat change calls back with NOTHING (payload dropped); the caller re-reads the count', async () => {
    const seen = [];
    const unsubscribe = subscribeToGatheringMessageChanges('g1', (...args) => seen.push(args));
    expect(mockDb.handlers).toHaveLength(1);
    expect(mockDb.handlers[0].filter).toEqual({ event: '*', schema: 'public', table: 'gathering_messages', filter: 'gathering_id=eq.g1' });
    mockDb.handlers[0].handler({ new: { id: 'm1', body: 'secret', sender_id: 'blocked-person' } });
    expect(seen).toEqual([[]]);
    // the re-read reflects the new total
    mockDb.count = 13;
    expect(await getGatheringMessageCount('g1')).toBe(13);
    unsubscribe();
    expect(mockDb.removed).toBe(1);
  });
  test('the screen re-counts on every change and on focus, host only, and unsubscribes on leave', () => {
    expect(detail).toMatch(/const recount = async \(\) => \{\s*const n = await getGatheringMessageCount\(gatheringId\);\s*if \(!cancelled\) setHostMessageCount\(n\);/);
    expect(detail).toMatch(/subscribeToGatheringMessageChanges\(gatheringId, recount\)/);
    expect(detail).toMatch(/if \(!isHostViewer \|\| !gatheringId\) return undefined;/);
    expect(detail).toMatch(/cancelled = true;\s*unsubscribe\(\);/);
  });
});

describe('3. nothing the host may not see reaches the badge', () => {
  test('the subscription never forwards a body or sender, and the screen never reads one', () => {
    const svc = read('services/gatherings.js');
    const fn = svc.slice(svc.indexOf('export function subscribeToGatheringMessageChanges'), svc.indexOf('export function subscribeToGatheringMessageChanges') + 700);
    expect(fn).toMatch(/\(\) => onChange\(\)/);
    expect(fn).not.toMatch(/payload|\.new\b|body|sender/);
    const effect = detail.slice(detail.indexOf('const isHostViewer'), detail.indexOf('const isHostViewer') + 900);
    expect(effect).not.toMatch(/payload|body|sender_id/);
  });
  test('the count read goes through the client (RLS applies), never a SECURITY DEFINER count function', () => {
    const svc = read('services/gatherings.js');
    const fn = svc.slice(svc.indexOf('export async function getGatheringMessageCount'), svc.indexOf('export function subscribeToGatheringMessageChanges'));
    expect(fn).toMatch(/\.from\('gathering_messages'\)/);
    expect(fn).not.toMatch(/\.rpc\(/);
  });
});

describe('4. zero and unknown', () => {
  test('0 messages: plain "Message", no pill', async () => {
    mockDb.count = 0;
    expect(messageBadge(await getGatheringMessageCount('g1'))).toBeNull();
  });
  test('a failed lookup is unknown (null): no pill, never "0"', async () => {
    mockDb.error = { message: 'boom' };
    expect(await getGatheringMessageCount('g1')).toBeNull();
    expect(messageBadge(null)).toBeNull();
    expect(messageBadge(undefined)).toBeNull();
    expect(messageBadge(NaN)).toBeNull();
  });
});

describe('5. Interested and pending requests stay separate; no standalone messages figure returns', () => {
  test('the stats row has no messages figure', () => {
    expect(hostStats({ going: 4, requests: 2, interested: 3, messages: 9 }).map((s) => s.key)).toEqual(['going', 'requests', 'interested']);
    expect(detail).not.toMatch(/statMessages/);
    expect(detail).not.toMatch(/messages: messageCount|countdownStats\.messages/);
  });
  test('requests and Interested come from different sources and keep their own labels', () => {
    expect(detail).toMatch(/requests,\s*\n\s*waitlisted: g\.waitlistCount/);
    expect(detail).toMatch(/interested: g\.interestedCount \?\? null/);
    expect(translate('en', 'ui.hostCenter.stat.requests', { count: 2 })).toBe('2 requests to join');
    expect(translate('en', 'ui.hostCenter.stat.interested', { count: 3 })).toBe('3 interested');
  });
});
