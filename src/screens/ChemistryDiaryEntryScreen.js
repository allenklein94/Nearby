import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { submitChemistryEntry } from '../services/chemistryDiary';
import { checkTextModeration } from '../services/textModeration';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const SIGNALS = [
  { key: 'felt_relaxed', icon: '😌', label: 'Did I feel relaxed?' },
  { key: 'felt_curious', icon: '🤔', label: 'Did I feel curious?' },
  { key: 'felt_respected', icon: '🤝', label: 'Did I feel respected?' },
  { key: 'felt_laughed', icon: '😄', label: 'Did I laugh?' },
  { key: 'felt_like_myself', icon: '✨', label: 'Did I feel like myself?' },
];

export default function ChemistryDiaryEntryScreen({ route, navigation }) {
  const { aboutDisplayName } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [signals, setSignals] = useState({});
  const [noteText, setNoteText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function toggleSignal(key) {
    setSignals((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSubmit() {
    if (noteText.trim()) {
      const check = await checkTextModeration(noteText);
      if (!check.safe) {
        return Alert.alert('Not allowed', 'Please revise your note and try again.');
      }
    }

    setSubmitting(true);
    try {
      await submitChemistryEntry(aboutDisplayName, signals, noteText);
      Alert.alert('Saved privately', 'Only you can see this — it helps build a picture of what actually feels good to you over time.');
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSubmitting(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.headerTitle} accessibilityRole="header">How did that feel?</Text>
          <Text style={styles.headerSubtitle}>
            About time with {aboutDisplayName || 'them'} — completely private. Just your own honest answers, nothing analyzed or shown to anyone.
          </Text>

          {SIGNALS.map((signal) => {
            const active = !!signals[signal.key];
            return (
              <TouchableOpacity
                key={signal.key}
                style={[styles.signalRow, active && styles.signalRowActive]}
                onPress={() => toggleSignal(signal.key)}
                activeOpacity={0.8}
                accessibilityLabel={signal.label}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
              >
                <Text style={styles.signalIcon}>{signal.icon}</Text>
                <Text style={styles.signalLabel}>{signal.label}</Text>
                <View style={[styles.checkbox, active && styles.checkboxChecked]}>
                  {active && <Text style={styles.checkmark}>✓</Text>}
                </View>
              </TouchableOpacity>
            );
          })}

          <Text style={styles.label}>Anything else worth noting (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Whatever comes to mind..."
            placeholderTextColor={colors.textTertiary}
            value={noteText}
            onChangeText={setNoteText}
            multiline
            accessibilityLabel="Additional note"
          />

          <TouchableOpacity
            style={styles.button}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.85}
            accessibilityLabel={submitting ? 'Saving' : 'Save privately'}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{submitting ? 'Saving...' : 'Save Privately'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  signalRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  signalRowActive: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  signalIcon: { fontSize: 20, marginRight: spacing.sm },
  signalLabel: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 14, flex: 1 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.textTertiary,
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.lg },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border, minHeight: 70, textAlignVertical: 'top' },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', marginTop: spacing.xl, ...shadow.button },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});