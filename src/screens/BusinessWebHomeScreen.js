import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, SafeAreaView, TouchableOpacity } from 'react-native';
import { getMyManagedPartner } from '../services/brandOffers';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { typography, spacing } from '../theme';
import NearbyMark from '../components/brand/NearbyMark';

import { NLoader } from '../motion';
// Phase 7 (Business Web, CLAUDE.md) -- the entire gate for Business Web:
// a signed-in visitor only ever reaches BusinessDashboard here if they
// really do manage a real, approved partner (same getMyManagedPartner()
// BusinessDashboardScreen.js itself already uses to load selectedPartner,
// reused verbatim rather than a second ownership check). A visitor who
// doesn't gets a real, honest message -- never a fabricated dashboard.
// Admins (profiles.is_admin, set only server-side) also get a link to Admin review (20270368 + 20270369); the link is a
// convenience: every admin read and action is refused by the server for anyone else.
export default function BusinessWebHomeScreen({ navigation }) {
  const { colors } = useTheme();
  const { isAdmin } = useAuth();
  const styles = getStyles(colors);
  const [checking, setChecking] = useState(true);
  const [hasBusiness, setHasBusiness] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMyManagedPartner().then((partner) => {
      if (cancelled) return;
      if (partner && !isAdmin) {
        navigation.replace('BusinessDashboard');
      } else if (partner) {
        setHasBusiness(true);
        setChecking(false);
      } else {
        setHasBusiness(false);
        setChecking(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [navigation, isAdmin]);

  if (checking) {
    return (
      <SafeAreaView style={styles.container}>
        <NLoader />
      </SafeAreaView>
    );
  }

  const adminLinks = isAdmin ? (
    <View style={styles.links}>
      {hasBusiness ? (
        <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('BusinessDashboard')} accessibilityRole="button">
          <Text style={styles.buttonText}>Business dashboard</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('AdminReview')} accessibilityRole="button">
        <Text style={styles.buttonText}>Admin review</Text>
      </TouchableOpacity>
    </View>
  ) : null;

  if (hasBusiness) {
    return <SafeAreaView style={styles.container}><NearbyMark size={48} style={styles.mark} />{adminLinks}</SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <NearbyMark size={48} style={styles.mark} />
      {adminLinks}
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
  links: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  button: { backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  buttonText: { color: '#fff', fontWeight: '700' },
});
