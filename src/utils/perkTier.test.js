import fs from 'fs';
import path from 'path';
import { perkTierLine } from './perkTier';

const EN = {
  'ui.rewards.tier.bronze': 'Bronze', 'ui.rewards.tier.silver': 'Silver', 'ui.rewards.tier.gold': 'Gold',
  'ui.rewards.youveReachedTheTopTier': "You've reached the top tier",
};
const t = (k, v = {}) => {
  if (k === 'ui.rewards.member') return `${v.name} Member`;
  if (k === 'ui.rewards.moreToNext') return `${v.count} more redemption${v.count === 1 ? '' : 's'} to ${v.tier}`;
  return EN[k] ?? k;
};
const B = { name: 'Bronze', min: 5, emoji: '🥉' }; const S = { name: 'Silver', min: 15, emoji: '🥈' }; const G = { name: 'Gold', min: 30, emoji: '🥇' };
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('the perk tier is one line at the top of Discover -> Perks (rule 14)', () => {
  it('says the current tier and how far the next one is', () => {
    expect(perkTierLine({ points: 12, tier: B, nextTier: S, pointsToNextTier: 3 }, t)).toBe('🥉 Bronze Member · 3 more redemptions to Silver');
    expect(perkTierLine({ points: 31, tier: G, nextTier: null, pointsToNextTier: null }, t)).toBe("🥇 Gold Member · You've reached the top tier");
    expect(perkTierLine({ points: 4, tier: null, nextTier: B, pointsToNextTier: 1 }, t)).toBe('🎁 1 more redemption to Bronze');
  });
  it('says nothing when unknown or before the first redemption (never an invented 0)', () => {
    expect(perkTierLine(null, t)).toBeNull();
    expect(perkTierLine({ points: 0, tier: null, nextTier: B, pointsToNextTier: 5 }, t)).toBeNull();
    expect(read('services/rewards.js')).not.toMatch(/return \{ points: 0/);
  });
  it('is not a rewards dashboard: no tier list, no progress bar, no button', () => {
    const src = read('components/PerkTierLine.js');
    expect(src).not.toMatch(/TouchableOpacity|Pressable|allTiers|progress/i);
    expect(read('screens/DiscoverHubScreen.js')).toMatch(/typeFilter === 'perks' && !isSearching && <PerkTierLine \/>/);
  });
  it('the Rewards and Relationship Tools screens are gone and nothing routes to them', () => {
    for (const f of ['screens/RewardsScreen.js', 'screens/RelationshipToolsScreen.js']) expect(fs.existsSync(path.join(__dirname, '..', f))).toBe(false);
    const nav = read('navigation/RootNavigator.js') + read('navigation/notificationDestinations.js') + read('screens/SettingsScreen.js')
      + read('screens/ProfileScreen.js') + read('screens/LegacyLibraryScreen.js');
    expect(nav).not.toMatch(/['"](Rewards|RelationshipTools)['"]/);
  });
});
