import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, Alert } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

const REPORT_REASONS = [
  'Inappropriate photo',
  'Harassment or abuse',
  'Fake profile',
  'Spam or scam',
  'Underage user',
  'Other',
];

export default function ReportBlockModal({ visible, onClose, onBlocked, reportedUserId, reportedUserName }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [selectedReason, setSelectedReason] = useState(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitReport() {
    if (!selectedReason) {
      return Alert.alert('Select a reason', 'Please choose a reason for this report.');
    }
    setSubmitting(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const reporterId = sessionData?.session?.user?.id;

    const { error } = await supabase.from('reports').insert({
      reporter_id: reporterId,
      reported_id: reportedUserId,
      reason: selectedReason,
      details: details.trim() || null,
    });

    setSubmitting(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    Alert.alert('Report submitted', 'Thank you — our team will review this.');
    setSelectedReason(null);
    setDetails('');
    onClose();
  }

  async function blockUser() {
    Alert.alert(
      `Block ${reportedUserName || 'this user'}?`,
      "They won't be able to contact you again, and won't be notified. Any existing match between you will be removed.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('block_and_unmatch', { blocked_user_id: reportedUserId });
            if (error) {
              Alert.alert('Error', error.message);
              return;
            }
            onBlocked && onBlocked();
          },
        },
      ]
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Report or Block</Text>

          <Text style={styles.label}>Reason for report</Text>
          <View style={styles.reasonsWrap}>
            {REPORT_REASONS.map((reason) => (
              <TouchableOpacity
                key={reason}
                style={[styles.reasonChip, selectedReason === reason && styles.reasonChipSelected]}
                onPress={() => setSelectedReason(reason)}
              >
                <Text style={[styles.reasonText, selectedReason === reason && styles.reasonTextSelected]}>{reason}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.detailsInput}
            placeholder="Additional details (optional)"
            placeholderTextColor={colors.textTertiary}
            value={details}
            onChangeText={setDetails}
            multiline
          />

          <TouchableOpacity style={styles.reportButton} onPress={submitReport} disabled={submitting}>
            <Text style={styles.reportButtonText}>{submitting ? 'Submitting...' : 'Submit Report'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.blockButton} onPress={blockUser}>
            <Text style={styles.blockButtonText}>Block User</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.md }}>
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
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.md },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm },
  reasonsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  reasonChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  reasonChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  reasonText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  reasonTextSelected: { color: '#fff' },
  detailsInput: {
    backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.sm,
    padding: spacing.md, minHeight: 70, textAlignVertical: 'top', borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.md,
  },
  reportButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center' },
  reportButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  blockButton: { paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  blockButtonText: { color: colors.danger, fontWeight: '700', fontSize: 15 },
  cancelText: { color: colors.textTertiary, textAlign: 'center' },
});