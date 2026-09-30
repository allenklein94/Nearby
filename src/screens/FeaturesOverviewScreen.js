import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

// Titles and descriptions read ui.features.cat.<key> and ui.features.f.<feature>.name / .desc.
const CATEGORIES = [
  {
    key: 'meeting',
    emoji: '📍',
    features: [
      { icon: '📍', key: 'crossedPaths' },
      { icon: '👋', key: 'noticesWaves' },
      { icon: '🔎', key: 'browse' },
      { icon: '🎉', key: 'gatherings' },
      { icon: '🗺️', key: 'gatheringsMap' },
    ],
  },
  {
    key: 'together',
    emoji: '💞',
    features: [
      { icon: '📜', key: 'ourConstitution' },
      { icon: '🗓️', key: 'timelineThoughts' },
      { icon: '💫', key: 'memoryVault' },
      { icon: '🧪', key: 'whatIf' },
      { icon: '🎵', key: 'sharedPlaylist' },
      { icon: '🧳', key: 'planATrip' },
      { icon: '🧭', key: 'bigPicture' },
      { icon: '💌', key: 'relationshipWisdom' },
    ],
  },
  {
    key: 'growth',
    emoji: '🌱',
    features: [
      { icon: '🎭', key: 'rehearsalRoom' },
      { icon: '🧰', key: 'toolkit' },
      { icon: '📔', key: 'chemistryDiary' },
      { icon: '🌙', key: 'privateReflections' },
      { icon: '🦁', key: 'helpMeSayIt' },
    ],
  },
  {
    key: 'safety',
    emoji: '🛡️',
    features: [
      { icon: '✓', key: 'idVerification' },
      { icon: '🚫', key: 'blockedUsers' },
      { icon: '🛡️', key: 'dateSafetyCheckIn' },
      { icon: '⏳', key: 'disappearingMessages' },
    ],
  },
  {
    key: 'extras',
    emoji: '✨',
    features: [
      { icon: '🎁', key: 'inviteFriends' },
      { icon: '🎁', key: 'offersPerks' },
      { icon: '🌍', key: 'languages' },
    ],
  },
];

export default function FeaturesOverviewScreen() {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors);
  const [expandedCategory, setExpandedCategory] = useState(null);

  function toggleCategory(key) {
    setExpandedCategory((prev) => (prev === key ? null : key));
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.headerTitle} accessibilityRole="header">{t('ui.features.title')}</Text>
        <Text style={styles.headerSubtitle}>
          {t('ui.features.subtitle')}
        </Text>

        {CATEGORIES.map((category) => {
          const expanded = expandedCategory === category.key;
          return (
            <View key={category.key} style={styles.categoryCard}>
              <TouchableOpacity
                style={styles.categoryHeader}
                onPress={() => toggleCategory(category.key)}
                activeOpacity={0.85}
                accessibilityLabel={t(expanded ? 'ui.features.collapseA11y' : 'ui.features.expandA11y', { title: t(`ui.features.cat.${category.key}`) })}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
              >
                <Text style={styles.categoryTitle}>{category.emoji} {t(`ui.features.cat.${category.key}`)}</Text>
                <Text style={styles.categoryChevron}>{expanded ? '⌃' : '⌄'}</Text>
              </TouchableOpacity>
              {expanded && (
                <View style={styles.featuresList}>
                  {category.features.map((feature) => (
                    <View key={feature.key} style={styles.featureRow}>
                      <Text style={styles.featureIcon}>{feature.icon}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.featureName}>{t(`ui.features.f.${feature.key}.name`)}</Text>
                        <Text style={styles.featureDescription}>{t(`ui.features.f.${feature.key}.desc`)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  categoryCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  categoryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md },
  categoryTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  categoryChevron: { color: colors.textTertiary, fontSize: 16 },
  featuresList: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  featureRow: { flexDirection: 'row', marginBottom: spacing.md },
  featureIcon: { fontSize: 20, marginRight: spacing.sm, width: 26 },
  featureName: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 14, marginBottom: 2 },
  featureDescription: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
});