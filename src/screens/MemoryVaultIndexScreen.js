import React, { useEffect, useState, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';
import EmptyCopy from '../components/EmptyCopy';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Image, ActivityIndicator } from 'react-native';
import { NLoader } from '../motion';
import { useFocusEffect } from '@react-navigation/native';
import { getMyMatchesWithMemoryCounts } from '../services/memoryVault';
import { getSignedPhotoUrl } from '../services/photos';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import LoadErrorState from '../components/LoadErrorState';

export default function MemoryVaultIndexScreen({ navigation }) {
  const { t } = useLanguage();
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [matches, setMatches] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getMyMatchesWithMemoryCounts();
      setMatches(data);

      const urlEntries = await Promise.all(
        data.map(async (m) => {
          if (!m.other?.photo_url) return [m.matchId, null];
          const url = await getSignedPhotoUrl(m.other.photo_url);
          return [m.matchId, url];
        })
      );
      setPhotoUrls(Object.fromEntries(urlEntries));
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <NLoader fullScreen={false} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{t('ui.matchNotes.loadingYourMemories')}</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message={t('ui.matchNotes.couldntLoadYourMemories')} onRetry={load} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={matches}
        keyExtractor={(m) => m.matchId}
        contentContainerStyle={{ padding: spacing.lg }}
        ListHeaderComponent={
          <Text style={styles.subtitle}>
            {t('ui.matchNotes.eachMatchHasItsOwn')}
          </Text>
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center' }}>
            <EmptyCopy id="memory_vault_index" />
            <TouchableOpacity onPress={() => navigation.navigate('Discover', { initialMode: 'people' })} accessibilityLabel={t('ui.matchNotes.meetPeopleA11y')} accessibilityRole="button">
              <Text style={styles.emptyActionText}>{t('ui.matchNotes.meetPeople')}</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('MemoryVault', { matchId: item.matchId, matchName: item.other?.display_name })}
            accessibilityLabel={t('ui.matchNotes.vaultRowA11y', { name: item.other?.display_name ?? t('ui.matchNotes.someone'), count: item.memoryCount })}
            accessibilityRole="button"
          >
            {photoUrls[item.matchId] ? (
              <Image source={{ uri: photoUrls[item.matchId] }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarFallbackText}>{item.other?.display_name?.[0] ?? '?'}</Text>
              </View>
            )}
            <View style={styles.rowText}>
              <Text style={styles.rowName}>{item.other?.display_name ?? t('ui.matchNotes.someone')}</Text>
              <Text style={styles.rowCount}>
                {item.memoryCount === 0 ? t('ui.matchNotes.noMemoriesYet') : t('ui.matchNotes.memoriesSaved', { count: item.memoryCount })}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  subtitle: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg, lineHeight: 18 },
  emptyText: { color: colors.textTertiary, fontSize: 14, textAlign: 'center', marginTop: spacing.xl },
  emptyActionText: { color: colors.primary, fontWeight: '700', fontSize: 14, marginTop: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: spacing.md },
  avatarFallback: { backgroundColor: colors.surfaceElevated, justifyContent: 'center', alignItems: 'center' },
  avatarFallbackText: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  rowText: { flex: 1 },
  rowName: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  rowCount: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  chevron: { color: colors.textTertiary, fontSize: 18, fontWeight: '700' },
});
