import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { INTEREST_OPTIONS } from '../constants/gatheringCategories';
import TagGroupPicker from './TagGroupPicker';
import KeyboardSafeSheet from './KeyboardSafeSheet';

import { modalAnimation } from '../motion';
const MAX_PICKS = 5;

export default function QuickPicksEditModal({ visible, onClose, initialPicks, onSave, onResetToAuto }) {
  const { t } = useLanguage();
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
    <Modal visible={visible} animationType={modalAnimation('slide')} transparent onRequestClose={onClose}>
      <KeyboardSafeSheet style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{t('ui.quickPicks.editQuickPicks')}</Text>
          <Text style={styles.subtitle}>{t('ui.quickPicks.chooseUpToCategoriesTo', { maxPicks: MAX_PICKS })}</Text>

          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
            <TagGroupPicker options={INTEREST_OPTIONS} selected={selected} onToggle={toggle} max={MAX_PICKS} />
          </ScrollView>

          <TouchableOpacity style={styles.saveButton} onPress={handleSave} accessibilityRole="button" accessibilityLabel={t('ui.quickPicks.saveQuickPicksA11y')}>
            <Text style={styles.saveButtonText}>{t('ui.quickPicks.save')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.resetButton} onPress={handleReset} accessibilityRole="button" accessibilityLabel={t('ui.quickPicks.useMyActivityInsteadA11y')}>
            <Text style={styles.resetButtonText}>{t('ui.quickPicks.useMyActivityInstead')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('ui.quickPicks.cancelA11y')}>
            <Text style={styles.cancelButtonText}>{t('ui.quickPicks.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardSafeSheet>
    </Modal>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing.xl },
    title: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
    subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
    saveButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md },
    saveButtonText: { ...typography.bodyBold, color: '#fff' },
    resetButton: { paddingVertical: spacing.md, alignItems: 'center' },
    resetButtonText: { ...typography.caption, color: colors.primary },
    cancelButton: { paddingVertical: spacing.sm, alignItems: 'center' },
    cancelButtonText: { ...typography.caption, color: colors.textTertiary },
  });
}
