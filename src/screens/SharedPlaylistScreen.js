import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Linking } from 'react-native';
import { addPlaylistItem, getPlaylistItems } from '../services/sharedPlaylist';
import { checkTextModeration } from '../services/textModeration';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

export default function SharedPlaylistScreen({ route }) {
  const { matchId, matchName } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [items, setItems] = useState([]);
  const [songTitle, setSongTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    load();

    const channel = supabase
      .channel(`playlist:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'shared_playlist_items', filter: `match_id=eq.${matchId}` },
        () => {
          load();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const data = await getPlaylistItems(matchId);
    setItems(data);
  }

  async function handleAdd() {
    if (!songTitle.trim()) {
      return Alert.alert('Song title required', 'Enter at least a song title.');
    }

    const titleCheck = await checkTextModeration(songTitle);
    if (!titleCheck.safe) {
      return Alert.alert('Not allowed', 'Please revise the song title and try again.');
    }
    if (artist.trim()) {
      const artistCheck = await checkTextModeration(artist);
      if (!artistCheck.safe) {
        return Alert.alert('Not allowed', 'Please revise the artist name and try again.');
      }
    }

    setSubmitting(true);
    try {
      await addPlaylistItem(matchId, songTitle.trim(), artist.trim());
      setSongTitle('');
      setArtist('');
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSubmitting(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🎵 Shared Playlist</Text>
        <Text style={styles.headerSubtitle}>Build a playlist with {matchName} — add songs you think they'd like.</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🎧</Text>
            <Text style={styles.emptyText}>No songs added yet. Be the first!</Text>
          </View>
        }
        renderItem={({ item }) => {
          const query = encodeURIComponent(`${item.song_title} ${item.artist || ''}`.trim());
          return (
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.songTitle}>{item.song_title}</Text>
                {item.artist ? <Text style={styles.artist}>{item.artist}</Text> : null}
                <Text style={styles.addedBy}>Added by {item.profiles?.display_name}</Text>
              </View>
              <TouchableOpacity
                style={styles.spotifyButton}
                onPress={() => Linking.openURL(`https://open.spotify.com/search/${query}`)}
                activeOpacity={0.8}
              >
                <Text style={styles.spotifyButtonText}>🎧 Open</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />

      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Song title"
          placeholderTextColor={colors.textTertiary}
          value={songTitle}
          onChangeText={setSongTitle}
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Artist (optional)"
          placeholderTextColor={colors.textTertiary}
          value={artist}
          onChangeText={setArtist}
        />
      </View>
      <TouchableOpacity style={styles.addButton} onPress={handleAdd} disabled={submitting} activeOpacity={0.85}>
        <Text style={styles.addButtonText}>{submitting ? 'Adding...' : '+ Add Song'}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.lg, paddingBottom: spacing.sm },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  songTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  artist: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  addedBy: { color: colors.textTertiary, fontSize: 11, marginTop: spacing.xs },
  spotifyButton: { backgroundColor: '#1DB954', borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 8 },
  spotifyButtonText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  addRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  addButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginHorizontal: spacing.lg, marginBottom: spacing.lg, ...shadow.button },
  addButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});