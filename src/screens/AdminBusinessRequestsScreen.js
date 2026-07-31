import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export default function AdminBusinessRequestsScreen() {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [requests, setRequests] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [processingIds, setProcessingIds] = useState({});

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('business_partner_requests')
      .select('*, profiles!business_partner_requests_requester_id_fkey(display_name)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    setRequests(data ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleApprove(request) {
    setProcessingIds((prev) => ({ ...prev, [request.id]: true }));
    try {
      await supabase.rpc('approve_business_partner_request', { request_id_param: request.id });
      Alert.alert('Approved', `${request.business_name} is now a business partner.`);
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setProcessingIds((prev) => ({ ...prev, [request.id]: false }));
  }

  async function handleDeny(request) {
    setProcessingIds((prev) => ({ ...prev, [request.id]: true }));
    try {
      await supabase.from('business_partner_requests').update({ status: 'denied', reviewed_at: new Date().toISOString() }).eq('id', request.id);
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setProcessingIds((prev) => ({ ...prev, [request.id]: false }));
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No pending business partner requests.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.businessName}>{item.business_name}</Text>
            <Text style={styles.requester}>Requested by {item.profiles?.display_name}</Text>
            {item.business_description ? <Text style={styles.description}>{item.business_description}</Text> : null}
            {item.contact_info ? <Text style={styles.contact}>📞 {item.contact_info}</Text> : null}
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.approveButton}
                onPress={() => handleApprove(item)}
                disabled={processingIds[item.id]}
                accessibilityLabel={`Approve ${item.business_name}`}
                accessibilityRole="button"
              >
                <Text style={styles.approveButtonText}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.denyButton}
                onPress={() => handleDeny(item)}
                disabled={processingIds[item.id]}
                accessibilityLabel={`Deny ${item.business_name}`}
                accessibilityRole="button"
              >
                <Text style={styles.denyButtonText}>Deny</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyText: { color: colors.textTertiary, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md, ...shadow.card,
  },
  businessName: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 16 },
  requester: { color: colors.textTertiary, fontSize: 12, marginTop: 2, marginBottom: spacing.sm },
  description: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.xs, lineHeight: 18 },
  contact: { color: colors.textTertiary, fontSize: 12, marginBottom: spacing.sm },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  approveButton: { flex: 1, backgroundColor: colors.success, borderRadius: radius.full, paddingVertical: 10, alignItems: 'center' },
  approveButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  denyButton: { flex: 1, backgroundColor: colors.surfaceElevated, borderRadius: radius.full, paddingVertical: 10, alignItems: 'center' },
  denyButtonText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
});