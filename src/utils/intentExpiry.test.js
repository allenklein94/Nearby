// Owner item 113: a temporary intent ("dinner tonight") ends when its named time is over; a persistent preference ("I like
// coffee") is a declared interest and is never created or ended by a typed ask.
const fs = require('fs');
const path = require('path');
jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('../services/supabase', () => ({ supabase: { rpc: jest.fn() } }));
import { intentExpiresAt, isIntentExpired } from './intentExpiry';
import { resolveAsk, toClassification } from './askResolver';
import { createDiscoverSessionStore } from '../services/discoverSession';

const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const cls = (text) => toClassification(resolveAsk(text, null));

describe('when a temporary intent ends', () => {
  it('"Find me dinner tonight" is over at 4 AM the next morning', () => {
    const asked = at(2026, 9, 27, 18); // Sunday evening
    expect(cls('Find me dinner tonight').dateWindow).toBe('tonight');
    expect(isIntentExpired(cls('Find me dinner tonight'), asked, at(2026, 9, 27, 23, 30))).toBe(false);
    expect(isIntentExpired(cls('Find me dinner tonight'), asked, at(2026, 9, 28, 3, 59))).toBe(false);
    expect(isIntentExpired(cls('Find me dinner tonight'), asked, at(2026, 9, 28, 4))).toBe(true);
  });
  it('a "tonight" asked after midnight still belongs to that night', () => {
    expect(intentExpiresAt('tonight', at(2026, 9, 28, 1))).toBe(at(2026, 9, 28, 4));
  });
  it('now and today end the same way; tomorrow the morning after', () => {
    expect(intentExpiresAt('now', at(2026, 9, 27, 14))).toBe(at(2026, 9, 28, 4));
    expect(intentExpiresAt('today', at(2026, 9, 27, 9))).toBe(at(2026, 9, 28, 4));
    expect(intentExpiresAt('tomorrow', at(2026, 9, 27, 20))).toBe(at(2026, 9, 29, 4));
  });
  it('this weekend ends the Monday after it', () => {
    expect(intentExpiresAt('weekend', at(2026, 9, 23, 12))).toBe(at(2026, 9, 28, 4)); // Wednesday -> next Monday
    expect(intentExpiresAt('weekend', at(2026, 9, 26, 12))).toBe(at(2026, 9, 28, 4)); // Saturday
    expect(intentExpiresAt('weekend', at(2026, 9, 27, 12))).toBe(at(2026, 9, 28, 4)); // Sunday
  });
  it('an ask with no time word has no time-based end (the 180-day retention still applies)', () => {
    expect(cls('coffee near me').dateWindow).toBeNull();
    expect(intentExpiresAt(null, at(2026, 9, 27, 12))).toBeNull();
    expect(isIntentExpired(cls('coffee near me'), at(2026, 9, 27, 12), at(2026, 10, 20, 12))).toBe(false);
  });
});

describe('the Discover session follows it', () => {
  const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
  const storage = () => { const map = new Map(); return { map, getItem: async (k) => map.get(k) ?? null, setItem: async (k, v) => { map.set(k, v); }, removeItem: async (k) => { map.delete(k); }, getAllKeys: async () => [...map.keys()], multiRemove: async (ks) => ks.forEach((k) => map.delete(k)) }; };
  const state = (text, askedAt) => ({ typedText: text, classifyResult: cls(text), askedAt, updatedAt: askedAt, sessionId: 'cccccccc-0000-4000-8000-000000000001' });

  it('"dinner tonight" is restored the same evening and gone the next day', async () => {
    const s = storage();
    const asked = at(2026, 9, 27, 18);
    await createDiscoverSessionStore(s, () => asked).save(USER, state('Find me dinner tonight', asked));
    expect(await createDiscoverSessionStore(s, () => at(2026, 9, 27, 22)).load(USER)).not.toBeNull();
    expect(await createDiscoverSessionStore(s, () => at(2026, 9, 28, 9)).load(USER)).toBeNull();
    expect(s.map.size).toBe(0);
  });

  it('the account copy ends too: sync clears an expired session everywhere', async () => {
    const { supabase } = require('../services/supabase');
    const asked = at(2026, 9, 27, 18);
    const row = { session_id: 'cccccccc-0000-4000-8000-000000000001', typed_text: 'Find me dinner tonight', classify_result: cls('Find me dinner tonight'), asked_at: new Date(asked).toISOString(), client_updated_at: new Date(asked).toISOString(), cleared_at: null };
    supabase.rpc.mockImplementation(async (name) => (name === 'get_discover_session' ? { data: row, error: null } : { data: null, error: null }));
    let session;
    jest.isolateModules(() => {
      jest.doMock('./../services/discoverSession', () => ({ discoverSession: { load: async () => null, save: jest.fn(), clear: jest.fn() } }));
      const { syncDiscoverSession } = require('../services/discoverSessionSync');
      session = syncDiscoverSession(USER, () => at(2026, 9, 28, 9));
    });
    expect(await session).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith('clear_discover_session', expect.objectContaining({ session_id_param: row.session_id }));
  });
});

describe('a typed ask never becomes a persistent preference', () => {
  it('the expiry rule writes nothing and interests are never set from an ask', () => {
    const src = fs.readFileSync(path.join(__dirname, 'intentExpiry.js'), 'utf8');
    expect(src).not.toMatch(/supabase|interests\s*[:=]/);
    for (const f of ['../services/discoverSession.js', '../services/discoverSessionSync.js', '../services/askRefine.js', '../services/intentResolver.js']) {
      expect(fs.readFileSync(path.join(__dirname, f), 'utf8')).not.toMatch(/from\('profiles'\)\s*\.update|addLearnedInterestToProfile/);
    }
  });
});
