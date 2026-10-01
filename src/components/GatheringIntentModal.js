import React, { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { setGatheringIntent, getMyGatheringIntent } from '../services/gatherings';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

import { modalAnimation } from '../motion';
// Labels come from ui.gatheringIntent.option.<value>.
const INTENT_OPTIONS = [
  { value: 'meet_someone_new', emoji: '👋' },
  { value: 'get_out_of_house', emoji: '🚪' },
  { value: 'good_conversations', emoji: '💬' },
  { value: 'be_active', emoji: '🏃' },
  { value: 'relax_unwind', emoji: '🌿' },
];

// Private, own-eyes-only signal — never shown to the host, not even in
// aggregate (see gathering_intents' RLS: no update-by-host or aggregate
// RPC exists on purpose). Asked right before joining so it captures what
// someone's actually hoping for, not what they'd say for an audience.
export default function GatheringIntentModal({ visible, gathering, onClose, onConfirm, confirmLabel: confirmLabelProp }) {
  const { t } = useLanguage();
  const confirmLabel = confirmLabelProp ?? t('ui.gatheringIntent.imInterested');
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (visible && gathering) {
      getMyGatheringIntent(gathering.id).then((intent) => {
        if (!cancelled) setSelected(intent);
      });
    }
    return () => { cancelled = true; };
  }, [visible, gathering]);

  async function handleConfirm() {
    setSubmitting(true);
    try {
      if (selected) {
        await setGatheringIntent(gathering.id, selected);
      }
    } catch (e) {
      console.error('Failed to save gathering intent', e);
      // Own-eyes-only preference signal — never block joining over it.
    }
    setSubmitting(false);
    setSelected(null);
    onConfirm();
  }

  return (
    <Modal visible={visible} animationType={modalAnimation('slide')} transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{t('ui.gatheringIntent.whatAreYouHopingFor')}</Text>
          <Text style={styles.subtitle}>{t('ui.gatheringIntent.justForYouTheHost')}</Text>
          {INTENT_OPTIONS.map((o) => {
            const isSelected = selected === o.value;
            return (
              <TouchableOpacity
                key={o.value}
                style={[styles.option, isSelected && styles.optionSelected]}
                onPress={() => setSelected(o.value)}
                accessibilityLabel={t(`ui.gatheringIntent.option.${o.value}`)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
              >
                <Text style={styles.optionEmoji}>{o.emoji}</Text>
                <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>{t(`ui.gatheringIntent.option.${o.value}`)}</Text>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            style={styles.submitButton}
            onPress={handleConfirm}
            disabled={submitting}
            activeOpacity={0.85}
            accessibilityLabel={submitting ? t('ui.gatheringIntent.joiningA11y') : confirmLabel}
            accessibilityRole="button"
          >
            <Text style={styles.submitButtonText}>{submitting ? t('ui.gatheringIntent.joining') : confirmLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.sm }} accessibilityLabel={t('ui.gatheringIntent.cancelA11y')} accessibilityRole="button">
            <Text style={styles.skipText}>{t('ui.gatheringIntent.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs, textAlign: 'center' },
  subtitle: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg, textAlign: 'center' },
  option: {
    flexDirection: 'row', alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md, marginBottom: spacing.sm,
  },
  optionSelected: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  optionEmoji: { fontSize: 20, marginRight: spacing.sm },
  optionLabel: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  optionLabelSelected: { color: colors.primary },
  submitButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md, ...shadow.button },
  submitButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  skipText: { color: colors.textTertiary, textAlign: 'center', fontSize: 14 },
});
