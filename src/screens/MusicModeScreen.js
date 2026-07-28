import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Image, FlatList, StyleSheet, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../services/supabase';
import { useSpotifyAuthRequest, exchangeCodeForToken, saveSpotifyTokens, fetchTopTracks } from '../services/spotifyAuth';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

WebBrowser.maybeCompleteAuthSession();

const MAX_FAVORITE_TRACKS = 5;

export default function MusicModeScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [request, response, promptAsync] = useSpotifyAuthRequest();
  const [connecting, setConnecting] = useState(false);
  const [topTracks, setTopTracks] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [myUserId, setMyUserId] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMyUserId(data?.session?.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (response?.type === 'success' && response.params?.code) {
      handleAuthSuccess(response.params.code);
    }
  }, [response]);

  async function handleAuthSuccess(code) {
    setConnecting(true);
    try {
      const tokenResult = await exchangeCodeForToken(code, request.codeVerifier);
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;

      await saveSpotifyTokens(userId, tokenResult.accessToken, tokenResult.refreshToken, tokenResult.expiresIn);

      const tracks = await fetchTopTracks(tokenResult.accessToken);
      setTopTracks(tracks);
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not connect to Spotify.');
    }
    setConnecting(false);
  }

  function toggleTrack(trackId) {
    setSelectedIds((prev) => {
      if (prev.includes(trackId)) return prev.filter((id) => id !== trackId);
      if (prev.length >= MAX_FAVORITE_TRACKS) {
        Alert.alert('Limit reached', `You can pick up to ${MAX_FAVORITE_TRACKS} favorite tracks.`);
        return prev;
      }
      return [...prev, trackId];
    });
  }

  async function handleSave() {
    if (selectedIds.length === 0) {
      Alert.alert('Pick at least one', 'Choose at least one favorite track to show on your profile.');
      return;
    }

    setSaving(true);
    try {
      const selectedTracks = topTracks.filter((t) => selectedIds.includes(t.id));
      const { error } = await supabase
        .from('profiles')
        .update({ favorite_tracks: selectedTracks })
        .eq('id', myUserId);

      if (error) throw error;

      Alert.alert('Saved', 'Your favorite tracks now show on your profile.');
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSaving(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">🎵 Music Mode</Text>
        <Text style={styles.subtitle}>Show off your vibe — pick a few favorite songs to display on your profile.</Text>
      </View>

      {!topTracks ? (
        <View style={styles.connectSection}>
          <TouchableOpacity
            style={styles.connectButton}
            onPress={() => promptAsync()}
            disabled={!request || connecting}
            activeOpacity={0.85}
            accessibilityLabel="Connect your Spotify account"
            accessibilityRole="button"
          >
            {connecting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.connectButtonText}>Connect Spotify</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.connectHint}>We'll pull your top tracks so you can pick your favorites.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.pickHint}>Select up to {MAX_FAVORITE_TRACKS} ({selectedIds.length}/{MAX_FAVORITE_TRACKS})</Text>
          <FlatList
            data={topTracks}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: spacing.lg }}
            renderItem={({ item }) => {
              const selected = selectedIds.includes(item.id);
              return (
                <TouchableOpacity
                  style={[styles.trackRow, selected && styles.trackRowSelected]}
                  onPress={() => toggleTrack(item.id)}
                  activeOpacity={0.85}
                  accessibilityLabel={`${item.name} by ${item.artist}${selected ? ', selected' : ''}`}
                  accessibilityRole="button"
                >
                  {item.albumArt ? (
                    <Image source={{ uri: item.albumArt }} style={styles.albumArt} />
                  ) : (
                    <View style={[styles.albumArt, styles.albumArtPlaceholder]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.trackName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.trackArtist} numberOfLines={1}>{item.artist}</Text>
                  </View>
                  <Text style={styles.checkmark}>{selected ? '✓' : ''}</Text>
                </TouchableOpacity>
              );
            }}
          />
          <TouchableOpacity
            style={styles.saveButton}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
            accessibilityLabel="Save selected tracks to your profile"
            accessibilityRole="button"
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Save to Profile</Text>}
          </TouchableOpacity>
        </>
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.lg },
  title: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary },
  connectSection: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  connectButton: { backgroundColor: '#1DB954', borderRadius: radius.full, paddingVertical: 16, paddingHorizontal: spacing.xl, minWidth: 220, alignItems: 'center' },
  connectButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  connectHint: { color: colors.textTertiary, fontSize: 13, textAlign: 'center', marginTop: spacing.md },
  pickHint: { ...typography.caption, color: colors.textTertiary, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  trackRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  trackRowSelected: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  albumArt: { width: 48, height: 48, borderRadius: radius.sm, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  albumArtPlaceholder: {},
  trackName: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  trackArtist: { color: colors.textTertiary, fontSize: 12 },
  checkmark: { color: colors.primary, fontSize: 18, fontWeight: '700', width: 24, textAlign: 'center' },
  saveButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', margin: spacing.lg },
  saveButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});