import React, { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TouchableOpacity, TextInput, Switch, StyleSheet, Platform, Alert } from 'react-native';
import PlatformDateTimeInput from './PlatformDateTimeInput';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { setBusinessOperatingHours } from '../services/brandOffers';
import { operatingHoursProblem, formatClock, blankWeek, DAY_ORDER, DAY_SHORT, MAX_INTERVALS_PER_DAY } from '../utils/operatingStatus';
import { weekHoursRows, hoursLine } from '../i18n/businessProfileDisplay';
import { bizClock } from '../i18n/bizFormat';
import { vocabValue } from '../i18n/format';

const WEEKDAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
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
  const { t, language } = useLanguage();
  // The editor's day chips: English keeps "Mon"; other languages use their own weekday names.
  const dayChip = (d) => (language === 'en' ? DAY_SHORT[d] : (vocabValue(language, 'date.weekdays') ?? [])[WEEKDAY_INDEX[d]] ?? DAY_SHORT[d]);
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
    Alert.alert(t('ui.bizComp.removeYourHours'), t('ui.bizComp.peopleFilteringByOpenNow'), [
      { text: t('ui.bizComp.cancel'), style: 'cancel' },
      { text: t('ui.bizComp.remove'), style: 'destructive', onPress: () => save(null) },
    ]);
  }

  function renderDayEditor(target, key, label) {
    const value = getDay(draft, target, key);
    const mode = value === 'closed' ? 'closed' : value === 'all_day' ? 'all_day' : Array.isArray(value) ? 'hours' : null;
    return (
      <View key={`${target}-${key}`} style={styles.dayBlock}>
        <View style={styles.dayRow}>
          <Text style={styles.dayLabel}>{label}</Text>
          {[['closed', t('ui.bizComp.closed')], ['hours', t('ui.bizComp.hours')], ['all_day', t('ui.bizComp.n24Hours')]].map(([m, text]) => (
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
            <TouchableOpacity onPress={() => update((d) => { d.special = d.special.filter((s) => s.date !== key); return d; })} accessibilityRole="button" accessibilityLabel={t('ui.bizComp.removeA11y', { label: label })}>
              <Text style={styles.remove}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {mode === 'hours' && value.map(([o, c], i) => (
          <View key={i} style={styles.intervalRow}>
            {[[0, o, t('ui.bizComp.opens')], [1, c, t('ui.bizComp.closes')]].map(([end, v, word]) => (
              <TouchableOpacity key={end} style={styles.chip} onPress={() => setPicker({ target, key, index: i, end })} accessibilityRole="button" accessibilityLabel={`${label} ${word} ${v}`}>
                <Text style={styles.chipText}>{word} {language === 'en' ? formatClock(v) : bizClock(v)}</Text>
              </TouchableOpacity>
            ))}
            {value.length > 1 ? (
              <TouchableOpacity onPress={() => update((d) => setDay(d, target, key, value.filter((_, j) => j !== i)))} accessibilityRole="button" accessibilityLabel={t('ui.bizComp.removeThisTimeRangeOnA11y', { label: label })}>
                <Text style={styles.remove}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
        {mode === 'hours' && value.length < MAX_INTERVALS_PER_DAY ? (
          <TouchableOpacity onPress={() => update((d) => setDay(d, target, key, [...value, ['17:00', '22:00']]))} accessibilityRole="button" accessibilityLabel={t('ui.bizComp.addAnotherTimeRangeOnA11y', { label: label })}>
            <Text style={styles.link}>{t('ui.bizComp.addAnotherTimeRange')}</Text>
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

  // The same rows and status line the public profile shows, in the owner's language (English unchanged).
  const lines = weekHoursRows(saved, language);
  const nowLabel = saved ? hoursLine({ operating_hours: saved }, language) : null;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.row} onPress={open ? () => setOpen(false) : startEditing} accessibilityRole="button" accessibilityLabel={saved ? t('ui.bizComp.editYourHoursA11y') : t('ui.bizComp.addYourHoursA11y')}>
        <Text style={styles.rowTitle}>{t('ui.bizComp.hours2')}</Text>
        <Text style={styles.rowAction}>{open ? t('ui.bizComp.close') : saved ? t('ui.bizComp.edit') : t('ui.bizComp.addHours')}</Text>
      </TouchableOpacity>
      {!open && (lines ? (
        <View>
          {nowLabel ? <Text style={styles.status}>{nowLabel}{saved.temporarily_closed ? '' : ` (${saved.timezone})`}</Text> : null}
          {lines.map((l) => <Text key={l.key} style={styles.summary}>{l.day}  {l.text}</Text>)}
          {(saved.special ?? []).length ? <Text style={styles.helper}>{t('ui.bizComp.specialDaysSet', { count: saved.special.length })}</Text> : null}
        </View>
      ) : (
        <Text style={styles.helper}>{t('ui.bizComp.notSetPeopleWhoFilter')}</Text>
      ))}
      {open && draft && (
        <View>
          <Text style={styles.label}>{t('ui.bizComp.timeZone')}</Text>
          <TextInput
            style={styles.input}
            value={draft.timezone}
            onChangeText={(t) => update((d) => { d.timezone = t.trim(); return d; })}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t('ui.bizComp.timeZoneA11y')}
            placeholder="America/Los_Angeles"
            placeholderTextColor={colors.textTertiary}
          />
          {deviceTimeZone() && deviceTimeZone() !== draft.timezone ? (
            <TouchableOpacity onPress={() => update((d) => { d.timezone = deviceTimeZone(); return d; })} accessibilityRole="button" accessibilityLabel={t('ui.bizComp.useA11y', { deviceTimeZone: deviceTimeZone() })}>
              <Text style={styles.link}>{t('ui.bizComp.useThisDevicesTimeZone', { zone: deviceTimeZone() })}</Text>
            </TouchableOpacity>
          ) : null}
          <View style={styles.switchRow}>
            <Text style={styles.label}>{t('ui.bizComp.temporarilyClosed')}</Text>
            <Switch value={draft.temporarily_closed === true} onValueChange={(v) => update((d) => { d.temporarily_closed = v; return d; })} accessibilityLabel={t('ui.bizComp.temporarilyClosedA11y')} />
          </View>
          {DAY_ORDER.map((d) => renderDayEditor('week', d, dayChip(d)))}
          {Array.isArray(draft.week.mon) || draft.week.mon === 'closed' || draft.week.mon === 'all_day' ? (
            <TouchableOpacity onPress={() => update((d) => { DAY_ORDER.forEach((k) => { d.week[k] = JSON.parse(JSON.stringify(d.week.mon)); }); return d; })} accessibilityRole="button" accessibilityLabel={t('ui.bizComp.copyMondayToEveryDayA11y')}>
              <Text style={styles.link}>{t('ui.bizComp.copyMondayToEveryDay')}</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={[styles.label, { marginTop: spacing.md }]}>{t('ui.bizComp.specialDaysHolidaysEvents')}</Text>
          {(draft.special ?? []).map((s) => renderDayEditor('special', s.date, s.date))}
          <TouchableOpacity onPress={() => setPicker({ target: 'newSpecial' })} accessibilityRole="button" accessibilityLabel={t('ui.bizComp.addASpecialDayA11y')}>
            <Text style={styles.link}>{t('ui.bizComp.addASpecialDay')}</Text>
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
            <TouchableOpacity style={styles.primary} onPress={() => save(draft)} disabled={saving} accessibilityRole="button" accessibilityLabel={t('ui.bizComp.saveHoursA11y')}>
              <Text style={styles.primaryText}>{saving ? t('ui.bizComp.saving') : t('ui.bizComp.saveHours')}</Text>
            </TouchableOpacity>
            {saved ? (
              <TouchableOpacity onPress={confirmClear} disabled={saving} accessibilityRole="button" accessibilityLabel={t('ui.bizComp.removeHoursA11y')}>
                <Text style={styles.danger}>{t('ui.bizComp.removeHours')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.helper}>{t('ui.bizComp.hoursSayWhenYoureOpen')}</Text>
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
