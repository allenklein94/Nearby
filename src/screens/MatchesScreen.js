import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Image } from 'react-native';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

export default function MatchesScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [matches, setMatches] = useState([]);
  const [myUserId, setMyUserId] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    setMyUserId(myId);

    const { data, error } = await supabase
      .from('matches')
      .select('id, user_a, user_b, matched_at, a:profiles!matches_user_a_fkey(id, display_name, photo_url), b:profiles!matches_user_b_fkey(id, display_name, photo_url)')
      .order('matched_at', { ascending: false });

    if (!error) {
      setMatches(data);

      const urlEntries = await Promise.all(
        data.map(async (m) => {
          const other = m.user_a === myId ? m.b : m.a;
          if (!other?.photo_url) return [m.id, null];
          const url = await getSignedPhotoUrl(other.photo_url);
          return [m.id, url];
        })
      );
      setPhotoUrls(Object.fromEntries(urlEntries));
    }
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
        renderItem={({ item }) => {
          const other = item.user_a === myUserId ? item.b : item.a;
          return (
            <View style={styles.card}>
              <TouchableOpacity
                onPress={() => navigation.navigate('ViewProfile', { userId: other?.id })}
                activeOpacity={0.85}
              >
                {photoUrls[item.id] ? (
                  <Image source={{ uri: photoUrls[item.id] }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cardInfo}
                onPress={() => navigation.navigate('Chat', { matchId: item.id })}
                activeOpacity={0.85}
              >
                <Text style={styles.name}>{other?.display_name}</Text>
                <Text style={styles.sub}>Tap to start chatting</Text>
              </TouchableOpacity>
              <Text style={styles.chevron}>›</Text>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
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
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: { width: 52, height: 52, borderRadius: radius.md, marginRight: spacing.md },
  avatarPlaceholder: { backgroundColor: colors.surfaceElevated },
  cardInfo: { flex: 1 },
  name: { ...typography.bodyBold, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  chevron: { color: colors.textTertiary, fontSize: 22, fontWeight: '700' },
});