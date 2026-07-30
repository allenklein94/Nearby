import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import StartSomethingModal from '../components/StartSomethingModal';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// A dedicated action hub — the "I want to do something" tab,
// distinct from Discover's "let me look around" browsing. Reuses
// the same Start Something quick-picks already built for Home.
export default function CreateHubScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [startModalVisible, setStartModalVisible] = useState(false);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Create</Text>
      <Text style={styles.subtitle}>What do you want to do?</Text>

      <TouchableOpacity
        style={styles.card}
        onPress={() => setStartModalVisible(true)}
        activeOpacity={0.85}
        accessibilityLabel="Start something spontaneous"
        accessibilityRole="button"
      >
        <Text style={styles.cardIcon}>⚡</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Start Something</Text>
          <Text style={styles.cardSubtitle}>Coffee, food, a walk — spontaneous plans</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('CreateGathering')}
        activeOpacity={0.85}
        accessibilityLabel="Host a full gathering"
        accessibilityRole="button"
      >
        <Text style={styles.cardIcon}>🎉</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Host a Gathering</Text>
          <Text style={styles.cardSubtitle}>Plan something bigger, set a time and place</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </TouchableOpacity>

      <StartSomethingModal
        visible={startModalVisible}
        onClose={() => setStartModalVisible(false)}
        navigation={navigation}
      />
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