import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, Image, StyleSheet, Modal, Alert, ActivityIndicator } from 'react-native';
import { getMyFriends } from '../services/friends';
import { getSignedPhotoUrl } from '../services/photos';
import { supabase } from '../services/supabase';
import { sendInvite } from '../services/invites';
import * as Haptics from 'expo-haptics';
import AnimatedListItem from './AnimatedListItem';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// Gathering invites go through the older, gathering-specific
// invite_friend_to_gathering RPC (women-only + blocks-aware, already
// wired here before this component also learned to invite to
// communities) — kept as-is rather than folded into the newer generic
// social_invites path, so nothing about its existing safety checks
// changes. Community invites use the newer generic path since no
// gathering-specific RPC exists for them.
export default function InviteFriendsModal({
  visible, onClose,
  gatheringId, gatheringTitle,
  inviteType = 'gathering', targetId, targetTitle,
}) {
  const resolvedType = gatheringId ? 'gathering' : inviteType;
  const resolvedTargetId = gatheringId ?? targetId;
  const resolvedTargetTitle = gatheringTitle ?? targetTitle;
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [friends, setFriends] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [invitedIds, setInvitedIds] = useState({});
  const [invitingId, setInvitingId] = useState(null);

  useEffect(() => {
    if (visible) {
      setInvitedIds({});
      loadFriends();
    }
  }, [visible]);

  async function loadFriends() {
    setLoading(true);
    const friendsList = await getMyFriends();
    setFriends(friendsList);

    const urlEntries = await Promise.all(
      friendsList.map(async (f) => {
        if (!f.photo_url) return [f.id, null];
        const url = await getSignedPhotoUrl(f.photo_url);
        return [f.id, url];
      })
    );
    setPhotoUrls(Object.fromEntries(urlEntries));
    setLoading(false);
  }

  async function handleInvite(friendId) {
    setInvitingId(friendId);
    try {
      if (resolvedType === 'gathering') {
        const { error } = await supabase.rpc('invite_friend_to_gathering', {
          gathering_id_param: resolvedTargetId,
          friend_id_param: friendId,
        });
        if (error) throw error;
      } else {
        await sendInvite('community', resolvedTargetId, friendId);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setInvitedIds((prev) => ({ ...prev, [friendId]: true }));
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setInvitingId(null);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Invite Friends</Text>
          <Text style={styles.subtitle}>to "{resolvedTargetTitle}"</Text>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
          ) : (
            <FlatList
              data={friends}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 400 }}
              ListEmptyComponent={
                <Text style={styles.emptyText}>Add some friends first to be able to invite them here.</Text>
              }
              renderItem={({ item, index }) => (
                <AnimatedListItem index={index}>
                <View style={styles.friendRow}>
                  {photoUrls[item.id] ? (
                    <Image source={{ uri: photoUrls[item.id] }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarPlaceholder]} />
                  )}
                  <Text style={styles.friendName}>{item.display_name}</Text>
                  <TouchableOpacity
                    style={[styles.inviteButton, invitedIds[item.id] && styles.inviteButtonSent]}
                    onPress={() => handleInvite(item.id)}
                    disabled={invitingId === item.id || invitedIds[item.id]}
                    accessibilityLabel={invitedIds[item.id] ? 'Invite sent' : `Invite ${item.display_name}`}
                    accessibilityRole="button"
                  >
                    {invitingId === item.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.inviteButtonText}>{invitedIds[item.id] ? '✓ Sent' : 'Invite'}</Text>
                    )}
                  </TouchableOpacity>
                </View>
                </AnimatedListItem>
              )}
            />
          )}

          <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.lg }}>
            <Text style={styles.closeText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg },
  friendRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  avatarPlaceholder: {},
  friendName: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  inviteButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 8, minWidth: 70, alignItems: 'center' },
  inviteButtonSent: { backgroundColor: colors.success },
  inviteButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  emptyText: { color: colors.textTertiary, textAlign: 'center', paddingVertical: spacing.xl, lineHeight: 20 },
  closeText: { color: colors.textTertiary, textAlign: 'center', fontSize: 14 },
});