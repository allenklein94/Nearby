import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, Modal, ScrollView, StyleSheet, Alert, SafeAreaView } from 'react-native';
import { Video } from 'expo-av';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { modalAnimation } from '../motion';
import { presentRecoverableError } from '../utils/recoverableError';
import { getGatheringMemories, addGatheringMemory, deleteStory, getSignedStoryUrl } from '../services/stories';
import { supabase } from '../services/supabase';

// Owner item 122 (2026-10-16, LOCKED): "a gathering could leave a memory". On a COMPLETED gathering (gatheringMemoryState in
// utils/gatheringCompletion.js: you were there AND it is over), the host and approved attendees see the photos/videos the
// people who were there chose to add, and may add one themselves (photo library) or remove their own. The server is the
// authority on who sees them (viewer_was_at_gathering, migration 20270315); this section only renders what it returns.
// Not a feed (LOCKED): it lives only here, oldest first, no likes, comments, counts elsewhere (except item 123's Plans -> Past line), push, Home row, anniversary,
// collage or public sharing. Static (no motion). Video is tap-to-play in the viewer, never autoplayed or preloaded.
// Item 123: `openOnLoad` (a tap on Plans -> Past's card with memories) opens the viewer once the server returns at least one
// memory; Close lands on this gathering's detail. Nothing visible = it simply stays closed.
export default function GatheringMemories({ gatheringId, openOnLoad = false }) {
  const { t } = useLanguage();
  const m = (key, vars) => t(`ui.gatheringMemories.${key}`, vars);
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [memories, setMemories] = useState(null);
  const [urls, setUrls] = useState({});
  const [adding, setAdding] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [myUserId, setMyUserId] = useState(null);
  const openedOnLoad = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMyUserId(data?.session?.user?.id ?? null));
  }, []);

  const load = useCallback(async () => {
    try {
      const rows = await getGatheringMemories(gatheringId);
      setMemories(rows);
      // Images only: a signed address per photo, reused by the viewer. A video gets one only when its viewer opens.
      const pairs = await Promise.all(rows.filter((r) => r.media_type !== 'video').map(async (r) => [r.id, await getSignedStoryUrl(r.media_path)]));
      setUrls((prev) => ({ ...prev, ...Object.fromEntries(pairs.filter(([, u]) => u)) }));
    } catch {
      setMemories((prev) => prev ?? []);
    }
  }, [gatheringId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!openOnLoad || openedOnLoad.current || !memories || memories.length === 0) return;
    openedOnLoad.current = true;
    setViewerOpen(true);
  }, [openOnLoad, memories]);

  useEffect(() => {
    if (!viewerOpen || !memories) return;
    const videos = memories.filter((r) => r.media_type === 'video' && !urls[r.id]);
    if (videos.length === 0) return;
    let cancelled = false;
    Promise.all(videos.map(async (r) => [r.id, await getSignedStoryUrl(r.media_path)])).then((pairs) => {
      if (!cancelled) setUrls((prev) => ({ ...prev, ...Object.fromEntries(pairs.filter(([, u]) => u)) }));
    });
    return () => { cancelled = true; };
  }, [viewerOpen, memories]);

  async function handleAdd() {
    if (adding) return;
    setAdding(true);
    try {
      const added = await addGatheringMemory(gatheringId);
      if (added) await load();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleAdd() });
    }
    setAdding(false);
  }

  function handleRemove(memory) {
    Alert.alert(m('removeTitle'), m('removeBody'), [
      { text: t('ui.common.cancel'), style: 'cancel' },
      {
        text: m('remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteStory(memory.id);
            setMemories((prev) => (prev ?? []).filter((r) => r.id !== memory.id));
          } catch (e) {
            presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleRemove(memory) });
          }
        },
      },
    ]);
  }

  if (memories === null) return null;
  const nameOf = (r) => r.profiles?.display_name || m('someone');
  const labelOf = (r) => m(r.media_type === 'video' ? 'videoBy' : 'photoBy', { name: nameOf(r) });

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{m('title')}</Text>
      <Text style={styles.hint}>🔒 {m('onlyThere')}</Text>
      {memories.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {memories.map((r) => (
            <TouchableOpacity key={r.id} onPress={() => setViewerOpen(true)} accessibilityRole="button" accessibilityLabel={labelOf(r)}>
              {r.media_type === 'video' ? (
                <View style={[styles.thumb, styles.thumbPlaceholder]}><Text style={styles.play}>▶</Text></View>
              ) : urls[r.id] ? (
                <Image source={{ uri: urls[r.id] }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]} />
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      <TouchableOpacity style={styles.addButton} onPress={handleAdd} disabled={adding} accessibilityRole="button" accessibilityLabel={m('addPhoto')}>
        <Text style={styles.addText}>{adding ? m('adding') : `＋ ${m('addPhoto')}`}</Text>
      </TouchableOpacity>

      <Modal visible={viewerOpen} animationType={modalAnimation('slide')} onRequestClose={() => setViewerOpen(false)}>
        <SafeAreaView style={styles.viewer}>
          <View style={styles.viewerHeader}>
            <Text style={styles.viewerTitle}>{m('title')}</Text>
            <TouchableOpacity onPress={() => setViewerOpen(false)} accessibilityRole="button" accessibilityLabel={t('ui.common.close')}>
              <Text style={styles.close}>{t('ui.common.close')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
            {memories.map((r) => (
              <View key={r.id} style={styles.viewerItem}>
                <View style={styles.viewerItemHeader}>
                  <Text style={styles.poster}>{nameOf(r)}</Text>
                  {r.user_id === myUserId && (
                    <TouchableOpacity onPress={() => handleRemove(r)} accessibilityRole="button" accessibilityLabel={`${m('remove')}, ${labelOf(r)}`}>
                      <Text style={styles.remove}>{m('remove')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {urls[r.id] ? (
                  r.media_type === 'video' ? (
                    <Video source={{ uri: urls[r.id] }} style={styles.full} resizeMode="contain" useNativeControls shouldPlay={false} accessibilityLabel={labelOf(r)} />
                  ) : (
                    <Image source={{ uri: urls[r.id] }} style={styles.full} resizeMode="contain" accessibilityLabel={labelOf(r)} />
                  )
                ) : (
                  <View style={[styles.full, styles.thumbPlaceholder]} />
                )}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  section: { marginTop: spacing.lg },
  sectionLabel: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  hint: { color: colors.textTertiary, fontSize: 12, marginBottom: spacing.sm },
  strip: { gap: spacing.sm, paddingBottom: spacing.sm },
  thumb: { width: 88, height: 88, borderRadius: radius.md },
  thumbPlaceholder: { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  play: { color: colors.textSecondary, fontSize: 22 },
  addButton: { alignSelf: 'flex-start', paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  addText: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  viewer: { flex: 1, backgroundColor: colors.background },
  viewerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: spacing.lg },
  viewerTitle: { ...typography.display, color: colors.textPrimary },
  close: { color: colors.primary, fontWeight: '700' },
  viewerItem: { marginBottom: spacing.lg, paddingHorizontal: spacing.lg },
  viewerItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  poster: { color: colors.textPrimary, fontWeight: '700' },
  remove: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  full: { width: '100%', height: 400, borderRadius: radius.lg },
});
