// Discover design review (owner-approved 2026-10-10): presentation only. Tile type follows the section (top of Because you
// like / Friends are into / Trending = hero, Tonight / This Weekend = compact rows), communities / places / perks are compact
// rows, and nothing about ranking, dedupe, sections, reasons or actions changes.
import fs from 'fs';
import path from 'path';
import {
  buildDiscoverSections, discoverTileVariant, sectionHeroEyebrowCode, sectionLeadReason,
  HERO_SECTION_KEYS, COMPACT_SECTION_KEYS,
} from './discoverSections';
import { gatheringCardModel } from './recommendationCard';
import { becauseYouLikeReason, reasonText } from '../constants/recommendationReasonVocabulary';

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const screen = read('screens/DiscoverHubScreen.js');
const placeCard = read('components/PlaceCard.js');
const compactRow = read('components/CompactRow.js');

const NOW = new Date(2026, 8, 25, 20, 0); // Fri 8 PM
const at = (h, dayOffset = 0) => new Date(2026, 8, 25 + dayOffset, h, 0).toISOString();
const isInWindow = (iso, key) => {
  const d = new Date(iso);
  const mins = (d - NOW) / 60000;
  if (key === 'now') return mins >= -30 && mins <= 60;
  if (key === 'today') return d.toDateString() === NOW.toDateString() && mins > 0;
  if (key === 'weekend') return [0, 6].includes(d.getDay());
  return false;
};
const g = (id, over = {}) => ({ id, title: id, scheduled_at: at(12, 5), interest_tag: 'Coffee', approvedCount: 0, ...over });

function sample() {
  return buildDiscoverSections({
    gatherings: [
      g('now', { scheduled_at: at(20) }),
      g('tonight1', { scheduled_at: at(22) }),
      g('tonight2', { scheduled_at: at(23) }),
      g('hot1', { approvedCount: 12, interest_tag: 'Live Music' }),
      g('hot2', { approvedCount: 9, interest_tag: 'Live Music' }),
      g('yoga1', { interest_tag: 'Yoga' }),
      g('yoga2', { interest_tag: 'Yoga' }),
      g('jazz', { interest_tag: 'Jazz' }),
      g('sat', { scheduled_at: at(12, 1), interest_tag: 'Hiking' }),
    ],
    now: NOW,
    isInWindow,
    declared: ['Yoga'],
    friendInterestByTag: { Jazz: { friend_count: 2, sample_names: ['Sam', 'Alex'] } },
  });
}

describe('tile type by section', () => {
  it('top of a reason section is the hero; the rest stay standard', () => {
    expect(HERO_SECTION_KEYS).toEqual(['because', 'friends', 'trending']);
    for (const key of HERO_SECTION_KEYS) {
      expect(discoverTileVariant(key, 0)).toBe('hero');
      expect(discoverTileVariant(key, 1)).toBe('standard');
      expect(discoverTileVariant(key, 3)).toBe('standard');
    }
  });

  it('every gathering in Tonight / This Weekend is a compact row, including the first', () => {
    expect(COMPACT_SECTION_KEYS).toEqual(['tonight', 'weekend']);
    for (const key of COMPACT_SECTION_KEYS) {
      expect(discoverTileVariant(key, 0)).toBe('compact');
      expect(discoverTileVariant(key, 2)).toBe('compact');
    }
  });

  it('Happening Now and non-section lists keep their own tiles (no override)', () => {
    expect(discoverTileVariant('now', 0)).toBeNull();
    expect(discoverTileVariant(null, 0)).toBeNull();
    expect(discoverTileVariant(undefined, 0)).toBeNull();
  });

  it('on a real section build: one hero per reason section, compact for timing sections, order + dedupe untouched', () => {
    const sections = sample();
    expect(sections.map((s) => s.key)).toEqual(['now', 'tonight', 'because', 'friends', 'trending', 'weekend']);
    const ids = sections.flatMap((s) => s.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    const variants = Object.fromEntries(sections.map((s) => [s.key, s.items.map((_, i) => discoverTileVariant(s.key, i))]));
    expect(variants.tonight).toEqual(['compact', 'compact']);
    expect(variants.weekend).toEqual(['compact']);
    expect(variants.because).toEqual(['hero', 'standard']);
    expect(variants.friends).toEqual(['hero']);
    expect(variants.trending).toEqual(['hero', 'standard']);
    expect(variants.now).toEqual([null]);
  });

  it('presentation never reads score, reasons or membership', () => {
    const fn = fs.readFileSync(path.join(__dirname, 'discoverSections.js'), 'utf8')
      .split('export function discoverTileVariant')[1].split('\n}')[0];
    expect(fn).not.toMatch(/score|reason|fit|items/);
  });
});

describe('hero reasons and actions stay real', () => {
  it('a Because-you-like hero leads with "Because you like Yoga" and keeps its real Join action', () => {
    const item = g('yoga1', { interest_tag: 'Yoga', host_id: 'host', attendees: [], is_public: true });
    const lead = sectionLeadReason('because', item);
    expect(lead).toBe(becauseYouLikeReason('Yoga'));
    const card = gatheringCardModel(item, {
      signals: [{ kind: 'reason', text: becauseYouLikeReason('Yoga') }], leadReason: lead, now: NOW.getTime(), myUserId: 'me',
    });
    expect(card.reasons[0]).toBe('Because you like Yoga');
    expect(card.action?.label).toBe('Join');
  });

  it('a Trending hero leads with the real attendance count', () => {
    const item = g('hot1', { approvedCount: 12 });
    expect(sectionLeadReason('trending', item)).toBe(reasonText('attendingCount', { count: 12 }));
  });

  it('hero labels are the section\'s own signal, never "Personalized"', () => {
    expect(sectionHeroEyebrowCode('trending', g('x'))).toBe('TRENDING');
    for (const key of ['because', 'friends']) {
      const code = sectionHeroEyebrowCode(key, g('x', { scheduled_at: at(22) }), NOW);
      expect(code).not.toBe('PERSONALIZED');
      expect(code).not.toBe('RECOMMENDED');
    }
    expect(sectionHeroEyebrowCode('because', g('x', { scheduled_at: null }), NOW)).toBeNull();
  });
});

describe('Discover screen wiring (source guards)', () => {
  const tile = screen.split('function renderGatheringTile')[1].split('function renderHappeningNowTile')[0];

  it('the section loop passes the section key, so the variant follows the section', () => {
    expect(screen).toMatch(/section\.items\.map\(\(g, i\) => renderGatheringTile\(g, i, section\.key\)\)/);
    expect(tile).toMatch(/discoverTileVariant\(sectionKey, index\)/);
    // outside sections the old score tiers are kept
    expect(tile).toMatch(/\?\? \(g\.fit\.score >= HERO_SCORE \? 'hero' : 'standard'\)/);
  });

  it('every tile keeps the real reason line and the shared state-aware action (no Explore)', () => {
    expect(tile).toMatch(/const action = gatheringActionInfo\(g, card\)/);
    expect(tile).toMatch(/card\.reasons\[0\]/);
    expect(tile).toMatch(/openDestination\(navigation, card\.destination\)/);
    expect(tile).not.toMatch(/Explore/);
  });

  it('no generic copy, no mixed "More nearby" list, no Recommended-for-you or standalone Gatherings list on All', () => {
    const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // rendered code, not comments
    for (const bad of ['Personalized for you', 'Matches your interest', 'More nearby', 'Recommended for you']) {
      expect(code).not.toContain(bad);
    }
  });

  it('section labels are unchanged, including This Weekend', () => {
    expect(screen).toMatch(/case 'weekend': return t\('ui\.discover\.section\.weekend'\)/);
    expect(screen).toMatch(/case 'tonight': return t\(String\(section\.title\)\.startsWith\('🌙'\) \? 'ui\.discover\.section\.tonight' : 'ui\.discover\.section\.today'\)/);
  });

  it('communities render as compact rows, not the white card', () => {
    expect(screen).toMatch(/function renderCommunityRow/);
    const communityMaps = screen.match(/\.map\(\(c\) => \{ const cc = communityContext\(c\); return \([\s\S]*?\); \}\)/g) || [];
    expect(communityMaps.length).toBe(2);
    for (const m of communityMaps) {
      expect(m).toMatch(/renderCommunityRow/);
      expect(m).not.toMatch(/styles\.card\b/);
    }
  });

  it('places and perks (PlaceCard) are compact rows', () => {
    expect(placeCard).toMatch(/<CompactRow/);
    expect(placeCard).not.toMatch(/borderRadius|shadow/);
    expect(compactRow).toMatch(/hairlineWidth/);
    expect(compactRow).toMatch(/COMPACT_ROW_MIN_HEIGHT = 56/);
  });

  it('a perk still expands in place when selected (never a navigable row)', () => {
    const perk = screen.split('function renderPerkCard')[1].split('function withSelectedPerk')[0];
    expect(perk).toMatch(/onPress=\{\(\) => \(selectedPerkId === o\.id \? clearPerkSelection\(\) : selectPerk\(o\.id\)\)\}/);
    expect(perk).toMatch(/<PerkRedemptionPanel/);
    expect(perk).toMatch(/accessibilityState=\{\{ expanded: selectedPerkId === o\.id \}\}/);
    expect(perk).not.toMatch(/navigation\.navigate|openDestination\(navigation, pc\.destination\)/);
  });
});
