import React, { useState } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { submitLegacyEntry } from '../services/relationshipLegacy';
import { checkTextModeration } from '../services/textModeration';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

export default function RelationshipLegacyScreen({ route, navigation }) {
  const { matchId, matchName } = route.params;
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [whatSurprisedUs, setWhatSurprisedUs] = useState('');
  const [whatAlmostEndedUs, setWhatAlmostEndedUs] = useState('');
  const [whatMadeUsStronger, setWhatMadeUsStronger] = useState('');
  const [whatWeWishWeDiscussedEarlier, setWhatWeWishWeDiscussedEarlier] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const fields = [whatSurprisedUs, whatAlmostEndedUs, whatMadeUsStronger, whatWeWishWeDiscussedEarlier];
    if (fields.every((f) => !f.trim())) {
      return Alert.alert(t('ui.relationshipLegacy.addAtLeastOneAnswer'), t('ui.relationshipLegacy.shareWhateverFeelsTrueYou'));
    }

    for (const field of fields) {
      if (field.trim()) {
        const check = await checkTextModeration(field);
        if (!check.safe) {
          return Alert.alert(t('ui.relationshipLegacy.notAllowed'), t('ui.relationshipLegacy.pleaseReviseYourAnswerAnd'));
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
     Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      posthog.capture('relationship_legacy_submitted');
      Alert.alert(t('ui.relationshipLegacy.thankYou'), t('ui.relationshipLegacy.yourWisdomIsNowPart'));
      navigation.goBack();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSubmit() });
    }
    setSubmitting(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.headerTitle} accessibilityRole="header">💌 {t('legacyLibrary.leaveWisdom')}</Text>
          <Text style={styles.headerSubtitle}>{t('ui.relationshipLegacy.anythingYouAndHaveLearned', { matchName: matchName })}</Text>

          <TouchableOpacity
            style={styles.libraryLink}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('LegacyLibrary')}
            accessibilityRole="button"
            accessibilityLabel={t('ui.relationshipLegacy.browseWhatOtherCouplesHaveA11y')}
          >
            <Text style={styles.libraryLinkText}>{t('ui.relationshipLegacy.seeWhatOthersHaveShared')}</Text>
          </TouchableOpacity>

          <Text style={styles.label}>{t('ui.relationshipLegacy.whatSurprisedUs')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('ui.relationshipLegacy.eGHowMuchWe')}
            placeholderTextColor={colors.textTertiary}
            value={whatSurprisedUs}
            onChangeText={setWhatSurprisedUs}
            multiline
            accessibilityLabel={t('ui.relationshipLegacy.whatSurprisedUsA11y')}
          />

          <Text style={styles.label}>{t('ui.relationshipLegacy.whatAlmostEndedUs')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('ui.relationshipLegacy.eGNotTalkingAbout')}
            placeholderTextColor={colors.textTertiary}
            value={whatAlmostEndedUs}
            onChangeText={setWhatAlmostEndedUs}
            multiline
            accessibilityLabel={t('ui.relationshipLegacy.whatAlmostEndedUsA11y')}
          />

          <Text style={styles.label}>{t('ui.relationshipLegacy.whatMadeUsStronger')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('ui.relationshipLegacy.eGLearningToActually')}
            placeholderTextColor={colors.textTertiary}
            value={whatMadeUsStronger}
            onChangeText={setWhatMadeUsStronger}
            multiline
            accessibilityLabel={t('ui.relationshipLegacy.whatMadeUsStrongerA11y')}
          />

          <Text style={styles.label}>{t('ui.relationshipLegacy.whatWeWishWedDiscussed')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('ui.relationshipLegacy.eGWhatWeEach')}
            placeholderTextColor={colors.textTertiary}
            value={whatWeWishWeDiscussedEarlier}
            onChangeText={setWhatWeWishWeDiscussedEarlier}
            multiline
            accessibilityLabel={t('ui.relationshipLegacy.whatWeWishWedDiscussedA11y')}
          />

          <TouchableOpacity
            style={styles.button}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.85}
            accessibilityLabel={submitting ? t('ui.relationshipLegacy.submittingA11y') : t('ui.relationshipLegacy.shareThisWisdomA11y')}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{submitting ? t('ui.relationshipLegacy.sharing') : t('ui.relationshipLegacy.shareThisWisdom')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.md, lineHeight: 18 },
  libraryLink: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  libraryLinkText: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border, minHeight: 70, textAlignVertical: 'top' },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', marginTop: spacing.xl, ...shadow.button },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});