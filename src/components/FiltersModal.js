import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Modal, SafeAreaView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

export default function FiltersModal({ visible, onClose, fields, activeFilters, onApply, showAgeRange, ageRange, onAgeRangeChange }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [draft, setDraft] = useState(activeFilters);
  const [draftMinAge, setDraftMinAge] = useState(String(ageRange?.min ?? 18));
  const [draftMaxAge, setDraftMaxAge] = useState(String(ageRange?.max ?? 99));

  useEffect(() => {
    if (visible) {
      setDraft(activeFilters);
      setDraftMinAge(String(ageRange?.min ?? 18));
      setDraftMaxAge(String(ageRange?.max ?? 99));
    }
  }, [visible, activeFilters, ageRange]);

  function toggleOption(fieldKey, option) {
    setDraft((prev) => {
      const current = prev[fieldKey] ?? [];
      const next = current.includes(option)
        ? current.filter((o) => o !== option)
        : [...current, option];
      return { ...prev, [fieldKey]: next };
    });
  }

  function clearAll() {
    setDraft({});
    setDraftMinAge('18');
    setDraftMaxAge('99');
  }

  function apply() {
    onApply(draft);
    if (showAgeRange && onAgeRangeChange) {
      const min = parseInt(draftMinAge, 10);
      const max = parseInt(draftMaxAge, 10);
      if (!isNaN(min) && !isNaN(max) && min >= 18 && max >= min) {
        onAgeRangeChange({ min, max });
      }
    }
    onClose();
  }

  const activeCount = Object.values(draft).reduce((sum, arr) => sum + (arr?.length ?? 0), 0);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} accessibilityLabel="Cancel" accessibilityRole="button">
            <Text style={styles.headerButton}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Filters</Text>
          <TouchableOpacity onPress={clearAll} accessibilityLabel="Clear all filters" accessibilityRole="button">
            <Text style={styles.headerButton}>Clear</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          {showAgeRange && (
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>🎂 Age Range</Text>
              <View style={styles.ageRow}>
                <TextInput
                  style={styles.ageInput}
                  value={draftMinAge}
                  onChangeText={setDraftMinAge}
                  keyboardType="number-pad"
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel="Minimum age"
                />
                <Text style={styles.ageDash}>to</Text>
                <TextInput
                  style={styles.ageInput}
                  value={draftMaxAge}
                  onChangeText={setDraftMaxAge}
                  keyboardType="number-pad"
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel="Maximum age"
                />
              </View>
            </View>
          )}

          {fields.map((field) => (
            <View key={field.key} style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>{field.icon} {field.label}</Text>
              <View style={styles.chipsWrap}>
                {field.options.map((option) => {
                  const active = (draft[field.key] ?? []).includes(option);
                  return (
                    <TouchableOpacity
                      key={option}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => toggleOption(field.key, option)}
                      accessibilityLabel={`${field.label}: ${option}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{option}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.applyButton} onPress={apply} activeOpacity={0.85} accessibilityLabel={`Apply filters${activeCount > 0 ? `, ${activeCount} active` : ''}`} accessibilityRole="button">
            <Text style={styles.applyButtonText}>Show Results{activeCount > 0 ? ` (${activeCount} filter${activeCount === 1 ? '' : 's'})` : ''}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerButton: { color: colors.primary, fontWeight: '600', fontSize: 15 },
  headerTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 17 },
  fieldSection: { marginBottom: spacing.lg },
  fieldLabel: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15, marginBottom: spacing.sm },
  ageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ageInput: { flex: 1, backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.sm, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border, textAlign: 'center' },
  ageDash: { color: colors.textTertiary },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  applyButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', ...shadow.button },
  applyButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});