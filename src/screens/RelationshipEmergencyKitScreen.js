import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { usePostHog } from 'posthog-react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

// Tip text: ui.relationship.kit.<key>.<1..tipCount>.
const KIT_SECTIONS = [
  {
    icon: '💬',
    key: 'hard_conversation',
    titleKey: 'hardConversation',
    tipCount: 3,
  },
  {
    icon: '🙏',
    key: 'apologize',
    titleKey: 'apologize',
    tipCount: 3,
  },
  {
    icon: '🔧',
    key: 'rebuild_trust',
    titleKey: 'rebuildTrust',
    tipCount: 3,
  },
  {
    icon: '🌊',
    key: 'resentment',
    titleKey: 'resentment',
    tipCount: 3,
  },
  {
    icon: '🌉',
    key: 'reconnecting',
    titleKey: 'reconnecting',
    tipCount: 3,
  },
];

export default function RelationshipEmergencyKitScreen() {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors);
  const [expandedIndex, setExpandedIndex] = useState(null);

  function toggleExpand(index, sectionKey) {
    const expanding = expandedIndex !== index;
    setExpandedIndex(expanding ? index : null);
    if (expanding) {
      posthog.capture('emergency_kit_section_opened', { section: sectionKey });
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.headerTitle} accessibilityRole="header">{t('emergencyKit.title')}</Text>
        <Text style={styles.headerSubtitle}>
          {t('emergencyKit.subtitle')}
        </Text>

        {KIT_SECTIONS.map((section, index) => {
          const expanded = expandedIndex === index;
          const title = t(`emergencyKit.${section.titleKey}`);
          return (
            <View key={section.key} style={styles.card}>
              <TouchableOpacity
                style={styles.cardHeader}
                onPress={() => toggleExpand(index, section.key)}
                activeOpacity={0.85}
                accessibilityLabel={t(expanded ? 'ui.relationship.kit.collapseA11y' : 'ui.relationship.kit.expandA11y', { title })}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
              >
                <Text style={styles.cardTitle}>{title}</Text>
                <Text style={styles.chevron}>{expanded ? '⌃' : '⌄'}</Text>
              </TouchableOpacity>
              {expanded && (
                <View style={styles.tipsContainer}>
                  {Array.from({ length: section.tipCount }, (_, i) => (
                    <Text key={i} style={styles.tipText}>• {t(`ui.relationship.kit.${section.key}.${i + 1}`)}</Text>
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
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md },
  cardTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15, flex: 1 },
  chevron: { color: colors.textTertiary, fontSize: 16 },
  tipsContainer: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  tipText: { ...typography.body, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.sm },
});