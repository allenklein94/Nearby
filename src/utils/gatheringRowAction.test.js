// Item 196: typed-ask gathering rows and the "You're ready" cards show the one state-aware action, never a placeholder.
import fs from 'fs';
import path from 'path';
import { resultRowView, gatheringRowAction } from './recommendationContext';

const NOW = new Date(2026, 9, 4, 15, 0);
const later = new Date(NOW.getTime() + 4 * 3600e3).toISOString();
const ME = 'me';
const row = (g, myUserId = ME) => resultRowView({ type: 'gathering', id: 'g1', title: 'Coffee', startsAt: later, ...g }, { now: NOW, myUserId });

describe('item 196: gathering row action', () => {
  test('open public gathering, viewer state known = Join', () => {
    expect(row({ host_id: 'h', attendees: [], is_public: true }).action).toEqual({ kind: 'join', label: 'Join' });
  });
  test('approval needed = Request to Join; full = Join Waitlist', () => {
    expect(row({ host_id: 'h', attendees: [], is_public: true, requires_approval: true }).action.label).toBe('Request to Join');
    expect(row({ host_id: 'h', attendees: [], is_public: true, capacity: 2, approvedCount: 1 }).action.label).toBe('Join Waitlist');
  });
  test('hosting / going = View Plan; requested = Requested', () => {
    expect(row({ host_id: ME, attendees: [] }).action.label).toBe('View Plan');
    expect(row({ host_id: 'h', attendees: [{ user_id: ME, status: 'approved' }] }).action.label).toBe('View Plan');
    expect(row({ host_id: 'h', attendees: [{ user_id: ME, status: 'pending' }] }).action.label).toBe('Requested');
  });
  test('invite-only is a neutral status, not an action', () => {
    expect(row({ host_id: 'h', attendees: [], visibility: 'invite_only' }).action.kind).toBe('status');
  });
  test('unknown viewer state (no attendance rows, or signed out) = no action, never a wrong Join', () => {
    expect(row({ host_id: 'h', is_public: true }).action).toBeNull();
    expect(row({ host_id: 'h', attendees: [], is_public: true }, null).action).toBeNull();
  });
  test('plain View maps to nothing', () => {
    expect(gatheringRowAction({ kind: 'view', label: 'View' })).toBeNull();
    expect(gatheringRowAction(null)).toBeNull();
  });
  test('wiring: resolver carries the state fields, screens pass myUserId, wizard reads the shared action', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
    expect(read('../services/intentResolver.js')).toMatch(/attendees: Array\.isArray\(gathering\.attendees\)/);
    expect(read('../screens/HomeScreen.js').match(/resultRowView\(item, \{ language, myUserId \}\)/g)).toHaveLength(2);
    expect(read('../screens/DiscoverHubScreen.js')).toMatch(/resultRowView\(item, \{ language, myUserId \}\)/);
    const wizard = read('../screens/OnboardingRecommendationsScreen.js');
    expect(wizard).toMatch(/gatheringRowAction\(gatheringPrimaryAction\(r, myUserId\)\)/);
    expect(read('../services/homeDashboard.js')).toMatch(/attendees:gathering_interest\(status, user_id\)/);
  });
});
