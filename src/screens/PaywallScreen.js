import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Alert, ActivityIndicator } from 'react-native';
import { getOfferings, purchasePackage, restorePurchases, isPremium } from '../services/purchases';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

export default function PaywallScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors, shadow);
  const [offering, setOffering] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [alreadyPremium, setAlreadyPremium] = useState(false);

  const FEATURES = [
    { icon: '👀', text: t('paywall.feature1') },
    { icon: '✨', text: t('paywall.feature2') },
    { icon: '📍', text: t('paywall.feature3') },
    { icon: '💬', text: t('paywall.feature4') },
  ];

  useEffect(() => {
    isPremium()
      .then(setAlreadyPremium)
      .catch(() => setAlreadyPremium(false));

    getOfferings()
      .then((result) => {
        setOffering(result);
        if (!result) {
          setErrorMessage('getOfferings() returned null/undefined — RevenueCat may not be configured, or no current offering exists.');
        }
      })
      .catch((err) => {
        setErrorMessage(err?.message || String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  async function handlePurchase(pkg) {
    try {
      const unlocked = await purchasePackage(pkg);
      if (unlocked) {
        Alert.alert('Welcome to Premium', 'You can now see who noticed you.');
        navigation.goBack();
      }
    } catch (e) {
      if (!e.userCancelled) Alert.alert('Purchase failed', e.message);
    }
  }

  async function handleRestore() {
    const restored = await restorePurchases();
    if (restored) {
      Alert.alert('Restored', 'Your premium access has been restored.');
      navigation.goBack();
    } else {
      Alert.alert('Nothing to restore', 'No active premium subscription found.');
    }
  }

  const isAnnual = (pkg) => pkg.identifier.toLowerCase().includes('annual') || pkg.identifier.toLowerCase().includes('year');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>✨ {t('paywall.badge')}</Text>
      </View>

      <Text style={styles.title} accessibilityRole="header">{t('paywall.title')}</Text>
      <Text style={styles.subtitle}>{t('paywall.subtitle')}</Text>

      <View style={styles.featuresCard} accessible={true} accessibilityLabel={`Premium features: ${FEATURES.map((f) => f.text).join('. ')}`}>
        {FEATURES.map((f, i) => (
          <View key={f.text} style={[styles.featureRow, i > 0 && styles.featureRowBorder]}>
            <Text style={styles.featureIcon}>{f.icon}</Text>
            <Text style={styles.featureText}>{f.text}</Text>
          </View>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : alreadyPremium ? (
        <View style={styles.alreadyPremiumCard}>
          <Text style={styles.alreadyPremiumEmoji}>🎉</Text>
          <Text style={styles.alreadyPremiumTitle}>You're already Premium</Text>
          <Text style={styles.alreadyPremiumText}>All these features are unlocked on your account.</Text>
        </View>
      ) : offering ? (
        offering.availablePackages.map((pkg) => {
          const featured = isAnnual(pkg);
          return (
            <TouchableOpacity
              key={pkg.identifier}
              style={[styles.planButton, featured && styles.planButtonFeatured]}
              onPress={() => handlePurchase(pkg)}
              activeOpacity={0.85}
              accessibilityLabel={`${pkg.product.title}, ${pkg.product.priceString}${featured ? ', ' + t('paywall.bestValue') : ''}`}
              accessibilityRole="button"
              accessibilityHint="Starts a subscription purchase"
            >
              {featured && (
                <View style={styles.saveBadge}>
                  <Text style={styles.saveBadgeText}>{t('paywall.bestValue')}</Text>
                </View>
              )}
              <Text style={[styles.planButtonText, featured && styles.planButtonTextFeatured]}>
                {pkg.product.title} — {pkg.product.priceString}
              </Text>
            </TouchableOpacity>
          );
        })
      ) : (
        <View style={styles.errorCard}>
          <Text style={styles.empty}>
            Offerings not configured yet — set this up in RevenueCat + App Store Connect.
          </Text>
          {errorMessage && (
            <Text style={styles.errorDetail}>Debug: {errorMessage}</Text>
          )}
        </View>
      )}

      {!alreadyPremium && (
        <TouchableOpacity
          onPress={handleRestore}
          style={{ marginTop: spacing.lg }}
          accessibilityLabel={t('paywall.restorePurchases')}
          accessibilityRole="button"
        >
          <Text style={styles.restoreText}>{t('paywall.restorePurchases')}</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, paddingTop: spacing.xl },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    marginBottom: spacing.md,
  },
  badgeText: { color: colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  title: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  featuresCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  featureRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  featureRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  featureIcon: { fontSize: 20, marginRight: spacing.md },
  featureText: { ...typography.bodyBold, color: colors.textPrimary, flex: 1 },
  alreadyPremiumCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl,
    alignItems: 'center', borderWidth: 1.5, borderColor: colors.primary,
  },
  alreadyPremiumEmoji: { fontSize: 40, marginBottom: spacing.sm },
  alreadyPremiumTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
  alreadyPremiumText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  planButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  planButtonFeatured: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    ...shadow.button,
  },
  planButtonText: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  planButtonTextFeatured: { color: '#fff' },
  saveBadge: {
    position: 'absolute',
    top: -10,
    backgroundColor: colors.success,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  saveBadgeText: { color: '#0a0a0a', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  restoreText: { color: colors.textTertiary, textAlign: 'center', fontSize: 13 },
  errorCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  empty: { color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  errorDetail: { color: colors.primary, marginTop: spacing.md, textAlign: 'center', fontSize: 12, fontFamily: 'monospace' },
});