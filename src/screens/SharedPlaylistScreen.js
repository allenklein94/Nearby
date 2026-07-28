import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, Image, StyleSheet, SafeAreaView, Alert, Linking, ActivityIndicator } from 'react-native';
import { addPlaylistItem, getPlaylistItems } from '../services/sharedPlaylist';
import { searchSpotifyTracks } from '../services/spotifyAuth';
import { supabase } from '../services/supabase';
import * as Haptics from 'expo-haptics';
import { usePostHog } from 'posthog-react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

export default function SharedPlaylistScreen({ route }) {
  const { matchId, matchName } = route.params;
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(null);
  const [myUserId, setMyUserId] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMyUserId(data?.session?.user?.id ?? null));
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

  async function handleSearch(text) {
    setQuery(text);
    if (text.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await searchSpotifyTracks(myUserId, text.trim());
      setSearchResults(results);
    } catch (e) {
      // Most likely means Spotify isn't connected yet — fail quietly
      // in the search box itself rather than an intrusive alert on
      // every keystroke.
      setSearchResults([]);
    }
    setSearching(false);
  }

  async function handleAddTrack(track) {
    setAdding(track.id);
    try {
      await addPlaylistItem(matchId, track);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      posthog.capture('shared_playlist_song_added');
      setQuery('');
      setSearchResults([]);
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setAdding(null);
  }

  function handleOpenPress(item) {
    if (item.spotify_track_id) {
      posthog.capture('shared_playlist_opened', { service: 'spotify' });
      Linking.openURL(`https://open.spotify.com/track/${item.spotify_track_id}`);
      return;
    }
    // Legacy items added before Spotify search existed — fall back
    // to a generic search link since there's no specific track ID.
    const query = encodeURIComponent(`${item.song_title} ${item.artist || ''}`.trim());
    Alert.alert(
      'Open where?',
      '',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: '🎧 Spotify', onPress: () => { posthog.capture('shared_playlist_opened', { service: 'spotify' }); Linking.openURL(`https://open.spotify.com/search/${query}`); } },
        { text: '▶️ YouTube', onPress: () => { posthog.capture('shared_playlist_opened', { service: 'youtube' }); Linking.openURL(`https://www.youtube.com/results?search_query=${query}`); } },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">{t('together.sharedPlaylist')}</Text>
        <Text style={styles.headerSubtitle}>Build a playlist with {matchName} — add songs you think they'd like.</Text>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search Spotify for a song..."
          placeholderTextColor={colors.textTertiary}
          value={query}
          onChangeText={handleSearch}
          accessibilityLabel="Search Spotify for a song to add"
        />
        {searching && <ActivityIndicator color={colors.primary} style={{ marginRight: spacing.sm }} />}
      </View>

      {searchResults.length > 0 ? (
        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.resultRow}
              onPress={() => handleAddTrack(item)}
              disabled={adding === item.id}
              activeOpacity={0.85}
              accessibilityLabel={`Add ${item.name} by ${item.artist} to the shared playlist`}
              accessibilityRole="button"
            >
              {item.albumArt ? (
                <Image source={{ uri: item.albumArt }} style={styles.resultArt} />
              ) : (
                <View style={[styles.resultArt, styles.resultArtPlaceholder]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.resultArtist} numberOfLines={1}>{item.artist}</Text>
              </View>
              {adding === item.id ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.addIcon}>+</Text>}
            </TouchableOpacity>
          )}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🎧</Text>
              <Text style={styles.emptyText}>No songs added yet. Search above to add the first one!</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              {item.album_art ? (
                <Image source={{ uri: item.album_art }} style={styles.cardArt} />
              ) : (
                <View style={[styles.cardArt, styles.resultArtPlaceholder]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.songTitle}>{item.song_title}</Text>
                {item.artist ? <Text style={styles.artist}>{item.artist}</Text> : null}
                <Text style={styles.addedBy}>Added by {item.profiles?.display_name}</Text>
              </View>
              <TouchableOpacity
                style={styles.openButton}
                onPress={() => handleOpenPress(item)}
                activeOpacity={0.8}
                accessibilityLabel={`Open ${item.song_title}`}
                accessibilityRole="button"
              >
                <Text style={styles.openButtonText}>🎧 Open</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.lg, paddingBottom: spacing.sm },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs },
  searchWrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  searchInput: {
    flex: 1, backgroundColor: colors.surface, color: colors.textPrimary,
    borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  resultArt: { width: 44, height: 44, borderRadius: radius.sm, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  resultArtPlaceholder: {},
  resultName: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  resultArtist: { color: colors.textTertiary, fontSize: 12 },
  addIcon: { color: colors.primary, fontSize: 22, fontWeight: '300', width: 28, textAlign: 'center' },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  cardArt: { width: 44, height: 44, borderRadius: radius.sm, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  songTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  artist: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  addedBy: { color: colors.textTertiary, fontSize: 11, marginTop: spacing.xs },
  openButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 8 },
  openButtonText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});