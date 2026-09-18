import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Switch, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { NOTIFICATION_CATEGORIES } from '../constants/notificationCategories';
import { ONBOARDING_ANSWERS_KEY } from './OnboardingQuestionsScreen';

export default function OnboardingNotificationsScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [choices, setChoices] = useState(() => Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c.column, true])));

  async function handleContinue() {
    try {
      const stored = await AsyncStorage.getItem(ONBOARDING_ANSWERS_KEY);
      const answers = stored ? JSON.parse(stored) : {};
      await AsyncStorage.setItem(ONBOARDING_ANSWERS_KEY, JSON.stringify({ ...answers, notification_choices: choices }));
    } catch (e) {
      // Preference only; Settings -> Notifications remains the full control, so never block signup.
    }
    navigation.navigate('Login');
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, flexGrow: 1, justifyContent: 'center' }}>
        <Text style={styles.title}>What would you like Nearby to keep you posted about?</Text>
        <Text style={styles.subtitle}>You can fine-tune all of this later in Settings.</Text>
        <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
          {NOTIFICATION_CATEGORIES.map((c) => (
            <View key={c.column} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{c.icon} {c.label}</Text>
                <Text style={styles.hint}>{c.hint}</Text>
              </View>
              <Switch
                value={choices[c.column]}
                onValueChange={(v) => setChoices((prev) => ({ ...prev, [c.column]: v }))}
                trackColor={{ true: colors.primary, false: colors.border }}
                accessibilityLabel={`Notify me about ${c.label}`}
              />
            </View>
          ))}
        </View>
        <TouchableOpacity style={styles.button} onPress={handleContinue} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Continue">
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { ...typography.title, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, ...shadow.card,
  },
  label: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  hint: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  button: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md, alignItems: 'center', marginTop: spacing.lg },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
