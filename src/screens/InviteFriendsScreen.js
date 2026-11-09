import React from 'react';
import { Text, TouchableOpacity, StyleSheet, SafeAreaView, Share, View } from 'react-native';
import { usePostHog } from 'posthog-react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

// A plain invitation (owner, 2026-11-09): no referral code, no count, no reward. Inviting never earns anything.
const APP_URL = 'https://apps.apple.com/app/nearby-crossed-paths/id6792143175';

export default function InviteFriendsScreen() {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);

  async function handleShare() {
    try {
      const result = await Share.share({
        message: t('ui.inviteFriends.joinMeOnNearbyUse', { url: APP_URL }),
      });
      if (result.action === Share.sharedAction) {
        posthog.capture('invite_shared');
      }
    } catch (e) {
      // User cancelled the share sheet — not an error
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={{ padding: spacing.lg }}>
        <Text style={styles.headerTitle} accessibilityRole="header">{t('inviteFriends.title')}</Text>
        <Text style={styles.headerSubtitle}>{t('inviteFriends.subtitle')}</Text>
        <TouchableOpacity style={styles.shareButton} onPress={handleShare} activeOpacity={0.85} accessibilityLabel={t('inviteFriends.shareInvite')} accessibilityRole="button">
          <Text style={styles.shareButtonText}>{t('inviteFriends.shareInvite')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  shareButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, ...shadow.button },
  shareButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
