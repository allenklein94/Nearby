import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
// P1 item 4 (CLAUDE.md, Aug 28 Full Coherence Audit): the same shared
// recommendation-reason vocabulary Best Pick/Nearby Right Now/Ask
// Nearby already use, tagging this card's own real shared-context bits
// (never a new invented signal -- the three counts below already came
// from get_friend_discovery_candidates()) so the leading icon matches
// the same category glyph wherever that category appears app-wide.
import { REASON_CATEGORIES, REASON_CATEGORY_ICONS } from '../constants/recommendationReasonVocabulary';
import { gatheringReasonText, formatCrossedPathsTimeShort } from '../services/crossedPathsSignals';

// Display keys for the RPC's stored distance buckets (ui.friends.bucket.*); the stored value itself is never translated.
export const DISTANCE_BUCKET_KEYS = { Nearby: 'nearby', 'A few miles away': 'fewMiles', 'In the wider area': 'wider' };

// Owner idea 156: one Friends candidate's facts (name, verified, compatibility, distance bucket, crossed paths, what you
// share, bio, interests), moved out of FriendDiscoverySwipeCards so the list rows and the optional deck show the same
// card. The card answers "would I want this person as a friend?"; distance is a coarse bucket, never exact miles.
export default function FriendCandidateDetails({ item, compatibilityColor, bioLines = 3 }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);

  // Tagged with the same shared vocabulary Best Pick/Nearby Right Now/
  // Ask Nearby already use -- the joined line stays one compact string,
  // but its one leading icon reflects the strongest real signal present,
  // in the same priority order these three checks already ran in.
  const sharedBits = [];
  if (item.shared_interest_count > 0) {
    sharedBits.push({ text: t('ui.friends.interestsInCommon', { count: item.shared_interest_count }), category: REASON_CATEGORIES.INTEREST });
  }
  if (item.shared_community_count > 0) {
    sharedBits.push({ text: t('ui.friends.inYourCommunities', { count: item.shared_community_count }), category: REASON_CATEGORIES.CONTEXT });
  }
  if (item.mutual_friend_count > 0) {
    sharedBits.push({ text: t('ui.friends.mutualFriends', { count: item.mutual_friend_count }), category: REASON_CATEGORIES.CONTEXT });
  }

  // Unified Crossed Paths, step 6 (CLAUDE.md, 2026-09-10): only present
  // on a real Crossed Paths candidate (never on a Browse-mode one) --
  // gathering attendance is always the preferred, real explanation when
  // it exists; a proximity-only match gets today's existing Dating
  // Crossed Paths wording, never blended together.
  const crossedPathsText = item.crossedPathsReason?.type === 'gathering'
    ? gatheringReasonText(item.crossedPathsReason)
    : item.crossedPathsReason?.type === 'proximity'
      ? (() => {
          const time = formatCrossedPathsTimeShort(item.crossedPathsReason.lastSeenAt);
          return time ? t('ui.friends.crossedPathsCardWhen', { time }) : t('ui.friends.crossedPathsCard');
        })()
      : null;

  return (
    <View>
      <View style={styles.nameRow}>
        <Text style={styles.name}>{item.display_name}</Text>
        {item.photo_verified && <Text style={styles.verifiedBadge}>✓</Text>}
        {typeof item.compatScore === 'number' && compatibilityColor && (
          <View style={[styles.compatBadge, { borderColor: compatibilityColor(item.compatScore) }]}>
            <Text style={[styles.compatText, { color: compatibilityColor(item.compatScore) }]}>{t('ui.friends.compatMatch', { score: item.compatScore })}</Text>
          </View>
        )}
        {item.distance_bucket && <Text style={styles.distance}>{DISTANCE_BUCKET_KEYS[item.distance_bucket] ? t(`ui.friends.bucket.${DISTANCE_BUCKET_KEYS[item.distance_bucket]}`) : item.distance_bucket}</Text>}
      </View>
      {crossedPathsText && (
        <Text style={styles.crossedPathsText}>
          {item.crossedPathsReason?.type === 'gathering' ? '🗓️ ' : '📍 '}{crossedPathsText}
        </Text>
      )}
      {sharedBits.length > 0 && (
        <View style={styles.sharedRow}>
          <Ionicons
            name={REASON_CATEGORY_ICONS[sharedBits[0].category]}
            size={13}
            color={colors.primary}
            style={styles.sharedIcon}
          />
          <Text style={styles.sharedText}>{sharedBits.map((b) => b.text).join(' · ')}</Text>
        </View>
      )}
      {item.bio ? <Text style={styles.bio} numberOfLines={bioLines}>{item.bio}</Text> : null}
      {item.interests?.length > 0 && (
        <View style={styles.chipsWrap}>
          {item.interests.slice(0, 6).map((tag) => (
            <View key={tag} style={styles.chip}>
              <Text style={styles.chipText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  // Same treatment as SwipeableDiscoveryCards.js's own verifiedBadge/
  // compatBadge/compatText -- values copied verbatim so the two surfaces
  // read as the same product.
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs, flexWrap: 'wrap' },
  name: { ...typography.headline, color: colors.textPrimary },
  verifiedBadge: { color: colors.success, fontSize: 16, fontWeight: '700' },
  compatBadge: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  compatText: { fontSize: 11, fontWeight: '700' },
  distance: { ...typography.small, color: colors.textTertiary },
  crossedPathsText: { ...typography.small, color: colors.textTertiary, marginBottom: spacing.xs },
  // sharedText itself keeps its own marginBottom -- sharedRow adds no
  // margin of its own, matching ReasonList.js's own "don't double the
  // gap" convention.
  sharedRow: { flexDirection: 'row', alignItems: 'center' },
  sharedIcon: { marginRight: 4 },
  sharedText: { ...typography.small, color: colors.primary, fontWeight: '600', marginBottom: spacing.xs },
  bio: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { backgroundColor: colors.surfaceElevated, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  chipText: { ...typography.small, color: colors.textSecondary },
});
