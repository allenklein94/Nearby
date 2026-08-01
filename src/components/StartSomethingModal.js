import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// First screen stays deliberately simple — broad activities, not
// categories, so the very first tap feels effortless. Picking one
// (other than "Something Else") reveals a genuine second step for
// specificity, rather than forcing everything into the full form
// immediately.
const QUICK_STARTS = [
  { icon: '☕', label: 'Coffee', category: 'Coffee' },
  { icon: '🍽️', label: 'Dinner', category: 'Foodie' },
  { icon: '🚶', label: 'Walk', category: 'Outdoors' },
  { icon: '🏃', label: 'Workout', category: 'Fitness' },
  { icon: '⚽', label: 'Sports', category: 'Sports' },
  { icon: '➕', label: 'Something Else', category: null },
];

const SUB_OPTIONS = {
  Dinner: [
    { icon: '🍕', label: 'Pizza' },
    { icon: '🌮', label: 'Mexican' },
    { icon: '🍣', label: 'Sushi' },
    { icon: '🍔', label: 'Burgers' },
    { icon: '🥗', label: 'Healthy' },
    { icon: '🍝', label: 'Italian' },
    { icon: '➕', label: "Doesn't matter" },
  ],
  Sports: [
    { icon: '⚽', label: 'Soccer' },
    { icon: '🏀', label: 'Basketball' },
    { icon: '🏐', label: 'Volleyball' },
    { icon: '🎾', label: 'Tennis' },
    { icon: '🏓', label: 'Pickleball' },
    { icon: '🏈', label: 'Football' },
    { icon: '➕', label: 'Other' },
  ],
};

export default function StartSomethingModal({ visible, onClose, navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [activeCategory, setActiveCategory] = useState(null);

  function handleClose() {
    setActiveCategory(null);
    onClose();
  }

  function handlePick(item) {
    if (item.category === null) {
      handleClose();
      navigation.navigate('CreateGathering');
      return;
    }
    if (SUB_OPTIONS[item.label]) {
      setActiveCategory(item);
      return;
    }
    handleClose();
    navigation.navigate('CreateGathering', {
      quickStartTitle: item.label,
      quickStartCategory: item.category,
    });
  }

  function handlePickSub(subLabel) {
    handleClose();
    navigation.navigate('CreateGathering', {
      quickStartTitle: subLabel === "Doesn't matter" || subLabel === 'Other' ? activeCategory.label : subLabel,
      quickStartCategory: activeCategory.category,
    });
  }

  const options = activeCategory ? SUB_OPTIONS[activeCategory.label] : QUICK_STARTS;
  const title = activeCategory ? `What kind of ${activeCategory.label.toLowerCase()}?` : 'I want to...';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {activeCategory && (
            <TouchableOpacity onPress={() => setActiveCategory(null)} accessibilityLabel="Back" accessibilityRole="button">
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.title}>{title}</Text>
          <View style={styles.grid}>
            {options.map((item) => (
              <TouchableOpacity
                key={item.label}
                style={styles.option}
                onPress={() => (activeCategory ? handlePickSub(item.label) : handlePick(item))}
                accessibilityLabel={item.label}
                accessibilityRole="button"
              >
                <Text style={styles.optionIcon}>{item.icon}</Text>
                <Text style={styles.optionLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={handleClose} style={{ marginTop: spacing.lg }} accessibilityLabel="Cancel" accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
const getStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  backText: { color: colors.primary, fontWeight: '600', marginBottom: spacing.sm },
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: {
    width: '31%', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.md, alignItems: 'center',
  },
  optionIcon: { fontSize: 26, marginBottom: spacing.xs },
  optionLabel: { color: colors.textPrimary, fontSize: 11, fontWeight: '600', textAlign: 'center' },
  cancelText: { color: colors.textTertiary, textAlign: 'center', fontSize: 14 },
});