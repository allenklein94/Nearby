import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// Real bottom-sheet menu component, not a native Alert.alert — RN's
// Alert.alert is documented as unreliable with more than ~3 buttons on
// Android (some/all extra buttons silently don't render), so anything
// with more than a couple of real options should render its own list,
// not stack onto Alert's fixed-size button row.
export default function ActionSheetModal({ visible, onClose, title, message, options }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  function handlePick(option) {
    onClose();
    // Let the modal actually close before firing navigation/async work,
    // same "close first" ordering the native Alert callbacks already had.
    setTimeout(() => option.onPress?.(), 0);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityLabel="Close menu" />
        <View style={styles.sheet}>
          {!!title && <Text style={styles.title}>{title}</Text>}
          {!!message && <Text style={styles.message}>{message}</Text>}
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {options.map((option, index) => (
              <TouchableOpacity
                key={option.key || `${option.text}-${index}`}
                style={styles.row}
                onPress={() => handlePick(option)}
                accessibilityLabel={option.text}
                accessibilityRole="button"
              >
                <Text style={[styles.rowText, option.destructive && styles.rowTextDestructive]}>{option.text}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity onPress={onClose} style={styles.cancelRow} accessibilityLabel="Cancel" accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl, maxHeight: '75%',
  },
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs, textAlign: 'center' },
  message: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.md, textAlign: 'center' },
  list: { marginTop: spacing.sm },
  row: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowText: { color: colors.textPrimary, fontSize: 16, textAlign: 'center' },
  rowTextDestructive: { color: colors.danger || '#e53e3e' },
  cancelRow: { marginTop: spacing.md, paddingVertical: spacing.sm },
  cancelText: { color: colors.textTertiary, textAlign: 'center', fontSize: 15, fontWeight: '600' },
});
