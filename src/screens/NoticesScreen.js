import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, TouchableOpacity } from 'react-native';
import { supabase } from '../services/supabase';
import { isPremium } from '../services/purchases';
import { colors, typography, spacing, radius, shadow } from '../theme';

export default function NoticesScreen({ navigation }) {
  const [notices, setNotices] = useState([]);
  const [premium, setPremium] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const premiumStatus = await isPremium().catch(() => false);
    setPremium(premiumStatus);

    const { data, error } = await supabase
      .from('notices')
      .select('id, from_user, created_at, profiles!notices_from_user_fkey(display_name, photo_url)')
      .order('created_at', { ascending: false });

    if (!error) setNotices(data);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Notices</Text>
      </View>

      {!premium && (
        <TouchableOpacity style={styles.upsell} onPress={() => navigation.navigate('Paywall')} activeOpacity={0.85}>
          <Text style={styles.upsellIcon}>✨</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.upsellTitle}>Unlock Premium</Text>
            <Text style={styles.upsellText}>See everyone who's noticed you</Text>
          </View>
          <Text style={styles.upsellArrow}>›</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={notices}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>👋</Text>
            <Text style={styles.emptyText}>No notices yet. Check back after you've been out.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>{item.profiles?.display_name} noticed you</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  upsell: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    ...shadow.button,
  },
  upsellIcon: { fontSize: 24, marginRight: spacing.md },
  upsellTitle: { color: '#fff', fontWeight: '700', fontSize: 15 },
  upsellText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 1 },
  upsellArrow: { color: '#fff', fontSize: 22, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  name: { ...typography.body, color: colors.textPrimary },
});