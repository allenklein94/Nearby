import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, ActivityIndicator, Alert, Share } from 'react-native';
import { getGatheringById, getFriendsWithSharedContext } from '../services/gatherings';
import { getSignedPhotoUrl } from '../services/photos';
import { sendInvite } from '../services/invites';
import * as Haptics from 'expo-haptics';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// Replaces the old plain Alert.alert('Posted!', ...) dead end with two
// real actions — a working shareable deep link (needs the `linking`
// config added to RootNavigator.js; a "shareable link" that silently
// does nothing when tapped is exactly the class of bug this codebase
// has caught before) and friends-only "Invite Connections" (locked
// decision #3 — never nearby strangers, even ones the recommendation
// engine would score as a good match).
export default function GatheringConfirmationScreen({ route, navigation }) {
  const { gatheringId, placeName } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  const [gathering, setGathering] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [friends, setFriends] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [invitedIds, setInvitedIds] = useState({});
  const [invitingId, setInvitingId] = useState(null);

  useEffect(() => {
    getGatheringById(gatheringId).then((g) => {
      setGathering(g);
      setLoading(false);
    });
  }, [gatheringId]);

  async function handleShare() {
    try {
      await Share.share({
        message: `Join me: ${gathering?.title ?? 'my gathering'}${placeName ? ` at ${placeName}` : ''} — nearby://gathering/${gatheringId}`,
        url: `nearby://gathering/${gatheringId}`,
      });
    } catch (e) {
      // Share sheet cancellation isn't an error worth surfacing.
    }
  }

  async function handleOpenInvite() {
    setShowInvite(true);
    if (friends.length > 0 || loadingFriends) return;
    setLoadingFriends(true);
    const list = await getFriendsWithSharedContext(gathering?.host_id);
    setFriends(list);
    const urlEntries = await Promise.all(
      list.map(async (f) => {
        if (!f.photo_url) return [f.id, null];
        return [f.id, await getSignedPhotoUrl(f.photo_url)];
      })
    );
    setPhotoUrls(Object.fromEntries(urlEntries));
    setLoadingFriends(false);
  }

  async function handleInvite(friendId) {
    setInvitingId(friendId);
    try {
      await sendInvite('gathering', gatheringId, friendId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setInvitedIds((prev) => ({ ...prev, [friendId]: true }));
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setInvitingId(null);
  }

  function handleDone() {
    navigation.replace('GatheringDetail', { gatheringId });
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const categoryStyle = categoryStyleFor(gathering?.interest_tag);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xxl, alignItems: 'center' }}>
        <Text style={styles.celebrateIcon}>🎉</Text>
        <Text style={styles.title}>Your gathering is live!</Text>
        <Text style={styles.subtitle}>Now let's help people discover it.</Text>

        <View style={[styles.summaryCard, { borderColor: categoryStyle.color }]}>
          <Text style={styles.summaryIcon}>{categoryStyle.icon}</Text>
          <Text style={styles.summaryTitle}>{gathering?.title}</Text>
        </View>

        {!showInvite ? (
          <View style={{ width: '100%' }}>
            <TouchableOpacity style={styles.actionButton} onPress={handleShare} activeOpacity={0.85} accessibilityLabel="Share Gathering" accessibilityRole="button">
              <Text style={styles.actionButtonText}>🔗 Share Gathering</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, styles.actionButtonSecondary]} onPress={handleOpenInvite} activeOpacity={0.85} accessibilityLabel="Invite Connections" accessibilityRole="button">
              <Text style={[styles.actionButtonText, styles.actionButtonTextSecondary]}>🤝 Invite Connections</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDone} style={{ marginTop: spacing.lg }} accessibilityLabel="Done" accessibilityRole="button">
              <Text style={styles.doneLink}>I'll do this later</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ width: '100%' }}>
            <Text style={styles.inviteHeader}>Invite Connections</Text>
            <Text style={styles.inviteSubtext}>Only people you're already friends with — never nearby strangers.</Text>
            {loadingFriends ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
            ) : friends.length === 0 ? (
              <Text style={styles.emptyText}>Add some friends first to be able to invite them here.</Text>
            ) : (
              friends.map((f) => (
                <View key={f.id} style={styles.friendRow}>
                  {photoUrls[f.id] ? (
                    <Image source={{ uri: photoUrls[f.id] }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarPlaceholder]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.friendName}>{f.display_name}</Text>
                    {f.sharedContext && <Text style={styles.friendContext}>{f.sharedContext}</Text>}
                  </View>
                  <TouchableOpacity
                    style={[styles.inviteButton, invitedIds[f.id] && styles.inviteButtonSent]}
                    onPress={() => handleInvite(f.id)}
                    disabled={invitingId === f.id || invitedIds[f.id]}
                    accessibilityLabel={invitedIds[f.id] ? 'Invite sent' : `Invite ${f.display_name}`}
                    accessibilityRole="button"
                  >
                    {invitingId === f.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.inviteButtonText}>{invitedIds[f.id] ? '✓ Sent' : 'Invite'}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ))
            )}
            <TouchableOpacity onPress={handleDone} style={{ marginTop: spacing.lg }} accessibilityLabel="Done" accessibilityRole="button">
              <Text style={styles.doneLink}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  celebrateIcon: { fontSize: 48, marginBottom: spacing.sm },
  title: { ...typography.title, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: 4, marginBottom: spacing.lg },
  summaryCard: {
    width: '100%', flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1.5, padding: spacing.lg, marginBottom: spacing.xl, ...shadow.card,
  },
  summaryIcon: { fontSize: 28, marginRight: spacing.md },
  summaryTitle: { ...typography.headline, color: colors.textPrimary, flex: 1 },
  actionButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16,
    alignItems: 'center', marginBottom: spacing.sm, ...shadow.button,
  },
  actionButtonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, shadowOpacity: 0 },
  actionButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  actionButtonTextSecondary: { color: colors.textPrimary },
  doneLink: { color: colors.textTertiary, textAlign: 'center', fontSize: 14 },
  inviteHeader: { ...typography.headline, color: colors.textPrimary, marginBottom: 2 },
  inviteSubtext: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg },
  emptyText: { color: colors.textTertiary, textAlign: 'center', paddingVertical: spacing.xl, lineHeight: 20 },
  friendRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  avatarPlaceholder: {},
  friendName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  friendContext: { color: colors.textTertiary, fontSize: 11, marginTop: 1 },
  inviteButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 8, minWidth: 70, alignItems: 'center' },
  inviteButtonSent: { backgroundColor: colors.success },
  inviteButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
