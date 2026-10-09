// The chemistry diary's "add an entry" form, opened IN PLACE on the diary list (screen-reduction audit B9, owner 2026-10-09).
// It used to be two steps on two surfaces: a "Who is this entry about?" modal, then a separate ChemistryDiaryEntry screen.
// Same fields, same moderation, same private save (services/chemistryDiary.js); nothing about what is stored changed.
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { presentRecoverableError } from '../utils/recoverableError';
import { submitChemistryEntry } from '../services/chemistryDiary';
import { checkTextModeration } from '../services/textModeration';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';
import { showSuccessToast } from '../motion';

export const CHEMISTRY_SIGNALS = [
  { key: 'felt_relaxed', icon: '😌', labelKey: 'relaxed' },
  { key: 'felt_curious', icon: '🤔', labelKey: 'curious' },
  { key: 'felt_respected', icon: '🤝', labelKey: 'respected' },
  { key: 'felt_laughed', icon: '😄', labelKey: 'laughed' },
  { key: 'felt_like_myself', icon: '✨', labelKey: 'likeMyself' },
];

// initialName: the person the entry is about when it was started from their chat or profile (still editable).
export default function ChemistryEntryComposer({ initialName = '', onSaved, onCancel }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [name, setName] = useState(initialName ?? '');
  const [signals, setSignals] = useState({});
  const [noteText, setNoteText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) {
      return Alert.alert(t('ui.chemistryDiary.addAName'), t('ui.chemistryDiary.whoIsThisEntryAbout'));
    }
    if (noteText.trim()) {
      const check = await checkTextModeration(noteText);
      if (!check.safe) {
        return Alert.alert(t('ui.chemistryEntry.notAllowed'), t('ui.chemistryEntry.pleaseReviseYourNoteAnd'));
      }
    }
    setSubmitting(true);
    try {
      await submitChemistryEntry(name.trim(), signals, noteText);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      posthog.capture('chemistry_diary_entry_saved');
      showSuccessToast(t('ui.chemistryEntry.savedPrivately'), t('ui.chemistryEntry.onlyYouCanSeeThis'));
      onSaved?.();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSubmit() });
    }
    setSubmitting(false);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">{t('chemistryDiary.howDidItFeel')}</Text>
      <Text style={styles.label}>{t('ui.chemistryDiary.whoIsThisEntryAbout2')}</Text>
      <TextInput
        style={styles.nameInput}
        placeholder={t('ui.chemistryDiary.firstNameOrHoweverYoud')}
        placeholderTextColor={colors.textTertiary}
        value={name}
        onChangeText={setName}
        autoFocus={!initialName}
        accessibilityLabel={t('ui.chemistryDiary.nameA11y')}
      />
      <Text style={styles.subtitle}>{name.trim() ? t('ui.chemistryEntry.introAbout', { name: name.trim() }) : t('ui.chemistryEntry.introNoName')}</Text>
      {CHEMISTRY_SIGNALS.map((signal) => {
        const active = !!signals[signal.key];
        const label = t(`chemistryDiary.${signal.labelKey}`);
        return (
          <TouchableOpacity
            key={signal.key}
            style={[styles.signalRow, active && styles.signalRowActive]}
            onPress={() => setSignals((prev) => ({ ...prev, [signal.key]: !prev[signal.key] }))}
            activeOpacity={0.85}
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
      <Text style={styles.label}>{t('ui.chemistryEntry.anythingElseWorthNotingOptional')}</Text>
      <TextInput
        style={styles.input}
        placeholder={t('ui.chemistryEntry.whateverComesToMind')}
        placeholderTextColor={colors.textTertiary}
        value={noteText}
        onChangeText={setNoteText}
        multiline
        accessibilityLabel={t('ui.chemistryEntry.additionalNoteA11y')}
      />
      <TouchableOpacity
        style={styles.button}
        onPress={handleSubmit}
        disabled={submitting}
        activeOpacity={0.85}
        accessibilityLabel={submitting ? t('ui.chemistryEntry.savingA11y') : t('chemistryDiary.savePrivately')}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>{submitting ? t('ui.chemistryEntry.saving') : t('chemistryDiary.savePrivately')}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onCancel} style={{ marginTop: spacing.md }} accessibilityLabel={t('ui.chemistryDiary.cancelA11y')} accessibilityRole="button">
        <Text style={styles.cancelText}>{t('ui.chemistryDiary.cancel')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  card: { backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.primary },
  title: { ...typography.headline, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.sm, marginBottom: spacing.md, lineHeight: 18 },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  nameInput: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  signalRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  signalRowActive: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  signalIcon: { fontSize: 20, marginRight: spacing.sm },
  signalLabel: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 14, flex: 1 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.textTertiary, justifyContent: 'center', alignItems: 'center' },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border, minHeight: 70, textAlignVertical: 'top' },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg, ...shadow.button },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelText: { color: colors.textTertiary, textAlign: 'center', fontSize: 13 },
});
