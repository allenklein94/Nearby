import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import StartSomethingModal from '../components/StartSomethingModal';
import { supabase } from '../services/supabase';
import { getHostStats } from '../services/gatherings';
import { getMyCommunities } from '../services/communities';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// A dedicated action hub — the "I want to do something" tab,
// distinct from Discover's "let me look around" browsing. Reuses
// the same Start Something quick-picks already built for Home.
export default function CreateHubScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [startModalVisible, setStartModalVisible] = useState(false);
  const [managesBusiness, setManagesBusiness] = useState(false);
  const [isOrganizer, setIsOrganizer] = useState(false);

  // "Partner With Us" was previously shown to every user regardless of
  // whether they organize anything — gated here on a real signal (hosted
  // a gathering, or leads/created a community), same "already a partner"
  // swap SettingsScreen.js's Business Mode row already does, so an
  // existing partner isn't shown the apply flow for a business they
  // already run.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const { data: sessionData } = await supabase.auth.getSession();
        const myId = sessionData?.session?.user?.id;
        if (!myId) return;

        const [{ data: profile }, hostStats, myCommunities] = await Promise.all([
          supabase.from('profiles').select('managed_partner_id').eq('id', myId).single(),
          getHostStats(myId),
          getMyCommunities(),
        ]);
        if (cancelled) return;

        setManagesBusiness(!!profile?.managed_partner_id);
        const leadsCommunity = myCommunities.some((c) => c.myRole === 'creator' || c.myRole === 'leader');
        setIsOrganizer((hostStats?.gatherings_hosted ?? 0) > 0 || leadsCommunity);
      })();
      return () => { cancelled = true; };
    }, [])
  );

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Create</Text>
      <Text style={styles.subtitle}>What do you want to do?</Text>

      <TouchableOpacity
        style={styles.card}
        onPress={() => setStartModalVisible(true)}
        activeOpacity={0.85}
        accessibilityLabel="Start something spontaneous"
        accessibilityRole="button"
      >
        <Text style={styles.cardIcon}>⚡</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Start Something</Text>
          <Text style={styles.cardSubtitle}>Coffee, food, a walk — spontaneous plans</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('CreateGathering')}
        activeOpacity={0.85}
        accessibilityLabel="Host a full gathering"
        accessibilityRole="button"
      >
        <Text style={styles.cardIcon}>🎉</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Host a Gathering</Text>
          <Text style={styles.cardSubtitle}>Plan something bigger, set a time and place</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('CreateCommunity')}
        activeOpacity={0.85}
        accessibilityLabel="Create a community"
        accessibilityRole="button"
      >
        <Text style={styles.cardIcon}>🏘️</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Create a Community</Text>
          <Text style={styles.cardSubtitle}>Build an ongoing group around a shared interest</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </TouchableOpacity>

      {managesBusiness ? (
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('BusinessDashboard')}
          activeOpacity={0.85}
          accessibilityLabel="Manage your business"
          accessibilityRole="button"
        >
          <Text style={styles.cardIcon}>🏪</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Manage Your Business</Text>
            <Text style={styles.cardSubtitle}>Open your business dashboard</Text>
          </View>
          <Text style={styles.cardChevron}>›</Text>
        </TouchableOpacity>
      ) : isOrganizer ? (
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('BusinessPartnerApply')}
          activeOpacity={0.85}
          accessibilityLabel="Partner with a business"
          accessibilityRole="button"
        >
          <Text style={styles.cardIcon}>🏪</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Partner With Us</Text>
            <Text style={styles.cardSubtitle}>Bring your business into the community</Text>
          </View>
          <Text style={styles.cardChevron}>›</Text>
        </TouchableOpacity>
      ) : null}

      <StartSomethingModal
        visible={startModalVisible}
        onClose={() => setStartModalVisible(false)}
        navigation={navigation}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  title: { ...typography.display, color: colors.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.xl },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.md, ...shadow.card,
  },
  cardIcon: { fontSize: 32, marginRight: spacing.md },
  cardTitle: { ...typography.headline, color: colors.textPrimary },
  cardSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  cardChevron: { color: colors.textTertiary, fontSize: 24 },
});