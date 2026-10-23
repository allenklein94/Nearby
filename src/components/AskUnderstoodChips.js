import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { spacing, typography } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES, infoOpacity } from '../motion/motionBudget';
import { categoryName, groupName } from '../i18n/categoryNames';
import { PARTY_TYPE_LABELS } from '../constants/gatheringDisplaySignals';
import { understoodPieces, understoodKey, takeUnderstoodPlay, understoodChoices, sameClock, UNDERSTOOD_CHANGEABLE } from '../utils/askUnderstood';
import { localClock } from '../i18n/format';
import { displayWeekdayDate } from '../i18n/display';
import { localDateFromKey as dayFromKey } from '../utils/createStartTime';

// Owner item 45 (2026-10-11): "Nearby understood me". The quiet chips of what a typed ask was read as ("Tonight · 🌳 Outdoor"),
// shown the moment the ask is understood (under the "Finding…" loader) and kept above its results. Which pieces: only
// utils/askUnderstood.js. Not buttons (the refinement chips below are the ones that change the ask), no coral, no new strings:
// labels reuse the date filter, environment chip, category and party names already shown elsewhere. The first time an ask is
// understood they settle in one after another (small tier, readable from frame one); Reduce Motion or a repeat = already there.
// Owner (2026-10-15, reopens "not buttons" narrowly): with `onRemove` (a results list only, never the loader or People mode)
// each chip carries an ✕, like the category rail's selected chip, and a tap removes that piece (the surface re-runs the ask in
// place through services/askRefine.js). Same look and motion otherwise.
// Owner idea "307" (2026-10-20): with `onChange` too, a WHEN or People chip's label is a button: a tap opens ONE row of that
// piece's existing choices under the chips (no motion, no coral; the current one marked ✓), a choice re-runs the ask in place with it
// (`onChange(piece, value)`), a second tap on the label closes the row; its ✕ still removes. WHAT, WHERE and WHO stay remove-only.
// Owner idea "306" (2026-10-22): the clock chip ("After 7 PM") works the same way; its row offers only the same time AM / PM.
// Owner (2026-10-22): the 4-chip cap stays the visual default, but no understood piece may become impossible to correct: past
// the cap, a quiet "+N" chip (screen reader: "Show more") shows the rest in place, each with its own ✕ / change row.
// Owner (2026-10-23): a named weekday or explicit date shows as its date ("Sat, Oct 3"; "Mon, Jan 5, 2027" in another year; the
// shared date format, no new string); its row offers the existing WHEN choices plus Monday-Sunday as their upcoming dates.
const T = SEQUENCES.askUnderstood;

export default function AskUnderstoodChips({ classifyResult, typedText, onRemove = null, onChange = null, disabled = false }) {
  const { colors } = useTheme();
  const { t, language } = useLanguage();
  const reduceMotion = useReduceMotion();
  const all = understoodPieces(classifyResult, typedText);
  const [showAll, setShowAll] = useState(false);
  const pieces = showAll ? all : all.slice(0, T.maxPieces);
  const hidden = all.length - pieces.length;
  const [play] = useState(() => all.length > 0 && takeUnderstoodPlay(understoodKey(all.slice(0, T.maxPieces), typedText)) && !reduceMotion);
  const steps = useRef(Array.from({ length: T.maxPieces }, () => new Animated.Value(play ? 0 : 1))).current;
  const settled = useRef(new Animated.Value(1)).current; // pieces past the cap appear as they are (no settle)
  const [openKey, setOpenKey] = useState(null);

  useEffect(() => {
    if (!play) return undefined;
    const ease = Easing.bezier(0.2, 0, 0, 1);
    const anim = Animated.stagger(T.staggerMs, steps.map((v) => Animated.timing(v, { toValue: 1, duration: T.pieceMs, easing: ease, useNativeDriver: true })));
    anim.start();
    return () => { anim.stop(); steps.forEach((v) => v.setValue(1)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (all.length === 0) return null;
  const clockText = (c) => {
    const at = (m) => localClock(m, language, { words: true });
    if (c.at != null) return t('ui.discover.understoodClockAt', { time: at(c.at) });
    if (c.after != null && c.before != null) return t('ui.discover.understoodClockBetween', { from: at(c.after), to: at(c.before) });
    return c.after != null ? t('ui.discover.understoodClockAfter', { time: at(c.after) }) : t('ui.discover.understoodClockBefore', { time: at(c.before) });
  };
  // The year only when the date is in another calendar year than today's (owner 2026-10-23: "Mon, Jan 5, 2027").
  const dayText = (key) => { const d = dayFromKey(key); return displayWeekdayDate(d, language, { withYear: d.getFullYear() !== new Date().getFullYear() }); };
  const label = (p) => {
    if (p.key === 'clock') return clockText(p.clock);
    if (p.key === 'what') return p.category ? categoryName(p.category, language) : groupName(p.group, language);
    if (p.key === 'when') return p.date ? dayText(p.date) : t(`ui.gatherings.dateFilter.${p.window}`);
    if (p.key === 'where') return t(p.environment === 'outdoor' ? 'ui.gatherings.envOutdoorChip' : 'ui.gatherings.envIndoorChip');
    if (p.key === 'people') return t('ui.common.count.people', { count: p.count });
    return p.party === 'groups' ? t('ui.discover.tagBigGroup') : PARTY_TYPE_LABELS[p.party];
  };
  const choiceLabel = (key, value) => (key === 'clock' ? clockText(value) : key === 'when' ? (/^\d{4}-/.test(value) ? dayText(value) : t(`ui.gatherings.dateFilter.${value}`)) : t('ui.common.count.people', { count: value }));
  const labels = pieces.map(label);
  const allLabels = all.map(label);
  const removable = typeof onRemove === 'function';
  const changeable = (p) => removable && typeof onChange === 'function' && UNDERSTOOD_CHANGEABLE.includes(p.key);
  const open = pieces.find((p) => p.key === openKey && changeable(p)) ?? null;
  const current = (p) => (p.key === 'clock' ? p.clock : p.key === 'when' ? (p.date ?? p.window) : p.count);
  const isCurrent = (p, v) => (p.key === 'clock' ? sameClock(v, p.clock) : v === current(p));
  return (
    <View
      style={styles.row}
      pointerEvents={removable ? 'box-none' : 'none'}
      {...(removable ? {} : { accessible: true, accessibilityLabel: allLabels.join(', ') })}
    >
      {pieces.map((p, i) => {
        const text = <Text style={[styles.text, { color: colors.textSecondary }]} numberOfLines={1}>{removable ? `${labels[i]} ✕` : labels[i]}</Text>;
        const remove = (child) => (
          <TouchableOpacity
            onPress={() => { setOpenKey(null); onRemove(p.key); }}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            accessibilityLabel={t('ui.discover.selectedTapClear', { label: labels[i] })}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            {child}
          </TouchableOpacity>
        );
        return (
          <Animated.View
            key={p.key}
            style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface }, {
              opacity: infoOpacity(steps[i] ?? settled),
              transform: [{ translateY: (steps[i] ?? settled).interpolate({ inputRange: [0, 1], outputRange: [T.risePx, 0] }) }],
            }]}
          >
            {changeable(p) ? (
              <View style={styles.split}>
                <TouchableOpacity
                  onPress={() => setOpenKey(openKey === p.key ? null : p.key)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityState={{ disabled, expanded: openKey === p.key }}
                  accessibilityLabel={t('ui.discover.understoodTapChange', { label: labels[i] })}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 2 }}
                >
                  <Text style={[styles.text, { color: colors.textSecondary }]} numberOfLines={1}>{labels[i]}</Text>
                </TouchableOpacity>
                {remove(<Text style={[styles.text, { color: colors.textSecondary }]}> ✕</Text>)}
              </View>
            ) : removable ? remove(text) : text}
          </Animated.View>
        );
      })}
      {hidden > 0 && (removable ? (
        <TouchableOpacity
          onPress={() => setShowAll(true)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          accessibilityLabel={t('ui.common.showMore')}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface }]}
        >
          <Text style={[styles.text, { color: colors.textSecondary }]}>{`+${hidden}`}</Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.text, { color: colors.textSecondary }]}>{`+${hidden}`}</Text>
        </View>
      ))}
      {open && (
        <View style={styles.choices}>
          {understoodChoices(open).map((v) => {
            const selected = isCurrent(open, v);
            return (
              <TouchableOpacity
                key={open.key === 'clock' ? `${v.at ?? ''}/${v.after ?? ''}/${v.before ?? ''}` : String(v)}
                onPress={() => { setOpenKey(null); if (!selected) onChange(open.key, v); }}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityState={{ disabled, selected }}
                accessibilityLabel={choiceLabel(open.key, v)}
                style={[styles.chip, { borderColor: selected ? colors.textPrimary : colors.border, backgroundColor: colors.surface }]}
              >
                <Text style={[styles.text, { color: selected ? colors.textPrimary : colors.textSecondary }]} numberOfLines={1}>{selected ? `✓ ${choiceLabel(open.key, v)}` : choiceLabel(open.key, v)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: 12, borderWidth: 1 },
  split: { flexDirection: 'row', alignItems: 'center' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, width: '100%' },
  text: { ...typography.caption, fontWeight: '600' },
});
