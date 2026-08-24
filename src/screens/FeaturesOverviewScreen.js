import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const CATEGORIES = [
  {
    key: 'meeting',
    title: '📍 Meeting People',
    features: [
      { icon: '📍', name: 'Crossed Paths', description: "The main way you find people — shows you who you've actually been near recently (about 35 feet, a few minutes ago), not just anyone in the city." },
      { icon: '👋', name: 'Notices & Waves', description: 'A Notice is silent — the other person only finds out if they notice you back too. A Wave tells them right away. Both live in the "Interested" tab.' },
      { icon: '🔎', name: 'Browse', description: "An optional second way to discover people — not limited to proximity, shows a wider pool matching your filters. Switch to it from Discover's People mode." },
      { icon: '🎉', name: 'Gatherings', description: 'Real things happening nearby — coffee meetups, hikes, game nights — hosted by people near you. A great way to meet people even before matching.' },
      { icon: '🗺️', name: 'Gatherings Map', description: "See gatherings on an actual map instead of a list. Locations are shown approximately, never your exact address." },
    ],
  },
  {
    key: 'together',
    title: '💞 Building Something Real',
    features: [
      { icon: '📜', name: 'Our Constitution', description: 'A living agreement with a match — how you handle conflict, make big decisions, and support each other, written together.' },
      { icon: '🗓️', name: 'Timeline Thoughts', description: "A space to share expectations about pacing and timing, before mismatches turn into friction." },
      { icon: '💫', name: 'Memory Vault', description: 'A shared place to save the small stuff worth remembering — milestones, inside jokes, funny moments.' },
      { icon: '🧪', name: 'What If...', description: 'Hypothetical scenarios to surface real conversations worth having before they actually come up.' },
      { icon: '🎵', name: 'Shared Playlist', description: 'Build a music playlist together with a match.' },
      { icon: '🧳', name: 'Plan a Trip', description: 'Brainstorm destinations, activities, and budget ideas together.' },
      { icon: '🧭', name: 'Big Picture', description: 'A space for the bigger conversations — living situations, finances, family, long-term plans.' },
      { icon: '💌', name: 'Relationship Wisdom', description: "Read anonymous reflections other couples chose to share, or leave your own." },
    ],
  },
  {
    key: 'growth',
    title: '🌱 For You',
    features: [
      { icon: '🎭', name: 'Rehearsal Room', description: "Practice a hard conversation with an AI role-play partner before having it for real. Nothing here is saved permanently or about a real person." },
      { icon: '🧰', name: 'Toolkit', description: 'General guidance on hard conversations, apologizing, rebuilding trust, and reconnecting after distance.' },
      { icon: '📔', name: 'Chemistry Diary', description: "A private log of how time with someone actually felt. Over time, builds an honest picture of what genuinely feels good to you." },
      { icon: '🌙', name: 'Private Reflections', description: 'A private space to write down what you learned from a connection, however it ended. Only you can see it.' },
      { icon: '🦁', name: 'Help Me Say It', description: 'Stuck on how to say something hard? Get help finding the words, right from a chat.' },
    ],
  },
  {
    key: 'safety',
    title: '🛡️ Safety & Trust',
    features: [
      { icon: '✓', name: 'ID Verification', description: 'Verify your identity to get a badge on your profile and appear when others filter for verified profiles.' },
      { icon: '🚫', name: 'Blocked Users', description: 'Manage who you\u2019ve blocked. You can unblock anyone at any time.' },
      { icon: '🛡️', name: 'Date Safety Check-In', description: 'Share your live location snapshot with a trusted contact before a date, from within a chat.' },
      { icon: '⏳', name: 'Disappearing Messages', description: 'Turn on a 24-hour auto-delete for a specific conversation, from the chat options menu.' },
    ],
  },
  {
    key: 'extras',
    title: '✨ Extras',
    features: [
      { icon: '🎁', name: 'Invite Friends', description: 'Share your referral code — when a friend joins with it, you both get 3 bonus Notices.' },
      { icon: '🎁', name: 'Offers & Perks', description: 'Deals from local businesses and brands partnering with Nearby.' },
      { icon: '🌍', name: '11 Languages', description: 'Switch the app\u2019s language anytime in Settings.' },
    ],
  },
];

export default function FeaturesOverviewScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [expandedCategory, setExpandedCategory] = useState(null);

  function toggleCategory(key) {
    setExpandedCategory((prev) => (prev === key ? null : key));
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.headerTitle} accessibilityRole="header">Everything In Nearby</Text>
        <Text style={styles.headerSubtitle}>
          A quick reference for everything the app can do — tap a category to see what's inside.
        </Text>

        {CATEGORIES.map((category) => {
          const expanded = expandedCategory === category.key;
          return (
            <View key={category.key} style={styles.categoryCard}>
              <TouchableOpacity
                style={styles.categoryHeader}
                onPress={() => toggleCategory(category.key)}
                activeOpacity={0.8}
                accessibilityLabel={`${category.title}, ${expanded ? 'tap to collapse' : 'tap to expand'}`}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
              >
                <Text style={styles.categoryTitle}>{category.title}</Text>
                <Text style={styles.categoryChevron}>{expanded ? '⌃' : '⌄'}</Text>
              </TouchableOpacity>
              {expanded && (
                <View style={styles.featuresList}>
                  {category.features.map((feature) => (
                    <View key={feature.name} style={styles.featureRow}>
                      <Text style={styles.featureIcon}>{feature.icon}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.featureName}>{feature.name}</Text>
                        <Text style={styles.featureDescription}>{feature.description}</Text>
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