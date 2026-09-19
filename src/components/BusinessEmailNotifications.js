import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, Switch, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import {
  getMyBusinessEmailSettings, startBusinessEmailVerification, confirmBusinessEmail,
  removeBusinessEmail, setBusinessEmailEnabled, businessEmailReasonCopy,
} from '../services/businessEmail';

// Email alerts for an owner who uses Nearby on the website and has no phone to push to (the same Important alerts the
// app would push: new requests, offer responses, reservations). Verified with a 6-digit code before anything is sent.
export default function BusinessEmailNotifications() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [settings, setSettings] = useState(undefined); // undefined = loading, null = none saved
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    try { setSettings(await getMyBusinessEmailSettings()); } catch (e) { setSettings(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(fn) {
    setBusy(true);
    setMessage(null);
    try { await fn(); } catch (e) { setMessage(e.message || businessEmailReasonCopy()); }
    setBusy(false);
  }

  const sendCode = () => run(async () => {
    const r = await startBusinessEmailVerification(email);
    if (r.ok) { setCodeSent(true); setMessage(`We sent a 6-digit code to ${email.trim()}.`); } else setMessage(businessEmailReasonCopy(r.reason));
  });
  const confirm = () => run(async () => {
    const r = await confirmBusinessEmail(code);
    if (r.ok) { setCode(''); setCodeSent(false); setEmail(''); await load(); } else setMessage(businessEmailReasonCopy(r.reason));
  });
  const remove = () => run(async () => { await removeBusinessEmail(); setCodeSent(false); await load(); });
  const toggle = (value) => run(async () => { await setBusinessEmailEnabled(value); await load(); });

  if (settings === undefined) return null;
  const verified = !!settings?.verified;

  return (
    <View style={styles.card}>
      <Text style={styles.header}>Email me when I'm not on my phone</Text>
      <Text style={styles.body}>
        Using Nearby on the website? Get important alerts (new requests, offer responses, reservations) by email too.
      </Text>

      {verified ? (
        <>
          <View style={styles.row}>
            <Text style={styles.email}>{settings.email}</Text>
            <Switch value={!!settings.enabled} onValueChange={toggle} disabled={busy} accessibilityLabel="Email alerts" />
          </View>
          <TouchableOpacity onPress={remove} disabled={busy} accessibilityRole="button" accessibilityLabel="Remove email address">
            <Text style={styles.link}>Remove this address</Text>
          </TouchableOpacity>
        </>
      ) : codeSent ? (
        <>
          <TextInput style={styles.input} value={code} onChangeText={setCode} placeholder="6-digit code" placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad" maxLength={6} accessibilityLabel="Verification code" />
          <TouchableOpacity style={[styles.button, (busy || code.length !== 6) && styles.disabled]} onPress={confirm} disabled={busy || code.length !== 6} accessibilityRole="button">
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.buttonText}>Confirm</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setCodeSent(false); setCode(''); setMessage(null); }} accessibilityRole="button">
            <Text style={styles.link}>Use a different address</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="you@yourbusiness.com" placeholderTextColor={colors.textSecondary}
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Email address" />
          <TouchableOpacity style={[styles.button, (busy || !email.includes('@')) && styles.disabled]} onPress={sendCode} disabled={busy || !email.includes('@')} accessibilityRole="button">
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.buttonText}>Send a code</Text>}
          </TouchableOpacity>
        </>
      )}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.xl },
  header: { ...typography.bodyBold, color: colors.textPrimary },
  body: { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  email: { color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.textPrimary, marginBottom: spacing.sm },
  button: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.sm, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.5 },
  link: { color: colors.textSecondary, marginTop: spacing.sm, textDecorationLine: 'underline' },
  message: { color: colors.textSecondary, marginTop: spacing.sm },
});
