import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView } from 'react-native';
import StoriesRow from '../components/StoriesRow';
import TabHeaderActions from '../components/TabHeaderActions';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Phase 5 of the "build everything" plan (see CLAUDE.md): the new
// 👥 People bottom tab, absorbing exactly two things Discover used to
// carry -- the Stories carousel and the "People Nearby" Dating/Friends
// module -- and nothing else. Dating and Friends stay two genuinely
// separate matching systems under the hood (separate opt-in flags,
// separate swipe tables, separate exclusion/safety rules); this is a
// navigation-only grouping, not a combined candidate pool. "Everyone" is
// still deliberately absent -- there's no real merged pool to show under
// that label. See CLAUDE.md's Aug 22 2026 entry for the full reasoning,
// unchanged by this move.
const PEOPLE_MODES = [
  { key: 'dating', route: 'Nearby', icon: '💗', title: 'Dating', subtitle: 'Meet people nearby who are open to dating' },
  { key: 'friends', route: 'FriendDiscovery', icon: '🤝', title: 'Friends', subtitle: 'Meet new people nearby and make friends' },
];

export default function PeopleScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} accessibilityRole="header">People</Text>
            <Text style={styles.subtitle}>Stories, dating, and friends nearby.</Text>
          </View>
          <TabHeaderActions navigation={navigation} />
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <StoriesRow />

        <Text style={styles.sectionHeader}>People Nearby</Text>
        <View style={styles.peopleModule}>
          {PEOPLE_MODES.map((mode, index) => (
            <React.Fragment key={mode.key}>
              {index > 0 && <View style={styles.peopleModuleDivider} />}
              <TouchableOpacity
                style={styles.peopleModuleRow}
                onPress={() => navigation.navigate(mode.route)}
                activeOpacity={0.7}
                accessibilityLabel={`${mode.title}, ${mode.subtitle}`}
                accessibilityRole="button"
              >
                <Text style={styles.cardIcon}>{mode.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{mode.title}</Text>
                  <Text style={styles.cardSubtitle}>{mode.subtitle}</Text>
                </View>
                <Text style={styles.cardChevron}>›</Text>
              </TouchableOpacity>
            </React.Fragment>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.sm },
  scrollContent: { padding: spacing.lg, paddingTop: spacing.sm },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  peopleModule: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, marginBottom: spacing.md, ...shadow.card, overflow: 'hidden',
  },
  peopleModuleRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  peopleModuleDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: spacing.lg },
  cardIcon: { fontSize: 32, marginRight: spacing.md },
  cardTitle: { ...typography.headline, color: colors.textPrimary },
  cardSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  cardChevron: { color: colors.textTertiary, fontSize: 22 },
});
