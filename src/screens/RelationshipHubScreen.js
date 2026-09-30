import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

// Consolidates what used to be ~7 flat rows spread across SettingsScreen's
// "Reflection Tools" section (plus Memory Vault's own separate Profile
// entry) into one real hub with sections. Every underlying screen/route is
// unchanged — this is a navigation/organization layer, not a rebuild. See
// CLAUDE.md's "Relationship hub consolidation" section for why: the tools
// were all individually reachable already, they just read as a pile of
// destinations rather than a coherent suite.
// Labels live in ui.relationship.hub.<section>.* and ui.relationship.hub.row.<key>.label / .a11y.
const SECTIONS = [
  { key: 'together', rows: [
    { key: 'tools', icon: '🧩', route: 'RelationshipTools' },
    { key: 'vault', icon: '💫', route: 'MemoryVaultIndex' },
  ] },
  { key: 'onYourOwn', rows: [
    { key: 'rehearsal', icon: '🎭', route: 'RehearsalRoom' },
    { key: 'chemistry', icon: '📔', route: 'ChemistryDiaryList' },
    { key: 'goodbye', icon: '🌙', route: 'GoodbyeArchiveList' },
    { key: 'legacy', icon: '💌', route: 'LegacyLibrary' },
    { key: 'kit', icon: '🧰', route: 'RelationshipEmergencyKit' },
  ] },
];

export default function RelationshipHubScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors, shadow);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          {t('ui.relationship.hub.intro')}
        </Text>
        {SECTIONS.map((section) => (
          <View key={section.key}>
            <Text style={styles.sectionLabel} accessibilityRole="header">{t(`ui.relationship.hub.${section.key}.title`)}</Text>
            <Text style={styles.sectionSubtitle}>{t(`ui.relationship.hub.${section.key}.subtitle`)}</Text>
            {section.rows.map((row) => (
              <TouchableOpacity
                key={row.key}
                style={styles.rowButtonCard}
                onPress={() => navigation.navigate(row.route)}
                activeOpacity={0.85}
                accessibilityLabel={t(`ui.relationship.hub.row.${row.key}.a11y`)}
                accessibilityRole="button"
              >
                <Text style={styles.rowButtonText}>{row.icon} {t(`ui.relationship.hub.row.${row.key}.label`)}</Text>
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
