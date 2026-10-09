import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { submitGatheringFeedback } from '../services/gatherings';
import { maybeRequestAppReview } from '../services/appReview';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

import { modalAnimation } from '../motion';
import { navigateKeepingTrail } from '../services/openDestination';
import { gatheringsTabParams } from '../utils/gatheringFilters';
const SATISFACTION_OPTIONS = [
  { value: 'loved_it', emoji: '😊', labelKey: 'lovedIt' },
  { value: 'good', emoji: '🙂', labelKey: 'good' },
  { value: 'okay', emoji: '😐', labelKey: 'okay' },
  { value: 'not_for_me', emoji: '🙁', labelKey: 'notForMe' },
];

const GREAT_BECAUSE_OPTIONS = [
  { value: 'people', labelKey: 'people' },
  { value: 'location', labelKey: 'location' },
  { value: 'activity', labelKey: 'activity' },
  { value: 'conversation', labelKey: 'conversation' },
  { value: 'host', labelKey: 'host' },
];

// "What next" chips reuse the exact category tags getQuickPrompts()
// already maps these same labels to (see timeContext.js), so tapping
// one prefills CreateGathering the same way Home's quick-action chips
// do — no new category vocabulary invented here.
const NEXT_STEP_OPTIONS = [
  { icon: '☕', labelKey: 'coffee', category: 'Coffee' },
  { icon: '🍽️', labelKey: 'dinner', category: 'Foodie' },
  { icon: '🚶', labelKey: 'anotherWalk', category: 'Outdoors' },
];

// Behavior teaches the app more than a bio ever could — this is
// deliberately asked only after someone's actually attended
// something, never before, and it's the only post-gathering prompt
// they'll see for this specific event.
export default function GatheringFeedbackModal({ visible, gatheringId, navigation, onClose }) {
  const { t } = useLanguage();
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [satisfaction, setSatisfaction] = useState(null);
  const [greatBecause, setGreatBecause] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState('rate');

  function toggleGreatBecause(value) {
    setGreatBecause((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  function handleClose() {
    setSatisfaction(null);
    setGreatBecause([]);
    setStep('rate');
    onClose();
  }

  // Skipping must actually record something -- otherwise
  // getMostRecentUnratedGathering() (services/gatherings.js) has no way
  // to know this gathering was ever asked about, and re-surfaces the
  // exact same prompt every time Home reloads (on every focus). This
  // writes a real, honest "asked, declined to rate" row -- no rating
  // fabricated -- same convention as dismissIntentOutcomePrompt()'s
  // answered_at-with-no-outcome stamp. Fire-and-forget: skipping must
  // never feel blocked on a network call, and a failed write here just
  // means the prompt may honestly resurface later, matching the "fails
  // quietly" posture already used for the real Submit path below.
  function handleSkip() {
    submitGatheringFeedback(gatheringId).catch((e) => console.error('Failed to record feedback skip', e));
    handleClose();
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await submitGatheringFeedback(gatheringId, { satisfactionRating: satisfaction, greatBecause });
    } catch (e) {
      console.error('Failed to submit gathering feedback', e);
      // Fails quietly — this is a preference signal, not something
      // worth blocking or alarming someone over if it doesn't save.
    }
    setSubmitting(false);
    // A real, clearly high-satisfaction moment — the one honest place
    // in this app to ask for an App Store rating (see CLAUDE.md item 14).
    if (satisfaction === 'loved_it') {
      maybeRequestAppReview();
    }
    // Only worth asking "what's next" if we actually have somewhere
    // useful to send them (navigation) — otherwise just close, same
    // as before this was added.
    if (navigation) {
      setStep('next');
    } else {
      handleClose();
    }
  }

  function handleNextStep(option) {
    handleClose();
    navigation.navigate('CreateGathering', { quickStartTitle: t(`ui.gatheringParts.${option.labelKey}`), quickStartCategory: option.category });
  }

  function handleJoinNextWeek() {
    handleClose();
    navigateKeepingTrail(navigation, 'Discover', gatheringsTabParams());
  }

  if (step === 'next') {
    return (
      <Modal visible={visible} animationType={modalAnimation('slide')} transparent onRequestClose={handleClose}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.title}>{t('ui.gatheringParts.anythingYoudLikeToDo')}</Text>
            <View style={styles.chipsWrap}>
              {NEXT_STEP_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.category}
                  style={styles.chip}
                  onPress={() => handleNextStep(o)}
                  accessibilityLabel={t(`ui.gatheringParts.${o.labelKey}`)}
                  accessibilityRole="button"
                >
                  <Text style={styles.chipText}>{o.icon} {t(`ui.gatheringParts.${o.labelKey}`)}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.chip}
                onPress={handleJoinNextWeek}
                accessibilityLabel={t('ui.gatheringParts.joinAGatheringNextWeekA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.chipText}>{t('ui.gatheringParts.joinNextWeek')}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={handleClose} style={{ marginTop: spacing.lg }} accessibilityLabel={t('ui.gatheringParts.notNowA11y')} accessibilityRole="button">
              <Text style={styles.skipText}>{t('ui.gatheringParts.notNow')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType={modalAnimation('slide')} transparent onRequestClose={handleSkip}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{t('ui.gatheringParts.howWasIt')}</Text>
          <View style={styles.satisfactionRow}>
            {SATISFACTION_OPTIONS.map((o) => {
              const selected = satisfaction === o.value;
              return (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.satisfactionOption, selected && styles.satisfactionOptionSelected]}
                  onPress={() => setSatisfaction(o.value)}
                  accessibilityLabel={t(`ui.gatheringParts.${o.labelKey}`)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={styles.satisfactionEmoji}>{o.emoji}</Text>
                  <Text style={styles.satisfactionLabel}>{t(`ui.gatheringParts.${o.labelKey}`)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {satisfaction && (
            <>
              <Text style={styles.subtitle}>{t('ui.gatheringParts.whatMadeItGreat')}</Text>
              <View style={styles.chipsWrap}>
                {GREAT_BECAUSE_OPTIONS.map((o) => {
                  const selected = greatBecause.includes(o.value);
                  return (
                    <TouchableOpacity
                      key={o.value}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => toggleGreatBecause(o.value)}
                      accessibilityLabel={t(`ui.gatheringParts.${o.labelKey}`)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{t(`ui.gatheringParts.${o.labelKey}`)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          <TouchableOpacity
            style={[styles.submitButton, !satisfaction && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!satisfaction || submitting}
            activeOpacity={0.85}
            accessibilityLabel={submitting ? t('ui.gatheringParts.submittingA11y') : t('ui.gatheringParts.submitA11y')}
            accessibilityRole="button"
          >
            <Text style={styles.submitButtonText}>{submitting ? t('ui.gatheringParts.submitting') : t('ui.gatheringParts.submit')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSkip} style={{ marginTop: spacing.sm }} accessibilityLabel={t('ui.gatheringParts.skipA11y')} accessibilityRole="button">
            <Text style={styles.skipText}>{t('ui.gatheringParts.skip')}</Text>
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
  submitButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xl, ...shadow.button },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  skipText: { color: colors.textTertiary, textAlign: 'center', fontSize: 14 },
});