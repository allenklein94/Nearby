import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// A genuinely simple hub — two large cards linking to the existing,
// fully-functional People and Gatherings screens, which remain
// completely untouched. This only changes navigation structure, not
// any of the actual complex screens underneath.
export default function DiscoverHubScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

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

      <TouchableOpacity
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
});