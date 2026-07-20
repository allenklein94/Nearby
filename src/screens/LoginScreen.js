import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { supabase } from '../services/supabase';
import { colors, typography, spacing, radius, shadow } from '../theme';

const REVIEWER_PHONE_DIGITS = '5555550199';

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
          email: result.email,
          token: result.tokenHash,
          type: 'magiclink',
        });
        if (verifyError) return Alert.alert('Error', verifyError.message);
      } catch (e) {
        setLoading(false);