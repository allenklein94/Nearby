import React, { useState } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { submitGoodbyeEntry } from '../services/goodbyeArchive';
import { checkTextModeration } from '../services/textModeration';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

import { showSuccessToast } from '../motion';
export default function GoodbyeArchiveEntryScreen({ route, navigation }) {
  const { aboutDisplayName } = route.params;
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [whatWasBeautiful, setWhatWasBeautiful] = useState('');
  const [whatWasDifficult, setWhatWasDifficult] = useState('');
  const [whatYouLearned, setWhatYouLearned] = useState('');
  const [whatYouWantNextTime, setWhatYouWantNextTime] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const fields = [whatWasBeautiful, whatWasDifficult, whatYouLearned, whatYouWantNextTime];
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
      await submitGoodbyeEntry(aboutDisplayName, {
        whatWasBeautiful,
        whatWasDifficult,
        whatYouLearned,
        whatYouWantNextTime,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      posthog.capture('goodbye_archive_entry_saved');
      showSuccessToast(t('ui.goodbyeArchive.savedPrivately'), t('ui.goodbyeArchive.onlyYouCanSeeThis'));
      navigation.goBack();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSubmit() });
    }
    setSubmitting(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.headerTitle} accessibilityRole="header">{t('ui.goodbyeArchive.aPrivateReflection')}</Text>
          <Text style={styles.headerSubtitle}>
            {aboutDisplayName ? t('ui.goodbyeArchive.introAbout', { name: aboutDisplayName }) : t('ui.goodbyeArchive.introNoName')}
          </Text>

          <Text style={styles.label}>{t('goodbyeArchive.whatWasBeautiful')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('ui.goodbyeArchive.eGHowEasyIt')}
            placeholderTextColor={colors.textTertiary}
            value={whatWasBeautiful}
            onChangeText={setWhatWasBeautiful}
            multiline
            accessibilityLabel={t('goodbyeArchive.whatWasBeautiful')}
          />

          <Text style={styles.label}>{t('goodbyeArchive.whatWasDifficult')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('ui.goodbyeArchive.eGWeWantedDifferent')}
            placeholderTextColor={colors.textTertiary}
            value={whatWasDifficult}
            onChangeText={setWhatWasDifficult}
            multiline
            accessibilityLabel={t('goodbyeArchive.whatWasDifficult')}
          />

          <Text style={styles.label}>{t('goodbyeArchive.whatYouLearned')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('ui.goodbyeArchive.eGINeedTo')}
            placeholderTextColor={colors.textTertiary}
            value={whatYouLearned}
            onChangeText={setWhatYouLearned}
            multiline
            accessibilityLabel={t('goodbyeArchive.whatYouLearned')}
          />

          <Text style={styles.label}>{t('goodbyeArchive.whatYouWant')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('ui.goodbyeArchive.eGSomeoneWhoShares')}
            placeholderTextColor={colors.textTertiary}
            value={whatYouWantNextTime}
            onChangeText={setWhatYouWantNextTime}
            multiline
            accessibilityLabel={t('goodbyeArchive.whatYouWant')}
          />

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