import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, Alert } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

import { modalAnimation } from '../motion';
// `value` is what is saved in reports.reason and read by the admin queue (English, unchanged); `key` names the chip label
// in the person's language (ui.reportBlock.reason.<key>).
const REPORT_REASONS = [
  { value: 'Inappropriate photo', key: 'inappropriatePhoto' },
  { value: 'Harassment or abuse', key: 'harassment' },
  { value: 'Fake profile', key: 'fakeProfile' },
  { value: 'Spam or scam', key: 'spam' },
  { value: 'Underage user', key: 'underage' },
  { value: 'Other', key: 'other' },
];

export default function ReportBlockModal({ visible, onClose, onBlocked, reportedUserId, reportedUserName }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [selectedReason, setSelectedReason] = useState(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitReport() {
    if (!selectedReason) {
      return Alert.alert(t('ui.reportBlock.selectAReason'), t('ui.reportBlock.pleaseChooseAReasonFor'));
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
      presentRecoverableError(Alert, { what: 'complete that', error: error, onRetry: () => submitReport() });
      return;
    }
    Alert.alert(t('ui.reportBlock.reportSubmitted'), t('ui.reportBlock.thankYouOurTeamWill'));
    setSelectedReason(null);
    setDetails('');
    onClose();
  }

  async function blockUser() {
    Alert.alert(
      t('ui.reportBlock.block', { reportedUserName: reportedUserName || t('ui.reportBlock.thisUser') }),
      t('ui.reportBlock.theyWontBeAbleTo'),
      [
        { text: t('ui.reportBlock.cancel'), style: 'cancel' },
        {
          text: t('ui.reportBlock.block2'),
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('block_and_unmatch', { blocked_user_id: reportedUserId });
            if (error) {
              presentRecoverableError(Alert, { what: 'complete that', error: error, onRetry: () => blockUser() });
              return;
            }
            onBlocked && onBlocked();
          },
        },
      ]
    );
  }

  return (
    <Modal visible={visible} animationType={modalAnimation('slide')} transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{t('ui.reportBlock.reportOrBlock')}</Text>

          <Text style={styles.label}>{t('ui.reportBlock.reasonForReport')}</Text>
          <View style={styles.reasonsWrap}>
            {REPORT_REASONS.map(({ value, key }) => (
              <TouchableOpacity
                key={value}
                style={[styles.reasonChip, selectedReason === value && styles.reasonChipSelected]}
                onPress={() => setSelectedReason(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedReason === value }}
              >
                <Text style={[styles.reasonText, selectedReason === value && styles.reasonTextSelected]}>{t(`ui.reportBlock.reason.${key}`)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.detailsInput}
            placeholder={t('ui.reportBlock.additionalDetailsOptional')}
            placeholderTextColor={colors.textTertiary}
            value={details}
            onChangeText={setDetails}
            multiline
          />

          <TouchableOpacity style={styles.reportButton} onPress={submitReport} disabled={submitting}>
            <Text style={styles.reportButtonText}>{submitting ? t('ui.reportBlock.submitting') : t('ui.reportBlock.submitReport')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.blockButton} onPress={blockUser}>
            <Text style={styles.blockButtonText}>{t('ui.reportBlock.blockUser')}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.md }}>
            <Text style={styles.cancelText}>{t('ui.reportBlock.cancel')}</Text>
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