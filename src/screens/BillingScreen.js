import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getSubscriptionDetails, restorePurchases, openSubscriptionManagement } from '../services/purchases';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const STORE_LABELS = {
  APP_STORE: 'the App Store',
  MAC_APP_STORE: 'the Mac App Store',
  PLAY_STORE: 'Google Play',
  AMAZON: 'Amazon',
  STRIPE: 'Stripe',
  PROMOTIONAL: 'a promotional grant',
  RC_BILLING: 'RevenueCat Billing',
};

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function BillingScreen({ navigation }) {
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
        restored ? 'Restored' : 'Nothing to restore',
        restored ? 'Your premium access has been restored.' : 'No active premium subscription found for this account.'
      );
      if (restored) load();
    } finally {
      setRestoring(false);
    }
  }

  function handleManage() {
    openSubscriptionManagement(details?.managementURL || null).catch(() => {
      Alert.alert('Could not open', 'Please open your device Settings app and look under Subscriptions to manage your plan.');
    });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading your subscription...</Text>
      </SafeAreaView>
    );
  }

  const since = formatDate(details?.latestPurchaseDate);
  const until = formatDate(details?.expirationDate);
  const storeLabel = details?.store ? (STORE_LABELS[details.store] || details.store) : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {details?.unavailable ? (
          <View style={styles.planCard}>
            <Text style={styles.planEmoji}>💳</Text>
            <Text style={styles.planTitle}>Subscription status unavailable</Text>
            <Text style={styles.planSubtext}>
              This device/build can't reach the store to check your plan right now. Try again from a real device build.
            </Text>
          </View>
        ) : details?.active ? (
          <View style={[styles.planCard, styles.planCardActive]}>
            <Text style={styles.planEmoji}>✨</Text>
            <Text style={styles.planTitle}>Premium</Text>
            {since && <Text style={styles.planSubtext}>Member since {since}</Text>}
            {until ? (
              <Text style={styles.planSubtext}>
                {details.willRenew ? 'Renews' : 'Ends'} {until}{!details.willRenew ? ' — auto-renew is off' : ''}
              </Text>
            ) : (
              <Text style={styles.planSubtext}>Does not expire</Text>
            )}
            {storeLabel && <Text style={styles.planStoreText}>Billed via {storeLabel}</Text>}
            {details.isSandbox && <Text style={styles.sandboxText}>Sandbox / test purchase</Text>}

            <TouchableOpacity
              style={styles.manageButton}
              onPress={handleManage}
              activeOpacity={0.85}
              accessibilityLabel="Manage your subscription plan"
              accessibilityRole="button"
            >
              <Text style={styles.manageButtonText}>Manage Subscription</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.planCard}>
            <Text style={styles.planEmoji}>🔓</Text>
            <Text style={styles.planTitle}>Free plan</Text>
            <Text style={styles.planSubtext}>Upgrade to unlock Premium features.</Text>
            <TouchableOpacity
              style={styles.manageButton}
              onPress={() => navigation.navigate('Paywall')}
              activeOpacity={0.85}
              accessibilityLabel="Upgrade to Premium"
              accessibilityRole="button"
            >
              <Text style={styles.manageButtonText}>Upgrade to Premium</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          onPress={handleRestore}
          disabled={restoring}
          style={{ marginTop: spacing.md, alignSelf: 'center' }}
          accessibilityLabel="Restore purchases"
          accessibilityRole="button"
        >
          <Text style={styles.restoreText}>{restoring ? 'Restoring…' : 'Restore Purchases'}</Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel} accessibilityRole="header">Payment Methods</Text>
        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            Nearby doesn't store your card details. Your subscription is billed directly by Apple or Google using
            whatever payment method is on file with your App Store or Google Play account — update it there, not here.
          </Text>
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">Billing History</Text>
        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            Receipts and charge history for this subscription live on your App Store or Google Play account, not in
            Nearby. Tap "Manage Subscription" above to open it.
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
