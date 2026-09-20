import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { listSponsoredPaymentsForApprover, requestSponsoredRefund } from '../services/sponsored';
import { priceLabel, dayLabel } from '../utils/sponsoredPromotions';

// Sponsored spotlight refunds. Visible only to a platform admin who is also a NAMED finance approver (the database
// enforces it; this screen just shows what it returns). The approver picks the case and gives a reason; the DATABASE
// computes the amount. Every confirmation names the exact amount before anything is sent.
const KINDS = [
  { key: 'full_before_start', label: 'Full refund (not started)' },
  { key: 'late_payment', label: 'Late payment (full)' },
  { key: 'nearby_failure', label: 'Nearby failed to deliver (prorated)' },
];

export default function AdminSponsoredRefundsScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [state, setState] = useState({ loading: true });
  const [openId, setOpenId] = useState(null);
  const [kind, setKind] = useState('full_before_start');
  const [days, setDays] = useState('3');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => setState({ ...(await listSponsoredPaymentsForApprover()), loading: false }), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const confirm = (row) => {
    const undelivered = kind === 'nearby_failure' ? parseInt(days, 10) : null;
    if (kind === 'nearby_failure' && !(undelivered >= 1 && undelivered <= 7)) { setMessage('Undelivered days must be 1 to 7.'); return; }
    if (reason.trim().length < 3) { setMessage('Add a reason (at least 3 characters). It is recorded.'); return; }
    Alert.alert(
      'Send this refund to Stripe?',
      `${row.partner_name} · ${row.title}\nThe amount is worked out by the system from the refund rules and recorded against your name. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Refund', style: 'destructive', onPress: async () => {
          setBusy(true); setMessage(null);
          const res = await requestSponsoredRefund({ paymentId: row.payment_id, kind, undeliveredDays: undelivered, reason: reason.trim() });
          setBusy(false);
          if (res.error) { setMessage(res.error); return; }
          setMessage(`Refund of ${priceLabel(res.amountCents, row.currency)} sent to Stripe.`);
          setOpenId(null); setReason('');
          load();
        } },
      ]
    );
  };

  if (state.loading) return <SafeAreaView style={styles.container}><Text style={styles.helper}>Loading…</Text></SafeAreaView>;
  if (state.error === 'not_an_approver') return <SafeAreaView style={styles.container}><Text style={styles.helper}>You are not an approved finance approver. The platform owner adds approvers.</Text></SafeAreaView>;
  if (state.error) return <SafeAreaView style={styles.container}><Text style={styles.helper}>Couldn't load payments.</Text></SafeAreaView>;

  return (
    <SafeAreaView style={styles.container}>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <FlatList
        data={state.rows}
        keyExtractor={(r) => r.payment_id}
        ListEmptyComponent={<Text style={styles.helper}>No paid spotlights yet.</Text>}
        renderItem={({ item: r }) => (
          <View style={styles.card}>
            <Text style={styles.title} numberOfLines={1}>{r.partner_name} · {r.title}</Text>
            <Text style={styles.helper}>
              {dayLabel(r.starts_at)} – {dayLabel(r.ends_at)} · {priceLabel(r.amount_cents, r.currency)} · {r.payment_status}
              {r.refunded_cents > 0 ? ` · ${priceLabel(r.refunded_cents, r.currency)} refunded` : ''}
            </Text>
            {r.refund_due ? <Text style={styles.flag}>Flagged: money arrived that should be refunded.</Text> : null}
            {r.last_refund_status ? <Text style={styles.helper}>Last refund attempt: {r.last_refund_status}</Text> : null}
            {['paid', 'partially_refunded'].includes(r.payment_status) && r.amount_cents > r.refunded_cents ? (
              <TouchableOpacity onPress={() => { setOpenId(openId === r.payment_id ? null : r.payment_id); setMessage(null); }} accessibilityRole="button" accessibilityLabel="Refund this payment">
                <Text style={styles.link}>{openId === r.payment_id ? 'Close' : 'Refund…'}</Text>
              </TouchableOpacity>
            ) : null}
            {openId === r.payment_id ? (
              <View>
                {KINDS.map((k) => (
                  <TouchableOpacity key={k.key} style={[styles.chip, kind === k.key && styles.chipOn]} onPress={() => setKind(k.key)} accessibilityRole="button">
                    <Text style={[styles.chipText, kind === k.key && styles.chipTextOn]}>{k.label}</Text>
                  </TouchableOpacity>
                ))}
                {kind === 'nearby_failure' ? (
                  <TextInput style={styles.input} value={days} onChangeText={setDays} keyboardType="number-pad" placeholder="Undelivered days (1-7)" placeholderTextColor={colors.textSecondary} />
                ) : null}
                <TextInput style={styles.input} value={reason} onChangeText={setReason} maxLength={500} placeholder="Reason (recorded)" placeholderTextColor={colors.textSecondary} />
                <TouchableOpacity style={[styles.cta, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => confirm(r)} accessibilityRole="button">
                  <Text style={styles.ctaText}>Review refund</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  title: { ...typography.bodyBold, color: colors.text },
  helper: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  flag: { ...typography.caption, color: colors.danger, marginTop: spacing.xs },
  message: { ...typography.caption, color: colors.text, marginBottom: spacing.sm },
  link: { ...typography.caption, color: colors.primary, marginTop: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.xs },
  chipOn: { borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.text },
  chipTextOn: { color: colors.primary, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: spacing.xs },
  cta: { backgroundColor: colors.danger, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  ctaText: { ...typography.body, color: '#fff', fontWeight: '600' },
});
