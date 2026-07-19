import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { supabase } from '../services/supabase';

// Reachable only for accounts with profiles.is_admin = true — see
// ProfileScreen for the entry point, and schema.sql for how that flag
// gets set (manually, in the SQL editor, per trusted admin).
// RLS policies on `reports` and `profiles` enforce the actual access
// control here — this screen simply won't return data for non-admins
// even if someone found their way to it.
export default function AdminReportsScreen() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('reports')
      .select('id, reason, details, created_at, resolved, reporter_id, reported_id, reported:profiles!reports_reported_id_fkey(display_name)')
      .order('resolved', { ascending: true })
      .order('created_at', { ascending: false });

    if (!error) setReports(data);
    setLoading(false);
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
      <Text style={styles.header}>Reports</Text>
      <FlatList
        data={reports}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={<Text style={styles.empty}>No reports.</Text>}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', paddingHorizontal: 20, paddingTop: 10 },
  header: { fontSize: 26, fontWeight: '700', color: '#fff', marginBottom: 16 },
  empty: { color: '#8888a8', textAlign: 'center', marginTop: 60 },
  card: { backgroundColor: '#2a2a4a', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardResolved: { opacity: 0.5 },
  reason: { color: '#fff', fontSize: 15, fontWeight: '600' },
  meta: { color: '#c9c9e0', fontSize: 13, marginTop: 4 },
  details: { color: '#8888a8', fontSize: 13, marginTop: 6, fontStyle: 'italic' },
  date: { color: '#666688', fontSize: 11, marginTop: 8 },
  actions: { flexDirection: 'row', marginTop: 12, gap: 8 },
  actionButton: { backgroundColor: '#1a1a2e', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  resolveButton: { backgroundColor: '#e94560' },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});