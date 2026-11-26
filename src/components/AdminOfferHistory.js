// Admin offer history inside the existing business review card (20270416, owner idea 39). Collapsed by default; reads
// admin_business_offer_history (admins only, business side only) when first opened. Evidence for the admin, never a decision.
// Wording: utils/adminOfferHistory.js.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { offerHistorySteps, offerHistoryTitle, historyUnavailable } from '../utils/adminOfferHistory';

export default function AdminOfferHistory({ partnerId }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  if (!partnerId) return null;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || rows) return;
    setFailed(false);
    const { data, error } = await supabase.rpc('admin_business_offer_history', { partner_id_param: partnerId, limit_param: 50 });
    if (error && !historyUnavailable(error)) { setFailed(true); return; }
    setRows(Array.isArray(data) ? data : []);
  }

  return (
    <View style={styles.box}>
      <TouchableOpacity onPress={toggle} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel="Offer history">
        <Text style={styles.title}>{open ? '▾' : '▸'} Offer history</Text>
      </TouchableOpacity>
      {open ? (
        failed ? (
          <TouchableOpacity onPress={() => { setOpen(false); setRows(null); setTimeout(toggle, 0); }} accessibilityRole="button">
            <Text style={styles.muted}>Couldn't load the offer history. Tap to try again.</Text>
          </TouchableOpacity>
        ) : rows === null ? (
          <Text style={styles.muted}>Loading…</Text>
        ) : rows.length === 0 ? (
          <Text style={styles.muted}>No offers yet.</Text>
        ) : (
          rows.map((r) => (
            <View key={`${r.source}:${r.offer_id}`} style={styles.row}>
              <Text style={styles.line}>{offerHistoryTitle(r)}</Text>
              <Text style={styles.muted}>{offerHistorySteps(r).join(' · ')}</Text>
            </View>
          ))
        )
      ) : null}
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm },
    title: { fontWeight: '700', color: colors.textPrimary, fontSize: 14 },
    row: { marginTop: spacing.sm },
    line: { color: colors.textPrimary, fontSize: 13 },
    muted: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  });
}
