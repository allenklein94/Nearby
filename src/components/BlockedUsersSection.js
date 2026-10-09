import React, { useEffect, useState, useCallback } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Image } from 'react-native';
import FadeInState from '../components/FadeInState';
import { NLoader } from '../motion';
import { getMyBlockedUsers, unblockUser } from '../services/blockedUsers';
import { getSignedPhotoUrl } from '../services/photos';
import LoadErrorState from '../components/LoadErrorState';
import { usePostHog } from 'posthog-react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

// Blocked people, shown in place under Settings > Safety (screen-reduction audit B10, 2026-10-09: this was its own
// screen, BlockedUsers). Loads when the section is opened; unblocking re-reads the list.
export default function BlockedUsersSection() {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [unblockingId, setUnblockingId] = useState(null);

  const load = useCallback(async () => {
    try {
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
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function confirmUnblock(block) {
    Alert.alert(
      block.profiles?.display_name ? t('ui.blockedUsers.unblock', { name: block.profiles.display_name }) : t('ui.blockedUsers.unblockThisPerson'),
      t('ui.blockedUsers.theyllBeAbleToSee'),
      [
        { text: t('ui.blockedUsers.cancel'), style: 'cancel' },
        {
          text: t('blockedUsers.unblock'),
          onPress: async () => {
            setUnblockingId(block.id);
            try {
              await unblockUser(block.id);
              posthog.capture('user_unblocked');
              load();
            } catch (e) {
              presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => confirmUnblock(block) });
            }
            setUnblockingId(null);
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <NLoader fullScreen={false} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{t('ui.blockedUsers.loadingBlockedUsers')}</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.container}>
        <LoadErrorState message={t('ui.blockedUsers.couldntLoadYourBlockedUsers')} onRetry={load} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
        <Text style={styles.headerSubtitle}>
          {t('blockedUsers.subtitle')}
        </Text>

        {blockedUsers.length === 0 && (
          <FadeInState style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>✓</Text>
            <Text style={styles.emptyText}>{t('blockedUsers.noneBlocked')}</Text>
          </FadeInState>
        )}

        {blockedUsers.map((block) => (
          <View key={block.id} style={styles.card}>
            {photoUrls[block.id] ? (
              <Image source={{ uri: photoUrls[block.id] }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]} />
            )}
            <Text style={styles.name}>{block.profiles?.display_name || t('ui.blockedUsers.someone')}</Text>
            <TouchableOpacity
              style={styles.unblockButton}
              onPress={() => confirmUnblock(block)}
              disabled={unblockingId === block.id}
              accessibilityLabel={t('ui.blockedUsers.unblockA11y', { name: block.profiles?.display_name || t('ui.blockedUsers.thisPerson') })}
              accessibilityRole="button"
            >
              <Text style={styles.unblockButtonText}>{unblockingId === block.id ? '...' : t('blockedUsers.unblock')}</Text>
            </TouchableOpacity>
          </View>
        ))}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { paddingTop: spacing.xs, paddingBottom: spacing.sm },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.md, lineHeight: 18 },
  emptyState: { alignItems: 'center', paddingVertical: spacing.md },
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