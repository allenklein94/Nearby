import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { BASICS_FIELDS } from '../constants/basicsFields';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

function fieldLabel(key) {
  const field = BASICS_FIELDS.find((f) => f.key === key);
  return field ? `${field.icon} ${field.label}` : key;
}

export default function CompatibilityReportModal({ visible, onClose, report, theirName }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  if (!report) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{report.score}% Match with {theirName}</Text>

          <ScrollView style={{ maxHeight: 400 }}>
            {report.sharedInterests.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>You Both Like</Text>
                <View style={styles.chipsWrap}>
                  {report.sharedInterests.map((interest) => (
                    <View key={interest} style={styles.matchChip}>
                      <Text style={styles.matchChipText}>{interest}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {report.matchingFields.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>You Match On</Text>
                {report.matchingFields.map((field) => (
                  <View key={field.key} style={styles.row}>
                    <Text style={styles.rowLabel}>{fieldLabel(field.key)}</Text>
                    <Text style={styles.rowValueMatch}>{field.value}</Text>
                  </View>
                ))}
              </>
            )}

            {report.differingFields.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>You Differ On</Text>
                {report.differingFields.map((field) => (
                  <View key={field.key} style={styles.differRow}>
                    <Text style={styles.rowLabel}>{fieldLabel(field.key)}</Text>
                    <Text style={styles.differText}>You: {field.myValue}</Text>
                    <Text style={styles.differText}>Them: {field.theirValue}</Text>
                  </View>
                ))}
              </>
            )}

            {report.sharedInterests.length === 0 && report.matchingFields.length === 0 && report.differingFields.length === 0 && (
              <Text style={styles.emptyText}>
                Not enough shared profile info yet to show a detailed breakdown — fill out more of your profile to see this.
              </Text>
            )}
          </ScrollView>

          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Close</Text>
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
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.md, textTransform: 'uppercase', letterSpacing: 0.5 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  matchChip: { backgroundColor: colors.primaryMuted, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  matchChipText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel: { color: colors.textSecondary, fontSize: 14 },
  rowValueMatch: { color: colors.success, fontWeight: '700', fontSize: 14 },
  differRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  differText: { color: colors.textTertiary, fontSize: 13, marginTop: 2 },
  emptyText: { color: colors.textTertiary, textAlign: 'center', paddingVertical: spacing.xl, lineHeight: 20 },
  closeButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  closeButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});