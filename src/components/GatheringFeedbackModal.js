import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { submitGatheringFeedback } from '../services/gatherings';
import { maybeRequestAppReview } from '../services/appReview';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

const SATISFACTION_OPTIONS = [
  { value: 'loved_it', emoji: '😊', label: 'Loved it' },
  { value: 'good', emoji: '🙂', label: 'Good' },
  { value: 'okay', emoji: '😐', label: 'Okay' },
  { value: 'not_for_me', emoji: '🙁', label: 'Not for me' },
];

const GREAT_BECAUSE_OPTIONS = [
  { value: 'people', label: 'People' },
  { value: 'location', label: 'Location' },
  { value: 'activity', label: 'Activity' },
  { value: 'conversation', label: 'Conversation' },
  { value: 'host', label: 'Host' },
];

// "What next" chips reuse the exact category tags getQuickPrompts()
// already maps these same labels to (see timeContext.js), so tapping
// one prefills CreateGathering the same way Home's quick-action chips
// do — no new category vocabulary invented here.
const NEXT_STEP_OPTIONS = [
  { icon: '☕', label: 'Coffee', category: 'Coffee' },
  { icon: '🍽️', label: 'Dinner', category: 'Foodie' },
  { icon: '🚶', label: 'Another walk', category: 'Outdoors' },
];

// Behavior teaches the app more than a bio ever could — this is
// deliberately asked only after someone's actually attended
// something, never before, and it's the only post-gathering prompt
// they'll see for this specific event.
export default function GatheringFeedbackModal({ visible, gatheringId, navigation, onClose }) {
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
    navigation.navigate('CreateGathering', { quickStartTitle: option.label, quickStartCategory: option.category });
  }

  function handleJoinNextWeek() {
    handleClose();
    navigation.navigate('Gatherings');
  }

  if (step === 'next') {
    return (
      <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Anything you'd like to do next?</Text>
            <View style={styles.chipsWrap}>
              {NEXT_STEP_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.label}
                  style={styles.chip}
                  onPress={() => handleNextStep(o)}
                  accessibilityLabel={o.label}
                  accessibilityRole="button"
                >
                  <Text style={styles.chipText}>{o.icon} {o.label}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.chip}
                onPress={handleJoinNextWeek}
                accessibilityLabel="Join a gathering next week"
                accessibilityRole="button"
              >
                <Text style={styles.chipText}>📅 Join next week</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={handleClose} style={{ marginTop: spacing.lg }} accessibilityLabel="Not now" accessibilityRole="button">
              <Text style={styles.skipText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>How was it?</Text>
          <View style={styles.satisfactionRow}>
            {SATISFACTION_OPTIONS.map((o) => {
              const selected = satisfaction === o.value;
              return (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.satisfactionOption, selected && styles.satisfactionOptionSelected]}
                  onPress={() => setSatisfaction(o.value)}
                  accessibilityLabel={o.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={styles.satisfactionEmoji}>{o.emoji}</Text>
                  <Text style={styles.satisfactionLabel}>{o.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {satisfaction && (
            <>
              <Text style={styles.subtitle}>What made it great?</Text>
              <View style={styles.chipsWrap}>
                {GREAT_BECAUSE_OPTIONS.map((o) => {
                  const selected = greatBecause.includes(o.value);
                  return (
                    <TouchableOpacity
                      key={o.value}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => toggleGreatBecause(o.value)}
                      accessibilityLabel={o.label}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
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
            accessibilityLabel={submitting ? 'Submitting' : 'Submit'}
            accessibilityRole="button"
          >
            <Text style={styles.submitButtonText}>{submitting ? 'Submitting...' : 'Submit'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleClose} style={{ marginTop: spacing.sm }} accessibilityLabel="Skip" accessibilityRole="button">
            <Text style={styles.skipText}>Skip</Text>
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