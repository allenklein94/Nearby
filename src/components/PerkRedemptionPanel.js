import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Image } from 'react-native';
import { usePostHog } from 'posthog-react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';
import { redeemOffer, followBusiness, unfollowBusiness, isFollowingBusiness, getRedemptionCounts } from '../services/brandOffers';
import { getCommunityMemberCount } from '../services/communities';
import { getApprovedAttendeeCount } from '../services/gatherings';
import { presentRecoverableError } from '../utils/recoverableError';
import { unlockStatus } from '../utils/unlockProgress';

// The selected perk's redemption context, shown in place under its card on Discover -> Perks (owner, 2026-10-04: the
// former BrandOffers screen's redemption moved here; there is no separate perk screen or second perk list). It loads only
// what this ONE perk needs (follow state, spots claimed, unlock progress) and redeems from here. After a redemption the
// person stays on the perk: the staff code and the optional "stay connected" choice appear inline instead of alerts.
export default function PerkRedemptionPanel({ offer, redeemed, onRedeemed, onClose, onOpenBusiness }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors);
  const name = offer.brand_partners?.name ?? null;

  const [following, setFollowing] = useState(null);
  const [claimed, setClaimed] = useState(null);
  const [progress, setProgress] = useState(undefined);
  const [redeeming, setRedeeming] = useState(false);
  const [code, setCode] = useState(null); // shown after a redemption in this visit
  const [followAsked, setFollowAsked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCode(null);
    setFollowAsked(false);
    isFollowingBusiness(offer.partner_id).then((v) => { if (!cancelled) setFollowing(!!v); }).catch(() => {});
    if (offer.redemption_limit != null) {
      getRedemptionCounts([offer.id]).then((c) => { if (!cancelled) setClaimed(c?.[offer.id] ?? 0); }).catch(() => {});
    }
    if (offer.unlock_scope != null) {
      const load = offer.unlock_scope === 'community' ? getCommunityMemberCount(offer.unlock_community_id) : getApprovedAttendeeCount(offer.gathering_id);
      Promise.resolve(load).then((n) => { if (!cancelled) setProgress(n); }).catch(() => { if (!cancelled) setProgress(null); });
    }
    return () => { cancelled = true; };
  }, [offer.id]);

  const unlock = unlockStatus(offer, progress);
  const isLocked = unlock?.isLocked ?? false;
  const showFollowAsk = !!code && following === false && !followAsked;

  async function toggleFollow() {
    const next = !following;
    try {
      if (next) await followBusiness(offer.partner_id);
      else await unfollowBusiness(offer.partner_id);
      setFollowing(next);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e });
    }
  }

  async function handleRedeem() {
    setRedeeming(true);
    try {
      const { confirmationCode } = await redeemOffer(offer.id);
      posthog?.capture?.('brand_offer_redeemed', { offer_id: offer.id, partner: name });
      setCode(confirmationCode);
      if (offer.redemption_limit != null) setClaimed((c) => (c ?? 0) + 1);
      onRedeemed?.(offer.id);
    } catch (e) {
      if (e.message === 'ALREADY_REDEEMED') {
        Alert.alert(t('ui.brandOffersUi.alreadyRedeemed'), t('ui.brandOffersUi.youveAlreadyClaimedThisOffer'));
        onRedeemed?.(offer.id);
      } else if (e.message === 'REDEMPTION_LIMIT_REACHED') {
        Alert.alert(t('ui.brandOffersUi.offerFullyClaimed'), t('ui.brandOffersUi.thisOffersLimitedSpotsHave'));
      } else if (e.message === 'OFFER_LOCKED') {
        Alert.alert(t('ui.brandOffersUi.notUnlockedYet'), t('ui.brandOffersUi.thisOfferNeedsMorePeople'));
      } else {
        presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: handleRedeem });
      }
    }
    setRedeeming(false);
  }

  return (
    <View style={styles.panel}>
      <TouchableOpacity
        style={styles.businessRow}
        onPress={onOpenBusiness}
        accessibilityLabel={t('ui.brandOffersUi.viewSBusinessProfileA11y', { name })}
        accessibilityRole="button"
      >
        {offer.brand_partners?.logo_url ? (
          <Image source={{ uri: offer.brand_partners.logo_url }} style={styles.logo} />
        ) : (
          <View style={styles.logo} />
        )}
        <Text style={styles.partnerName} numberOfLines={1}>{name}</Text>
      </TouchableOpacity>

      {offer.description ? <Text style={styles.description}>{offer.description}</Text> : null}
      {offer.redemption_limit != null && claimed != null && (
        <Text style={styles.fact}>
          {t('ui.brandOffersUi.spotsLeftOf', { left: Math.max(0, offer.redemption_limit - claimed), count: offer.redemption_limit })}
        </Text>
      )}
      {offer.unlock_scope != null && (
        <Text style={styles.fact}>
          {isLocked ? unlock.label : (offer.unlock_scope === 'community' ? t('ui.brandOffersUi.unlockedCommunity') : t('ui.brandOffersUi.unlockedGathering'))}
        </Text>
      )}

      {code ? (
        <View style={styles.codeBox} accessibilityLiveRegion="polite">
          <Text style={styles.codeLabel}>{t('ui.brandOffersUi.yourCode')}</Text>
          <Text style={styles.codeText}>
            {t('ui.brandOffersUi.showStaffCode', { code, instructions: offer.redemption_instructions || t('ui.brandOffersUi.checkYourAccountForDetails') })}
          </Text>
        </View>
      ) : null}

      {/* The optional "stay connected" choice after a redemption: a genuine choice, never a default opt-in. */}
      {showFollowAsk ? (
        <View style={styles.followAsk}>
          <Text style={styles.followAskTitle}>{t('ui.brandOffersUi.stayConnectedWith', { name: name ?? t('ui.brandOffersUi.thisBusiness') })}</Text>
          <Text style={styles.followAskBody}>{t('ui.brandOffersUi.theyllBeAbleToInvite')}</Text>
          <View style={styles.followAskRow}>
            <TouchableOpacity onPress={() => setFollowAsked(true)} accessibilityRole="button">
              <Text style={styles.secondaryText}>{t('ui.brandOffersUi.noThanks')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={async () => { setFollowAsked(true); await toggleFollow(); }} accessibilityRole="button">
              <Text style={styles.linkText}>{t('ui.brandOffersUi.yesStayConnected')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : following != null ? (
        <TouchableOpacity
          onPress={toggleFollow}
          accessibilityLabel={following ? t('ui.brandOffersUi.unfollowA11y', { name }) : t('ui.brandOffersUi.followA11y', { name })}
          accessibilityRole="button"
        >
          <Text style={styles.linkText}>{following ? t('ui.brandOffersUi.following') : t('ui.brandOffersUi.follow')}</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.actionRow}>
        {redeemed ? (
          <View style={styles.redeemedBadge}>
            <Text style={styles.redeemedBadgeText}>{t('brandOffers.redeemed')}</Text>
          </View>
        ) : isLocked ? (
          <View style={[styles.redeemButton, styles.lockedButton]}>
            <Text style={styles.lockedButtonText}>{t('ui.brandOffersUi.locked')}</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.redeemButton}
            onPress={handleRedeem}
            disabled={redeeming}
            activeOpacity={0.85}
            accessibilityLabel={t('ui.brandOffersUi.fromA11y', { value: t('brandOffers.redeem'), title: offer.title, name })}
            accessibilityRole="button"
          >
            <Text style={styles.redeemButtonText}>{redeeming ? t('ui.brandOffersUi.redeeming') : t('brandOffers.redeem')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onClose} accessibilityLabel={t('ui.brandOffersUi.closePerkA11y', { title: offer.title })} accessibilityRole="button" style={styles.closeButton}>
          <Text style={styles.secondaryText}>{t('ui.brandOffersUi.close')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  panel: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, paddingTop: spacing.xs },
  businessRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  logo: { width: 32, height: 32, borderRadius: radius.md, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  partnerName: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', flex: 1 },
  description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  fact: { color: colors.textSecondary, fontWeight: '700', fontSize: 12, marginBottom: spacing.sm },
  codeBox: { backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  codeLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs },
  codeText: { ...typography.body, color: colors.textPrimary },
  followAsk: { marginBottom: spacing.sm },
  followAskTitle: { ...typography.bodyBold, color: colors.textPrimary },
  followAskBody: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  followAskRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  linkText: { color: colors.primary, fontSize: 13, fontWeight: '700', marginBottom: spacing.sm },
  secondaryText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  redeemButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 12, alignItems: 'center' },
  redeemButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  redeemedBadge: { flex: 1, alignSelf: 'flex-start', backgroundColor: colors.primaryMuted, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, alignItems: 'center' },
  redeemedBadgeText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  lockedButton: { backgroundColor: colors.surfaceElevated },
  lockedButtonText: { color: colors.textTertiary, fontWeight: '700', fontSize: 14 },
  closeButton: { paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
});
