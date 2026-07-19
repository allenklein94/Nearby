import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, TouchableOpacity } from 'react-native';
import { supabase } from '../services/supabase';
import { isPremium } from '../services/purchases';

// Note: the RLS policy on `notices` already enforces that a user only
// gets rows back here if the notice is mutual, or if they're premium.
// This screen doesn't need extra client-side filtering for that reason —
// the database is the source of truth for the privacy rule.
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
      <Text style={styles.header}>Notices</Text>

      {!premium && (
        <TouchableOpacity style={styles.upsell} onPress={() => navigation.navigate('Paywall')}>
          <Text style={styles.upsellText}>
            Unlock Premium to see everyone who's noticed you →
          </Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={notices}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <Text style={styles.empty}>No notices yet. Check back after you've been out.</Text>
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
  container: { flex: 1, backgroundColor: '#1a1a2e', paddingHorizontal: 20, paddingTop: 10 },
  header: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 16 },
  upsell: { backgroundColor: '#e94560', borderRadius: 12, padding: 14, marginBottom: 16 },
  upsellText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  empty: { color: '#8888a8', textAlign: 'center', marginTop: 60 },
  card: { backgroundColor: '#2a2a4a', borderRadius: 12, padding: 14, marginBottom: 10 },
  name: { color: '#fff', fontSize: 15 },
});