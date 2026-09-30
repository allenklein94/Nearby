import React, { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TouchableOpacity, Image, FlatList, StyleSheet, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../services/supabase';
import { useSpotifyAuthRequest, exchangeCodeForToken, saveSpotifyTokens, fetchTopTracks } from '../services/spotifyAuth';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

import { showSuccessToast } from '../motion';
WebBrowser.maybeCompleteAuthSession();

const MAX_FAVORITE_TRACKS = 5;

export default function MusicModeScreen({ navigation }) {
  const { t } = useLanguage();
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
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleAuthSuccess(code) });
    }
    setConnecting(false);
  }

  function toggleTrack(trackId) {
    setSelectedIds((prev) => {
      if (prev.includes(trackId)) return prev.filter((id) => id !== trackId);
      if (prev.length >= MAX_FAVORITE_TRACKS) {
        Alert.alert(t('ui.musicMode.limitReached'), t('ui.musicMode.youCanPickUpTo', { max: MAX_FAVORITE_TRACKS }));
        return prev;
      }
      return [...prev, trackId];
    });
  }

  async function handleSave() {
    if (selectedIds.length === 0) {
      Alert.alert(t('ui.musicMode.pickAtLeastOne'), t('ui.musicMode.chooseAtLeastOneFavorite'));
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

      showSuccessToast(t('ui.musicMode.saved'), t('ui.musicMode.yourFavoriteTracksNowShow'));
      navigation.goBack();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSave() });
    }
    setSaving(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">{t('ui.musicMode.musicMode')}</Text>
        <Text style={styles.subtitle}>{t('ui.musicMode.showOffYourVibePick')}</Text>
      </View>

      {!topTracks ? (
        <View style={styles.connectSection}>
          <TouchableOpacity
            style={styles.connectButton}
            onPress={() => promptAsync()}
            disabled={!request || connecting}
            activeOpacity={0.85}
            accessibilityLabel={t('ui.musicMode.connectYourSpotifyAccountA11y')}
            accessibilityRole="button"
          >
            {connecting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.connectButtonText}>{t('ui.musicMode.connectSpotify')}</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.connectHint}>{t('ui.musicMode.wellPullYourTopTracks')}</Text>
        </View>
      ) : (
        <>
          <Text style={styles.pickHint}>{t('ui.musicMode.selectUpTo', { max: MAX_FAVORITE_TRACKS, count: selectedIds.length })}</Text>
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
                  accessibilityLabel={t(selected ? 'ui.musicMode.trackSelectedA11y' : 'ui.musicMode.trackA11y', { name: item.name, artist: item.artist })}
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
            accessibilityLabel={t('ui.musicMode.saveSelectedTracksToYourA11y')}
            accessibilityRole="button"
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>{t('ui.musicMode.saveToProfile')}</Text>}
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