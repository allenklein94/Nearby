import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, SafeAreaView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { WHEN_OPTIONS, MOOD_OPTIONS } from '../services/surpriseMeLogic';

// "Surprise Me" (critique item 28) -- the locked-spec quick-picker: When
// (Now/Today/This Weekend, the real gatheringDateFilter.js DATE_OPTIONS
// keys) and Mood (six real chips, mapped to real vocabulary in
// surpriseMeLogic.js). Deliberately no free text and no new screen --
// same full-screen slide Modal shape FiltersModal.js already established
// for this app's own "in-place sheet" pattern, not a new presentation.
export default function SurpriseMeSheet({ visible, onClose, onSubmit }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [when, setWhen] = useState('now');
  const [mood, setMood] = useState(null);

  useEffect(() => {
    if (visible) {
      setWhen('now');
      setMood(null);
    }
  }, [visible]);

  function submit() {
    if (!mood) return;
    onSubmit({ when, mood });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>✨ Surprise Me</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close" accessibilityRole="button">
              <Text style={styles.headerClose}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionLabel}>When?</Text>
          <View style={styles.chipsWrap}>
            {WHEN_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.chip, when === opt.key && styles.chipActive]}
                onPress={() => setWhen(opt.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: when === opt.key }}
              >
                <Text style={[styles.chipText, when === opt.key && styles.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Mood?</Text>
          <View style={styles.chipsWrap}>
            {MOOD_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.chip, mood === opt.key && styles.chipActive]}
                onPress={() => setMood(opt.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: mood === opt.key }}
              >
                <Text style={[styles.chipText, mood === opt.key && styles.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.submitButton, !mood && styles.submitButtonDisabled]}
            onPress={submit}
            disabled={!mood}
            accessibilityLabel="Surprise Me"
            accessibilityRole="button"
          >
            <Text style={styles.submitButtonText}>✨ Surprise Me</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
      padding: spacing.lg, paddingBottom: spacing.xl,
    },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
    headerTitle: { ...typography.title, color: colors.textPrimary },
    headerClose: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
    sectionLabel: { ...typography.caption, color: colors.textTertiary, fontWeight: '700', marginBottom: spacing.sm },
    chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
    chip: {
      borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated ?? colors.surface,
      paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    },
    chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
    chipText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
    chipTextActive: { color: colors.primary },
    submitButton: {
      backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.md, alignItems: 'center',
    },
    submitButtonDisabled: { opacity: 0.5 },
    submitButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  });
}
