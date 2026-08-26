// Business Intelligence Phase 8 (see CLAUDE.md's own locked plan): the
// real dev/admin-only tier switch -- no Stripe, no real money, clearly
// marked as development tooling. Real, admin-gated (both client-side
// here and, more importantly, server-side inside every RPC this screen
// calls) -- never a surface a real business ever sees.
import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, SafeAreaView, Alert, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { adminListBusinesses, adminSetBusinessTier, tierDisplayLabel } from '../services/entitlements';

const TIERS = ['basic', 'growth', 'brand'];

export default function AdminBusinessTierScreen() {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [businesses, setBusinesses] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [changingId, setChangingId] = useState(null);

  const load = useCallback(async (term) => {
    try {
      const results = await adminListBusinesses(term || null);
      setBusinesses(results);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load(search).finally(() => setLoading(false));
      // Intentionally not re-running on every keystroke via this effect --
      // handleSearch below drives the live-typed searches; this only
      // covers the real "screen just came into focus" reload.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load(search);
    setRefreshing(false);
  }

  async function handleSearch(text) {
    setSearch(text);
    await load(text);
  }

  async function handleSetTier(business, tier) {
    if (business.tier === tier) return;
    setChangingId(business.id);
    try {
      await adminSetBusinessTier(business.id, tier);
      setBusinesses((prev) => prev.map((b) => (b.id === business.id ? { ...b, tier } : b)));
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setChangingId(null);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.devBanner}>
        <Text style={styles.devBannerText}>
          🛠 Development tooling — sets a business's real plan tier directly, with no billing
          involved. Never shown to a real business.
        </Text>
      </View>
      <TextInput
        style={styles.searchInput}
        placeholder="Search businesses by name..."
        placeholderTextColor={colors.textTertiary}
        value={search}
        onChangeText={handleSearch}
        accessibilityLabel="Search businesses"
      />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={businesses}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No businesses match.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.businessName}>{item.name}</Text>
                {!item.active && <Text style={styles.inactiveBadge}>inactive</Text>}
              </View>
              <View style={styles.chipRow}>
                {TIERS.map((tier) => (
                  <TouchableOpacity
                    key={tier}
                    style={[styles.chip, item.tier === tier && styles.chipSelected]}
                    onPress={() => handleSetTier(item, tier)}
                    disabled={changingId === item.id}
                    accessibilityLabel={`Set ${item.name} to ${tierDisplayLabel(tier)} tier`}
                    accessibilityRole="button"
                  >
                    {changingId === item.id ? (
                      <ActivityIndicator color={item.tier === tier ? '#fff' : colors.primary} size="small" />
                    ) : (
                      <Text style={[styles.chipText, item.tier === tier && styles.chipTextSelected]}>
                        {tierDisplayLabel(tier)}
                      </Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  devBanner: { backgroundColor: colors.surfaceElevated, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  devBannerText: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  searchInput: {
    margin: spacing.lg, marginBottom: 0, backgroundColor: colors.surface, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 10,
    color: colors.textPrimary, fontSize: 14,
  },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyText: { color: colors.textTertiary, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md, ...shadow.card,
  },
  businessName: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 16 },
  inactiveBadge: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  chipTextSelected: { color: '#fff' },
});
