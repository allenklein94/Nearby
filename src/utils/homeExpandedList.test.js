// Item 136 follow-up (owner, 2026-10-01): an insight list the person opens on Home shows every gathering it counted, and
// while open those gatherings leave Best Pick / Picked For You / weather rows. Dedupe by id; each keeps its own destination.
jest.mock('../services/supabase', () => ({ supabase: {} }));
jest.mock('../services/proximity', () => ({}));
jest.mock('../services/gatherings', () => ({}));
jest.mock('../services/userLocation', () => ({ getUserLocation: jest.fn() }));
import fs from 'fs';
import path from 'path';
import { selectHomeAttention, cardWithoutIds, expandedListIds, HOME_SECTION_PRIORITY } from './homeAttention';
import { getHomeInsight } from '../services/homeDashboard';

const now = new Date(2026, 8, 22, 19, 0, 0);
const at = (min) => new Date(now.getTime() + min * 60000).toISOString();
const g = (id, host, extra = {}) => ({ id, title: `T-${id}`, scheduled_at: at(120), profiles: { display_name: host }, ...extra });
const card = (gathering, reasons = ['Because you like Coffee']) => ({ gathering, reasons, signals: reasons.map((text) => ({ kind: 'interest', text })) });

// The same composition HomeScreen performs: placements above weather, then the attention list.
function home({ friends = [], soon = [], hero = null, cards = [], weather = null, expanded = null, yourPlans = [] }) {
  const insight = getHomeInsight({ friendsActivity: friends, happeningNow: soon }, now);
  const ids = expandedListIds(insight, expanded);
  const above = new Set([...yourPlans, ...ids]);
  const weatherCard = cardWithoutIds(weather, above);
  const attention = selectHomeAttention({ hero, cards, exclude: new Set([...above, ...(weatherCard ? weatherCard.gatherings.map((x) => x.id) : [])]), now });
  return { insight, ids, weatherCard, attention };
}

describe('expanded friends list on Home', () => {
  const friends = [g('a', 'Sam'), g('b', 'Alex'), g('c', 'Jo')];

  test('expanded: every friend gathering is listed, none trimmed', () => {
    const { insight, ids } = home({ friends, expanded: 'friends_planning' });
    expect(insight.cta.destination.items.map((i) => i.gathering.id)).toEqual(['a', 'b', 'c']);
    expect([...ids]).toEqual(['a', 'b', 'c']);
  });

  test('overlapping gatherings leave Picked For You while expanded, and come back when collapsed', () => {
    const cards = [card(friends[0]), card(g('x', 'Kim')), card(friends[2])];
    const open = home({ friends, cards, expanded: 'friends_planning' });
    expect(open.attention.items.map((c) => c.gathering.id)).toEqual(['x']);
    const closed = home({ friends, cards, expanded: null });
    expect(closed.attention.items.map((c) => c.gathering.id).sort()).toEqual(['a', 'c', 'x']);
  });

  test('Best Pick conflict: a Best Pick already in the expanded list is dropped and the slot refills', () => {
    const hero = { ...friends[1], reasons: ['Sam is going'] };
    const open = home({ friends, hero, cards: [card(g('y', 'Lee'))], expanded: 'friends_planning' });
    expect(open.attention.hero).toBeNull();
    expect(open.attention.items.map((c) => c.gathering.id)).toEqual(['y']);
    const closed = home({ friends, hero, cards: [card(g('y', 'Lee'))], expanded: null });
    expect(closed.attention.hero.id).toBe('b');
  });

  test('weather rows drop gatherings the expanded list shows', () => {
    const weather = { bias: 'indoor', gatherings: [friends[0], g('w', 'Pat')] };
    const open = home({ friends, weather, expanded: 'friends_planning' });
    expect(open.weatherCard.gatherings.map((x) => x.id)).toEqual(['w']);
  });

  test('dedupe is by id only: same title or same host is not a duplicate', () => {
    const twin = g('z', 'Sam', { title: friends[0].title });
    const open = home({ friends, cards: [card(twin)], expanded: 'friends_planning' });
    expect(open.attention.items.map((c) => c.gathering.id)).toEqual(['z']);
  });

  test('ranking of what remains is unchanged', () => {
    const cards = [card(g('p', 'A'), ['Because you like Coffee', 'Sam is going']), card(friends[0]), card(g('q', 'B'))];
    const open = home({ friends, cards, expanded: 'friends_planning' });
    const base = selectHomeAttention({ cards: cards.filter((c) => c.gathering.id !== 'a'), now });
    expect(open.attention.items.map((c) => c.gathering.id)).toEqual(base.items.map((c) => c.gathering.id));
  });

  test('navigation: each listed gathering opens its own detail', () => {
    const { insight } = home({ friends, expanded: 'friends_planning' });
    for (const it of insight.cta.destination.items) {
      expect(it.destination).toEqual({ kind: 'navigate', screen: 'GatheringDetail', params: { gatheringId: it.gathering.id } });
    }
  });

  test('a stale expanded kind (the line changed) suppresses nothing', () => {
    expect(expandedListIds(getHomeInsight({ happeningNow: [g('s1'), g('s2')] }, now), 'friends_planning').size).toBe(0);
    expect(expandedListIds(getHomeInsight({ friendsActivity: friends }, now), null).size).toBe(0);
  });

  test('the starting-soon list behaves the same way', () => {
    const soon = [g('s1', 'A', { scheduled_at: at(20) }), g('s2', 'B', { scheduled_at: at(25) })];
    const open = home({ soon, cards: [card(soon[0]), card(g('k', 'C'))], expanded: 'starting_soon' });
    expect(open.attention.items.map((c) => c.gathering.id)).toEqual(['k']);
  });

  test("the person's own plans are not removed by the expanded list (placed above it)", () => {
    expect(HOME_SECTION_PRIORITY.indexOf('yourPlans')).toBeLessThan(HOME_SECTION_PRIORITY.indexOf('expandedList'));
    expect(HOME_SECTION_PRIORITY.indexOf('expandedList')).toBeLessThan(HOME_SECTION_PRIORITY.indexOf('bestPick'));
  });

  test('Home wires it in; Discover never reads it', () => {
    const home = fs.readFileSync(path.join(__dirname, '..', 'screens', 'HomeScreen.js'), 'utf8');
    expect(home).toContain('expandedListIds(homeInsight, insightExpanded)');
    expect(home).toMatch(/aboveWeather = new Set\(\[\.\.\.firstRunIds, \.\.\.yourPlansIds, \.\.\.expandedIds\]\)/);
    const discover = fs.readFileSync(path.join(__dirname, '..', 'screens', 'DiscoverHubScreen.js'), 'utf8');
    expect(discover).not.toMatch(/expandedListIds|insightExpanded/);
  });
});
