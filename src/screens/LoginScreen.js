import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const REVIEWER_PHONE_DIGITS = '5555550199';

function toE164(rawInput) {
  const digits = rawInput.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export default function LoginScreen() {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors, shadow);
  const [phoneInput, setPhoneInput] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [e164Phone, setE164Phone] = useState('');

  function isReviewerNumber(rawInput) {
    return rawInput.replace(/\D/g, '') === REVIEWER_PHONE_DIGITS;
  }

  async function sendOtp() {
    if (isReviewerNumber(phoneInput)) {
      setE164Phone('+1' + REVIEWER_PHONE_DIGITS);
      setOtpSent(true);
      return;
    }

    const formatted = toE164(phoneInput);
    if (!formatted) {
      return Alert.alert(t('login.invalidNumber'), t('login.invalidNumberMessage'));
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

    if (isReviewerNumber(phoneInput)) {
      try {
        const response = await fetch('https://enmosvippabmuqslzrox.supabase.co/functions/v1/review-login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW',
          },
          body: JSON.stringify({ pin: otp }),
        });
        const result = await response.json();
        setLoading(false);

        if (!response.ok || result.error) {
          return Alert.alert('Error', result.error || 'Invalid code');
        }

        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: result.tokenHash,
          type: 'magiclink',
        });
        if (verifyError) return Alert.alert('Error', verifyError.message);
      } catch (e) {
        setLoading(false);
        Alert.alert('Error', e.message);
      }
      return;
    }

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
      <Text style={styles.title}>{otpSent ? t('login.enterCode') : t('login.signIn')}</Text>

      {!otpSent ? (
        <>
          <Text style={styles.label}>{t('login.textDescription')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('login.phonePlaceholder')}
            placeholderTextColor={colors.textTertiary}
            keyboardType="phone-pad"
            value={phoneInput}
            onChangeText={setPhoneInput}
          />
          <TouchableOpacity style={styles.button} onPress={sendOtp} disabled={loading} activeOpacity={0.85}>
            <Text style={styles.buttonText}>{loading ? t('login.sending') : t('login.sendCode')}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.label}>{t('login.enterCode')} {phoneInput}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('login.codePlaceholder')}
            placeholderTextColor={colors.textTertiary}
            keyboardType="number-pad"
            value={otp}
            onChangeText={setOtp}
          />
          <TouchableOpacity style={styles.button} onPress={verifyOtp} disabled={loading} activeOpacity={0.85}>
            <Text style={styles.buttonText}>{loading ? t('login.verifying') : t('login.verify')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setOtpSent(false)} style={{ marginTop: spacing.md }}>
            <Text style={styles.backText}>{t('login.differentNumber')}</Text>
          </TouchableOpacity>
        </>
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
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