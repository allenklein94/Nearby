import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Consolidates what used to be ~7 flat rows spread across SettingsScreen's
// "Reflection Tools" section (plus Memory Vault's own separate Profile
// entry) into one real hub with sections. Every underlying screen/route is
// unchanged — this is a navigation/organization layer, not a rebuild. See
// CLAUDE.md's "Relationship hub consolidation" section for why: the tools
// were all individually reachable already, they just read as a pile of
// destinations rather than a coherent suite.
const SECTIONS = [
  {
    title: 'With Someone',
    subtitle: 'Shared tools, used together with a specific match.',
    rows: [
      { key: 'tools', icon: '🧩', label: 'Relationship Tools', route: 'RelationshipTools', a11y: 'Relationship tools shared with a specific match' },
      { key: 'vault', icon: '💫', label: 'Memory Vault', route: 'MemoryVaultIndex', a11y: 'Memory vault, memories saved with your matches' },
    ],
  },
  {
    title: 'On Your Own',
    subtitle: 'Private reflection — nothing here is shared with a match.',
    rows: [
      { key: 'rehearsal', icon: '🎭', label: 'Rehearsal Room', route: 'RehearsalRoom', a11y: 'Rehearsal Room, practice hard conversations' },
      { key: 'chemistry', icon: '📔', label: 'Chemistry Diary', route: 'ChemistryDiaryList', a11y: 'Your chemistry diary' },
      { key: 'goodbye', icon: '🌙', label: 'Private Reflections', route: 'GoodbyeArchiveList', a11y: 'Your private reflections' },
      { key: 'legacy', icon: '💌', label: 'Relationship Wisdom', route: 'LegacyLibrary', a11y: 'Relationship wisdom library' },
      { key: 'kit', icon: '🧰', label: 'Emergency Kit', route: 'RelationshipEmergencyKit', a11y: 'Relationship emergency kit' },
    ],
  },
];

export default function RelationshipHubScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Everything for building and reflecting on a relationship, in one place.
        </Text>
        {SECTIONS.map((section) => (
          <View key={section.title}>
            <Text style={styles.sectionLabel} accessibilityRole="header">{section.title}</Text>
            <Text style={styles.sectionSubtitle}>{section.subtitle}</Text>
            {section.rows.map((row) => (
              <TouchableOpacity
                key={row.key}
                style={styles.rowButtonCard}
                onPress={() => navigation.navigate(row.route)}
                activeOpacity={0.85}
                accessibilityLabel={row.a11y}
                accessibilityRole="button"
              >
                <Text style={styles.rowButtonText}>{row.icon} {row.label}</Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  intro: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: 2, marginTop: spacing.md, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionSubtitle: { color: colors.textTertiary, fontSize: 12, marginBottom: spacing.sm, lineHeight: 16 },
  rowButtonCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  rowButtonText: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  chevron: { color: colors.textTertiary, fontSize: 20, fontWeight: '700' },
});
