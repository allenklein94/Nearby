import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { supabase } from '../services/supabase';
import { colors, typography, spacing, radius, shadow } from '../theme';

function toE164(rawInput) {
  const digits = rawInput.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export default function LoginScreen() {
  const [phoneInput, setPhoneInput] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [e164Phone, setE164Phone] = useState('');

  async function sendOtp() {
    const formatted = toE164(phoneInput);
    if (!formatted) {
      return Alert.alert('Invalid number', 'Enter a 10-digit US phone number.');
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: formatted });
    setLoading(false);
    if (error) return Alert.alert('Error', error.message);
    setE164Phone(formatted);
    setOtpSent(true);
  }

  async function verifyOtp() {
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      phone: e164Phone,
      token: otp,
      type: 'sms',
    });
    setLoading(false);
    if (error) return Alert.alert('Error', error.message);
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.icon}>{otpSent ? '💬' : '📱'}</Text>
      <Text style={styles.title}>{otpSent ? 'Enter your code' : 'Sign in'}</Text>

      {!otpSent ? (
        <>
          <Text style={styles.label}>We'll text you a verification code.</Text>
          <TextInput
            style={styles.input}
            placeholder="(555) 555-5555"
            placeholderTextColor={colors.textTertiary}
            keyboardType="phone-pad"
            value={phoneInput}
            onChangeText={setPhoneInput}
          />
          <TouchableOpacity style={styles.button} onPress={sendOtp} disabled={loading} activeOpacity={0.85}>
            <Text style={styles.buttonText}>{loading ? 'Sending...' : 'Send Code'}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.label}>Enter the code sent to {phoneInput}</Text>
          <TextInput
            style={styles.input}
            placeholder="6-digit code"
            placeholderTextColor={colors.textTertiary}
            keyboardType="number-pad"
            value={otp}
            onChangeText={setOtp}
          />
          <TouchableOpacity style={styles.button} onPress={verifyOtp} disabled={loading} activeOpacity={0.85}>
            <Text style={styles.buttonText}>{loading ? 'Verifying...' : 'Verify'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setOtpSent(false)} style={{ marginTop: spacing.md }}>
            <Text style={styles.backText}>Use a different number</Text>
          </TouchableOpacity>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, justifyContent: 'center' },
  icon: { fontSize: 40, textAlign: 'center', marginBottom: spacing.md },
  title: { ...typography.title, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
  label: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    textAlign: 'center',
  },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', ...shadow.button },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  backText: { color: colors.textTertiary, fontSize: 13, textAlign: 'center' },
});