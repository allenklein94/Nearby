import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { submitGatheringFeedback } from '../services/gatherings';
import { maybeRequestAppReview } from '../services/appReview';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { navigateKeepingTrail } from '../services/openDestination';
import { gatheringsTabParams } from '../utils/gatheringFilters';
import { SATISFACTION_SCALE } from '../constants/satisfactionScale';

// Owner item 34 (2026-10-11): the ONE post-gathering "How was it?", asked inline on the completed plan card in Home's Your Plans
// (utils/gatheringCompletion.js), never in a pop-up. It replaced GatheringFeedbackModal (which opened over Home on its own) and
// keeps everything it did: the shared four-option scale, "What made it great?", the same gathering_feedback row, the App
// Store prompt only after "Loved it", and the "what's next" chips. Asked only after someone actually attended something.
// Skip must record something: an honest "asked, declined to rate" row (no rating invented), otherwise
// getMostRecentUnratedGathering() would offer the same card on every Home focus. Saving fails quietly (a preference signal).

const GREAT_BECAUSE_OPTIONS = [
  { value: 'people', labelKey: 'people' },
  { value: 'location', labelKey: 'location' },
  { value: 'activity', labelKey: 'activity' },
  { value: 'conversation', labelKey: 'conversation' },
  { value: 'host', labelKey: 'host' },
];

// "What next" chips reuse the exact category tags getQuickPrompts() already maps these same labels to (timeContext.js), so
// tapping one prefills CreateGathering the same way Home's quick-action chips do; no new category vocabulary.
const NEXT_STEP_OPTIONS = [
  { icon: '☕', labelKey: 'coffee', category: 'Coffee' },
  { icon: '🍽️', labelKey: 'dinner', category: 'Foodie' },
  { icon: '🚶', labelKey: 'anotherWalk', category: 'Outdoors' },
];

export default function GatheringFeedbackInline({ gatheringId, navigation, onDone }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [satisfaction, setSatisfaction] = useState(null);
  const [greatBecause, setGreatBecause] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState('rate');

  function toggleGreatBecause(value) {
    setGreatBecause((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  // Fire-and-forget: skipping never waits on the network; a failed write only means the card may honestly come back.
  function handleSkip() {
    submitGatheringFeedback(gatheringId).catch((e) => console.error('Failed to record feedback skip', e));
    onDone();
  }

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await submitGatheringFeedback(gatheringId, { satisfactionRating: satisfaction, greatBecause });
    } catch (e) {
      console.error('Failed to submit gathering feedback', e);
    }
    setSubmitting(false);
    // A real, clearly high-satisfaction moment: the one honest place to ask for an App Store rating (CLAUDE.md item 14).
    if (satisfaction === 'loved_it') maybeRequestAppReview();
    if (navigation) setStep('next');
    else onDone();
  }

  function handleNextStep(option) {
    onDone();
    navigation.navigate('CreateGathering', { quickStartTitle: t(`ui.gatheringParts.${option.labelKey}`), quickStartCategory: option.category });
  }

  function handleJoinNextWeek() {
    onDone();
    navigateKeepingTrail(navigation, 'Discover', gatheringsTabParams());
  }

  if (step === 'next') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>{t('ui.gatheringParts.anythingYoudLikeToDo')}</Text>
        <View style={styles.chipsWrap}>
          {NEXT_STEP_OPTIONS.map((o) => (
            <TouchableOpacity key={o.category} style={styles.chip} onPress={() => handleNextStep(o)} accessibilityLabel={t(`ui.gatheringParts.${o.labelKey}`)} accessibilityRole="button">
              <Text style={styles.chipText}>{o.icon} {t(`ui.gatheringParts.${o.labelKey}`)}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.chip} onPress={handleJoinNextWeek} accessibilityLabel={t('ui.gatheringParts.joinAGatheringNextWeekA11y')} accessibilityRole="button">
            <Text style={styles.chipText}>{t('ui.gatheringParts.joinNextWeek')}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={onDone} style={styles.quietLink} accessibilityLabel={t('ui.gatheringParts.notNowA11y')} accessibilityRole="button">
          <Text style={styles.quietText}>{t('ui.gatheringParts.notNow')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t('ui.gatheringParts.howWasIt')}</Text>
      <View style={styles.satisfactionRow}>
        {SATISFACTION_SCALE.map((o) => {
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

      <View style={styles.actions}>
        <TouchableOpacity onPress={handleSkip} style={styles.quietLink} accessibilityLabel={t('ui.gatheringParts.skipA11y')} accessibilityRole="button">
          <Text style={styles.quietText}>{t('ui.gatheringParts.skip')}</Text>
        </TouchableOpacity>
        {satisfaction && (
          <TouchableOpacity
            style={styles.submitButton}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.85}
            accessibilityLabel={submitting ? t('ui.gatheringParts.submittingA11y') : t('ui.gatheringParts.submitA11y')}
            accessibilityRole="button"
          >
            <Text style={styles.submitButtonText}>{submitting ? t('ui.gatheringParts.submitting') : t('ui.gatheringParts.submit')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  wrap: { paddingTop: spacing.sm, paddingBottom: spacing.xs },
  title: { ...typography.bodyBold, color: colors.textPrimary, marginBottom: spacing.sm },
  satisfactionRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.xs },
  satisfactionOption: { flex: 1, alignItems: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm },
  satisfactionOptionSelected: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  satisfactionEmoji: { fontSize: 22, marginBottom: 2 },
  satisfactionLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', textAlign: 'center' },
  subtitle: { ...typography.bodyBold, color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.sm },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipSelected: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  chipTextSelected: { color: colors.primary },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  submitButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  submitButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  quietLink: { paddingVertical: spacing.sm, paddingRight: spacing.md },
  quietText: { color: colors.textTertiary, fontSize: 14 },
});
