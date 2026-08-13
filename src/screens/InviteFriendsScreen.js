import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Share, ActivityIndicator, TextInput } from 'react-native';
import { getMyReferralCode, getMyReferralStats, redeemReferralCode } from '../services/referrals';
import { supabase } from '../services/supabase';
import { usePostHog } from 'posthog-react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

export default function InviteFriendsScreen() {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [userId, setUserId] = useState(null);
  const [code, setCode] = useState(null);
  const [referralCount, setReferralCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [redeemInput, setRedeemInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [alreadyReferred, setAlreadyReferred] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: sessionData } = await supabase.auth.getSession();
    const id = sessionData?.session?.user?.id;
    setUserId(id);
    if (!id) return;

    const [myCode, stats, profile] = await Promise.all([
      getMyReferralCode(id),
      getMyReferralStats(id),
      supabase.from('profiles').select('referred_by').eq('id', id).single(),
    ]);
    setCode(myCode);
    setReferralCount(stats.referralCount);
    setAlreadyReferred(!!profile.data?.referred_by);
    setLoading(false);
  }

  async function handleShare() {
    try {
      const result = await Share.share({
        message: `Join me on Nearby! Use my code ${code} when you sign up and we'll both get bonus Notices. https://apps.apple.com/app/nearby-crossed-paths/id6792143175`,
      });
      if (result.action === Share.sharedAction) {
        posthog.capture('referral_code_shared');
      }
    } catch (e) {
      // User cancelled the share sheet — not an error
    }
  }

  async function handleRedeem() {
    if (!redeemInput.trim()) return;
    setRedeeming(true);
    try {
      await redeemReferralCode(redeemInput);
      posthog.capture('referral_code_redeemed');
      Alert.alert('Success!', "You've both received 3 bonus Notices.");
      setRedeemInput('');
      load();
    } catch (e) {
      Alert.alert('Could not redeem', e.message);
    }
    setRedeeming(false);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading your friends...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.headerTitle} accessibilityRole="header">{t('inviteFriends.title')}</Text>
        <Text style={styles.headerSubtitle}>
          {t('inviteFriends.subtitle')}
        </Text>

        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>{t('inviteFriends.yourCode')}</Text>
          <Text style={styles.codeText}>{code}</Text>
          <TouchableOpacity style={styles.shareButton} onPress={handleShare} activeOpacity={0.85} accessibilityLabel={t('inviteFriends.shareCode')} accessibilityRole="button">
            <Text style={styles.shareButtonText}>{t('inviteFriends.shareCode')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{referralCount}</Text>
          <Text style={styles.statLabel}>{t('inviteFriends.friendsJoined')}</Text>
        </View>

        {!alreadyReferred && (
          <View style={styles.redeemCard}>
            <Text style={styles.redeemLabel}>{t('inviteFriends.haveCode')}</Text>
            <View style={styles.redeemRow}>
              <TextInput
                style={styles.redeemInput}
                placeholder={t('inviteFriends.enterCode')}
                placeholderTextColor={colors.textTertiary}
                value={redeemInput}
                onChangeText={setRedeemInput}
                autoCapitalize="characters"
                accessibilityLabel="Referral code"
              />
              <TouchableOpacity
                style={styles.redeemButton}
                onPress={handleRedeem}
                disabled={redeeming || !redeemInput.trim()}
                accessibilityLabel={t('inviteFriends.redeem')}
                accessibilityRole="button"
              >
                <Text style={styles.redeemButtonText}>{redeeming ? '...' : t('inviteFriends.redeem')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  codeCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl,
    alignItems: 'center', marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  codeLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm },
  codeText: { fontSize: 32, fontWeight: '800', letterSpacing: 4, color: colors.primary, marginBottom: spacing.lg },
  shareButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, ...shadow.button },
  shareButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  statCard: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.lg, padding: spacing.lg,
    alignItems: 'center', marginBottom: spacing.lg,
  },
  statNumber: { fontSize: 28, fontWeight: '800', color: colors.textPrimary },
  statLabel: { color: colors.textTertiary, fontSize: 13, marginTop: 2 },
  redeemCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  redeemLabel: { ...typography.bodyBold, color: colors.textPrimary, marginBottom: spacing.sm },
  redeemRow: { flexDirection: 'row', gap: spacing.sm },
  redeemInput: { flex: 1, backgroundColor: colors.surfaceElevated, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  redeemButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  redeemButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});