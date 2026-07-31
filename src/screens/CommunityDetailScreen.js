import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { getMyCommunities, joinCommunity, leaveCommunity, getCommunityMemberCount, getCommunityGatherings } from '../services/communities';
import { isFollowingBusiness, followBusiness, unfollowBusiness } from '../services/brandOffers';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export default function CommunityDetailScreen({ route, navigation }) {
  const { communityId, communityName } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [community, setCommunity] = useState(null);
  const [isMember, setIsMember] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const [memberCount, setMemberCount] = useState(0);
  const [gatherings, setGatherings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followingBusiness, setFollowingBusiness] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('communities').select('*').eq('id', communityId).single();
    setCommunity(data);

    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    setIsCreator(data?.creator_id === myId);

    const mine = await getMyCommunities();
    setIsMember(mine.some((c) => c.id === communityId));

    const count = await getCommunityMemberCount(communityId);
    setMemberCount(count);

    const upcoming = await getCommunityGatherings(communityId);
    setGatherings(upcoming.filter((g) => new Date(g.scheduled_at) >= new Date()));

    if (data?.hosting_partner_id) {
      const following = await isFollowingBusiness(data.hosting_partner_id);
      setFollowingBusiness(following);
    }

    setLoading(false);
  }, [communityId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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

  if (loading || !community) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
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
        {community.description ? <Text style={styles.description}>{community.description}</Text> : null}

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

        {community.hosting_partner_id && (
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

        {gatherings.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Upcoming Gatherings</Text>
            {gatherings.map((g) => (
              <View key={g.id} style={styles.gatheringCard}>
                <Text style={styles.gatheringTitle}>{g.title}</Text>
                <Text style={styles.gatheringMeta}>{formatDate(g.scheduled_at)}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
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
  sectionHeader: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  gatheringCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  gatheringTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  gatheringMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
});