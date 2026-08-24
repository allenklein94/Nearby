import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { INTEREST_OPTIONS } from '../constants/gatheringCategories';

const MAX_PICKS = 5;

export default function QuickPicksEditModal({ visible, onClose, initialPicks, onSave, onResetToAuto }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [selected, setSelected] = useState(initialPicks ?? []);

  function toggle(tag) {
    setSelected((prev) => {
      if (prev.includes(tag)) return prev.filter((t) => t !== tag);
      if (prev.length >= MAX_PICKS) return prev;
      return [...prev, tag];
    });
  }

  function handleSave() {
    onSave(selected);
  }

  function handleReset() {
    setSelected([]);
    onResetToAuto();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Edit Quick Picks</Text>
          <Text style={styles.subtitle}>Choose up to {MAX_PICKS} categories to always show on Home.</Text>

          <ScrollView style={{ maxHeight: 340 }}>
            <View style={styles.chipWrap}>
              {INTEREST_OPTIONS.map((tag) => {
                const isSelected = selected.includes(tag);
                const style = categoryStyleFor(tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    style={[styles.chip, isSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                    onPress={() => toggle(tag)}
                    accessibilityRole="button"
                    accessibilityLabel={tag}
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Text style={[styles.chipText, isSelected && { color: '#fff' }]}>{style.icon} {tag}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <TouchableOpacity style={styles.saveButton} onPress={handleSave} accessibilityRole="button" accessibilityLabel="Save quick picks">
            <Text style={styles.saveButtonText}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.resetButton} onPress={handleReset} accessibilityRole="button" accessibilityLabel="Use my activity instead">
            <Text style={styles.resetButtonText}>Use My Activity Instead</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing.xl },
    title: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
    subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingBottom: spacing.sm },
    chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    chipText: { ...typography.caption, color: colors.textPrimary },
    saveButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md },
    saveButtonText: { ...typography.bodyBold, color: '#fff' },
    resetButton: { paddingVertical: spacing.md, alignItems: 'center' },
    resetButtonText: { ...typography.caption, color: colors.primary },
    cancelButton: { paddingVertical: spacing.sm, alignItems: 'center' },
    cancelButtonText: { ...typography.caption, color: colors.textTertiary },
  });
}
