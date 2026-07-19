import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { supabase } from '../services/supabase';

export default function MatchesScreen({ navigation }) {
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data, error } = await supabase
      .from('matches')
      .select('id, user_a, user_b, matched_at, a:profiles!matches_user_a_fkey(display_name, photo_url), b:profiles!matches_user_b_fkey(display_name, photo_url)')
      .order('matched_at', { ascending: false });

    if (!error) setMatches(data);
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Matches</Text>
      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No matches yet. Matches happen when you both notice each other.
          </Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('Chat', { matchId: item.id })}
          >
            <Text style={styles.name}>{item.a?.display_name} & {item.b?.display_name}</Text>
            <Text style={styles.sub}>Tap to start chatting</Text>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', paddingHorizontal: 20, paddingTop: 10 },
  header: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 16 },
  empty: { color: '#8888a8', textAlign: 'center', marginTop: 60, lineHeight: 20 },
  card: { backgroundColor: '#2a2a4a', borderRadius: 12, padding: 14, marginBottom: 10 },
  name: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sub: { color: '#8888a8', fontSize: 13, marginTop: 4 },
});