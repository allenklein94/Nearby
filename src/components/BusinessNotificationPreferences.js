import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { BUSINESS_NOTIFICATION_GROUPS } from '../constants/businessNotificationGroups';
import { getMyBusinessNotificationPrefs, setBusinessNotificationGroupMuted } from '../services/businessEmail';

// Which kinds of alerts an owner wants, on the phone and by email alike. Everything is on until switched off.
export default function BusinessNotificationPreferences() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [muted, setMuted] = useState(undefined); // undefined = loading
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try { setMuted((await getMyBusinessNotificationPrefs()) ?? []); } catch (e) { setMuted(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(group, on) {
    const before = muted;
    setError(null);
    setMuted(on ? muted.filter((g) => g !== group) : [...muted, group]);
    try { await setBusinessNotificationGroupMuted(group, !on); } catch (e) { setMuted(before); setError("Couldn't save that. Please try again."); }
  }

  if (!muted) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.header}>Which alerts do you want?</Text>
      <Text style={styles.body}>Applies to phone and email. Account updates, like approvals, always come through.</Text>
      {BUSINESS_NOTIFICATION_GROUPS.map((g, i) => (
        <View key={g.key} style={[styles.row, i > 0 && styles.divider]}>
          <View style={{ flex: 1, marginRight: spacing.sm }}>
            <Text style={styles.label}>{g.label}</Text>
            <Text style={styles.detail}>{g.detail}</Text>
          </View>
          <Switch value={!muted.includes(g.key)} onValueChange={(on) => toggle(g.key, on)} accessibilityLabel={g.label} />
        </View>
      ))}
      {error ? <Text style={styles.detail}>{error}</Text> : null}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.xl },
  header: { ...typography.bodyBold, color: colors.textPrimary },
  body: { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  label: { color: colors.textPrimary, fontWeight: '600' },
  detail: { color: colors.textSecondary, marginTop: 2 },
});
