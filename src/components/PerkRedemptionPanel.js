import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Image } from 'react-native';
import { usePostHog } from 'posthog-react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';
import { redeemOffer, followBusiness, unfollowBusiness, isFollowingBusiness, getRedemptionCounts, getMyRedemptionFor } from '../services/brandOffers';
import { getCommunityMemberCount } from '../services/communities';
import { getApprovedAttendeeCount } from '../services/gatherings';
import { presentRecoverableError } from '../utils/recoverableError';
import { unlockStatus } from '../utils/unlockProgress';
import { perkRedemptionState } from '../utils/perkRedemptionState';
import PerkCodeBox from './PerkCodeBox';

// The selected perk's redemption context, shown in place under its card on Discover -> Perks (owner, 2026-10-04: the
// former BrandOffers screen's redemption moved here; there is no separate perk screen or second perk list). It loads only
// what this ONE perk needs (follow state, spots claimed, unlock progress, the viewer's own redemption row) and redeems
// from here. After a claim the person stays on the perk: the staff code and the optional "stay connected" choice appear
// inline instead of alerts. Owner (2026-10-12): the state comes from utils/perkRedemptionState.js only: a claimed perk
// shows its code every time it is opened; "Redeemed" only once the business has confirmed the visit.
// `redemption` = the viewer's row the list already has (null/undefined = none known); the panel re-reads it on open (the
// business may have confirmed since) and reports it back through onRedemption.
export default function PerkRedemptionPanel({ offer, redemption, onRedemption, onClose, onOpenBusiness }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors);
  const name = offer.brand_partners?.name ?? null;

  const [following, setFollowing] = useState(null);
  const [claimed, setClaimed] = useState(null);
  const [progress, setProgress] = useState(undefined);
  const [redeeming, setRedeeming] = useState(false);
  const [claimedHere, setClaimedHere] = useState(false); // claimed in this visit: offers the "stay connected" choice
  const [followAsked, setFollowAsked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setClaimedHere(false);
    setFollowAsked(false);
    getMyRedemptionFor(offer.id).then((row) => { if (!cancelled) onRedemption?.(offer.id, row); }).catch(() => {});
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
  // Unknown (the list's read failed) = available: the server refuses a second claim, and that path shows the code.
  const state = perkRedemptionState(redemption ?? null);
  const showFollowAsk = claimedHere && following === false && !followAsked;

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
      setClaimedHere(true);
      if (offer.redemption_limit != null) setClaimed((c) => (c ?? 0) + 1);
      onRedemption?.(offer.id, { offer_id: offer.id, confirmation_code: confirmationCode, confirmed_at: null });
    } catch (e) {
      if (e.message === 'ALREADY_REDEEMED') {
        // Already claimed (another device, a stale list): show what is true now, the code or the confirmed badge.
        try { onRedemption?.(offer.id, await getMyRedemptionFor(offer.id)); }
        catch (readError) { presentRecoverableError(Alert, { what: 'complete that', error: readError, onRetry: handleRedeem }); }
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

      {state === 'claimed' ? (
        <PerkCodeBox code={redemption?.confirmation_code} businessName={name} instructions={offer.redemption_instructions} />
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
        {state === 'confirmed' ? (
          <View style={styles.redeemedBadge}>
            <Text style={styles.redeemedBadgeText}>{t('brandOffers.redeemed')}</Text>
          </View>
        ) : state === 'claimed' ? (
          <View style={styles.actionSpacer} />
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
  actionSpacer: { flex: 1 },
  closeButton: { paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
});
