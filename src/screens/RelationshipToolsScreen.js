import React, { useState, useCallback } from 'react';
import EmptyCopy from '../components/EmptyCopy';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Image, ActivityIndicator } from 'react-native';
import { NLoader } from '../motion';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import ActionSheetModal from '../components/ActionSheetModal';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';
import LoadErrorState from '../components/LoadErrorState';

// The 8 relationship-longevity tools that only make sense in the context
// of a specific match (unlike Rehearsal Room / Chemistry Diary / Goodbye
// Archive / Legacy Library / Emergency Kit, which are personal and already
// have their own SettingsScreen row) — matches every entry in ChatScreen's
// "Do Something Together" menu exactly, so this screen is a real second
// entry point, not a partial one. Pick a match, then pick a tool for that
// match.
// Names are the chat "Do Something Together" menu's own (ui.chat.together.*), so the two entry points read the same.
const MATCH_TOOLS = [
  { key: 'constitution', textKey: 'ui.chat.together.constitution', route: 'RelationshipConstitution' },
  { key: 'stresstest', textKey: 'ui.chat.together.stresstest', route: 'StressTest' },
  { key: 'bigpicture', textKey: 'ui.chat.together.bigpicture', route: 'SharedDecisions' },
  { key: 'playlist', textKey: 'ui.chat.together.playlist', route: 'SharedPlaylist' },
  { key: 'trip', textKey: 'ui.chat.together.trip', route: 'TripPlanning' },
  { key: 'timeline', textKey: 'ui.chat.together.timeline', route: 'TimelinePlanner' },
  { key: 'legacy', textKey: 'ui.chat.together.legacy', route: 'RelationshipLegacy' },
  { key: 'memoryvault', textKey: 'ui.chat.together.memoryvault', route: 'MemoryVault' },
];

export default function RelationshipToolsScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors, shadow);
  const [matches, setMatches] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [activeMatch, setActiveMatch] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoadError(false);
      const { data: sessionData } = await supabase.auth.getSession();
      const myId = sessionData?.session?.user?.id;
      if (!myId) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('matches')
        .select('id, user_a, user_b, matched_at, a:profiles!matches_user_a_fkey(display_name, photo_url), b:profiles!matches_user_b_fkey(display_name, photo_url)')
        .order('matched_at', { ascending: false });

      if (error) {
        console.error('RelationshipToolsScreen load error', error);
        setLoadError(true);
        setLoading(false);
        return;
      }

      const withOther = (data ?? []).map((m) => ({
        matchId: m.id,
        other: m.user_a === myId ? m.b : m.a,
      }));
      setMatches(withOther);

      const urlEntries = await Promise.all(
        withOther.map(async (m) => {
          if (!m.other?.photo_url) return [m.matchId, null];
          const url = await getSignedPhotoUrl(m.other.photo_url);
          return [m.matchId, url];
        })
      );
      setPhotoUrls(Object.fromEntries(urlEntries));
      setLoading(false);
    } catch (e) {
      setLoadError(true);
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function handlePickTool(tool) {
    if (!activeMatch) return;
    navigation.navigate(tool.route, { matchId: activeMatch.matchId, matchName: activeMatch.other?.display_name });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <NLoader fullScreen={false} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{t('ui.relationship.tools.loading')}</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message={t('ui.relationship.tools.loadError')} onRetry={load} />
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
            {t('ui.relationship.tools.intro')}
          </Text>
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center' }}>
            <EmptyCopy id="relationship_tools" />
            <TouchableOpacity onPress={() => navigation.navigate('Discover', { initialMode: 'people' })} accessibilityLabel={t('ui.relationship.tools.meetPeopleA11y')} accessibilityRole="button">
              <Text style={styles.emptyActionText}>{t('ui.relationship.tools.meetPeople')}</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.85}
            onPress={() => setActiveMatch(item)}
            accessibilityLabel={t('ui.relationship.tools.withA11y', { name: item.other?.display_name ?? t('ui.relationship.tools.someone') })}
            accessibilityRole="button"
          >
            {photoUrls[item.matchId] ? (
              <Image source={{ uri: photoUrls[item.matchId] }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarFallbackText}>{item.other?.display_name?.[0] ?? '?'}</Text>
              </View>
            )}
            <Text style={styles.rowName}>{item.other?.display_name ?? t('ui.relationship.tools.someone')}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}
      />

      <ActionSheetModal
        visible={!!activeMatch}
        onClose={() => setActiveMatch(null)}
        title={activeMatch ? t('ui.relationship.tools.toolsWith', { name: activeMatch.other?.display_name ?? t('ui.relationship.tools.someone') }) : ''}
        options={MATCH_TOOLS.map((tool) => ({ ...tool, text: t(tool.textKey), onPress: () => handlePickTool(tool) }))}
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
  rowName: { flex: 1, color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  chevron: { color: colors.textTertiary, fontSize: 18, fontWeight: '700' },
});
