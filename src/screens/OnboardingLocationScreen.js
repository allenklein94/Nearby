import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import * as Location from 'expo-location';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const OPTIONS = [
  { key: 'near_me', icon: '📍', label: 'Near me' },
  { key: 'around_city', icon: '🏙️', label: 'Around my city' },
  { key: 'traveling', icon: '🌎', label: "I'm traveling" },
];

export default function OnboardingLocationScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [requesting, setRequesting] = useState(false);

  async function handleSelect(key) {
    // Every option genuinely needs location access to actually work
    // (proximity-based discovery is the app's whole premise) — this
    // just changes what someone expects the app is being used for,
    // not whether permission gets requested.
    setRequesting(true);
    await Location.requestForegroundPermissionsAsync().catch(() => null);
    setRequesting(false);
    navigation.navigate('Login');
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Where should we start?</Text>
        <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
          {OPTIONS.map((o) => (
            <TouchableOpacity
              key={o.key}
              style={styles.option}
              onPress={() => handleSelect(o.key)}
              disabled={requesting}
              activeOpacity={0.85}
              accessibilityLabel={o.label}
              accessibilityRole="button"
            >
              <Text style={styles.optionIcon}>{o.icon}</Text>
              <Text style={styles.optionText}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  title: { ...typography.title, color: colors.textPrimary, textAlign: 'center' },
  option: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg, ...shadow.card,
  },
  optionIcon: { fontSize: 24, marginRight: spacing.md },
  optionText: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
});