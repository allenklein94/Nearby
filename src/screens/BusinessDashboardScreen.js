import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, FlatList, Modal } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export default function BusinessDashboardScreen() {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [partners, setPartners] = useState([]);
  const [selectedPartner, setSelectedPartner] = useState(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPartners();
  }, []);

  async function loadPartners() {
    const { data } = await supabase.from('brand_partners').select('id, name').order('name');
    setPartners(data ?? []);
    if (data?.[0]) setSelectedPartner(data[0]);
    setLoading(false);
  }

  useFocusEffect(
    useCallback(() => {
      if (selectedPartner) loadStats(selectedPartner.id);
    }, [selectedPartner])
  );

  async function loadStats(partnerId) {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_business_dashboard_stats', { partner_id_param: partnerId });
    if (!error) setStats(data?.[0] ?? null);
    setLoading(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.title}>Business Dashboard</Text>

        <TouchableOpacity
          style={styles.partnerSelector}
          onPress={() => setPickerVisible(true)}
          accessibilityLabel={`Viewing ${selectedPartner?.name ?? 'no business selected'}, tap to change`}
          accessibilityRole="button"
        >
          <Text style={styles.partnerSelectorText}>{selectedPartner?.name ?? 'Select a business'}</Text>
          <Text style={styles.partnerSelectorChevron}>▾</Text>
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : stats ? (
          <>
            <Text style={styles.sectionHeader}>Community Health</Text>
            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{stats.total_followers}</Text>
                <Text style={styles.statLabel}>Followers</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{stats.followers_this_month}</Text>
                <Text style={styles.statLabel}>New This Month</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{stats.total_redemptions}</Text>
                <Text style={styles.statLabel}>Total Redemptions</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{stats.redemptions_this_month}</Text>
                <Text style={styles.statLabel}>This Month</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{stats.repeat_redeemers}</Text>
                <Text style={styles.statLabel}>Repeat Customers</Text>
              </View>
            </View>
            <Text style={styles.helperText}>
              These reflect people who opted in and genuinely engaged with your offers — not raw traffic or impressions.
            </Text>
          </>
        ) : (
          <Text style={styles.emptyText}>No data yet for this business.</Text>
        )}
      </ScrollView>

      <Modal visible={pickerVisible} animationType="slide" onRequestClose={() => setPickerVisible(false)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select a Business</Text>
            <TouchableOpacity onPress={() => setPickerVisible(false)} accessibilityLabel="Close" accessibilityRole="button">
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={partners}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: spacing.lg }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.partnerRow}
                onPress={() => {
                  setSelectedPartner(item);
                  setPickerVisible(false);
                }}
                accessibilityLabel={item.name}
                accessibilityRole="button"
              >
                <Text style={styles.partnerRowText}>{item.name}</Text>
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.md },
  partnerSelector: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  partnerSelectorText: { ...typography.bodyBold, color: colors.textPrimary },
  partnerSelectorChevron: { color: colors.textTertiary, fontSize: 16 },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statCard: {
    width: '31%', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, alignItems: 'center', ...shadow.card,
  },
  statNumber: { ...typography.title, color: colors.primary },
  statLabel: { color: colors.textTertiary, fontSize: 11, textAlign: 'center', marginTop: 2 },
  helperText: { color: colors.textTertiary, fontSize: 12, lineHeight: 18, marginTop: spacing.lg, fontStyle: 'italic' },
  emptyText: { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xl },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg },
  modalTitle: { ...typography.title, color: colors.textPrimary },
  modalCloseText: { color: colors.primary, fontWeight: '600' },
  partnerRow: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  partnerRowText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
});