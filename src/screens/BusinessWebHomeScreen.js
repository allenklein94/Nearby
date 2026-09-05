import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, SafeAreaView } from 'react-native';
import { getMyManagedPartner } from '../services/brandOffers';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing } from '../theme';
import NearbyMark from '../components/brand/NearbyMark';

// Phase 7 (Business Web, CLAUDE.md) -- the entire gate for Business Web:
// a signed-in visitor only ever reaches BusinessDashboard here if they
// really do manage a real, approved partner (same getMyManagedPartner()
// BusinessDashboardScreen.js itself already uses to load selectedPartner,
// reused verbatim rather than a second ownership check). A visitor who
// doesn't gets a real, honest message -- never a fabricated dashboard.
export default function BusinessWebHomeScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [checking, setChecking] = useState(true);
  const [hasBusiness, setHasBusiness] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMyManagedPartner().then((partner) => {
      if (cancelled) return;
      if (partner) {
        navigation.replace('BusinessDashboard');
      } else {
        setHasBusiness(false);
        setChecking(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  if (checking) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <NearbyMark size={48} style={styles.mark} />
      <Text style={styles.title} accessibilityRole="header">This view is for approved Nearby business partners</Text>
      <Text style={styles.body}>
        This account isn't linked to an approved business yet. If you've applied, download the
        Nearby app and sign in with the same phone number to get access once approved. If you
        haven't applied, visit nearby's business page to get started.
      </Text>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, justifyContent: 'center', alignItems: 'center' },
  mark: { marginBottom: spacing.lg },
  title: { ...typography.title, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.md },
  body: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
});
