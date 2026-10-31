import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Alert } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import {
  VERIFICATION_CHECKS, VERIFICATION_OUTCOMES, methodLabel, verificationStateLine, emptyReviewDraft, reviewDraftProblem, reviewDraftChecks,
} from '../utils/businessVerification';

// Verified Business admin review (owner, 2026-10-31; migration 20270371), inside the existing Business Requests admin screen
// (no new screen). Approval stays where it was; this records the separate verification: four checks, each with how it was
// done (the server's fixed list), the outcome and a factual note, plus the decision. The server stamps who and when, refuses
// incomplete evidence, refuses a business you manage, and keeps every decision (append-only). Admin screens are English-only.
export default function AdminBusinessVerificationSection({ refreshKey }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [rows, setRows] = useState(null);
  const [methods, setMethods] = useState(null);
  const [openId, setOpenId] = useState(null);       // the business whose review form is open
  const [revokeId, setRevokeId] = useState(null);   // the business whose revoke form is open
  const [historyId, setHistoryId] = useState(null);
  const [draft, setDraft] = useState(emptyReviewDraft());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, m] = await Promise.all([
      supabase.rpc('admin_list_business_verifications'),
      supabase.rpc('admin_business_verification_methods'),
    ]);
    setRows(list.error ? [] : list.data ?? []);
    setMethods(m.error ? null : m.data);
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (!rows || !methods) return null; // not live yet (before 20270371) or not an admin: nothing to show

  function openReview(id) {
    setOpenId(openId === id ? null : id);
    setRevokeId(null);
    setDraft(emptyReviewDraft());
  }
  function setCheck(key, field, value) {
    setDraft((d) => ({ ...d, checks: { ...d.checks, [key]: { ...d.checks[key], [field]: value } } }));
  }
  async function submitReview(row) {
    const problem = reviewDraftProblem(draft);
    if (problem) return Alert.alert('Not recorded yet', problem);
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_verify_business', {
      partner_id_param: row.partner_id, checks_param: reviewDraftChecks(draft), decision_note_param: draft.decision,
    });
    setBusy(false);
    if (error) return Alert.alert('Not recorded', error.message);
    Alert.alert(data?.state === 'verified' ? 'Verified' : 'Recorded as not verified',
      data?.state === 'verified' ? `${row.name} now shows Verified Business.` : 'Every check must pass. The review is in the history; no badge shows.');
    setOpenId(null);
    load();
  }
  async function submitRevoke(row) {
    if (reason.trim().length < 10) return Alert.alert('Not revoked yet', 'Write why (at least 10 characters).');
    setBusy(true);
    const { error } = await supabase.rpc('admin_revoke_business_verification', { partner_id_param: row.partner_id, reason_param: reason });
    setBusy(false);
    if (error) return Alert.alert('Not revoked', error.message);
    setRevokeId(null);
    setReason('');
    load();
  }

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Business verification</Text>
      <Text style={styles.help}>
        Separate from approval. Verified Business means Nearby checked the business exists and the person running it here may
        represent it. It is never a rating of quality or safety. Every check needs how you did it and what you found; anything
        inconclusive stays unverified.
      </Text>
      {rows.length === 0 ? <Text style={styles.help}>No approved businesses yet.</Text> : null}
      {rows.map((row) => (
        <View key={row.partner_id} style={styles.row}>
          <Text style={styles.name}>{row.name}</Text>
          {row.address ? <Text style={styles.meta}>{row.address}</Text> : null}
          <Text style={styles.meta}>Managed by {(row.managers ?? []).map((m) => m.display_name || 'unnamed').join(', ') || 'nobody'}</Text>
          <Text style={[styles.state, row.badge && { color: colors.success }]}>{verificationStateLine(row)}</Text>
          <View style={styles.actions}>
            {row.you_manage ? (
              <Text style={styles.meta}>You manage this business, so another admin has to verify it.</Text>
            ) : (
              <TouchableOpacity style={styles.button} onPress={() => openReview(row.partner_id)} accessibilityRole="button">
                <Text style={styles.buttonText}>{openId === row.partner_id ? 'Close review' : 'Record a review'}</Text>
              </TouchableOpacity>
            )}
            {row.state === 'verified' ? (
              <TouchableOpacity style={styles.buttonQuiet} onPress={() => { setRevokeId(revokeId === row.partner_id ? null : row.partner_id); setOpenId(null); }} accessibilityRole="button">
                <Text style={styles.buttonQuietText}>Revoke</Text>
              </TouchableOpacity>
            ) : null}
            {row.history?.length ? (
              <TouchableOpacity style={styles.buttonQuiet} onPress={() => setHistoryId(historyId === row.partner_id ? null : row.partner_id)} accessibilityRole="button">
                <Text style={styles.buttonQuietText}>History ({row.history.length})</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {openId === row.partner_id ? (
            <View style={styles.form}>
              {VERIFICATION_CHECKS.map((c) => (
                <View key={c.key} style={styles.check}>
                  <Text style={styles.checkTitle}>{c.title}</Text>
                  <Text style={styles.help}>{c.help}</Text>
                  <View style={styles.chips}>
                    {(methods[c.key] ?? []).map((m) => (
                      <TouchableOpacity key={m} onPress={() => setCheck(c.key, 'method', m)} style={[styles.chip, draft.checks[c.key].method === m && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: draft.checks[c.key].method === m }}>
                        <Text style={[styles.chipText, draft.checks[c.key].method === m && styles.chipTextOn]}>{methodLabel(m)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.chips}>
                    {VERIFICATION_OUTCOMES.map((o) => (
                      <TouchableOpacity key={o.key} onPress={() => setCheck(c.key, 'outcome', o.key)} style={[styles.chip, draft.checks[c.key].outcome === o.key && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: draft.checks[c.key].outcome === o.key }}>
                        <Text style={[styles.chipText, draft.checks[c.key].outcome === o.key && styles.chipTextOn]}>{o.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    style={styles.input} multiline maxLength={500} value={draft.checks[c.key].note}
                    onChangeText={(v) => setCheck(c.key, 'note', v)}
                    placeholder="What you checked and what you found (e.g. the registry entry number, the number you called and who answered)"
                    placeholderTextColor={colors.textTertiary}
                  />
                </View>
              ))}
              <Text style={styles.checkTitle}>Decision</Text>
              <TextInput
                style={styles.input} multiline maxLength={500} value={draft.decision}
                onChangeText={(v) => setDraft((d) => ({ ...d, decision: v }))}
                placeholder="Your decision and why" placeholderTextColor={colors.textTertiary}
              />
              <Text style={styles.help}>Your name and the time are recorded with it. A recorded review can't be edited.</Text>
              <TouchableOpacity style={[styles.button, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => submitReview(row)} accessibilityRole="button">
                <Text style={styles.buttonText}>Record review</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {revokeId === row.partner_id ? (
            <View style={styles.form}>
              <TextInput
                style={styles.input} multiline maxLength={500} value={reason} onChangeText={setReason}
                placeholder="Why verification is being removed (e.g. ownership changed, evidence no longer valid)"
                placeholderTextColor={colors.textTertiary}
              />
              <TouchableOpacity style={[styles.button, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => submitRevoke(row)} accessibilityRole="button">
                <Text style={styles.buttonText}>Revoke verification</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {historyId === row.partner_id ? (
            <View style={styles.form}>
              {row.history.map((h, i) => (
                <View key={i} style={styles.check}>
                  <Text style={styles.checkTitle}>{h.kind.replace('_', ' ')} · {new Date(h.at).toLocaleString()} · {h.by_name || 'deleted account'}</Text>
                  <Text style={styles.meta}>{h.note}</Text>
                  {Object.entries(h.checks ?? {}).map(([k, v]) => (
                    <Text key={k} style={styles.meta}>{k}: {methodLabel(v.method)}, {v.outcome}. {v.note}</Text>
                  ))}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  heading: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 16, marginBottom: spacing.xs },
  help: { color: colors.textTertiary, fontSize: 12, lineHeight: 17, marginBottom: spacing.xs },
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm },
  name: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  meta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  state: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: spacing.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'center' },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 8, paddingHorizontal: spacing.md, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  buttonQuiet: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingVertical: 8, paddingHorizontal: spacing.md },
  buttonQuietText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  form: { marginTop: spacing.sm, gap: spacing.sm },
  check: { gap: 4 },
  checkTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingVertical: 5, paddingHorizontal: 10 },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 12 },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.textPrimary, minHeight: 44, fontSize: 13 },
});
