import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, StyleSheet, SafeAreaView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getPublicStoriesGrouped } from '../services/stories';
import { getSignedPhotoUrl } from '../services/photos';
import StoryViewerModal from '../components/StoryViewerModal';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// A genuinely simple hub — two large cards linking to the existing,
// fully-functional People and Gatherings screens, which remain
// completely untouched. This only changes navigation structure, not
// any of the actual complex screens underneath.
export default function DiscoverHubScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [publicStories, setPublicStories] = useState([]);
  const [storyPhotoUrls, setStoryPhotoUrls] = useState({});
  const [viewerTarget, setViewerTarget] = useState(null);

  useFocusEffect(
    useCallback(() => {
      loadPublicStories();
    }, [])
  );

  async function loadPublicStories() {
    const grouped = await getPublicStoriesGrouped();
    setPublicStories(grouped);

    const urlEntries = await Promise.all(
      grouped.map(async (g) => {
        if (!g.photoUrl) return [g.userId, null];
        const url = await getSignedPhotoUrl(g.photoUrl);
        return [g.userId, url];
      })
    );
    setStoryPhotoUrls(Object.fromEntries(urlEntries));
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Discover</Text>
      <Text style={styles.subtitle}>What are you looking for?</Text>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('Nearby')}
        activeOpacity={0.85}
        accessibilityLabel="Meet People, find people nearby"
        accessibilityRole="button"
      >
        <Text style={styles.cardIcon}>👥</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Meet People</Text>
          <Text style={styles.cardSubtitle}>Find people nearby</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </TouchableOpacity>

      <<TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('Gatherings')}
        activeOpacity={0.85}
        accessibilityLabel="Join Gatherings, see what's happening"
        accessibilityRole="button"
      >
        <Text style={styles.cardIcon}>🎉</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Join Gatherings</Text>
          <Text style={styles.cardSubtitle}>See what's happening</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('Communities')}
        activeOpacity={0.85}
        accessibilityLabel="Communities, ongoing groups you can join"
        accessibilityRole="button"
      >
        <Text style={styles.cardIcon}>🏘️</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Communities</Text>
          <Text style={styles.cardSubtitle}>Join ongoing groups</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </TouchableOpacity>
      {publicStories.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>Public Stories Near You</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
            {publicStories.map((group) => (
              <TouchableOpacity
                key={group.userId}
                style={styles.storyRing}
                onPress={() => setViewerTarget(group)}
                accessibilityLabel={`${group.displayName}'s public story`}
                accessibilityRole="button"
              >
                {storyPhotoUrls[group.userId] ? (
                  <Image source={{ uri: storyPhotoUrls[group.userId] }} style={styles.storyAvatar} />
                ) : (
                  <View style={[styles.storyAvatar, styles.storyAvatarPlaceholder]} />
                )}
                <Text style={styles.storyName} numberOfLines={1}>{group.displayName}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}

      <StoryViewerModal
        visible={!!viewerTarget}
        group={viewerTarget}
        onClose={() => {
          setViewerTarget(null);
          loadPublicStories();
        }}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  title: { ...typography.display, color: colors.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.xl },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.md, ...shadow.card,
  },
  cardIcon: { fontSize: 32, marginRight: spacing.md },
  cardTitle: { ...typography.headline, color: colors.textPrimary },
  cardSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  cardChevron: { color: colors.textTertiary, fontSize: 24 },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  storyRing: { alignItems: 'center', width: 64 },
  storyAvatar: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: '#e1306c', marginBottom: 4, backgroundColor: colors.surfaceElevated },
  storyAvatarPlaceholder: {},
  storyName: { color: colors.textSecondary, fontSize: 11, textAlign: 'center' },
});