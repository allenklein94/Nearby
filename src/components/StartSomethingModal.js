import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

const QUICK_STARTS = [
  { icon: '☕', label: 'Grab Coffee', category: 'Coffee' },
  { icon: '🍕', label: 'Get Food', category: 'Foodie' },
  { icon: '🏃', label: 'Go for a Run', category: 'Fitness' },
  { icon: '🎲', label: 'Play Games', category: 'Gaming' },
  { icon: '🎵', label: 'Listen to Music', category: 'Music' },
  { icon: '🌳', label: 'Explore Outside', category: 'Outdoors' },
];

// A faster on-ramp into the existing Create Gathering flow — picking
// one of these pre-fills the title and category, so a spontaneous
// plan takes seconds instead of filling out a full form from
// scratch. It's still the same real gathering underneath, just a
// quicker starting point.
export default function StartSomethingModal({ visible, onClose, navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  function handlePick(item) {
    onClose();
    navigation.navigate('CreateGathering', {
      quickStartTitle: item.label,
      quickStartCategory: item.category,
    });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>I want to...</Text>
          <View style={styles.grid}>
            {QUICK_STARTS.map((item) => (
              <TouchableOpacity
                key={item.label}
                style={styles.option}
                onPress={() => handlePick(item)}
                accessibilityLabel={item.label}
                accessibilityRole="button"
              >
                <Text style={styles.optionIcon}>{item.icon}</Text>
                <Text style={styles.optionLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.lg }} accessibilityLabel="Cancel" accessibilityRole="button">
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