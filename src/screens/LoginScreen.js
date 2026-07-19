import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { supabase } from '../services/supabase';

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
      <Text style={styles.title}>Sign in</Text>
      {!otpSent ? (
        <>
          <Text style={styles.label}>We'll text you a verification code.</Text>
          <TextInput
            style={styles.input}
            placeholder="(555) 555-5555"
            placeholderTextColor="#8888a8"
            keyboardType="phone-pad"
            value={phoneInput}
            onChangeText={setPhoneInput}
          />
          <TouchableOpacity style={styles.button} onPress={sendOtp} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Sending...' : 'Send Code'}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.label}>Enter the code sent to {phoneInput}</Text>
          <TextInput
            style={styles.input}
            placeholder="6-digit code"
            placeholderTextColor="#8888a8"
            keyboardType="number-pad"
            value={otp}
            onChangeText={setOtp}
          />
          <TouchableOpacity style={styles.button} onPress={verifyOtp} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Verifying...' : 'Verify'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setOtpSent(false)} style={{ marginTop: 16 }}>
            <Text style={styles.backText}>Use a different number</Text>
          </TouchableOpacity>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 24, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 12 },
  label: { color: '#8888a8', fontSize: 14, marginBottom: 16 },
  input: {
    backgroundColor: '#2a2a4a', color: '#fff', borderRadius: 12,
    padding: 16, fontSize: 16, marginBottom: 16,
  },
  button: { backgroundColor: '#e94560', borderRadius: 30, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  backText: { color: '#8888a8', fontSize: 13, textAlign: 'center' },
});