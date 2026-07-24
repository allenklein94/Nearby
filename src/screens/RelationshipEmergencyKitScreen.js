import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const KIT_SECTIONS = [
  {
    icon: '💬',
    title: 'Having a Hard Conversation',
    tips: [
      'Pick a real moment, not mid-argument — ask "can we talk about something later tonight?" rather than diving in when either of you is already upset.',
      'Start with what you need, not what they did wrong: "I need to feel included in weekend plans" lands differently than "you never include me."',
      "Expect it to feel awkward at first. That's normal, not a sign it's going badly.",
    ],
  },
  {
    icon: '🙏',
    title: 'How to Apologize',
    tips: [
      'Name the specific thing, not a vague feeling: "I dismissed how you felt earlier" beats "sorry you\'re upset."',
      'Skip the "but" — an apology followed by an explanation often lands as an excuse, even when that\'s not the intent.',
      'Ask what would actually help, rather than assuming you already know.',
    ],
  },
  {
    icon: '🔧',
    title: 'Rebuilding Trust',
    tips: [
      'Trust rebuilds through small, consistent follow-through over time — not one grand gesture.',
      "Be patient with their caution. It's not punishment, it's a nervous system that got hurt and is being careful.",
      'Consider naming it directly: "What would help you feel more sure of me right now?"',
    ],
  },
  {
    icon: '🌊',
    title: 'Handling Resentment',
    tips: [
      "Resentment usually means an unspoken need. Try to name the need underneath it, not just the frustration.",
      "Small things add up. If something feels 'too small to mention,' that's often exactly the thing worth mentioning early.",
      'Consider writing it out privately first — sometimes what comes out is different from what you thought you felt.',
    ],
  },
  {
    icon: '🌉',
    title: 'Reconnecting After Distance',
    tips: [
      'Start smaller than feels necessary — a short, low-stakes check-in often works better than a big "we need to talk."',
      'Curiosity helps more than assumptions: ask what\'s been going on for them, rather than guessing.',
      "Physical presence matters too — sometimes reconnecting starts with just being in the same room, no agenda.",
    ],
  },
];

export default function RelationshipEmergencyKitScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [expandedIndex, setExpandedIndex] = useState(null);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.headerTitle} accessibilityRole="header">🧰 Relationship Emergency Kit</Text>
        <Text style={styles.headerSubtitle}>
          Most relationships don't fail from lack of love — they struggle from lack of tools. General guidance, not advice about any specific situation.
        </Text>

        {KIT_SECTIONS.map((section, index) => {
          const expanded = expandedIndex === index;
          return (
            <View key={section.title} style={styles.card}>
              <TouchableOpacity
                style={styles.cardHeader}
                onPress={() => setExpandedIndex(expanded ? null : index)}
                activeOpacity={0.8}
                accessibilityLabel={`${section.title}, ${expanded ? 'double tap to collapse' : 'double tap to expand'}`}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
              >
                <Text style={styles.cardTitle}>{section.icon} {section.title}</Text>
                <Text style={styles.chevron}>{expanded ? '⌃' : '⌄'}</Text>
              </TouchableOpacity>
              {expanded && (
                <View style={styles.tipsContainer}>
                  {section.tips.map((tip, i) => (
                    <Text key={i} style={styles.tipText}>• {tip}</Text>
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