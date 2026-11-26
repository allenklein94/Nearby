// Duplicate-detail / identical-image warnings inside the existing admin application review (20270414, owner idea 36).
// Evidence for the admin, never a decision: no reject, block or hide. "Expected" records why a match is fine (shared
// owner, franchise, licensed stock image) and keeps it listed, muted. Wording + grouping: utils/businessDuplicateWarnings.js.
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { duplicateWarningLine, DISMISS_REASON_MIN } from '../utils/businessDuplicateWarnings';

export default function AdminDuplicateWarnings({ rows, onDismiss, title = 'Check before approving' }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [openKey, setOpenKey] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!rows?.length) return null;
  const keyOf = (r) => `${r.match_kind}:${r.subject_id}:${r.other_request_id ?? r.other_partner_id}`;

  async function save(row) {
    if (reason.trim().length < DISMISS_REASON_MIN || busy) return;
    setBusy(true);
    const ok = await onDismiss(row, reason);
    setBusy(false);
    if (ok) { setOpenKey(null); setReason(''); }
  }

  return (
    <View style={styles.box} accessibilityRole="summary">
      <Text style={styles.title}>⚠️ {title}</Text>
      <Text style={styles.hint}>A match is a reason to look, not proof: shared owners, franchises and stock images match too.</Text>
      {rows.map((r) => {
        const k = keyOf(r);
        return (
          <View key={k} style={styles.row}>
            <Text style={[styles.line, r.dismissed && styles.muted]}>{duplicateWarningLine(r)}</Text>
            {r.dismissed ? (
              <Text style={styles.muted}>Marked expected{r.dismissed_at ? ` ${new Date(r.dismissed_at).toLocaleDateString()}` : ''}: {r.dismissed_reason}</Text>
            ) : openKey === k ? (
              <View>
                <TextInput
                  style={styles.input}
                  placeholder="Why is this expected? (e.g. same owner, confirmed by phone)"
                  placeholderTextColor={colors.textTertiary}
                  value={reason}
                  onChangeText={setReason}
                  maxLength={300}
                  accessibilityLabel="Reason this match is expected"
                />
                <TouchableOpacity
                  onPress={() => save(r)}
                  disabled={busy || reason.trim().length < DISMISS_REASON_MIN}
                  accessibilityRole="button"
                  accessibilityLabel="Save: this match is expected"
                >
                  <Text style={[styles.action, reason.trim().length < DISMISS_REASON_MIN && styles.muted]}>Save</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => { setOpenKey(k); setReason(''); }} accessibilityRole="button" accessibilityLabel="Mark this match as expected">
                <Text style={styles.action}>Mark as expected</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    box: { borderWidth: 1, borderColor: colors.warning ?? colors.border, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm },
    title: { fontWeight: '700', color: colors.textPrimary, fontSize: 14 },
    hint: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    row: { marginTop: spacing.sm },
    line: { color: colors.textPrimary, fontSize: 13 },
    muted: { color: colors.textTertiary, fontSize: 12 },
    action: { color: colors.primary, fontWeight: '700', fontSize: 13, marginTop: 4 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.xs, color: colors.textPrimary, marginTop: 4, fontSize: 13 },
  });
}
