import React, { useState, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { NLoader } from '../motion';
import { useFocusEffect } from '@react-navigation/native';
import { getSubscriptionDetails, restorePurchases, openSubscriptionManagement } from '../services/purchases';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { displayDay } from '../i18n/display';

// Stores we name, read from ui.billing.store.<STORE> (an unknown store id is shown as given).
const KNOWN_STORES = ['APP_STORE', 'MAC_APP_STORE', 'PLAY_STORE', 'AMAZON', 'STRIPE', 'PROMOTIONAL', 'RC_BILLING'];

// "September 30, 2026" in English (unchanged); other languages via the shared day formatter.
function formatDate(iso, language) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  if (!language || language === 'en') return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  return displayDay(iso, language, { withYear: true });
}

export default function BillingScreen({ navigation }) {
  const { t, language } = useLanguage();
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    (async () => {
      const data = await getSubscriptionDetails();
      if (!cancelled) {
        setDetails(data);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(load);

  async function handleRestore() {
    setRestoring(true);
    try {
      const restored = await restorePurchases();
      Alert.alert(
        restored ? t('ui.billing.restored') : t('ui.billing.nothingToRestore'),
        restored ? t('ui.billing.yourPremiumAccessHasBeen') : t('ui.billing.noActivePremiumSubscriptionFound')
      );
      if (restored) load();
    } catch (e) {
      Alert.alert(t('ui.billing.restoreFailed'), e.message || t('ui.billing.couldNotRestoreYourPurchases'));
    } finally {
      setRestoring(false);
    }
  }

  function handleManage() {
    openSubscriptionManagement(details?.managementURL || null).catch(() => {
      Alert.alert(t('ui.billing.couldNotOpen'), t('ui.billing.pleaseOpenYourDeviceSettings'));
    });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <NLoader fullScreen={false} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{t('ui.billing.loadingYourSubscription')}</Text>
      </SafeAreaView>
    );
  }

  const since = formatDate(details?.latestPurchaseDate, language);
  const until = formatDate(details?.expirationDate, language);
  const storeLabel = details?.store ? (KNOWN_STORES.includes(details.store) ? t(`ui.billing.store.${details.store}`) : details.store) : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {details?.unavailable ? (
          <View style={styles.planCard}>
            <Text style={styles.planEmoji}>💳</Text>
            <Text style={styles.planTitle}>{t('ui.billing.subscriptionStatusUnavailable')}</Text>
            <Text style={styles.planSubtext}>
              {t('ui.billing.thisDeviceBuildCantReach')}
            </Text>
          </View>
        ) : details?.active ? (
          <View style={[styles.planCard, styles.planCardActive]}>
            <Text style={styles.planEmoji}>✨</Text>
            <Text style={styles.planTitle}>{t('ui.billing.premium')}</Text>
            {since && <Text style={styles.planSubtext}>{t('ui.billing.memberSince', { since: since })}</Text>}
            {until ? (
              <Text style={styles.planSubtext}>
                {details.willRenew ? t('ui.billing.renewsOn', { date: until }) : t('ui.billing.endsOnAutoRenewOff', { date: until })}
              </Text>
            ) : (
              <Text style={styles.planSubtext}>{t('ui.billing.doesNotExpire')}</Text>
            )}
            {storeLabel && <Text style={styles.planStoreText}>{t('ui.billing.billedVia', { storeLabel: storeLabel })}</Text>}
            {details.isSandbox && <Text style={styles.sandboxText}>{t('ui.billing.sandboxTestPurchase')}</Text>}

            <TouchableOpacity
              style={styles.manageButton}
              onPress={handleManage}
              activeOpacity={0.85}
              accessibilityLabel={t('ui.billing.manageYourSubscriptionPlanA11y')}
              accessibilityRole="button"
            >
              <Text style={styles.manageButtonText}>{t('ui.billing.manageSubscription')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.planCard}>
            <Text style={styles.planEmoji}>🔓</Text>
            <Text style={styles.planTitle}>{t('ui.billing.freePlan')}</Text>
            <Text style={styles.planSubtext}>{t('ui.billing.upgradeToUnlockPremiumFeatures')}</Text>
            <TouchableOpacity
              style={styles.manageButton}
              onPress={() => navigation.navigate('Paywall')}
              activeOpacity={0.85}
              accessibilityLabel={t('ui.billing.upgradeToPremiumA11y')}
              accessibilityRole="button"
            >
              <Text style={styles.manageButtonText}>{t('ui.billing.upgradeToPremium')}</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          onPress={handleRestore}
          disabled={restoring}
          style={{ marginTop: spacing.md, alignSelf: 'center' }}
          accessibilityLabel={t('ui.billing.restorePurchasesA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.restoreText}>{restoring ? t('ui.billing.restoring') : t('ui.billing.restorePurchases')}</Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.billing.paymentMethods')}</Text>
        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            {t('ui.billing.nearbyDoesntStoreYourCard')}
          </Text>
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.billing.billingHistory')}</Text>
        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            {t('ui.billing.receiptsAndChargeHistoryFor')}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  planCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, alignItems: 'center', marginBottom: spacing.md,
  },
  planCardActive: { borderWidth: 1.5, borderColor: colors.border },
  planEmoji: { fontSize: 36, marginBottom: spacing.xs },
  planTitle: { ...typography.title, color: colors.textPrimary, fontSize: 20 },
  planSubtext: { color: colors.textSecondary, fontSize: 13, marginTop: 4, textAlign: 'center' },
  planStoreText: { color: colors.textTertiary, fontSize: 12, marginTop: spacing.xs },
  sandboxText: { color: colors.danger, fontSize: 11, marginTop: 4, fontWeight: '700' },
  manageButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, paddingHorizontal: spacing.xl,
    marginTop: spacing.lg, ...shadow.button,
  },
  manageButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  restoreText: { color: colors.textTertiary, textAlign: 'center', fontSize: 13 },
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  infoCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  infoText: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
});
