import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, SafeAreaView, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { BUSINESS_CATEGORIES } from './BusinessPartnerApplyScreen';

export default function AdminBusinessRequestsScreen() {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [requests, setRequests] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [processingIds, setProcessingIds] = useState({});
  // "Request More Information" reviewer state -- deliberately deferred
  // when this screen first shipped, closed later. expandedNotesId tracks
  // which single card currently has its notes field open.
  const [expandedNotesId, setExpandedNotesId] = useState(null);
  const [notesDrafts, setNotesDrafts] = useState({});

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('business_partner_requests')
      .select('*, profiles!business_partner_requests_requester_id_fkey(display_name)')
      // Fetch everything, not just pending — approved/denied
      // requests were vanishing with no history visible at all,
      // even though the data itself was preserved.
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
      await supabase.rpc('deny_business_partner_request', { request_id_param: request.id });
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setProcessingIds((prev) => ({ ...prev, [request.id]: false }));
  }

  async function handleRequestMoreInfo(request) {
    const notes = (notesDrafts[request.id] || '').trim();
    if (!notes) {
      Alert.alert('A note is required', 'Let the applicant know what to add before sending.');
      return;
    }
    setProcessingIds((prev) => ({ ...prev, [request.id]: true }));
    try {
      await supabase.rpc('request_more_business_partner_info', { request_id_param: request.id, notes_param: notes });
      setExpandedNotesId(null);
      setNotesDrafts((prev) => ({ ...prev, [request.id]: '' }));
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
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.businessName}>{item.business_name}</Text>
              <Text style={[styles.statusBadge, item.status === 'approved' && styles.statusApproved, item.status === 'denied' && styles.statusDenied, item.status === 'needs_info' && styles.statusNeedsInfo]}>
                {item.status === 'needs_info' ? 'needs info' : item.status}
              </Text>
            </View>
            {item.source === 'web' ? (
              <Text style={styles.requester}>
                🌐 Web application — {item.applicant_name} ({item.applicant_email}
                {item.applicant_phone ? `, ${item.applicant_phone}` : ''})
              </Text>
            ) : (
              <Text style={styles.requester}>Requested by {item.profiles?.display_name}</Text>
            )}
            {item.category ? (
              <Text style={styles.category}>
                {BUSINESS_CATEGORIES.find((c) => c.key === item.category)?.label ?? item.category}
              </Text>
            ) : null}
            {item.business_description ? <Text style={styles.description}>{item.business_description}</Text> : null}
            {item.contact_info ? <Text style={styles.contact}>📞 {item.contact_info}</Text> : null}
            {item.website ? <Text style={styles.contact}>🔗 {item.website}</Text> : null}
            {item.phone ? <Text style={styles.contact}>📱 {item.phone}</Text> : null}
            {item.address ? <Text style={styles.contact}>📍 {item.address}</Text> : null}
            {item.reviewed_by ? (
              <Text style={styles.contact}>Reviewed {item.reviewed_at ? new Date(item.reviewed_at).toLocaleDateString() : ''}</Text>
            ) : null}
            {item.status === 'needs_info' && item.admin_notes ? (
              <Text style={styles.needsInfoNote}>Waiting on: {item.admin_notes}</Text>
            ) : null}
            {item.status === 'pending' && (
              <>
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
                    style={styles.requestInfoButton}
                    onPress={() => setExpandedNotesId(expandedNotesId === item.id ? null : item.id)}
                    disabled={processingIds[item.id]}
                    accessibilityLabel={`Request more information for ${item.business_name}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.requestInfoButtonText}>Request Info</Text>
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
                {expandedNotesId === item.id && (
                  <View style={styles.notesInputRow}>
                    <TextInput
                      style={styles.notesInput}
                      placeholder="What does the applicant still need to add?"
                      placeholderTextColor={colors.textTertiary}
                      value={notesDrafts[item.id] || ''}
                      onChangeText={(text) => setNotesDrafts((prev) => ({ ...prev, [item.id]: text }))}
                      multiline
                    />
                    <TouchableOpacity
                      style={styles.sendNotesButton}
                      onPress={() => handleRequestMoreInfo(item)}
                      disabled={processingIds[item.id]}
                      accessibilityLabel={`Send info request for ${item.business_name}`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.sendNotesButtonText}>Send</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
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
  requester: { color: colors.textTertiary, fontSize: 12, marginTop: 2, marginBottom: spacing.xs },
  category: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: spacing.sm },
  statusBadge: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  statusApproved: { color: colors.success },
  statusDenied: { color: colors.textTertiary },
  statusNeedsInfo: { color: colors.primary },
  description: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.xs, lineHeight: 18 },
  contact: { color: colors.textTertiary, fontSize: 12, marginBottom: spacing.sm },
  needsInfoNote: { color: colors.primary, fontSize: 12, fontWeight: '600', marginBottom: spacing.sm },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  approveButton: { flex: 1, backgroundColor: colors.success, borderRadius: radius.full, paddingVertical: 10, alignItems: 'center' },
  approveButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  requestInfoButton: { flex: 1, backgroundColor: colors.surfaceElevated, borderRadius: radius.full, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.primary },
  requestInfoButtonText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  denyButton: { flex: 1, backgroundColor: colors.surfaceElevated, borderRadius: radius.full, paddingVertical: 10, alignItems: 'center' },
  denyButtonText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  notesInputRow: { marginTop: spacing.sm },
  notesInput: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm, color: colors.textPrimary, fontSize: 13, minHeight: 60, textAlignVertical: 'top',
  },
  sendNotesButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 10, alignItems: 'center', marginTop: spacing.sm },
  sendNotesButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});