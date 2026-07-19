import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, Alert } from 'react-native';
import { supabase } from '../services/supabase';

const REASONS = [
  'Fake profile or photos',
  'Harassment or threatening behavior',
  'Inappropriate messages',
  'Underage user',
  'Spam or scam',
  'Something else',
];

export default function ReportBlockModal({ visible, onClose, onBlocked, reportedUserId, reportedUserName }) {
  const [step, setStep] = useState('choose'); // 'choose' | 'reason' | 'done'
  const [selectedReason, setSelectedReason] = useState(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setStep('choose');
    setSelectedReason(null);
    setDetails('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function submitReport() {
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
      Alert.alert('Something went wrong', 'Please try again.');
      return;
    }
    setStep('done');
  }

  async function blockUser() {
    const { data: sessionData } = await supabase.auth.getSession();
    const blockerId = sessionData?.session?.user?.id;

    const { error } = await supabase
      .from('blocks')
      .insert({ blocker_id: blockerId, blocked_id: reportedUserId });

    if (error) {
      Alert.alert('Something went wrong', 'Please try again.');
      return;
    }
    Alert.alert('Blocked', `${reportedUserName || 'This user'} can no longer see you or contact you.`);
    reset();
    onBlocked ? onBlocked() : onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {step === 'choose' && (
            <>
              <Text style={styles.title}>
                {reportedUserName ? `Report or block ${reportedUserName}` : 'Report or block this user'}
              </Text>
              <TouchableOpacity style={styles.optionButton} onPress={() => setStep('reason')}>
                <Text style={styles.optionText}>Report this user</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.optionButton} onPress={blockUser}>
                <Text style={styles.optionText}>Block this user</Text>
              </TouchableOpacity>
              <Text style={styles.helperText}>
                Blocking removes them from your matches and notices immediately, and prevents
                any future contact. They won't be told you blocked them.
              </Text>
              <TouchableOpacity onPress={handleClose} style={styles.cancelButton}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'reason' && (
            <>
              <Text style={styles.title}>What's going on?</Text>
              {REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason}
                  style={[styles.optionButton, selectedReason === reason && styles.optionButtonSelected]}
                  onPress={() => setSelectedReason(reason)}
                >
                  <Text style={styles.optionText}>{reason}</Text>
                </TouchableOpacity>
              ))}
              <TextInput
                style={styles.input}
                placeholder="Any extra detail? (optional)"
                placeholderTextColor="#8888a8"
                value={details}
                onChangeText={setDetails}
                multiline
              />
              <TouchableOpacity
                style={[styles.submitButton, !selectedReason && { opacity: 0.5 }]}
                onPress={submitReport}
                disabled={!selectedReason || submitting}
              >
                <Text style={styles.submitText}>{submitting ? 'Submitting...' : 'Submit Report'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep('choose')} style={styles.cancelButton}>
                <Text style={styles.cancelText}>Back</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'done' && (
            <>
              <Text style={styles.title}>Report submitted</Text>
              <Text style={styles.helperText}>
                Thanks for letting us know. Our team reviews every report. In the meantime,
                you can also block this user so they can't contact you.
              </Text>
              <TouchableOpacity style={styles.optionButton} onPress={blockUser}>
                <Text style={styles.optionText}>Block this user too</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleClose} style={styles.cancelButton}>
                <Text style={styles.cancelText}>Done</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36 },
  title: { color: '#fff', fontSize: 19, fontWeight: '700', marginBottom: 16 },
  optionButton: { backgroundColor: '#2a2a4a', borderRadius: 12, padding: 14, marginBottom: 10 },
  optionButtonSelected: { borderWidth: 1, borderColor: '#e94560' },
  optionText: { color: '#fff', fontSize: 15 },
  helperText: { color: '#8888a8', fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 12 },
  input: {
    backgroundColor: '#2a2a4a', color: '#fff', borderRadius: 12, padding: 14,
    marginTop: 4, marginBottom: 16, minHeight: 70, textAlignVertical: 'top',
  },
  submitButton: { backgroundColor: '#e94560', borderRadius: 30, paddingVertical: 14, alignItems: 'center' },
  submitText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  cancelButton: { alignItems: 'center', marginTop: 14 },
  cancelText: { color: '#8888a8', fontSize: 14 },
});