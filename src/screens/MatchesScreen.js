import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { supabase } from '../services/supabase';
import { colors, typography, spacing, radius } from '../theme';

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
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Matches</Text>
      </View>
      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>✨</Text>
            <Text style={styles.emptyText}>
              No matches yet. Matches happen when you both notice each other.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('Chat', { matchId: item.id })}
            activeOpacity={0.85}
          >
            <View style={styles.cardInfo}>
              <Text style={styles.name}>{item.a?.display_name} & {item.b?.display_name}</Text>
              <Text style={styles.sub}>Tap to start chatting</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardInfo: { flex: 1 },
  name: { ...typography.bodyBold, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  chevron: { color: colors.textTertiary, fontSize: 22, fontWeight: '700' },
});