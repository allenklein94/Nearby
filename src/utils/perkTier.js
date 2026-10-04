// Rule 14 (owner, 2026-10-04): the Rewards screen is folded into Discover -> Perks as ONE compact informational line,
// context for Perks, not a rewards dashboard: the current tier and how far the next one is. No tier list, no points
// dashboard, no action. Built only from getMyRewardStatus() (services/rewards.js: the caller's own real redemption count).
//   "🥈 Silver Member · 3 more redemptions to Gold"   "🥇 Gold Member · You've reached the top tier"
//   "🎁 2 more redemptions to Bronze" (redeemed some, no tier yet)   nothing: unknown status, or nothing redeemed yet.
export function perkTierLine(status, t) {
  if (!status || typeof status.points !== 'number') return null;
  const tierName = (tier) => t(`ui.rewards.tier.${tier.name.toLowerCase()}`);
  const next = status.nextTier ? t('ui.rewards.moreToNext', { count: status.pointsToNextTier, tier: tierName(status.nextTier) }) : null;
  if (status.tier) {
    return `${status.tier.emoji} ${t('ui.rewards.member', { name: tierName(status.tier) })} · ${next ?? t('ui.rewards.youveReachedTheTopTier')}`;
  }
  if (status.points > 0 && next) return `🎁 ${next}`;
  return null;
}
