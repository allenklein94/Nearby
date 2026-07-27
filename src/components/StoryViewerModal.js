import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Modal, Animated, Dimensions, FlatList } from 'react-native';
import { Video } from 'expo-av';
import { getSignedStoryUrl, markStoryViewed, getStoryViewers } from '../services/stories';
import { getSignedPhotoUrl } from '../services/photos';
import { supabase } from '../services/supabase';
import { spacing, radius } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const IMAGE_DURATION_MS = 5000;

export default function StoryViewerModal({ visible, group, onClose }) {
  const [index, setIndex] = useState(0);
  const [mediaUrl, setMediaUrl] = useState(null);
  const [myUserId, setMyUserId] = useState(null);
  const [showViewers, setShowViewers] = useState(false);
  const [viewers, setViewers] = useState([]);
  const [viewerPhotoUrls, setViewerPhotoUrls] = useState({});
  const progress = useRef(new Animated.Value(0)).current;
  const timerRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMyUserId(data?.session?.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (visible) {
      setIndex(0);
      setShowViewers(false);
    }
  }, [visible, group?.userId]);

  useEffect(() => {
    if (!visible || !group) return;
    const story = group.stories[index];
    if (!story) {
      onClose();
      return;
    }

    markStoryViewed(story.id);
    progress.setValue(0);
    setMediaUrl(null);
    setShowViewers(false);

    getSignedStoryUrl(story.media_path).then(setMediaUrl);

    if (story.media_type === 'image') {
      Animated.timing(progress, { toValue: 1, duration: IMAGE_DURATION_MS, useNativeDriver: false }).start(({ finished }) => {
        if (finished) advance();
      });
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible, group, index]);

  function advance() {
    if (!group) return;
    if (index < group.stories.length - 1) {
      setIndex(index + 1);
    } else {
      onClose();
    }
  }

  function goBack() {
    if (index > 0) setIndex(index - 1);
  }

  function handleVideoStatus(status) {
    if (status.isLoaded && status.durationMillis) {
      progress.setValue(status.positionMillis / status.durationMillis);
    }
    if (status.didJustFinish) {
      advance();
    }
  }

  async function handleShowViewers() {
    if (!group) return;
    const story = group.stories[index];
    setShowViewers(true);
    const results = await getStoryViewers(story.id);
    setViewers(results);

    const urlEntries = await Promise.all(
      results.map(async (v) => {
        if (!v.profiles?.photo_url) return [v.viewer_id, null];
        const url = await getSignedPhotoUrl(v.profiles.photo_url);
        return [v.viewer_id, url];
      })
    );
    setViewerPhotoUrls(Object.fromEntries(urlEntries));
  }

  if (!visible || !group) return null;

  const story = group.stories[index];
  const isOwnStory = group.userId === myUserId;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.progressRow}>
          {group.stories.map((s, i) => (
            <View key={s.id} style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  { width: i < index ? '100%' : i === index ? progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) : '0%' },
                ]}
              />
            </View>
          ))}
        </View>

        <View style={styles.header}>
          <Text style={styles.name}>{group.displayName}</Text>
          <TouchableOpacity onPress={onClose} accessibilityLabel="Close story" accessibilityRole="button">
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.mediaWrap}>
          {mediaUrl && story?.media_type === 'video' ? (
            <Video
              source={{ uri: mediaUrl }}
              style={styles.media}
              resizeMode="contain"
              shouldPlay
              onPlaybackStatusUpdate={handleVideoStatus}
            />
          ) : mediaUrl ? (
            <Image source={{ uri: mediaUrl }} style={styles.media} resizeMode="contain" />
          ) : null}
        </View>

        <View style={styles.tapZones}>
          <TouchableOpacity style={{ flex: 1 }} onPress={goBack} accessibilityLabel="Previous story" />
          <TouchableOpacity style={{ flex: 1 }} onPress={advance} accessibilityLabel="Next story" />
        </View>

        {isOwnStory && (
          <TouchableOpacity style={styles.viewersButton} onPress={handleShowViewers} accessibilityLabel="See who viewed this story" accessibilityRole="button">
            <Text style={styles.viewersButtonText}>👁 Viewers</Text>
          </TouchableOpacity>
        )}

        {showViewers && (
          <View style={styles.viewersSheet}>
            <View style={styles.viewersSheetHandle} />
            <Text style={styles.viewersTitle}>Viewed by</Text>
            <FlatList
              data={viewers}
              keyExtractor={(item) => item.viewer_id}
              ListEmptyComponent={<Text style={styles.emptyViewersText}>No one has viewed this yet.</Text>}
              renderItem={({ item }) => (
                <View style={styles.viewerRow}>
                  {viewerPhotoUrls[item.viewer_id] ? (
                    <Image source={{ uri: viewerPhotoUrls[item.viewer_id] }} style={styles.viewerAvatar} />
                  ) : (
                    <View style={[styles.viewerAvatar, styles.viewerAvatarPlaceholder]} />
                  )}
                  <Text style={styles.viewerName}>{item.profiles?.display_name}</Text>
                </View>
              )}
            />
            <TouchableOpacity onPress={() => setShowViewers(false)} style={{ marginTop: spacing.md }} accessibilityLabel="Close viewers list" accessibilityRole="button">
              <Text style={styles.closeViewersText}>Close</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  progressRow: { flexDirection: 'row', gap: 4, paddingHorizontal: spacing.sm, paddingTop: 50 },
  progressTrack: { flex: 1, height: 2, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 1, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md },
  name: { color: '#fff', fontSize: 15, fontWeight: '700' },
  closeText: { color: '#fff', fontSize: 20 },
  mediaWrap: { flex: 1, justifyContent: 'center' },
  media: { width: SCREEN_WIDTH, height: '100%' },
  tapZones: { position: 'absolute', top: 90, bottom: 0, left: 0, right: 0, flexDirection: 'row' },
  viewersButton: {
    position: 'absolute', bottom: 30, alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: radius.full,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  viewersButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  viewersSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#1a1a2e',
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '60%',
  },
  viewersSheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', alignSelf: 'center', marginBottom: spacing.md },
  viewersTitle: { color: '#fff', fontWeight: '700', fontSize: 14, marginBottom: spacing.md },
  viewerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  viewerAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: spacing.sm, backgroundColor: '#333' },
  viewerAvatarPlaceholder: {},
  viewerName: { color: '#fff', fontSize: 14 },
  emptyViewersText: { color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg },
  closeViewersText: { color: 'rgba(255,255,255,0.7)', textAlign: 'center', fontSize: 14 },
});