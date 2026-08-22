import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import LoadErrorState from '../components/LoadErrorState';

// This screen is reached as a top-level stack push (not a bottom tab),
// headerShown: false in RootNavigator, and previously took no navigation
// prop at all -- the same "reachable, but no visible way back" shape
// found and fixed on FriendDiscoveryScreen/PlacesScreen/TimelineScreen.
export default function AdminReportsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('reports')
        .select('id, reason, details, created_at, resolved, reporter_id, reported_id, reported:profiles!reports_reported_id_fkey(display_name)')
        .order('resolved', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setReports(data);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  async function markResolved(id) {
    const { error } = await supabase.from('reports').update({ resolved: true }).eq('id', id);
    if (error) return Alert.alert('Error', error.message);
    load();
  }

  async function suspendReportedUser(reportedId) {
    Alert.alert(
      'Suspend this user?',
      'This hides their profile from everyone (sets photo_verified to false). You can restore it manually later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Suspend',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('profiles').update({ photo_verified: false }).eq('id', reportedId);
            Alert.alert('Suspended', 'Profile hidden from discovery.');
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Reports</Text>
      </View>
      <FlatList
        data={reports}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={
          loadError ? (
            <LoadErrorState message="Couldn't load reports." onRetry={load} />
          ) : (
            <Text style={styles.empty}>No reports.</Text>
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.card, item.resolved && styles.cardResolved]}>
            <Text style={styles.reason}>{item.reason}</Text>
            <Text style={styles.meta}>Against: {item.reported?.display_name || item.reported_id}</Text>
            {item.details ? <Text style={styles.details}>{item.details}</Text> : null}
            <Text style={styles.date}>{new Date(item.created_at).toLocaleString()}</Text>

            {!item.resolved && (
              <View style={styles.actions}>
                <TouchableOpacity style={styles.actionButton} onPress={() => suspendReportedUser(item.reported_id)}>
                  <Text style={styles.actionText}>Suspend User</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionButton, styles.resolveButton]} onPress={() => markResolved(item.id)}>
                  <Text style={styles.actionText}>Mark Resolved</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.md },
  backButton: { padding: spacing.xs },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  empty: { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardResolved: { opacity: 0.5 },
  reason: { ...typography.bodyBold, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  details: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, fontStyle: 'italic' },
  date: { ...typography.small, color: colors.textTertiary, marginTop: spacing.sm },
  actions: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.sm },
  actionButton: { backgroundColor: colors.surfaceElevated, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  resolveButton: { backgroundColor: colors.primary },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});