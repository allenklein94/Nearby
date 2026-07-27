import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Modal, Animated, Dimensions } from 'react-native';
import { Video } from 'expo-av';
import { getSignedStoryUrl, markStoryViewed } from '../services/stories';
import { spacing, radius } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const IMAGE_DURATION_MS = 5000;

export default function StoryViewerModal({ visible, group, onClose }) {
  const [index, setIndex] = useState(0);
  const [mediaUrl, setMediaUrl] = useState(null);
  const progress = useRef(new Animated.Value(0)).current;
  const timerRef = useRef(null);

  useEffect(() => {
    if (visible) setIndex(0);
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

  if (!visible || !group) return null;

  const story = group.stories[index];

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
});