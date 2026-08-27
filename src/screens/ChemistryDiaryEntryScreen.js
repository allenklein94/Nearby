import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { submitChemistryEntry } from '../services/chemistryDiary';
import { checkTextModeration } from '../services/textModeration';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const SIGNALS = [
  { key: 'felt_relaxed', icon: '😌', labelKey: 'relaxed' },
  { key: 'felt_curious', icon: '🤔', labelKey: 'curious' },
  { key: 'felt_respected', icon: '🤝', labelKey: 'respected' },
  { key: 'felt_laughed', icon: '😄', labelKey: 'laughed' },
  { key: 'felt_like_myself', icon: '✨', labelKey: 'likeMyself' },
];

export default function ChemistryDiaryEntryScreen({ route, navigation }) {
  const { aboutDisplayName } = route.params;
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [signals, setSignals] = useState({});
  const [noteText, setNoteText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef(null);

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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      posthog.capture('chemistry_diary_entry_saved');
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
        <ScrollView ref={scrollRef} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
          <Text style={styles.headerTitle} accessibilityRole="header">{t('chemistryDiary.howDidItFeel')}</Text>
          <Text style={styles.headerSubtitle}>
            About time with {aboutDisplayName || 'them'} — completely private. Just your own honest answers, nothing analyzed or shown to anyone.
          </Text>

          {SIGNALS.map((signal) => {
            const active = !!signals[signal.key];
            const label = t(`chemistryDiary.${signal.labelKey}`);
            return (
              <TouchableOpacity
                key={signal.key}
                style={[styles.signalRow, active && styles.signalRowActive]}
                onPress={() => toggleSignal(signal.key)}
                activeOpacity={0.8}
                accessibilityLabel={label}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
              >
                <Text style={styles.signalIcon}>{signal.icon}</Text>
                <Text style={styles.signalLabel}>{label}</Text>
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
            // The 5 signal rows above push this note field (and the Save
            // button right after it) far enough down that the keyboard
            // covered both once focused, with nothing scrolling them back
            // into view -- KeyboardAvoidingView's "padding" behavior only
            // resizes the container, it doesn't auto-scroll a nested
            // ScrollView's focused child. Since this input and Save are
            // the last two things on the screen, scrolling to the very
            // end on focus is exactly the fix.
            onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80)}
            accessibilityLabel="Additional note"
          />

          <TouchableOpacity
            style={styles.button}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.85}
            accessibilityLabel={submitting ? 'Saving' : t('chemistryDiary.savePrivately')}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{submitting ? 'Saving...' : t('chemistryDiary.savePrivately')}</Text>
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