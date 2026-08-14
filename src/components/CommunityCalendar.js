import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Real month grid, not a relabeled list — days with an actual scheduled
// gathering get a dot; tapping a day filters the caller's list to just
// that date. `gatherings` only needs a `scheduled_at` field per item.
export default function CommunityCalendar({ gatherings, selectedDate, onSelectDate }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const gatheringDates = useMemo(() => (gatherings ?? []).map((g) => new Date(g.scheduled_at)), [gatherings]);

  const monthLabel = visibleMonth.toLocaleDateString([], { month: 'long', year: 'numeric' });

  const cells = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const result = [];
    for (let i = 0; i < firstDayOfWeek; i++) result.push(null);
    for (let day = 1; day <= daysInMonth; day++) result.push(new Date(year, month, day));
    return result;
  }, [visibleMonth]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => setVisibleMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
          accessibilityLabel="Previous month"
          accessibilityRole="button"
        >
          <Text style={styles.navArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <TouchableOpacity
          onPress={() => setVisibleMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
          accessibilityLabel="Next month"
          accessibilityRole="button"
        >
          <Text style={styles.navArrow}>›</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((w, i) => (
          <Text key={i} style={styles.weekdayLabel}>{w}</Text>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((date, i) => {
          if (!date) return <View key={i} style={styles.cell} />;
          const hasGathering = gatheringDates.some((d) => sameDay(d, date));
          const isSelected = selectedDate && sameDay(selectedDate, date);
          const isToday = sameDay(date, new Date());
          return (
            <TouchableOpacity
              key={i}
              style={[styles.cell, isSelected && styles.cellSelected]}
              onPress={() => onSelectDate(isSelected ? null : date)}
              disabled={!hasGathering}
              accessibilityLabel={`${date.toLocaleDateString([], { month: 'long', day: 'numeric' })}${hasGathering ? ', has a gathering' : ''}`}
              accessibilityRole="button"
            >
              <Text style={[styles.dayText, isToday && styles.dayTextToday, isSelected && styles.dayTextSelected, !hasGathering && styles.dayTextMuted]}>
                {date.getDate()}
              </Text>
              {hasGathering && <View style={[styles.dot, isSelected && styles.dotSelected]} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { marginBottom: spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  navArrow: { fontSize: 22, color: colors.primary, paddingHorizontal: spacing.md, fontWeight: '700' },
  monthLabel: { ...typography.bodyBold, color: colors.textPrimary },
  weekdayRow: { flexDirection: 'row' },
  weekdayLabel: { flex: 1, textAlign: 'center', color: colors.textTertiary, fontSize: 11, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, justifyContent: 'center', alignItems: 'center', borderRadius: radius.md },
  cellSelected: { backgroundColor: colors.primaryMuted },
  dayText: { color: colors.textPrimary, fontSize: 13 },
  dayTextMuted: { color: colors.textTertiary },
  dayTextToday: { fontWeight: '800' },
  dayTextSelected: { color: colors.primary, fontWeight: '800' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.textSecondary, marginTop: 2 },
  dotSelected: { backgroundColor: colors.textSecondary },
});
