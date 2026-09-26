import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Switch, StyleSheet, Platform, Alert } from 'react-native';
import PlatformDateTimeInput from './PlatformDateTimeInput';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { setBusinessOperatingHours } from '../services/brandOffers';
import { operatingHoursProblem, weekHoursLines, formatClock, blankWeek, hoursStatus, DAY_ORDER, DAY_SHORT, MAX_INTERVALS_PER_DAY } from '../utils/operatingStatus';
import { presentRecoverableError } from '../utils/recoverableError';

// Owner item 71: ONE optional "Hours" row on the business Profile tab (expands in place; no new screen or settings area).
// What the owner enters is what is saved -- nothing is guessed, pre-filled with typical hours, or corrected silently; a problem
// is named and the owner fixes it. Clearing the hours makes the business "unknown" again (never "closed").
function toHHMM(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function toDate(hhmm) {
  const d = new Date();
  const [h, m] = String(hhmm).split(':').map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}
function deviceTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function BusinessHoursEditor({ partner, onSaved }) {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const saved = partner?.operating_hours ?? null;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [picker, setPicker] = useState(null); // { target: 'week'|'special', key, index, end: 0|1 } or { target: 'newSpecial' }
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState(null);

  useEffect(() => { if (!open) { setDraft(null); setPicker(null); setProblem(null); } }, [open]);

  function startEditing() {
    setDraft(saved
      ? JSON.parse(JSON.stringify({ special: [], temporarily_closed: false, ...saved }))
      : { timezone: deviceTimeZone(), week: blankWeek(), special: [], temporarily_closed: false });
    setOpen(true);
  }

  const update = (fn) => { setDraft((d) => fn(JSON.parse(JSON.stringify(d)))); setProblem(null); };
  const getDay = (d, target, key) => (target === 'week' ? d.week[key] : d.special.find((s) => s.date === key)?.hours);
  const setDay = (d, target, key, value) => {
    if (target === 'week') d.week[key] = value;
    else d.special = d.special.map((s) => (s.date === key ? { ...s, hours: value } : s));
    return d;
  };

  async function save(next) {
    const cleaned = next ? { ...next, special: (next.special ?? []).length ? next.special : undefined } : null;
    if (cleaned && !cleaned.special) delete cleaned.special;
    const p = cleaned ? operatingHoursProblem(cleaned) : null;
    if (p) { setProblem(p); return; }
    setSaving(true);
    try {
      await setBusinessOperatingHours(partner.id, cleaned);
      onSaved?.(cleaned);
      setOpen(false);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'save your hours', error: e, onRetry: () => save(next) });
    }
    setSaving(false);
  }

  function confirmClear() {
    Alert.alert('Remove your hours?', 'People filtering by "Open now" won\'t see your business until you add them again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => save(null) },
    ]);
  }

  function renderDayEditor(target, key, label) {
    const value = getDay(draft, target, key);
    const mode = value === 'closed' ? 'closed' : value === 'all_day' ? 'all_day' : Array.isArray(value) ? 'hours' : null;
    return (
      <View key={`${target}-${key}`} style={styles.dayBlock}>
        <View style={styles.dayRow}>
          <Text style={styles.dayLabel}>{label}</Text>
          {[['closed', 'Closed'], ['hours', 'Hours'], ['all_day', '24 hours']].map(([m, text]) => (
            <TouchableOpacity
              key={m}
              style={[styles.chip, mode === m && styles.chipSelected]}
              onPress={() => update((d) => setDay(d, target, key, m === 'hours' ? (Array.isArray(value) ? value : [['09:00', '17:00']]) : m))}
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${text}`}
              accessibilityState={{ selected: mode === m }}
            >
              <Text style={[styles.chipText, mode === m && styles.chipTextSelected]}>{text}</Text>
            </TouchableOpacity>
          ))}
          {target === 'special' ? (
            <TouchableOpacity onPress={() => update((d) => { d.special = d.special.filter((s) => s.date !== key); return d; })} accessibilityRole="button" accessibilityLabel={`Remove ${label}`}>
              <Text style={styles.remove}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {mode === 'hours' && value.map(([o, c], i) => (
          <View key={i} style={styles.intervalRow}>
            {[[0, o, 'Opens'], [1, c, 'Closes']].map(([end, v, word]) => (
              <TouchableOpacity key={end} style={styles.chip} onPress={() => setPicker({ target, key, index: i, end })} accessibilityRole="button" accessibilityLabel={`${label} ${word} ${v}`}>
                <Text style={styles.chipText}>{word} {formatClock(v)}</Text>
              </TouchableOpacity>
            ))}
            {value.length > 1 ? (
              <TouchableOpacity onPress={() => update((d) => setDay(d, target, key, value.filter((_, j) => j !== i)))} accessibilityRole="button" accessibilityLabel={`Remove this time range on ${label}`}>
                <Text style={styles.remove}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
        {mode === 'hours' && value.length < MAX_INTERVALS_PER_DAY ? (
          <TouchableOpacity onPress={() => update((d) => setDay(d, target, key, [...value, ['17:00', '22:00']]))} accessibilityRole="button" accessibilityLabel={`Add another time range on ${label}`}>
            <Text style={styles.link}>+ Add another time range</Text>
          </TouchableOpacity>
        ) : null}
        {picker && picker.target === target && picker.key === key && Array.isArray(value) && value[picker.index] ? (
          <PlatformDateTimeInput
            value={toDate(value[picker.index][picker.end])}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            themeVariant={isDark ? 'dark' : 'light'}
            onChange={(event, selected) => {
              const pk = picker;
              setPicker(Platform.OS === 'ios' ? pk : null);
              if (selected && event?.type !== 'dismissed') {
                update((d) => {
                  const v = getDay(d, pk.target, pk.key);
                  v[pk.index][pk.end] = toHHMM(selected);
                  return setDay(d, pk.target, pk.key, v);
                });
              }
            }}
          />
        ) : null}
      </View>
    );
  }

  const lines = weekHoursLines(saved);
  const now = saved ? hoursStatus(saved) : null;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.row} onPress={open ? () => setOpen(false) : startEditing} accessibilityRole="button" accessibilityLabel={saved ? 'Edit your hours' : 'Add your hours'}>
        <Text style={styles.rowTitle}>🕒 Hours</Text>
        <Text style={styles.rowAction}>{open ? 'Close' : saved ? 'Edit' : 'Add hours'}</Text>
      </TouchableOpacity>
      {!open && (lines ? (
        <View>
          {now?.label ? <Text style={styles.status}>{now.label}{saved.temporarily_closed ? '' : ` (${saved.timezone})`}</Text> : null}
          {lines.map((l) => <Text key={l.day} style={styles.summary}>{l.day}  {l.text}</Text>)}
          {(saved.special ?? []).length ? <Text style={styles.helper}>{saved.special.length} special day{saved.special.length === 1 ? '' : 's'} set</Text> : null}
        </View>
      ) : (
        <Text style={styles.helper}>Not set. People who filter Discover by "Open now" only see businesses with hours or a live availability posting.</Text>
      ))}
      {open && draft && (
        <View>
          <Text style={styles.label}>Time zone</Text>
          <TextInput
            style={styles.input}
            value={draft.timezone}
            onChangeText={(t) => update((d) => { d.timezone = t.trim(); return d; })}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Time zone"
            placeholder="America/Los_Angeles"
            placeholderTextColor={colors.textTertiary}
          />
          {deviceTimeZone() && deviceTimeZone() !== draft.timezone ? (
            <TouchableOpacity onPress={() => update((d) => { d.timezone = deviceTimeZone(); return d; })} accessibilityRole="button" accessibilityLabel={`Use ${deviceTimeZone()}`}>
              <Text style={styles.link}>Use this device's time zone ({deviceTimeZone()})</Text>
            </TouchableOpacity>
          ) : null}
          <View style={styles.switchRow}>
            <Text style={styles.label}>Temporarily closed</Text>
            <Switch value={draft.temporarily_closed === true} onValueChange={(v) => update((d) => { d.temporarily_closed = v; return d; })} accessibilityLabel="Temporarily closed" />
          </View>
          {DAY_ORDER.map((d) => renderDayEditor('week', d, DAY_SHORT[d]))}
          {Array.isArray(draft.week.mon) || draft.week.mon === 'closed' || draft.week.mon === 'all_day' ? (
            <TouchableOpacity onPress={() => update((d) => { DAY_ORDER.forEach((k) => { d.week[k] = JSON.parse(JSON.stringify(d.week.mon)); }); return d; })} accessibilityRole="button" accessibilityLabel="Copy Monday to every day">
              <Text style={styles.link}>Copy Monday to every day</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={[styles.label, { marginTop: spacing.md }]}>Special days (holidays, events)</Text>
          {(draft.special ?? []).map((s) => renderDayEditor('special', s.date, s.date))}
          <TouchableOpacity onPress={() => setPicker({ target: 'newSpecial' })} accessibilityRole="button" accessibilityLabel="Add a special day">
            <Text style={styles.link}>+ Add a special day</Text>
          </TouchableOpacity>
          {picker?.target === 'newSpecial' ? (
            <PlatformDateTimeInput
              value={new Date()}
              mode="date"
              minimumDate={new Date()}
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              themeVariant={isDark ? 'dark' : 'light'}
              onChange={(event, selected) => {
                setPicker(null);
                if (!selected || event?.type === 'dismissed') return;
                const key = `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}`;
                if (key < todayKey()) return;
                update((d) => { if (!d.special.some((x) => x.date === key)) d.special.push({ date: key, hours: 'closed' }); return d; });
              }}
            />
          ) : null}
          {problem ? <Text style={styles.problem}>{problem}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.primary} onPress={() => save(draft)} disabled={saving} accessibilityRole="button" accessibilityLabel="Save hours">
              <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save hours'}</Text>
            </TouchableOpacity>
            {saved ? (
              <TouchableOpacity onPress={confirmClear} disabled={saving} accessibilityRole="button" accessibilityLabel="Remove hours">
                <Text style={styles.danger}>Remove hours</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.helper}>Hours say when you're open. They don't say you have room: post availability for that.</Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { marginTop: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.xs },
  rowTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  rowAction: { color: colors.primary, fontWeight: '700' },
  status: { color: colors.textSecondary, fontWeight: '600', marginBottom: 4 },
  summary: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  helper: { color: colors.textTertiary, fontSize: 12, marginTop: spacing.xs, lineHeight: 17 },
  label: { color: colors.textSecondary, fontWeight: '700', marginTop: spacing.sm, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.textPrimary, backgroundColor: colors.surface },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  dayBlock: { marginTop: spacing.sm },
  dayRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
  dayLabel: { width: 88, color: colors.textPrimary, fontWeight: '700' },
  intervalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs, marginLeft: 88 },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.full ?? 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipSelected: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  chipTextSelected: { color: colors.primary },
  remove: { color: colors.textTertiary, fontSize: 16, paddingHorizontal: spacing.xs },
  link: { color: colors.primary, fontWeight: '700', marginTop: spacing.xs },
  problem: { color: colors.danger, marginTop: spacing.sm, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  primary: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md },
  primaryText: { color: '#fff', fontWeight: '700' },
  danger: { color: colors.danger, fontWeight: '700' },
});
