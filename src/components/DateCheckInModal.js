import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Platform, Alert, Share } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { createCheckIn, buildShareMessage } from '../services/dateSafety';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export default function DateCheckInModal({ visible, onClose, matchId, matchName }) {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const [scheduledAt, setScheduledAt] = useState(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const [showPicker, setShowPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate() {
    setSubmitting(true);
    try {
      await createCheckIn({ matchId, matchName, scheduledAt: scheduledAt.toISOString() });

      const message = buildShareMessage(matchName, scheduledAt.toISOString());
      await Share.share({ message });

      Alert.alert(
        "You're all set",
        "We'll check in with you after your date, and you've had a chance to share your plans with someone you trust."
      );
      onClose();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSubmitting(false);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>🛡️ Date Safety Check-In</Text>
          <Text style={styles.description}>
            Set a time for your date. We'll check in with you afterward, and you can share your plans with a trusted contact.
          </Text>

          <Text style={styles.label}>When are you meeting?</Text>
          <TouchableOpacity style={styles.input} onPress={() => setShowPicker(true)}>
            <Text style={{ color: colors.textPrimary }}>
              {scheduledAt.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </Text>
          </TouchableOpacity>
          {showPicker && (
            <DateTimePicker
              value={scheduledAt}
              mode="datetime"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              themeVariant={isDark ? 'dark' : 'light'}
              minimumDate={new Date()}
              onChange={(event, selectedDate) => {
                setShowPicker(Platform.OS === 'ios');
                if (selectedDate) setScheduledAt(selectedDate);
              }}
            />
          )}

          <TouchableOpacity style={styles.button} onPress={handleCreate} disabled={submitting} activeOpacity={0.85}>
            <Text style={styles.buttonText}>{submitting ? 'Setting up...' : 'Set Up Check-In & Share Plans'}</Text>
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
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.sm },
  description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelText: { color: colors.textTertiary, textAlign: 'center' },
});