import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, Alert, ActivityIndicator, Image, Modal } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { supabase } from '../services/supabase';
import { getMyCommunities, joinCommunity, leaveCommunity, getCommunityMemberCount, getCommunityGatherings, getCommunityMembers, setCommunityMemberRole, updateCommunityArea } from '../services/communities';
import { isFollowingBusiness, followBusiness, unfollowBusiness, getCommunityOffers, getMyRedemptions, redeemOffer, getMyManagedPartner } from '../services/brandOffers';
import { getSignedPhotoUrl } from '../services/photos';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import CommunityCalendar from '../components/CommunityCalendar';
import InviteFriendsModal from '../components/InviteFriendsModal';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

const ROLE_LABELS = { creator: 'Creator', leader: 'Leader', member: 'Member' };

export default function CommunityDetailScreen({ route, navigation }) {
  const { communityId, communityName } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [community, setCommunity] = useState(null);
  const [isMember, setIsMember] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const [myId, setMyId] = useState(null);
  const [memberCount, setMemberCount] = useState(0);
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

  const load = useCallback(async () => {
    try {
    const { data } = await supabase.from('communities').select('*').eq('id', communityId).single();
    setCommunity(data);

    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    setMyId(myId);
    setIsCreator(data?.creator_id === myId);

    const mine = await getMyCommunities();
    setIsMember(mine.some((c) => c.id === communityId));

    const count = await getCommunityMemberCount(communityId);
    setMemberCount(count);

    const upcoming = await getCommunityGatherings(communityId);
    setGatherings(upcoming.filter((g) => new Date(g.scheduled_at) >= new Date()));

    const memberList = await getCommunityMembers(communityId);
    setMembers(memberList);
    const urlEntries = await Promise.all(
      memberList.map(async (m) => {
        const path = m.profiles?.photo_url;
        if (!path) return null;
        const url = await getSignedPhotoUrl(path);
        return [m.user_id, url];
      })
    );
    setMemberPhotoUrls(Object.fromEntries(urlEntries.filter(Boolean)));

    if (data?.hosting_partner_id) {
      const following = await isFollowingBusiness(data.hosting_partner_id);
      setFollowingBusiness(following);
      // If you manage a business, every community you create is
      // automatically linked to it (set_community_hosting_partner_from_creator
      // trigger) so it shows up on your own Business Dashboard's Community
      // tab. Fetched here so the block below can tell "this is your own
      // business" apart from a genuine customer-facing perk -- following
      // your own business, or being told to, makes no sense.
      const partner = await getMyManagedPartner();
      setMyManagedPartner(partner);
    }

    const [communityOffers, myRedemptions] = await Promise.all([getCommunityOffers(communityId), getMyRedemptions()]);
    setOffers(communityOffers);
    setRedeemedOfferIds(myRedemptions);

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
      Alert.alert('Redeemed!', `Show staff this code to confirm: ${confirmationCode}\n\n${offer.redemption_instructions || 'Check your account for details on how to use this.'}`);
      load();
    } catch (e) {
      if (e.message === 'ALREADY_REDEEMED') {
        Alert.alert('Already redeemed', "You've already claimed this offer.");
      } else if (e.message === 'REDEMPTION_LIMIT_REACHED') {
        Alert.alert('Offer fully claimed', "This offer's limited spots have all been claimed.");
      } else if (e.message === 'OFFER_LOCKED') {
        Alert.alert('Not unlocked yet', "This community needs more members to unlock this perk.");
      } else {
        Alert.alert('Error', e.message);
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
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location permission needed', 'Enable location access to set a coarse map point for this Area.');
        return;
      }
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setAreaPoint({ lat: location.coords.latitude, lng: location.coords.longitude });
    } catch (e) {
      Alert.alert('Error', 'Could not get your current location.');
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
      Alert.alert('Error', e.message);
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
      Alert.alert('Error', e.message);
    }
  }

  async function handleToggleLeader(member) {
    const newRole = member.role === 'leader' ? 'member' : 'leader';
    setChangingRoleFor(member.user_id);
    try {
      await setCommunityMemberRole(communityId, member.user_id, newRole);
      setMembers((prev) => prev.map((m) => (m.user_id === member.user_id ? { ...m, role: newRole } : m)));
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setChangingRoleFor(null);
  }

  async function handleJoinLeave() {
    try {
      if (isMember) {
        await leaveCommunity(communityId);
      } else {
        await joinCommunity(communityId);
      }
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  if (loadError || !community) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load this community." onRetry={load} />
      </SafeAreaView>
    );
  }

  const categoryStyle = categoryStyleFor(community.interest_tag);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <View style={[styles.iconBadge, { backgroundColor: categoryStyle.color + '30' }]}>
          <Text style={styles.iconText}>{categoryStyle.icon}</Text>
        </View>
        <Text style={styles.title}>{community.name}</Text>
        <Text style={styles.meta}>{memberCount} member{memberCount === 1 ? '' : 's'} · {community.is_public ? 'Public' : 'Private'}</Text>
        {(community.area_label || community.area_city) && (
          <Text style={styles.areaText}>
            📍 {community.area_label || [community.area_city, community.area_region].filter(Boolean).join(', ')}
          </Text>
        )}
        {community.description ? <Text style={styles.description}>{community.description}</Text> : null}
        {canEditArea && (
          <TouchableOpacity onPress={openAreaModal} accessibilityLabel="Edit Community Area" accessibilityRole="button" style={{ marginBottom: spacing.md }}>
            <Text style={styles.editAreaLink}>{community.area_city || community.area_label ? 'Edit Community Area' : '+ Add a Community Area'}</Text>
          </TouchableOpacity>
        )}

        {!isCreator && (
          <TouchableOpacity
            style={[styles.joinButton, isMember && styles.leaveButton]}
            onPress={handleJoinLeave}
            activeOpacity={0.85}
            accessibilityLabel={isMember ? `Leave ${community.name}` : `Join ${community.name}`}
            accessibilityRole="button"
          >
            <Text style={[styles.joinButtonText, isMember && styles.leaveButtonText]}>
              {isMember ? 'Leave Community' : 'Join Community'}
            </Text>
          </TouchableOpacity>
        )}

        {community.hosting_partner_id && myManagedPartner?.id === community.hosting_partner_id ? (
          // You manage the business this community is auto-linked to (see
          // the load() comment above) -- following your own business makes
          // no sense, so this is an honest explanation instead of a Follow
          // button pointed at yourself.
          <View style={styles.ownBusinessNotice}>
            <Text style={styles.ownBusinessNoticeText}>
              🏪 This community is linked to your business, {myManagedPartner.name} — that's why it appears on your Business Dashboard's Community tab.
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('BusinessProfile', { partnerId: community.hosting_partner_id })}
              accessibilityLabel="View business profile"
              accessibilityRole="button"
            >
              <Text style={styles.businessProfileLink}>View Business Profile →</Text>
            </TouchableOpacity>
          </View>
        ) : community.hosting_partner_id && (
          <>
            <TouchableOpacity
              style={[styles.chatButton, followingBusiness && styles.leaveButton]}
              onPress={handleToggleFollowBusiness}
              activeOpacity={0.85}
              accessibilityLabel={followingBusiness ? 'Unfollow this business' : 'Follow this business'}
              accessibilityRole="button"
            >
              <Text style={[styles.chatButtonText, followingBusiness && styles.leaveButtonText]}>
                {followingBusiness ? '✓ Following' : '🏪 Follow This Business'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => navigation.navigate('BusinessProfile', { partnerId: community.hosting_partner_id })}
              accessibilityLabel="View business profile"
              accessibilityRole="button"
              style={{ marginBottom: spacing.lg }}
            >
              <Text style={styles.businessProfileLink}>View Business Profile →</Text>
            </TouchableOpacity>
          </>
        )}

        {offers.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>🎁 Community Perks</Text>
            {offers.map((offer) => {
              const isLocked = memberCount < offer.unlock_min_members;
              const alreadyRedeemed = redeemedOfferIds.includes(offer.id);
              return (
                <View key={offer.id} style={styles.perkCard}>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('BusinessProfile', { partnerId: offer.partner_id })}
                    accessibilityLabel={`View ${offer.brand_partners?.name}'s business profile`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.perkSubLink}>{offer.brand_partners?.name}</Text>
                  </TouchableOpacity>
                  <Text style={styles.perkTitle}>{offer.title}</Text>
                  {offer.description ? <Text style={styles.perkDesc}>{offer.description}</Text> : null}
                  <Text style={styles.perkUnlockText}>
                    {isLocked
                      ? `🔒 Unlocks at ${offer.unlock_min_members} members (${memberCount}/${offer.unlock_min_members} so far)`
                      : '🔓 Unlocked — community goal reached'}
                  </Text>
                  {alreadyRedeemed ? (
                    <View style={styles.perkRedeemedBadge}>
                      <Text style={styles.perkRedeemedBadgeText}>Redeemed</Text>
                    </View>
                  ) : isLocked ? (
                    <View style={[styles.perkRedeemButton, styles.perkLockedButton]}>
                      <Text style={styles.perkLockedButtonText}>Locked</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.perkRedeemButton}
                      onPress={() => handleRedeemOffer(offer)}
                      disabled={redeemingOfferId === offer.id}
                      activeOpacity={0.85}
                      accessibilityLabel={`Redeem ${offer.title}, from ${offer.brand_partners?.name}`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.perkRedeemButtonText}>{redeemingOfferId === offer.id ? 'Redeeming...' : 'Redeem'}</Text>
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
            accessibilityLabel="Open community group chat"
            accessibilityRole="button"
          >
            <Text style={styles.chatButtonText}>💬 Community Chat</Text>
          </TouchableOpacity>
        )}

        {(isMember || isCreator) && (
          <TouchableOpacity
            style={styles.chatButton}
            onPress={() => setInviteModalVisible(true)}
            activeOpacity={0.85}
            accessibilityLabel="Invite friends to this community"
            accessibilityRole="button"
          >
            <Text style={styles.chatButtonText}>🤝 Invite Friends</Text>
          </TouchableOpacity>
        )}

        {(isMember || isCreator) && (
          <TouchableOpacity
            style={styles.chatButton}
            onPress={() => navigation.navigate('CreateGathering', {
              initialVisibility: 'community',
              initialCommunityId: communityId,
            })}
            activeOpacity={0.85}
            accessibilityLabel={`Host a gathering for ${community?.name}`}
            accessibilityRole="button"
          >
            <Text style={styles.chatButtonText}>🎉 Host a Gathering for This Community</Text>
          </TouchableOpacity>
        )}

        {(isCreator || members.some((m) => m.user_id === myId && m.role === 'leader')) && (
          <TouchableOpacity
            style={styles.chatButton}
            onPress={() => navigation.navigate('RequestBusinessPartner', { targetType: 'community', targetId: communityId, targetTitle: community?.name })}
            activeOpacity={0.85}
            accessibilityLabel="Request a business partner for this community"
            accessibilityRole="button"
          >
            <Text style={styles.chatButtonText}>🤝 Request a Business Partner</Text>
          </TouchableOpacity>
        )}

        {members.length === 0 && (
          <>
            <Text style={styles.sectionHeader}>Leaders & Members</Text>
            <Text style={styles.emptyText}>No members to show yet.</Text>
          </>
        )}
        {members.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Leaders & Members ({memberCount})</Text>
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
                    <Text style={styles.memberName}>{m.profiles?.display_name ?? 'Member'}</Text>
                    <Text style={[styles.memberRoleBadge, m.role === 'creator' && styles.memberRoleCreator, m.role === 'leader' && styles.memberRoleLeader]}>
                      {ROLE_LABELS[m.role] ?? m.role}
                    </Text>
                  </View>
                  {isCreator && m.role !== 'creator' && (
                    <TouchableOpacity
                      onPress={() => handleToggleLeader(m)}
                      disabled={changingRoleFor === m.user_id}
                      accessibilityLabel={m.role === 'leader' ? `Remove ${m.profiles?.display_name} as leader` : `Make ${m.profiles?.display_name} a leader`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.memberActionLink}>
                        {changingRoleFor === m.user_id ? '...' : m.role === 'leader' ? 'Remove Leader' : 'Make Leader'}
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
            <Text style={styles.sectionHeader}>Upcoming Gatherings</Text>
            <Text style={styles.emptyText}>Nothing on the calendar yet — be the first to plan something.</Text>
          </>
        )}
        {gatherings.length > 0 && (
          <>
            <View style={styles.gatheringsHeaderRow}>
              <Text style={styles.sectionHeader}>Upcoming Gatherings</Text>
              <View style={styles.viewToggle}>
                <TouchableOpacity
                  style={[styles.viewToggleButton, viewMode === 'list' && styles.viewToggleButtonActive]}
                  onPress={() => setViewMode('list')}
                  accessibilityLabel="List view"
                  accessibilityRole="button"
                  accessibilityState={{ selected: viewMode === 'list' }}
                >
                  <Text style={[styles.viewToggleText, viewMode === 'list' && styles.viewToggleTextActive]}>List</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.viewToggleButton, viewMode === 'calendar' && styles.viewToggleButtonActive]}
                  onPress={() => setViewMode('calendar')}
                  accessibilityLabel="Calendar view"
                  accessibilityRole="button"
                  accessibilityState={{ selected: viewMode === 'calendar' }}
                >
                  <Text style={[styles.viewToggleText, viewMode === 'calendar' && styles.viewToggleTextActive]}>Calendar</Text>
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

      <Modal visible={areaModalVisible} animationType="slide" transparent onRequestClose={() => setAreaModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Community Area</Text>
            <Text style={styles.modalSubtitle}>
              Optional and coarse — a city and general area, never a precise address. Helps people nearby find this community.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="City (e.g. Princeton)"
              placeholderTextColor={colors.textTertiary}
              value={areaCity}
              onChangeText={setAreaCity}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="State / Region (e.g. NJ)"
              placeholderTextColor={colors.textTertiary}
              value={areaRegion}
              onChangeText={setAreaRegion}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Label, optional (e.g. Downtown)"
              placeholderTextColor={colors.textTertiary}
              value={areaLabel}
              onChangeText={setAreaLabel}
            />
            <TouchableOpacity
              onPress={handleUseCurrentLocationForArea}
              disabled={locatingArea}
              accessibilityLabel="Use my current location as this Area's coarse map point"
              accessibilityRole="button"
              style={styles.useLocationButton}
            >
              <Text style={styles.useLocationButtonText}>
                {locatingArea ? 'Getting location...' : areaPoint ? '📍 Map point set — tap to update' : '📍 Use My Current Location (optional)'}
              </Text>
            </TouchableOpacity>
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setAreaModalVisible(false)} style={styles.modalCancelButton} accessibilityLabel="Cancel" accessibilityRole="button">
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSaveArea} disabled={savingArea} style={styles.modalSaveButton} accessibilityLabel="Save Community Area" accessibilityRole="button">
                <Text style={styles.modalSaveButtonText}>{savingArea ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  iconBadge: { width: 56, height: 56, borderRadius: radius.lg, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md },
  iconText: { fontSize: 28 },
  title: { ...typography.title, color: colors.textPrimary },
  meta: { color: colors.textTertiary, fontSize: 13, marginTop: 2, marginBottom: spacing.md },
  description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },
  joinButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginBottom: spacing.sm, ...shadow.button },
  leaveButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  joinButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  leaveButtonText: { color: colors.textSecondary },
  chatButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginBottom: spacing.lg },
  chatButtonText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
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
  memberRoleCreator: { color: colors.primary, fontWeight: '700' },
  memberRoleLeader: { color: colors.primary, fontWeight: '600' },
  memberActionLink: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  gatheringsHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  viewToggle: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  viewToggleButton: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full },
  viewToggleButtonActive: { backgroundColor: colors.primary },
  viewToggleText: { color: colors.textTertiary, fontSize: 11, fontWeight: '700' },
  viewToggleTextActive: { color: '#fff' },
  areaText: { color: colors.textSecondary, fontSize: 13, marginTop: 2, marginBottom: spacing.xs },
  editAreaLink: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg },
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