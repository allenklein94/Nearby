import React from 'react';
import { View, Image, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import FriendCandidateDetails from './FriendCandidateDetails';
import FriendDecisionButtons from './FriendDecisionButtons';
import { FriendDiscoveryEmpty } from './FriendDiscoverySwipeCards';

// Owner idea 156 (2026-10-17): Friends discovery's DEFAULT mode, mirroring Dating's list (DiscoveryScreen's FlatList):
// one static card per candidate (the same FriendCandidateDetails the optional deck shows) with the labelled Pass / Connect
// pair. Nothing to swipe; a decided person leaves the list at once with no motion (the screen's undecidedCandidates), and
// comes back if the write fails.
export default function FriendDiscoveryList({ data, photoUrls, onlineStatuses = {}, storyByUserId = {}, onViewStory, compatibilityColor, onDecide, navigation }) {
  const { t } = useLanguage();
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  if (!data.length) return <FriendDiscoveryEmpty navigation={navigation} />;

  return (
    <FlatList
      data={data}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ paddingBottom: spacing.xl }}
      renderItem={({ item }) => {
        const storyGroup = storyByUserId[item.id] ?? null;
        const photo = (
          <Image
            source={{ uri: photoUrls[item.id] || 'https://placehold.co/200' }}
            style={[styles.avatar, storyGroup && (storyGroup.hasUnviewed ? styles.avatarRingUnviewed : styles.avatarRingViewed)]}
          />
        );
        return (
          <View style={styles.card}>
            <View>
              {storyGroup ? (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => onViewStory(storyGroup)}
                  accessibilityLabel={t('ui.friends.viewSStoryA11y', { name: item.display_name })}
                  accessibilityRole="button"
                >
                  {photo}
                </TouchableOpacity>
              ) : photo}
              {onlineStatuses[item.id] && <View style={styles.onlineDot} />}
            </View>
            <View style={styles.cardBody}>
              <FriendCandidateDetails item={item} compatibilityColor={compatibilityColor} bioLines={2} />
              <View style={styles.actions}>
                <FriendDecisionButtons compact name={item.display_name} onDecide={(direction) => onDecide(item, direction)} />
              </View>
            </View>
          </View>
        );
      }}
    />
  );
}

// Card values follow DiscoveryScreen.js's own list card (card/avatar/cardBody/onlineDot) so the two People lists match.
const getStyles = (colors, shadow) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, marginHorizontal: spacing.lg, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...shadow.card,
  },
  avatar: { width: '100%', height: 280, backgroundColor: colors.surfaceElevated },
  avatarRingUnviewed: { borderWidth: 2.5, borderColor: colors.textPrimary },
  avatarRingViewed: { borderWidth: 2.5, borderColor: colors.border },
  onlineDot: {
    position: 'absolute', top: spacing.md, right: spacing.md,
    width: 16, height: 16, borderRadius: 8, backgroundColor: colors.success, borderWidth: 2.5, borderColor: colors.surface,
  },
  cardBody: { padding: spacing.md },
  actions: { marginTop: spacing.sm },
});
