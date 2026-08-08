import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { getQuickPrompts } from '../utils/timeContext';

const SOMETHING_ELSE = { icon: '➕', label: 'Something Else', category: null };

// Fixed, non-time-adaptive option set for CreateHubScreen's "Start a
// Gathering" card — unlike the default getQuickPrompts() list (which
// changes by time of day), Create is reached at any hour and needs a
// stable set. Categories map to real existing INTEREST_OPTIONS tags.
export const CREATE_HUB_OPTIONS = [
  { icon: '☕', label: 'Coffee', category: 'Coffee' },
  { icon: '🍽️', label: 'Dinner', category: 'Foodie' },
  { icon: '🚶', label: 'Walk', category: 'Outdoors' },
  { icon: '🏐', label: 'Sports', category: 'Sports' },
  { icon: '🎮', label: 'Games', category: 'Gaming' },
  { icon: '🎵', label: 'Music', category: 'Music' },
  { icon: '🤝', label: 'Volunteer', category: 'Volunteering' },
  SOMETHING_ELSE,
];

export const SUB_OPTIONS = {
  Dinner: [
    { icon: '🍕', label: 'Pizza' },
    { icon: '🌮', label: 'Mexican' },
    { icon: '🍣', label: 'Sushi' },
    { icon: '🍔', label: 'Burgers' },
    { icon: '🥗', label: 'Healthy' },
    { icon: '🍝', label: 'Italian' },
    { icon: '➕', label: "Doesn't matter" },
  ],
};

export default function StartSomethingModal({ visible, onClose, navigation, initialCategory = null, topLevelOptions = null }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [activeCategory, setActiveCategory] = useState(null);

  useEffect(() => {
    if (visible && initialCategory) {
      setActiveCategory(initialCategory);
    }
  }, [visible, initialCategory]);

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

  const options = activeCategory ? SUB_OPTIONS[activeCategory.label] : topLevelOptions ?? [...getQuickPrompts(), SOMETHING_ELSE];
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