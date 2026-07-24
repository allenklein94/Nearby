import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { submitGoodbyeEntry } from '../services/goodbyeArchive';
import { checkTextModeration } from '../services/textModeration';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

export default function GoodbyeArchiveEntryScreen({ route, navigation }) {
  const { aboutDisplayName } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [whatWasBeautiful, setWhatWasBeautiful] = useState('');
  const [whatWasDifficult, setWhatWasDifficult] = useState('');
  const [whatYouLearned, setWhatYouLearned] = useState('');
  const [whatYouWantNextTime, setWhatYouWantNextTime] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const fields = [whatWasBeautiful, whatWasDifficult, whatYouLearned, whatYouWantNextTime];
    if (fields.every((f) => !f.trim())) {
      return Alert.alert('Add at least one reflection', 'Write whatever feels true — you don\u2019t need to answer all four.');
    }

    for (const field of fields) {
      if (field.trim()) {
        const check = await checkTextModeration(field);
        if (!check.safe) {
          return Alert.alert('Not allowed', 'Please revise your answer and try again.');
        }
      }
    }

    setSubmitting(true);
    try {
      await submitGoodbyeEntry(aboutDisplayName, {
        whatWasBeautiful,
        whatWasDifficult,
        whatYouLearned,
        whatYouWantNextTime,
      });
      Alert.alert('Saved privately', 'Only you can see this. It\u2019s yours whenever you want to look back.');
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
          <Text style={styles.headerTitle} accessibilityRole="header">A private reflection</Text>
          <Text style={styles.headerSubtitle}>
            About {aboutDisplayName || 'this connection'} — completely private, just for you. Every relationship, however it went, has something worth carrying forward. Answer whatever feels true; skip the rest.
          </Text>

          <Text style={styles.label}>What was beautiful</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. How easy it was to talk to them"
            placeholderTextColor={colors.textTertiary}
            value={whatWasBeautiful}
            onChangeText={setWhatWasBeautiful}
            multiline
            accessibilityLabel="What was beautiful"
          />

          <Text style={styles.label}>What was difficult</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. We wanted different things and couldn't bridge that"
            placeholderTextColor={colors.textTertiary}
            value={whatWasDifficult}
            onChangeText={setWhatWasDifficult}
            multiline
            accessibilityLabel="What was difficult"
          />

          <Text style={styles.label}>What you learned</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. I need to say what I actually want, earlier"
            placeholderTextColor={colors.textTertiary}
            value={whatYouLearned}
            onChangeText={setWhatYouLearned}
            multiline
            accessibilityLabel="What you learned"
          />

          <Text style={styles.label}>What you want next time</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Someone who shares how they're really feeling"
            placeholderTextColor={colors.textTertiary}
            value={whatYouWantNextTime}
            onChangeText={setWhatYouWantNextTime}
            multiline
            accessibilityLabel="What you want next time"
          />

          <TouchableOpacity
            style={styles.button}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.85}
            accessibilityLabel={submitting ? 'Saving' : 'Save this reflection privately'}
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
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border, minHeight: 70, textAlignVertical: 'top' },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', marginTop: spacing.xl, ...shadow.button },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});