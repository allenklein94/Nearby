import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getVisibleStoriesGrouped, captureStoryMedia, uploadStory } from '../services/stories';
import * as Haptics from 'expo-haptics';
import { getSignedPhotoUrl } from '../services/photos';
import { supabase } from '../services/supabase';
import StoryViewerModal from './StoryViewerModal';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export default function StoriesRow() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [groups, setGroups] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [posting, setPosting] = useState(false);
  const [viewerTarget, setViewerTarget] = useState(null);
  const [myUserId, setMyUserId] = useState(null);

  const load = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    setMyUserId(sessionData?.session?.user?.id ?? null);

    const grouped = await getVisibleStoriesGrouped();
    setGroups(grouped);

    const urlEntries = await Promise.all(
      grouped.map(async (g) => {
        if (!g.photoUrl) return [g.userId, null];
        const url = await getSignedPhotoUrl(g.photoUrl);
        return [g.userId, url];
      })
    );
    setPhotoUrls(Object.fromEntries(urlEntries));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handlePost() {
    setPosting(true);
    try {
      const captured = await captureStoryMedia();
      if (!captured) {
        setPosting(false);
        return;
      }
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      await uploadStory(userId, captured.uri, captured.type);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setPosting(false);
  }

  if (groups.length === 0 && !posting) {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.ringWrap} onPress={handlePost} accessibilityLabel="Post a story" accessibilityRole="button">
          <View style={[styles.ring, styles.addRing]}>
            <Text style={styles.addIcon}>+</Text>
          </View>
          <Text style={styles.name}>Your Story</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
        <TouchableOpacity style={styles.ringWrap} onPress={handlePost} disabled={posting} accessibilityLabel="Post a story" accessibilityRole="button">
          <View style={[styles.ring, styles.addRing]}>
            {posting ? <ActivityIndicator color={colors.primary} size="small" /> : <Text style={styles.addIcon}>+</Text>}
          </View>
          <Text style={styles.name}>Your Story</Text>
        </TouchableOpacity>

        {groups.map((group) => (
          <TouchableOpacity
            key={group.userId}
            style={styles.ringWrap}
            onPress={() => setViewerTarget(group)}
            accessibilityLabel={`${group.displayName}'s story${group.hasUnviewed ? ', new' : ''}`}
            accessibilityRole="button"
          >
            <View style={[styles.ring, group.hasUnviewed ? styles.ringUnviewed : styles.ringViewed]}>
              {photoUrls[group.userId] ? (
                <Image source={{ uri: photoUrls[group.userId] }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]} />
              )}
            </View>
            <Text style={styles.name} numberOfLines={1}>{group.userId === myUserId ? 'Your Story' : group.displayName}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <StoryViewerModal
        visible={!!viewerTarget}
        group={viewerTarget}
        onClose={() => {
          setViewerTarget(null);
          load();
        }}
      />
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { paddingVertical: spacing.md },
  ringWrap: { alignItems: 'center', width: 68 },
  ring: {
    width: 60, height: 60, borderRadius: 30, borderWidth: 2.5,
    justifyContent: 'center', alignItems: 'center', marginBottom: 4,
  },
  ringUnviewed: { borderColor: colors.primary },
  ringViewed: { borderColor: colors.border },
  addRing: { borderColor: colors.border, borderStyle: 'dashed' },
  addIcon: { fontSize: 24, color: colors.primary, fontWeight: '300' },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceElevated },
  avatarPlaceholder: {},
  name: { fontSize: 11, color: colors.textSecondary, textAlign: 'center' },
});