import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput } from 'react-native';
import { submitOfferOutcome } from '../services/businessFulfillment';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// Same four-option scale GatheringFeedbackModal already established --
// deliberately not a new star-rating invented for this, per direct
// instruction to mirror the existing shape rather than build a second one.
const SATISFACTION_OPTIONS = [
  { value: 'loved_it', emoji: '😊', label: 'Loved it' },
  { value: 'good', emoji: '🙂', label: 'Good' },
  { value: 'okay', emoji: '😐', label: 'Okay' },
  { value: 'not_for_me', emoji: '🙁', label: 'Not for me' },
];

const REPEAT_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'no', label: 'No' },
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
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [satisfaction, setSatisfaction] = useState(null);
  const [wouldRepeat, setWouldRepeat] = useState(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handleClose() {
    setSatisfaction(null);
    setWouldRepeat(null);
    setFeedbackText('');
    onClose();
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await submitOfferOutcome(offerId, { satisfactionRating: satisfaction, wouldRepeat, feedbackText: feedbackText.trim() || null });
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>How did it go?</Text>
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

          <Text style={styles.subtitle}>Would you do this again?</Text>
          <View style={styles.chipsWrap}>
            {REPEAT_OPTIONS.map((o) => {
              const selected = wouldRepeat === o.value;
              return (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setWouldRepeat(o.value)}
                  accessibilityLabel={o.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.subtitle}>Anything that would help next time? (optional)</Text>
          <TextInput
            style={styles.input}
            value={feedbackText}
            onChangeText={setFeedbackText}
            placeholder="Tell us anything that would help..."
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={500}
          />

          <TouchableOpacity
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit || submitting}
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
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm, color: colors.textPrimary, minHeight: 60, textAlignVertical: 'top',
  },
  submitButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xl, ...shadow.button },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  skipText: { color: colors.textTertiary, textAlign: 'center', fontSize: 14 },
});
