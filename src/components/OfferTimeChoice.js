import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { useLanguage } from '../context/LanguageContext';
import { sameInstant } from '../utils/offerTimes';

// Item 119: the two times one business reply offers, inside its one card. With `onSelect` they are selectable rows
// (coral = picked; an instant state change, no animation) under a "Pick a time" hint while nothing is picked; without
// it (the owner's Customer Preview) they are plain lines. `notes` = { [iso]: text } shown beside a time (item 63's
// "Fits 7 PM" only beside the time that really matches; a group's "N of M confirmed" per time). `enabled` = the times
// still bookable (a passed time stays listed, not tappable). `format(iso)` = the card's own time wording.
export default function OfferTimeChoice({ times, selected = null, onSelect = null, notes = {}, enabled = null, format, disabled = false }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors);
  if (!Array.isArray(times) || times.length === 0) return null;
  const canPick = typeof onSelect === 'function';
  const noteFor = (iso) => Object.entries(notes ?? {}).find(([k]) => sameInstant(k, iso))?.[1] ?? null;
  return (
    <View>
      {canPick && !selected ? <Text style={styles.hint}>{t('ui.requestDetail.pickATime')}</Text> : null}
      {times.map((iso) => {
        const label = format(iso);
        const note = noteFor(iso);
        if (!canPick) {
          return <Text key={iso} style={styles.line}>🕐 {label}{note ? ` · ${note}` : ''}</Text>;
        }
        const isOn = sameInstant(selected, iso);
        const open = !enabled || enabled.some((e) => sameInstant(e, iso));
        return (
          <TouchableOpacity
            key={iso}
            style={[styles.row, isOn && styles.rowOn, !open && styles.rowOff]}
            onPress={() => onSelect(iso)}
            disabled={disabled || !open}
            accessibilityRole="radio"
            accessibilityState={{ selected: isOn, disabled: disabled || !open }}
            accessibilityLabel={t('ui.requestDetail.chooseTimeA11y', { time: label })}
          >
            <Text style={[styles.rowText, isOn && styles.rowTextOn]}>🕐 {label}</Text>
            {note ? <Text style={styles.note}>{note}</Text> : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  hint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  line: { ...typography.body, color: colors.textPrimary, fontWeight: '600', marginBottom: spacing.xs },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.xs,
  },
  rowOn: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  rowOff: { opacity: 0.5 },
  rowText: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  rowTextOn: { color: colors.textPrimary },
  note: { ...typography.caption, color: colors.textSecondary },
});
