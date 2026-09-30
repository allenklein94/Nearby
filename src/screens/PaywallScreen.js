import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Alert, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getOfferings, purchasePackage, restorePurchases, isPremium, openSubscriptionManagement } from '../services/purchases';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

import { NLoader } from '../motion';
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
        Alert.alert(t('ui.paywallUi.welcomeToPremium'), t('ui.paywallUi.youCanNowSeeWho'));
        navigation.goBack();
      }
    } catch (e) {
      if (!e.userCancelled) Alert.alert(t('ui.paywallUi.purchaseFailed'), e.message);
    }
  }

  async function handleRestore() {
    try {
      const restored = await restorePurchases();
      if (restored) {
        Alert.alert(t('ui.paywallUi.restored'), t('ui.paywallUi.yourPremiumAccessHasBeen'));
        navigation.goBack();
      } else {
        Alert.alert(t('ui.paywallUi.nothingToRestore'), t('ui.paywallUi.noActivePremiumSubscriptionFound'));
      }
    } catch (e) {
      Alert.alert(t('ui.paywallUi.restoreFailed'), e.message || t('ui.paywallUi.couldNotRestoreYourPurchases'));
    }
  }

  function openNativeSubscriptionManagement() {
    openSubscriptionManagement(null).catch(() => {
      Alert.alert(t('ui.paywallUi.couldNotOpen'), t('ui.paywallUi.pleaseOpenYourDeviceSettings'));
    });
  }

  const isAnnual = (pkg) => pkg.identifier.toLowerCase().includes('annual') || pkg.identifier.toLowerCase().includes('year');

  return (
    <SafeAreaView style={styles.container}>
      {/* presentation: 'modal' relies on swipe-down (iOS) / hardware back
          (Android) to dismiss, with no visible affordance telling anyone
          either exists -- the same "reachable, no obvious way out" gap
          found and fixed on FriendDiscoveryScreen/PlacesScreen/
          TimelineScreen/AdminReportsScreen. A paywall specifically also
          deserves an explicit close, standard for this kind of screen. */}
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.closeButton}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel={t('ui.paywallUi.closeA11y')}
        accessibilityRole="button"
      >
        <Ionicons name="close" size={24} color={colors.textSecondary} />
      </TouchableOpacity>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>✨ {t('paywall.badge')}</Text>
      </View>

      <Text style={styles.title} accessibilityRole="header">{t('paywall.title')}</Text>
      <Text style={styles.subtitle}>{t('paywall.subtitle')}</Text>

      <View style={styles.featuresCard} accessible={true} accessibilityLabel={t('ui.paywallUi.premiumFeaturesA11y', { list: FEATURES.map((f) => f.text).join('. ') })}>
        {FEATURES.map((f, i) => (
          <View key={f.text} style={[styles.featureRow, i > 0 && styles.featureRowBorder]}>
            <Text style={styles.featureIcon}>{f.icon}</Text>
            <Text style={styles.featureText}>{f.text}</Text>
          </View>
        ))}
      </View>

      {loading ? (
        <NLoader fullScreen={false} size="compact" kind="content" />
      ) : alreadyPremium ? (
        <View style={styles.alreadyPremiumCard}>
          <Text style={styles.alreadyPremiumEmoji}>🎉</Text>
          <Text style={styles.alreadyPremiumTitle}>{t('ui.paywallUi.youreAlreadyPremium')}</Text>
          <Text style={styles.alreadyPremiumText}>{t('ui.paywallUi.allTheseFeaturesAreUnlocked')}</Text>
          <TouchableOpacity
            style={styles.manageButton}
            onPress={openNativeSubscriptionManagement}
            activeOpacity={0.85}
            accessibilityLabel={t('ui.paywallUi.manageYourSubscriptionPlanA11y')}
            accessibilityRole="button"
          >
            <Text style={styles.manageButtonText}>{t('ui.paywallUi.manageSubscription')}</Text>
          </TouchableOpacity>
          <Text style={styles.manageHelperText}>
            {Platform.OS === 'ios' ? t('ui.paywallUi.managedByApple') : t('ui.paywallUi.managedByGoogle')}
          </Text>
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
              accessibilityHint={t('ui.paywallUi.startsASubscriptionPurchaseA11y')}
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
            {t('ui.paywallUi.offeringsNotConfiguredYetSet')}
          </Text>
          {errorMessage && (
            <Text style={styles.errorDetail}>{t('ui.paywallUi.debug', { errorMessage: errorMessage })}</Text>
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
  closeButton: { position: 'absolute', top: spacing.md, right: spacing.md, zIndex: 1, padding: spacing.xs },
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
  alreadyPremiumText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg },
  manageButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, paddingHorizontal: spacing.xl, ...shadow.button },
  manageButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  manageHelperText: { ...typography.small, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.md, lineHeight: 16 },
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
  errorDetail: { color: colors.danger, marginTop: spacing.md, textAlign: 'center', fontSize: 12, fontFamily: 'monospace' },
});