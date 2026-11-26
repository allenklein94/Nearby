import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { getMyBusinessLocations, selectBusinessLocation } from '../services/businessLocations';
import { currentLocation, normalizeBusinessLocations, showLocationSelector } from '../utils/businessLocations';
import { presentRecoverableError } from '../utils/recoverableError';

// Compact location switch at the top of Business Mode (owner, 2026-11-16). For a one-location account (every business
// today) or before 0424 is live it renders its children (the existing name box) and nothing else. Opens in place (item 45: expand inline, no screen, no sheet); a pick
// asks the server to switch, then onSwitched() reloads Business Mode for that location. No motion.
export default function BusinessLocationSelector({ onSwitched, children = null }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [locations, setLocations] = useState([]);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(null);

  useEffect(() => {
    let alive = true;
    getMyBusinessLocations().then((rows) => { if (alive) setLocations(normalizeBusinessLocations(rows)); });
    return () => { alive = false; };
  }, []);

  if (!showLocationSelector(locations)) return children; // one location: the header's plain business name, unchanged
  const current = currentLocation(locations);

  async function pick(row) {
    if (row.is_selected) { setOpen(false); return; }
    setSwitching(row.partner_id);
    try {
      await selectBusinessLocation(row.partner_id);
      setOpen(false);
      onSwitched?.(row.partner_id);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => pick(row) });
    } finally {
      setSwitching(null);
    }
  }

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.head}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('ui.bizComp.switchLocationA11y', { name: current?.name ?? '' })}
      >
        <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{current?.name ?? ''}</Text>
          <Text style={styles.count}>{t('ui.bizComp.managingLocations', { count: locations.length })}</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textTertiary} />
      </TouchableOpacity>
      {open && locations.map((row) => (
        <TouchableOpacity
          key={row.partner_id}
          style={styles.row}
          onPress={() => pick(row)}
          disabled={switching != null}
          accessibilityRole="button"
          accessibilityState={{ selected: !!row.is_selected, disabled: switching != null }}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.rowName} numberOfLines={1}>{row.name}</Text>
            {row.address ? <Text style={styles.rowAddress} numberOfLines={1}>{row.address}</Text> : null}
          </View>
          {switching === row.partner_id ? <ActivityIndicator size="small" color={colors.textSecondary} />
            : row.is_selected ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { marginBottom: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  name: { ...typography.bodyBold, color: colors.textPrimary },
  count: { ...typography.caption, color: colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowName: { ...typography.body, color: colors.textPrimary },
  rowAddress: { ...typography.caption, color: colors.textTertiary },
});
