import React, { useState, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import EmptyCopy from '../components/EmptyCopy';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, Alert, ActivityIndicator, Image, Modal } from 'react-native';
import { NLoader, SuccessAnimation, modalAnimation } from '../motion';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { recordBehaviorEvent } from '../services/behaviorSignals';
import { getMyCommunities, joinCommunity, leaveCommunity, deleteCommunity, pauseCommunity, resumeCommunity, cancelCommunity, getCommunityMemberCount, getCommunityGatherings, getCommunityMembers, setCommunityMemberRole, updateCommunityArea } from '../services/communities';
import { isFollowingBusiness, followBusiness, unfollowBusiness, getCommunityOffers, getMyRedemptions, redeemOffer, getMyManagedPartner } from '../services/brandOffers';
import { getBusinessRequestForCommunity, getAcceptedOfferForRequest } from '../services/businessFulfillment';
import { getMyPartnershipRequestForTarget } from '../services/businessPartnerships';
import { CATEGORY_OPTIONS as BUSINESS_REQUEST_CATEGORY_OPTIONS } from './AskBusinessScreen';
import { getSignedPhotoUrl } from '../services/photos';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import CommunityCalendar from '../components/CommunityCalendar';
import CancellationReasonSheet from '../components/CancellationReasonSheet';
import AcceptedBusinessOfferCard from '../components/AcceptedBusinessOfferCard';
import InviteFriendsModal from '../components/InviteFriendsModal';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { formatDateTime } from '../utils/timeLabels';
import { spacing, radius, typography } from '../theme';
import { getUserLocation } from '../services/userLocation';
import { isGatheringUpcoming } from '../utils/objectState';

import { unlockStatus } from '../utils/unlockProgress';
const ROLE_LABELS = { creator: 'Creator', leader: 'Leader', member: 'Member' };

export default function CommunityDetailScreen({ route, navigation }) {
  const { t } = useLanguage();
  const membersLabel = (n) => (Number.isFinite(n) ? t('ui.common.count.members', { count: n }) : null);
  const { communityId, communityName } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  // Item 55 fast-follow #2 (CLAUDE.md, "deep links should preserve context
  // too"): a business_partnership_response/community_area_demand_growing
  // notification tap already carries the push's own real reason text --
  // see notifications.js. No forced CTA here (same reasoning as its
  // BusinessRequestDetail sibling fast-follow): whatever this community's
  // own content already shows below is the obvious next thing to look at.
  const notificationReason = route.params?.notificationReason ?? null;
  const [showReasonBanner, setShowReasonBanner] = useState(!!notificationReason);
  const [reasonAsk, setReasonAsk] = useState(null);
  // Success state (✓/🎉, per the Nearby Motion Language): the previous "create a
  // community" path landed here with zero feedback at all beyond the screen simply
  // appearing (a real, previously-disclosed gap -- CLAUDE.md Item 57). Consumed once
  // on mount, never re-shown on a later revisit to the same screen.
  const [showJustCreated] = useState(!!route.params?.justCreated);
  const [community, setCommunity] = useState(null);
  const [isMember, setIsMember] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const [myId, setMyId] = useState(null);
  const [memberCount, setMemberCount] = useState(null); // null = not known (never shown as 0)
  const [gatherings, setGatherings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [followingBusiness, setFollowingBusiness] = useState(false);
  const [myManagedPartner, setMyManagedPartner] = useState(null);
  const [members, setMembers] = useState([]);
  const [memberPhotoUrls, setMemberPhotoUrls] = useState({});
  const [changingRoleFor, setChangingRoleFor] = useState(null);
  const [viewMode, setViewMode] = useState('list');
  const [selectedDate, setSelectedDate] = useState(null);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [offers, setOffers] = useState([]);
  const [redeemedOfferIds, setRedeemedOfferIds] = useState([]);
  const [redeemingOfferId, setRedeemingOfferId] = useState(null);
  const [areaModalVisible, setAreaModalVisible] = useState(false);
  const [areaCity, setAreaCity] = useState('');
  const [areaRegion, setAreaRegion] = useState('');
  const [areaLabel, setAreaLabel] = useState('');
  const [areaPoint, setAreaPoint] = useState(null);
  const [savingArea, setSavingArea] = useState(false);
  const [locatingArea, setLocatingArea] = useState(false);
  // "Find a Business for This Plan" merge, community side (real user ask,
  // Aug 24 2026): the same merged front-door pattern GatheringDetailScreen
  // already established, so a community's own leader/creator sees the
  // identical mental model -- one primary action, expanding to "ask a
  // specific business" (the existing single-target flow) or "ask nearby
  // businesses" (the new category/party-size broadcast) -- instead of only
  // ever being offered the single-business path.
  const [businessRequest, setBusinessRequest] = useState(null);
  const [acceptedBusinessOffer, setAcceptedBusinessOffer] = useState(null);
  const [myPartnershipRequest, setMyPartnershipRequest] = useState(null);
  const [businessHelpChooserOpen, setBusinessHelpChooserOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      // Phase 1: every one of these is independent of the others -- none
      // need each other's *result*, only communityId/myId, which are
      // already known -- so they're fired together instead of one after
      // another (the old shape was a real ~8-round-trip sequential chain
      // gating this screen's loading spinner, the same bug already found
      // and fixed on Home).
      const [{ data }, { data: sessionData }, mine, count, upcoming, memberList, [communityOffers, myRedemptions]] = await Promise.all([
        supabase.from('communities').select('*').eq('id', communityId).single(),
        supabase.auth.getSession(),
        getMyCommunities(),
        getCommunityMemberCount(communityId),
        getCommunityGatherings(communityId),
        getCommunityMembers(communityId),
        Promise.all([getCommunityOffers(communityId), getMyRedemptions()]),
      ]);

      const myId = sessionData?.session?.user?.id;
      setCommunity(data);
      recordBehaviorEvent('open', 'community', communityId, data?.interest_tag);
      setMyId(myId);
      setIsCreator(data?.creator_id === myId);
      setIsMember(mine.some((c) => c.id === communityId));
      setMemberCount(count);
      setGatherings(upcoming.filter((g) => isGatheringUpcoming(g)));
      setMembers(memberList);
      setOffers(communityOffers);
      setRedeemedOfferIds(myRedemptions);

      const urlEntries = await Promise.all(
        memberList.map(async (m) => {
          const path = m.profiles?.photo_url;
          if (!path) return null;
          const url = await getSignedPhotoUrl(path);
          return [m.user_id, url];
        })
      );
      setMemberPhotoUrls(Object.fromEntries(urlEntries.filter(Boolean)));

      // Phase 2: both of these depend on phase-1 results (data/myId/
      // memberList), not on each other -- fired together too.
      const businessTask = (async () => {
        // Real ownership check computed from the values just fetched
        // above, not from React state (which wouldn't have committed
        // yet) -- matches request_business_partnership's own
        // creator/leader authority model for a community target.
        const canManageBusiness = data?.creator_id === myId || memberList.some((m) => m.user_id === myId && m.role === 'leader');
        if (!canManageBusiness) {
          setBusinessRequest(null);
          setAcceptedBusinessOffer(null);
          setMyPartnershipRequest(null);
          return;
        }
        const [request, partnershipRequest] = await Promise.all([
          getBusinessRequestForCommunity(communityId),
          getMyPartnershipRequestForTarget('community', communityId),
        ]);
        setBusinessRequest(request);
        setMyPartnershipRequest(partnershipRequest);
        setAcceptedBusinessOffer(request ? await getAcceptedOfferForRequest(request.id) : null);
      })();

      const hostingPartnerTask = (async () => {
        if (!data?.hosting_partner_id) return;
        const [following, partner] = await Promise.all([
          isFollowingBusiness(data.hosting_partner_id),
          // If you manage a business, every community you create is
          // automatically linked to it (set_community_hosting_partner_from_creator
          // trigger) so it shows up on your own Business Dashboard's
          // Community tab. Fetched here so the block below can tell
          // "this is your own business" apart from a genuine
          // customer-facing perk -- following your own business, or
          // being told to, makes no sense.
          getMyManagedPartner(),
        ]);
        setFollowingBusiness(following);
        setMyManagedPartner(partner);
      })();

      await Promise.all([businessTask, hostingPartnerTask]);

      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  async function handleRedeemOffer(offer) {
    setRedeemingOfferId(offer.id);
    try {
      const { confirmationCode } = await redeemOffer(offer.id);
      Alert.alert(t('ui.community.redeemed'), t('ui.community.showStaffThisCodeTo', { confirmationCode: confirmationCode, redemptionInstructions: offer.redemption_instructions || 'Check your account for details on how to use this.' }));
      load();
    } catch (e) {
      if (e.message === 'ALREADY_REDEEMED') {
        Alert.alert(t('ui.community.alreadyRedeemed'), t('ui.community.youveAlreadyClaimedThisOffer'));
      } else if (e.message === 'REDEMPTION_LIMIT_REACHED') {
        Alert.alert(t('ui.community.offerFullyClaimed'), t('ui.community.thisOffersLimitedSpotsHave'));
      } else if (e.message === 'OFFER_LOCKED') {
        Alert.alert(t('ui.community.notUnlockedYet'), t('ui.community.thisCommunityNeedsMoreMembers'));
      } else {
        presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleRedeemOffer(offer) });
      }
    }
    setRedeemingOfferId(null);
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const canEditArea = isCreator || members.some((m) => m.user_id === myId && m.role === 'leader');

  function openAreaModal() {
    setAreaCity(community.area_city ?? '');
    setAreaRegion(community.area_region ?? '');
    setAreaLabel(community.area_label ?? '');
    setAreaPoint(community.area_lat != null && community.area_lng != null ? { lat: community.area_lat, lng: community.area_lng } : null);
    setAreaModalVisible(true);
  }

  async function handleUseCurrentLocationForArea() {
    setLocatingArea(true);
    try {
      const location = await getUserLocation();
      if (!location) {
        Alert.alert(t('ui.community.locationPermissionNeeded'), t('ui.community.enableLocationAccessToSet'));
        setLocatingArea(false);
        return;
      }
      setAreaPoint({ lat: location.coords.latitude, lng: location.coords.longitude });
    } catch (e) {
      Alert.alert(t('ui.community.error'), t('ui.community.couldNotGetYourCurrent'));
    }
    setLocatingArea(false);
  }

  async function handleSaveArea() {
    setSavingArea(true);
    try {
      await updateCommunityArea(communityId, {
        city: areaCity,
        region: areaRegion,
        label: areaLabel,
        lat: areaPoint?.lat ?? null,
        lng: areaPoint?.lng ?? null,
      });
      setAreaModalVisible(false);
      load();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSaveArea() });
    }
    setSavingArea(false);
  }

  async function handleToggleFollowBusiness() {
    try {
      if (followingBusiness) {
        await unfollowBusiness(community.hosting_partner_id);
      } else {
        await followBusiness(community.hosting_partner_id);
      }
      setFollowingBusiness(!followingBusiness);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleToggleFollowBusiness() });
    }
  }

  async function handleToggleLeader(member) {
    const newRole = member.role === 'leader' ? 'member' : 'leader';
    setChangingRoleFor(member.user_id);
    try {
      await setCommunityMemberRole(communityId, member.user_id, newRole);
      setMembers((prev) => prev.map((m) => (m.user_id === member.user_id ? { ...m, role: newRole } : m)));
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleToggleLeader(member) });
    }
    setChangingRoleFor(null);
  }

  async function handleJoinLeave() {
    try {
      if (isMember) {
        await leaveCommunity(communityId);
      } else {
        await joinCommunity(communityId);
        recordBehaviorEvent('join', 'community', communityId, community?.interest_tag);
      }
      load();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleJoinLeave() });
    }
  }

  function confirmDeleteCommunity() {
    Alert.alert(
      t('ui.community.delete', { name: community.name }),
      t('ui.community.thisPermanentlyRemovesTheCommunity', { memberCountLabel: membersLabel(memberCount) ?? t('ui.community.membersFallback') }),
      [
        { text: t('ui.community.keepIt'), style: 'cancel' },
        {
          text: t('ui.community.deleteCommunity'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCommunity(communityId);
              navigation.goBack();
            } catch (e) {
              presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => confirmDeleteCommunity() });
            }
          },
        },
      ]
    );
  }

  function confirmPauseCommunity() {
    Alert.alert(
      t('ui.community.pause', { name: community.name }),
      t('ui.community.newMembersCantJoinAnd'),
      [
        { text: t('ui.community.cancel'), style: 'cancel' },
        {
          text: t('ui.community.pauseCommunity'),
          onPress: async () => {
            try {
              await pauseCommunity(communityId);
              load();
            } catch (e) {
              presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => confirmPauseCommunity() });
            }
          },
        },
      ]
    );
  }

  async function handleResumeCommunity() {
    try {
      await resumeCommunity(communityId);
      load();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleResumeCommunity() });
    }
  }

  function confirmCancelCommunity() {
    Alert.alert(
      t('ui.community.cancel2', { name: community.name }),
      t('ui.community.thisNotifiesAllThatThe', { memberCountLabel: membersLabel(memberCount) ?? t('ui.community.membersFallback') }),
      [
        { text: t('ui.community.keepIt'), style: 'cancel' },
        {
          text: t('ui.community.cancelCommunity'),
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelCommunity(communityId);
              setReasonAsk({ entityType: 'community', entityId: communityId, role: 'host' });
              load();
            } catch (e) {
              presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => confirmCancelCommunity() });
            }
          },
        },
      ]
    );
  }

  function formatDate(iso) {
    return formatDateTime(iso);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <NLoader fullScreen={false} />
        <Text style={{ ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm }}>{t('ui.community.loadingCommunity')}</Text>
      </SafeAreaView>
    );
  }

  if (loadError || !community) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message={t('ui.community.couldntLoadThisCommunity')} onRetry={load} />
      </SafeAreaView>
    );
  }

  const categoryStyle = categoryStyleFor(community.interest_tag);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {showJustCreated && <SuccessAnimation haptic text={t('ui.community.yourCommunityIsLive')} />}
        {showReasonBanner && notificationReason && (
          <View style={styles.notificationReasonBanner}>
            <Text style={styles.notificationReasonText}>{notificationReason}</Text>
            <TouchableOpacity
              onPress={() => setShowReasonBanner(false)}
              accessibilityLabel={t('ui.community.dismissA11y')}
              accessibilityRole="button"
              style={styles.notificationReasonDismiss}
            >
              <Text style={styles.notificationReasonDismissText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={[styles.iconBadge, { backgroundColor: categoryStyle.color + '30' }]}>
          <Text style={styles.iconText}>{categoryStyle.icon}</Text>
        </View>
        <Text style={styles.title}>{community.name}</Text>
        <Text style={styles.meta}>{[membersLabel(memberCount), community.is_public ? t('ui.community.publicWord') : t('ui.community.privateWord')].filter(Boolean).join(' · ')}</Text>
        {community.status === 'paused' && (
          <Text style={styles.statusNotice}>{t('ui.community.thisCommunityIsPausedBy')}</Text>
        )}
        {community.status === 'cancelled' && (
          <Text style={styles.statusNotice}>{t('ui.community.thisCommunityHasBeenCancelled')}</Text>
        )}
        {(community.area_label || community.area_city) && (
          <Text style={styles.areaText}>
            📍 {community.area_label || [community.area_city, community.area_region].filter(Boolean).join(', ')}
          </Text>
        )}
        {community.description ? <Text style={styles.description}>{community.description}</Text> : null}

        {/* Item 50 (state consistency audit, Finding 3): a paused/cancelled
            community is no longer joinable server-side (RLS now requires
            status='active') -- the Join button must not offer an action
            that would just fail. An existing member still needs Leave
            available regardless of status, since "existing members keep
            their own access" is the whole point of the distinction. */}
        {!isCreator && (isMember || community.status === 'active') && (
          <TouchableOpacity
            style={[styles.joinButton, isMember && styles.leaveButton]}
            onPress={handleJoinLeave}
            activeOpacity={0.85}
            accessibilityLabel={isMember ? t('ui.community.leaveA11y', { name: community.name }) : t('ui.community.joinA11y', { name: community.name })}
            accessibilityRole="button"
          >
            <Text style={[styles.joinButtonText, isMember && styles.leaveButtonText]}>
              {isMember ? t('ui.community.leaveCommunity') : t('ui.community.joinCommunity')}
            </Text>
          </TouchableOpacity>
        )}

        {/* The creator had no membership action here at all -- not a Leave
            button (leaving your own community makes no sense) and, until
            now, no Delete option either, despite the real "Creator can
            delete their community" RLS policy already existing (baseline.sql)
            -- this was a missing UI affordance, not a missing capability.
            Host cancellation lifecycle (2026-09-06 CLAUDE.md item 5): Edit /
            Pause-or-Resume / Cancel / Delete, each gated by community.status
            so only the transitions that are actually valid from the current
            state are ever shown. */}
        {isCreator && (
          <View style={styles.manageSection}>
            <Text style={styles.manageSectionLabel}>{t('ui.community.manageCommunity')}</Text>

            <TouchableOpacity
              onPress={() => navigation.navigate('EditCommunity', { community })}
              accessibilityLabel={t('ui.community.editCommunityA11y')}
              accessibilityRole="button"
              style={styles.manageLinkRow}
            >
              <Text style={styles.manageLink}>{t('ui.community.editCommunity')}</Text>
            </TouchableOpacity>

            {canEditArea && (
              <TouchableOpacity onPress={openAreaModal} accessibilityLabel={t('ui.community.editCommunityAreaA11y')} accessibilityRole="button" style={styles.manageLinkRow}>
                <Text style={styles.manageLink}>{community.area_city || community.area_label ? t('ui.community.editCommunityArea') : t('ui.community.addACommunityArea')}</Text>
              </TouchableOpacity>
            )}

            {community.status === 'active' && (
              <TouchableOpacity onPress={confirmPauseCommunity} accessibilityLabel={t('ui.community.pauseCommunityA11y')} accessibilityRole="button" style={styles.manageLinkRow}>
                <Text style={styles.manageLink}>{t('ui.community.pauseCommunity2')}</Text>
              </TouchableOpacity>
            )}
            {community.status === 'paused' && (
              <TouchableOpacity onPress={handleResumeCommunity} accessibilityLabel={t('ui.community.resumeCommunityA11y')} accessibilityRole="button" style={styles.manageLinkRow}>
                <Text style={styles.manageLink}>{t('ui.community.resumeCommunity')}</Text>
              </TouchableOpacity>
            )}

            {community.status !== 'cancelled' && (
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={confirmCancelCommunity}
                activeOpacity={0.85}
                accessibilityLabel={t('ui.community.cancelA11y', { name: community.name })}
                accessibilityRole="button"
              >
                <Text style={styles.deleteButtonText}>{t('ui.community.cancelCommunity')}</Text>
              </TouchableOpacity>
            )}

            {community.status === 'cancelled' && (
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={confirmDeleteCommunity}
                activeOpacity={0.85}
                accessibilityLabel={t('ui.community.deletePermanentlyA11y', { name: community.name })}
                accessibilityRole="button"
              >
                <Text style={styles.deleteButtonText}>{t('ui.community.deleteCommunityPermanently')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {community.hosting_partner_id && myManagedPartner?.id === community.hosting_partner_id ? (
          // You manage the business this community is auto-linked to (see
          // the load() comment above) -- following your own business makes
          // no sense, so this is an honest explanation instead of a Follow
          // button pointed at yourself.
          <View style={styles.ownBusinessNotice}>
            <Text style={styles.ownBusinessNoticeText}>{t('ui.community.thisCommunityIsLinkedTo', { name: myManagedPartner.name })}</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('BusinessProfile', { partnerId: community.hosting_partner_id })}
              accessibilityLabel={t('ui.community.viewBusinessProfileA11y')}
              accessibilityRole="button"
            >
              <Text style={styles.businessProfileLink}>{t('ui.community.viewBusinessProfile')}</Text>
            </TouchableOpacity>
          </View>
        ) : community.hosting_partner_id && (
          <>
            <TouchableOpacity
              style={[styles.chatButton, followingBusiness && styles.leaveButton]}
              onPress={handleToggleFollowBusiness}
              activeOpacity={0.85}
              accessibilityLabel={followingBusiness ? t('ui.community.unfollowThisBusinessA11y') : t('ui.community.followThisBusinessA11y')}
              accessibilityRole="button"
            >
              <Text style={[styles.chatButtonText, followingBusiness && styles.leaveButtonText]}>
                {followingBusiness ? t('ui.community.following') : t('ui.community.followThisBusiness')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => navigation.navigate('BusinessProfile', { partnerId: community.hosting_partner_id })}
              accessibilityLabel={t('ui.community.viewBusinessProfileA11y')}
              accessibilityRole="button"
              style={{ marginBottom: spacing.lg }}
            >
              <Text style={styles.businessProfileLink}>{t('ui.community.viewBusinessProfile')}</Text>
            </TouchableOpacity>
          </>
        )}

        {offers.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>{t('ui.community.communityPerks')}</Text>
            {offers.map((offer) => {
              const unlock = unlockStatus({ ...offer, unlock_scope: 'community' }, memberCount);
              const isLocked = unlock.isLocked;
              const alreadyRedeemed = redeemedOfferIds.includes(offer.id);
              return (
                <View key={offer.id} style={styles.perkCard}>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('BusinessProfile', { partnerId: offer.partner_id })}
                    accessibilityLabel={t('ui.community.viewSBusinessProfileA11y', { name: offer.brand_partners?.name })}
                    accessibilityRole="button"
                  >
                    <Text style={styles.perkSubLink}>{offer.brand_partners?.name}</Text>
                  </TouchableOpacity>
                  <Text style={styles.perkTitle}>{offer.title}</Text>
                  {offer.description ? <Text style={styles.perkDesc}>{offer.description}</Text> : null}
                  <Text style={styles.perkUnlockText}>
                    {isLocked
                      ? unlock.label
                      : t('ui.community.unlockedCommunityGoalReached')}
                  </Text>
                  {alreadyRedeemed ? (
                    <View style={styles.perkRedeemedBadge}>
                      <Text style={styles.perkRedeemedBadgeText}>{t('ui.community.redeemed2')}</Text>
                    </View>
                  ) : isLocked ? (
                    <View style={[styles.perkRedeemButton, styles.perkLockedButton]}>
                      <Text style={styles.perkLockedButtonText}>{t('ui.community.locked')}</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.perkRedeemButton}
                      onPress={() => handleRedeemOffer(offer)}
                      disabled={redeemingOfferId === offer.id}
                      activeOpacity={0.85}
                      accessibilityLabel={t('ui.community.redeemFromA11y', { title: offer.title, name: offer.brand_partners?.name })}
                      accessibilityRole="button"
                    >
                      <Text style={styles.perkRedeemButtonText}>{redeemingOfferId === offer.id ? t('ui.community.redeeming') : t('ui.community.redeem')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </>
        )}

        {isMember && (
          <TouchableOpacity
            style={styles.chatButton}
            onPress={() => navigation.navigate('CommunityChat', { communityId, communityName: community.name })}
            activeOpacity={0.85}
            accessibilityLabel={t('ui.community.openCommunityGroupChatA11y')}
            accessibilityRole="button"
          >
            <Text style={styles.chatButtonText}>{t('ui.community.communityChat')}</Text>
          </TouchableOpacity>
        )}

        {/* Item 51 (CLAUDE.md, "cancellation needs to propagate
            everywhere"): a cancelled community is a dead end, not
            somewhere to keep growing -- don't offer to bring in new
            people or spin up new activity under it. Membership/chat
            history stays visible either way. */}
        {(isMember || isCreator) && community.status !== 'cancelled' && (
          <TouchableOpacity
            style={styles.chatButton}
            onPress={() => setInviteModalVisible(true)}
            activeOpacity={0.85}
            accessibilityLabel={t('ui.community.inviteFriendsToThisCommunityA11y')}
            accessibilityRole="button"
          >
            <Text style={styles.chatButtonText}>{t('ui.community.inviteFriends')}</Text>
          </TouchableOpacity>
        )}

        {(isMember || isCreator) && community.status !== 'cancelled' && (
          <TouchableOpacity
            style={styles.chatButton}
            onPress={() => navigation.navigate('CreateGathering', {
              initialVisibility: 'community',
              initialCommunityId: communityId,
            })}
            activeOpacity={0.85}
            accessibilityLabel={t('ui.community.hostAGatheringForA11y', { name: community?.name })}
            accessibilityRole="button"
          >
            <Text style={styles.chatButtonText}>{t('ui.community.hostAGatheringForThis')}</Text>
          </TouchableOpacity>
        )}

        {(isCreator || members.some((m) => m.user_id === myId && m.role === 'leader')) && (
          acceptedBusinessOffer ? (
            <AcceptedBusinessOfferCard
              offer={acceptedBusinessOffer}
              partySize={businessRequest?.party_size ?? null}
              onViewRequest={() => navigation.navigate('BusinessRequestDetail', { requestId: businessRequest.id })}
              style={{ marginBottom: spacing.lg }}
            />
          ) : businessRequest ? (
            <View style={{ marginBottom: spacing.lg }}>
              <Text style={styles.businessHelpLink}>{t('ui.community.waitingToHearBackFrom2')}</Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('BusinessRequestDetail', { requestId: businessRequest.id })}
                accessibilityLabel={t('ui.community.viewYourBusinessRequestA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.businessHelpLink}>{t('ui.community.viewRequest')}</Text>
              </TouchableOpacity>
            </View>
          ) : myPartnershipRequest?.status === 'approved' ? (
            <View style={styles.businessOfferCard}>
              <Text style={styles.businessOfferKicker}>{t('ui.community.businessPartnerConfirmed')}</Text>
              <Text style={styles.businessOfferTitle}>{myPartnershipRequest.partnerName}</Text>
              <Text style={styles.businessOfferSub}>{t('ui.community.confirmedAsYourBusinessPartner')}</Text>
            </View>
          ) : myPartnershipRequest?.status === 'pending' ? (
            <View style={{ marginBottom: spacing.lg }}>
              <Text style={styles.businessHelpLink}>{t('ui.community.waitingToHearBackFrom', { partnerName: myPartnershipRequest.partnerName })}</Text>
            </View>
          ) : (
            // The merged front door: neither mechanism has any real
            // progress yet, so a leader sees one primary action instead of
            // being funneled straight into "name one specific business" --
            // matches GatheringDetailScreen's own "Find a Business for This
            // Plan" chooser exactly.
            <View>
              <TouchableOpacity
                style={styles.chatButton}
                onPress={() => setBusinessHelpChooserOpen((v) => !v)}
                activeOpacity={0.85}
                accessibilityLabel={t('ui.community.findABusinessForThisA11y')}
                accessibilityRole="button"
                accessibilityState={{ expanded: businessHelpChooserOpen }}
              >
                <Text style={styles.chatButtonText}>{t('ui.community.findABusinessForThis')}</Text>
              </TouchableOpacity>
              {businessHelpChooserOpen && (
                <View style={styles.businessHelpChooser}>
                  <TouchableOpacity
                    style={styles.businessHelpChooserOption}
                    onPress={() => {
                      setBusinessHelpChooserOpen(false);
                      navigation.navigate('RequestBusinessPartner', { targetType: 'community', targetId: communityId, targetTitle: community?.name });
                    }}
                    accessibilityLabel={t('ui.community.requestASpecificBusinessA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.businessHelpChooserOptionTitle}>{t('ui.community.requestASpecificBusiness')}</Text>
                    <Text style={styles.businessHelpChooserOptionSub}>{t('ui.community.youAlreadyHaveAPlace')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.businessHelpChooserOption, { marginTop: spacing.xs }]}
                    onPress={() => {
                      setBusinessHelpChooserOpen(false);
                      navigation.navigate('AskBusiness', {
                        communityId,
                        communityName: community?.name,
                        // A community's own interest_tag can be "Faith &
                        // Spirituality" (CreateCommunityScreen's own 25-tag
                        // list) -- a real value business_requests.category's
                        // CHECK constraint doesn't accept (the 24-tag list
                        // this screen's own chips use). Only prefill when it's
                        // genuinely one of those 24, so a mismatched tag never
                        // gets silently carried into a submit that would fail.
                        prefillCategory: BUSINESS_REQUEST_CATEGORY_OPTIONS.includes(community?.interest_tag) ? community.interest_tag : null,
                      });
                    }}
                    accessibilityLabel={t('ui.community.askNearbyBusinessesByCategoryA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.businessHelpChooserOptionTitle}>{t('ui.community.askNearbyBusinesses')}</Text>
                    <Text style={styles.businessHelpChooserOptionSub}>{t('ui.community.describeWhatYouNeedReal')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )
        )}

        {members.length === 0 && (
          <>
            <Text style={styles.sectionHeader}>{t('ui.community.leadersMembers')}</Text>
            <EmptyCopy id="community_members" />
          </>
        )}
        {members.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>{t('ui.community.leadersMembers')}{memberCount != null ? ` (${memberCount})` : ''}</Text>
            {members.map((m) => {
              const photoUrl = memberPhotoUrls[m.user_id];
              return (
                <View key={m.user_id} style={styles.memberRow}>
                  {photoUrl ? (
                    <Image source={{ uri: photoUrl }} style={styles.memberAvatar} />
                  ) : (
                    <View style={[styles.memberAvatar, styles.memberAvatarPlaceholder]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>{m.profiles?.display_name ?? t('ui.community.member')}</Text>
                    <Text style={[styles.memberRoleBadge, m.role === 'creator' && styles.memberRoleCreator, m.role === 'leader' && styles.memberRoleLeader]}>
                      {ROLE_LABELS[m.role] ?? m.role}
                    </Text>
                  </View>
                  {isCreator && m.role !== 'creator' && (
                    <TouchableOpacity
                      onPress={() => handleToggleLeader(m)}
                      disabled={changingRoleFor === m.user_id}
                      accessibilityLabel={m.role === 'leader' ? t('ui.community.removeAsLeaderA11y', { name: m.profiles?.display_name }) : t('ui.community.makeALeaderA11y', { name: m.profiles?.display_name })}
                      accessibilityRole="button"
                    >
                      <Text style={styles.memberActionLink}>
                        {changingRoleFor === m.user_id ? '...' : m.role === 'leader' ? t('ui.community.removeLeader') : t('ui.community.makeLeader')}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </>
        )}

        {gatherings.length === 0 && (
          <>
            <Text style={styles.sectionHeader}>{t('ui.community.upcomingGatherings')}</Text>
            <EmptyCopy id="community_calendar" />
          </>
        )}
        {gatherings.length > 0 && (
          <>
            <View style={styles.gatheringsHeaderRow}>
              <Text style={styles.sectionHeader}>{t('ui.community.upcomingGatherings')}</Text>
              <View style={styles.viewToggle}>
                <TouchableOpacity
                  style={[styles.viewToggleButton, viewMode === 'list' && styles.viewToggleButtonActive]}
                  onPress={() => setViewMode('list')}
                  accessibilityLabel={t('ui.community.listViewA11y')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: viewMode === 'list' }}
                >
                  <Text style={[styles.viewToggleText, viewMode === 'list' && styles.viewToggleTextActive]}>{t('ui.community.list')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.viewToggleButton, viewMode === 'calendar' && styles.viewToggleButtonActive]}
                  onPress={() => setViewMode('calendar')}
                  accessibilityLabel={t('ui.community.calendarViewA11y')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: viewMode === 'calendar' }}
                >
                  <Text style={[styles.viewToggleText, viewMode === 'calendar' && styles.viewToggleTextActive]}>{t('ui.community.calendar')}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {viewMode === 'calendar' && (
              <CommunityCalendar gatherings={gatherings} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
            )}

            {(viewMode === 'calendar' && selectedDate
              ? gatherings.filter((g) => new Date(g.scheduled_at).toDateString() === selectedDate.toDateString())
              : gatherings
            ).map((g) => (
              <View key={g.id} style={styles.gatheringCard}>
                <Text style={styles.gatheringTitle}>{g.title}</Text>
                <Text style={styles.gatheringMeta}>{formatDate(g.scheduled_at)}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <InviteFriendsModal
        visible={inviteModalVisible}
        onClose={() => setInviteModalVisible(false)}
        inviteType="community"
        targetId={communityId}
        targetTitle={community.name}
      />

      <Modal visible={areaModalVisible} animationType={modalAnimation('slide')} transparent onRequestClose={() => setAreaModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{t('ui.community.communityArea')}</Text>
            <Text style={styles.modalSubtitle}>
              {t('ui.community.optionalAndCoarseACity')}
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder={t('ui.community.cityEGPrinceton')}
              placeholderTextColor={colors.textTertiary}
              value={areaCity}
              onChangeText={setAreaCity}
            />
            <TextInput
              style={styles.modalInput}
              placeholder={t('ui.community.stateRegionEGNj')}
              placeholderTextColor={colors.textTertiary}
              value={areaRegion}
              onChangeText={setAreaRegion}
            />
            <TextInput
              style={styles.modalInput}
              placeholder={t('ui.community.labelOptionalEGDowntown')}
              placeholderTextColor={colors.textTertiary}
              value={areaLabel}
              onChangeText={setAreaLabel}
            />
            <TouchableOpacity
              onPress={handleUseCurrentLocationForArea}
              disabled={locatingArea}
              accessibilityLabel={t('ui.community.useMyCurrentLocationAsA11y')}
              accessibilityRole="button"
              style={styles.useLocationButton}
            >
              <Text style={styles.useLocationButtonText}>
                {locatingArea ? t('ui.community.gettingLocation') : areaPoint ? t('ui.community.mapPointSetTapTo') : t('ui.community.useMyCurrentLocationOptional')}
              </Text>
            </TouchableOpacity>
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setAreaModalVisible(false)} style={styles.modalCancelButton} accessibilityLabel={t('ui.community.cancelA11y2')} accessibilityRole="button">
                <Text style={styles.modalCancelButtonText}>{t('ui.community.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSaveArea} disabled={savingArea} style={styles.modalSaveButton} accessibilityLabel={t('ui.community.saveCommunityAreaA11y')} accessibilityRole="button">
                <Text style={styles.modalSaveButtonText}>{savingArea ? t('ui.community.saving') : t('ui.community.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <CancellationReasonSheet ask={reasonAsk} onClose={() => setReasonAsk(null)} />
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  notificationReasonBanner: {
    flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.primaryMuted,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, padding: spacing.md, marginBottom: spacing.lg,
  },
  notificationReasonText: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  notificationReasonDismiss: { paddingLeft: spacing.sm },
  notificationReasonDismissText: { color: colors.textTertiary, fontSize: 15, fontWeight: '600' },
  iconBadge: { width: 56, height: 56, borderRadius: radius.lg, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md },
  iconText: { fontSize: 28 },
  title: { ...typography.title, color: colors.textPrimary },
  meta: { color: colors.textTertiary, fontSize: 13, marginTop: 2, marginBottom: spacing.md },
  description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },
  joinButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginBottom: spacing.sm, ...shadow.button },
  leaveButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  joinButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  leaveButtonText: { color: colors.textSecondary },
  deleteButton: {
    backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.danger,
    paddingVertical: 14, alignItems: 'center', marginBottom: spacing.sm,
  },
  deleteButtonText: { color: colors.danger, fontWeight: '700', fontSize: 15 },
  chatButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginBottom: spacing.lg },
  chatButtonText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  businessHelpLink: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  businessHelpChooser: { marginTop: spacing.sm, marginBottom: spacing.lg },
  businessHelpChooserOption: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  businessHelpChooserOptionTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  businessHelpChooserOptionSub: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  businessOfferCard: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  businessOfferKicker: { color: colors.primary, fontSize: 12, fontWeight: '700', marginBottom: 2 },
  businessOfferTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  businessOfferSub: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  businessProfileLink: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  ownBusinessNotice: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.lg,
  },
  ownBusinessNoticeText: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm, lineHeight: 18 },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  emptyText: { color: colors.textTertiary, fontSize: 13, marginBottom: spacing.lg },
  perkCard: {
    backgroundColor: '#f59e0b15', borderRadius: radius.lg, borderWidth: 1, borderColor: '#f59e0b',
    padding: spacing.md, marginBottom: spacing.sm,
  },
  perkSubLink: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  perkTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 2 },
  perkDesc: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.xs },
  perkUnlockText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginTop: spacing.sm },
  perkRedeemButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 10, alignItems: 'center', marginTop: spacing.sm },
  perkRedeemButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  perkLockedButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  perkLockedButtonText: { color: colors.textTertiary, fontWeight: '700', fontSize: 13 },
  perkRedeemedBadge: { backgroundColor: colors.surface, borderRadius: radius.full, paddingVertical: 10, alignItems: 'center', marginTop: spacing.sm },
  perkRedeemedBadgeText: { color: colors.textTertiary, fontWeight: '700', fontSize: 13 },
  gatheringCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  gatheringTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  gatheringMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  memberRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginBottom: spacing.sm },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: spacing.sm },
  memberAvatarPlaceholder: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  memberName: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  memberRoleBadge: { color: colors.textTertiary, fontSize: 11, marginTop: 1 },
  memberRoleCreator: { color: colors.info, fontWeight: '700' },
  memberRoleLeader: { color: colors.info, fontWeight: '600' },
  memberActionLink: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  gatheringsHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  viewToggle: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  viewToggleButton: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full },
  viewToggleButtonActive: { backgroundColor: colors.primary },
  viewToggleText: { color: colors.textTertiary, fontSize: 11, fontWeight: '700' },
  viewToggleTextActive: { color: '#fff' },
  areaText: { color: colors.textSecondary, fontSize: 13, marginTop: 2, marginBottom: spacing.xs },
  editAreaLink: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  statusNotice: { color: colors.textTertiary, fontSize: 13, fontWeight: '600', marginBottom: spacing.xs },
  manageSection: { marginTop: spacing.sm, marginBottom: spacing.lg },
  manageSectionLabel: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  manageLinkRow: { marginBottom: spacing.md },
  manageLink: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
  modalSubtitle: { color: colors.textTertiary, fontSize: 12, marginBottom: spacing.md, lineHeight: 17 },
  modalInput: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.textPrimary, fontSize: 14, marginBottom: spacing.sm,
  },
  useLocationButton: { paddingVertical: spacing.sm, marginBottom: spacing.md },
  useLocationButtonText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
  modalCancelButton: { paddingVertical: 10, paddingHorizontal: spacing.md },
  modalCancelButtonText: { color: colors.textSecondary, fontWeight: '600' },
  modalSaveButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 10, paddingHorizontal: spacing.lg, ...shadow.button },
  modalSaveButtonText: { color: '#fff', fontWeight: '700' },
});