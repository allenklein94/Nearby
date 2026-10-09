// The goodbye archive's "add a reflection" form, opened IN PLACE on the archive list (screen-reduction audit B9, owner
// 2026-10-09). It used to be a "Who is this about?" modal followed by a separate GoodbyeArchiveEntry screen. Same four
// questions, same moderation, same private save (services/goodbyeArchive.js).
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { presentRecoverableError } from '../utils/recoverableError';
import { submitGoodbyeEntry } from '../services/goodbyeArchive';
import { checkTextModeration } from '../services/textModeration';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';
import { showSuccessToast } from '../motion';

const QUESTIONS = [
  { key: 'whatWasBeautiful', labelKey: 'goodbyeArchive.whatWasBeautiful', placeholderKey: 'ui.goodbyeArchive.eGHowEasyIt' },
  { key: 'whatWasDifficult', labelKey: 'goodbyeArchive.whatWasDifficult', placeholderKey: 'ui.goodbyeArchive.eGWeWantedDifferent' },
  { key: 'whatYouLearned', labelKey: 'goodbyeArchive.whatYouLearned', placeholderKey: 'ui.goodbyeArchive.eGINeedTo' },
  { key: 'whatYouWantNextTime', labelKey: 'goodbyeArchive.whatYouWant', placeholderKey: 'ui.goodbyeArchive.eGSomeoneWhoShares' },
];

export default function GoodbyeEntryComposer({ initialName = '', onSaved, onCancel }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [name, setName] = useState(initialName ?? '');
  const [answers, setAnswers] = useState({ whatWasBeautiful: '', whatWasDifficult: '', whatYouLearned: '', whatYouWantNextTime: '' });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) {
      return Alert.alert(t('ui.goodbyeArchive.addAName'), t('ui.goodbyeArchive.whoIsThisReflectionAbout'));
    }
    const fields = Object.values(answers);
    if (fields.every((f) => !f.trim())) {
      return Alert.alert(t('ui.goodbyeArchive.addAtLeastOneReflection'), t('ui.goodbyeArchive.writeWhateverFeelsTrueYou'));
    }
    for (const field of fields) {
      if (field.trim()) {
        const check = await checkTextModeration(field);
        if (!check.safe) {
          return Alert.alert(t('ui.goodbyeArchive.notAllowed'), t('ui.goodbyeArchive.pleaseReviseYourAnswerAnd'));
        }
      }
    }
    setSubmitting(true);
    try {
      await submitGoodbyeEntry(name.trim(), answers);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      posthog.capture('goodbye_archive_entry_saved');
      showSuccessToast(t('ui.goodbyeArchive.savedPrivately'), t('ui.goodbyeArchive.onlyYouCanSeeThis'));
      onSaved?.();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSubmit() });
    }
    setSubmitting(false);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">{t('ui.goodbyeArchive.aPrivateReflection')}</Text>
      <Text style={styles.label}>{t('goodbyeArchive.whoIsThisAbout')}</Text>
      <TextInput
        style={styles.nameInput}
        placeholder={t('ui.goodbyeArchive.firstNameOrHoweverYoud')}
        placeholderTextColor={colors.textTertiary}
        value={name}
        onChangeText={setName}
        autoFocus={!initialName}
        accessibilityLabel={t('ui.goodbyeArchive.nameA11y')}
      />
      <Text style={styles.subtitle}>{name.trim() ? t('ui.goodbyeArchive.introAbout', { name: name.trim() }) : t('ui.goodbyeArchive.introNoName')}</Text>
      {QUESTIONS.map((q) => (
        <View key={q.key}>
          <Text style={styles.label}>{t(q.labelKey)}</Text>
          <TextInput
            style={styles.input}
            placeholder={t(q.placeholderKey)}
            placeholderTextColor={colors.textTertiary}
            value={answers[q.key]}
            onChangeText={(v) => setAnswers((prev) => ({ ...prev, [q.key]: v }))}
            multiline
            accessibilityLabel={t(q.labelKey)}
          />
        </View>
      ))}
      <TouchableOpacity
        style={styles.button}
        onPress={handleSubmit}
        disabled={submitting}
        activeOpacity={0.85}
        accessibilityLabel={submitting ? t('ui.goodbyeArchive.savingA11y') : t('ui.goodbyeArchive.saveThisReflectionPrivatelyA11y')}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>{submitting ? t('ui.goodbyeArchive.saving') : t('ui.goodbyeArchive.savePrivately')}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onCancel} style={{ marginTop: spacing.md }} accessibilityLabel={t('ui.goodbyeArchive.cancelA11y')} accessibilityRole="button">
        <Text style={styles.cancelText}>{t('ui.goodbyeArchive.cancel')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  card: { backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.primary },
  title: { ...typography.headline, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.sm, lineHeight: 18 },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  nameInput: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border, minHeight: 70, textAlignVertical: 'top' },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg, ...shadow.button },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelText: { color: colors.textTertiary, textAlign: 'center', fontSize: 13 },
});
