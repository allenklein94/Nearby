import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput } from 'react-native';
import { submitOfferOutcome } from '../services/businessFulfillment';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

import { modalAnimation } from '../motion';
// Same four-option scale GatheringFeedbackModal already established --
// deliberately not a new star-rating invented for this, per direct
// instruction to mirror the existing shape rather than build a second one.
const SATISFACTION_OPTIONS = [
  { value: 'loved_it', emoji: '😊' },
  { value: 'good', emoji: '🙂' },
  { value: 'okay', emoji: '😐' },
  { value: 'not_for_me', emoji: '🙁' },
];

// "Good match?": did what Nearby found actually fit what they asked for. Optional, so it never slows the two core answers.
const MATCH_OPTIONS = [
  { value: 'yes' },
  { value: 'somewhat' },
  { value: 'no' },
];

const REPEAT_OPTIONS = [
  { value: 'yes' },
  { value: 'maybe' },
  { value: 'no' },
];

// The real, missing step at the end of the Request -> Offer -> Commitment
// -> Fulfillment loop (see CLAUDE.md, Offer System, "Outcome" node) --
// asked only once complete_business_reservation() has genuinely fired.
// Deliberately lightweight and private, not a public review platform: the
// free text and per-person answers are never shown to the business, only
// the aggregate satisfaction/would-repeat percentages
// get_partner_offer_reputation() computes from rows across every
// requester.
export default function OfferOutcomeModal({ visible, offerId, onClose }) {
  const { t } = useLanguage();
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [satisfaction, setSatisfaction] = useState(null);
  const [wouldRepeat, setWouldRepeat] = useState(null);
  const [matchFit, setMatchFit] = useState(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handleClose() {
    setSatisfaction(null);
    setWouldRepeat(null);
    setMatchFit(null);
    setFeedbackText('');
    onClose();
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await submitOfferOutcome(offerId, { satisfactionRating: satisfaction, wouldRepeat, matchFit, feedbackText: feedbackText.trim() || null });
    } catch (e) {
      console.error('Failed to submit offer outcome', e);
      // Fails quietly, same philosophy as GatheringFeedbackModal -- this
      // is a private signal, not something worth alarming someone over.
    }
    setSubmitting(false);
    handleClose();
  }

  const canSubmit = !!satisfaction && !!wouldRepeat;

  return (
    <Modal visible={visible} animationType={modalAnimation('slide')} transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{t('ui.requestDetail.howDidItGo')}</Text>
          <View style={styles.satisfactionRow}>
            {SATISFACTION_OPTIONS.map((o) => {
              const selected = satisfaction === o.value;
              return (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.satisfactionOption, selected && styles.satisfactionOptionSelected]}
                  onPress={() => setSatisfaction(o.value)}
                  accessibilityLabel={t(`ui.requestDetail.outcome.satisfaction.${o.value}`)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={styles.satisfactionEmoji}>{o.emoji}</Text>
                  <Text style={styles.satisfactionLabel}>{t(`ui.requestDetail.outcome.satisfaction.${o.value}`)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.subtitle}>{t('ui.requestDetail.wouldYouDoThisAgain')}</Text>
          <View style={styles.chipsWrap}>
            {REPEAT_OPTIONS.map((o) => {
              const selected = wouldRepeat === o.value;
              return (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setWouldRepeat(o.value)}
                  accessibilityLabel={t(`ui.requestDetail.outcome.repeat.${o.value}`)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{t(`ui.requestDetail.outcome.repeat.${o.value}`)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.subtitle}>{t('ui.requestDetail.wasItAGoodMatch')}</Text>
          <View style={styles.chipsWrap}>
            {MATCH_OPTIONS.map((o) => {
              const selected = matchFit === o.value;
              return (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setMatchFit(selected ? null : o.value)}
                  accessibilityLabel={t('ui.requestDetail.goodMatchA11y', { label: t(`ui.requestDetail.outcome.match.${o.value}`) })}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{t(`ui.requestDetail.outcome.match.${o.value}`)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.subtitle}>{t('ui.requestDetail.anythingThatWouldHelpNext')}</Text>
          <TextInput
            style={styles.input}
            value={feedbackText}
            onChangeText={setFeedbackText}
            placeholder={t('ui.requestDetail.tellUsAnythingThatWould')}
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={500}
          />

          <TouchableOpacity
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit || submitting}
            activeOpacity={0.85}
            accessibilityLabel={submitting ? t('ui.requestDetail.submittingA11y') : t('ui.requestDetail.submitA11y')}
            accessibilityRole="button"
          >
            <Text style={styles.submitButtonText}>{submitting ? t('ui.requestDetail.submitting') : t('ui.requestDetail.submit')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleClose} style={{ marginTop: spacing.sm }} accessibilityLabel={t('ui.requestDetail.skipA11y')} accessibilityRole="button">
            <Text style={styles.skipText}>{t('ui.requestDetail.skip')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.lg, textAlign: 'center' },
  satisfactionRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.xs },
  satisfactionOption: { flex: 1, alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md },
  satisfactionOptionSelected: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  satisfactionEmoji: { fontSize: 26, marginBottom: 4 },
  satisfactionLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', textAlign: 'center' },
  subtitle: { ...typography.bodyBold, color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  chipSelected: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  chipTextSelected: { color: colors.primary },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm, color: colors.textPrimary, minHeight: 60, textAlignVertical: 'top',
  },
  submitButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xl, ...shadow.button },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  skipText: { color: colors.textTertiary, textAlign: 'center', fontSize: 14 },
});
