import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { submitLegacyEntry } from '../services/relationshipLegacy';
import { checkTextModeration } from '../services/textModeration';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

export default function RelationshipLegacyScreen({ route, navigation }) {
  const { matchId, matchName } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [whatSurprisedUs, setWhatSurprisedUs] = useState('');
  const [whatAlmostEndedUs, setWhatAlmostEndedUs] = useState('');
  const [whatMadeUsStronger, setWhatMadeUsStronger] = useState('');
  const [whatWeWishWeDiscussedEarlier, setWhatWeWishWeDiscussedEarlier] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const fields = [whatSurprisedUs, whatAlmostEndedUs, whatMadeUsStronger, whatWeWishWeDiscussedEarlier];
    if (fields.every((f) => !f.trim())) {
      return Alert.alert('Add at least one answer', 'Share whatever feels true — you don\u2019t need to answer all four.');
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
      await submitLegacyEntry(matchId, {
        whatSurprisedUs,
        whatAlmostEndedUs,
        whatMadeUsStronger,
        whatWeWishWeDiscussedEarlier,
      });
      Alert.alert('Thank you', 'Your wisdom is now part of the library for others to learn from.');
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
          <Text style={styles.headerTitle} accessibilityRole="header">💌 Leave Some Wisdom</Text>
          <Text style={styles.headerSubtitle}>
            Anything you and {matchName} have learned together — shared publicly and anonymously to help others navigate their own relationships. Answer whatever feels true; skip the rest.
          </Text>

          <Text style={styles.label}>What surprised us</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. How much we laughed at things that weren't even that funny"
            placeholderTextColor={colors.textTertiary}
            value={whatSurprisedUs}
            onChangeText={setWhatSurprisedUs}
            multiline
            accessibilityLabel="What surprised us"
          />

          <Text style={styles.label}>What almost ended us</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Not talking about money early enough"
            placeholderTextColor={colors.textTertiary}
            value={whatAlmostEndedUs}
            onChangeText={setWhatAlmostEndedUs}
            multiline
            accessibilityLabel="What almost ended us"
          />

          <Text style={styles.label}>What made us stronger</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Learning to actually say what we needed"
            placeholderTextColor={colors.textTertiary}
            value={whatMadeUsStronger}
            onChangeText={setWhatMadeUsStronger}
            multiline
            accessibilityLabel="What made us stronger"
          />

          <Text style={styles.label}>What we wish we'd discussed earlier</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. What we each actually wanted long-term"
            placeholderTextColor={colors.textTertiary}
            value={whatWeWishWeDiscussedEarlier}
            onChangeText={setWhatWeWishWeDiscussedEarlier}
            multiline
            accessibilityLabel="What we wish we'd discussed earlier"
          />

          <TouchableOpacity
            style={styles.button}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.85}
            accessibilityLabel={submitting ? 'Submitting' : 'Share this wisdom'}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{submitting ? 'Sharing...' : 'Share This Wisdom'}</Text>
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