import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, Image, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyBlockedUsers, unblockUser } from '../services/blockedUsers';
import { getSignedPhotoUrl } from '../services/photos';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

export default function BlockedUsersScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unblockingId, setUnblockingId] = useState(null);

  const load = useCallback(async () => {
    const data = await getMyBlockedUsers();
    setBlockedUsers(data);

    const urlEntries = await Promise.all(
      data.map(async (b) => {
        const path = b.profiles?.photo_url;
        if (!path) return [b.id, null];
        const url = await getSignedPhotoUrl(path);
        return [b.id, url];
      })
    );
    setPhotoUrls(Object.fromEntries(urlEntries));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function confirmUnblock(block) {
    Alert.alert(
      `Unblock ${block.profiles?.display_name || 'this person'}?`,
      "They'll be able to see your profile and interact with you again if you cross paths.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            setUnblockingId(block.id);
            try {
              await unblockUser(block.id);
              load();
            } catch (e) {
              Alert.alert('Error', e.message);
            }
            setUnblockingId(null);
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.headerTitle} accessibilityRole="header">🚫 Blocked Users</Text>
        <Text style={styles.headerSubtitle}>
          People you've blocked won't see your profile and can't contact you. You can unblock anyone at any time.
        </Text>

        {blockedUsers.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>✓</Text>
            <Text style={styles.emptyText}>You haven't blocked anyone.</Text>
          </View>
        )}

        {blockedUsers.map((block) => (
          <View key={block.id} style={styles.card}>
            {photoUrls[block.id] ? (
              <Image source={{ uri: photoUrls[block.id] }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]} />
            )}
            <Text style={styles.name}>{block.profiles?.display_name || 'Someone'}</Text>
            <TouchableOpacity
              style={styles.unblockButton}
              onPress={() => confirmUnblock(block)}
              disabled={unblockingId === block.id}
              accessibilityLabel={`Unblock ${block.profiles?.display_name || 'this person'}`}
              accessibilityRole="button"
            >
              <Text style={styles.unblockButtonText}>{unblockingId === block.id ? '...' : 'Unblock'}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  avatar: { width: 44, height: 44, borderRadius: radius.md, marginRight: spacing.md, backgroundColor: colors.surfaceElevated },
  avatarPlaceholder: {},
  name: { ...typography.bodyBold, color: colors.textPrimary, flex: 1 },
  unblockButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  unblockButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});