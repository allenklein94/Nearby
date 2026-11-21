// The ONE grouped category/interest picker (owner, 2026-11-21). Replaces six flat 256-chip lists (Profile interests,
// Create/Edit Community category, Quick Picks, Friends interest filter, business AI rule category). Same options, same
// saved values, same toggle the screen already had (`onToggle(tag)`); only the layout changes:
//   - "N selected" summary on top with the chosen chips (tap = remove), so choices are reviewable without opening groups;
//   - a search box (matches the shown label and the key, accent-insensitive);
//   - the existing 19 groups (CATEGORY_GROUPS) as collapsible headers; groups holding a selection start open;
//     while searching every matching group is open.
// Not scrollable itself: it sits inside the screen's or sheet's own ScrollView. `single` = one choice (tap another to
// switch, tap the chosen one to clear, as before); `max` = cap (Quick Picks 5); a capped chip shows disabled.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import useCategoryNames from '../hooks/useCategoryNames';
import { spacing, radius, typography } from '../theme';
import { buildTagGroups, initiallyExpandedGroups, selectedInGroup, canAddTag } from '../utils/tagGroups';

export default function TagGroupPicker({ options, selected, onToggle, single = false, max = null, labelFor, chipA11yLabel, showSummary = true }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const names = useCategoryNames();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const label = labelFor ?? names.tag;
  const chosen = useMemo(() => (selected ?? []).filter(Boolean), [selected]);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(() => new Set(initiallyExpandedGroups(options, chosen)));
  const groups = useMemo(() => buildTagGroups(options, { query, labelFor: label }), [options, query, label]);
  const searching = query.trim().length > 0;
  // Saved selections often arrive after the first render (a screen's load): until the person opens or closes a group
  // themselves, the open groups follow the selection.
  const touched = useRef(false);
  const chosenKey = chosen.join('|');
  useEffect(() => {
    if (!touched.current) setExpanded(new Set(initiallyExpandedGroups(options, chosen)));
  }, [chosenKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleGroup(key) {
    touched.current = true;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function press(tag) {
    if (!canAddTag(chosen, tag, { max, single })) return;
    touched.current = true;
    // a selection made from search keeps its group open once the search is cleared
    if (!chosen.includes(tag)) {
      const g = buildTagGroups(options).find((x) => x.tags.includes(tag));
      if (g && !expanded.has(g.key)) setExpanded((prev) => new Set(prev).add(g.key));
    }
    onToggle(tag);
  }

  function renderChip(tag) {
    const isSelected = chosen.includes(tag);
    const disabled = !isSelected && !canAddTag(chosen, tag, { max, single });
    return (
      <TouchableOpacity
        key={tag}
        style={[styles.chip, isSelected && styles.chipSelected, disabled && styles.chipDisabled]}
        onPress={() => press(tag)}
        disabled={disabled}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={chipA11yLabel ? chipA11yLabel(tag) : label(tag)}
        accessibilityState={{ selected: isSelected, disabled }}
      >
        <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{isSelected ? '✓ ' : ''}{label(tag)}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View>
      {showSummary && chosen.length > 0 ? (
        <View style={styles.summary}>
          <Text style={styles.summaryLabel} accessibilityLiveRegion="polite">{t('ui.tagPicker.selectedCount', { count: chosen.length })}</Text>
          <View style={styles.chipsWrap}>
            {chosen.map((tag) => (
              <TouchableOpacity
                key={tag}
                style={[styles.chip, styles.chipSelected]}
                onPress={() => onToggle(tag)}
                accessibilityRole="button"
                accessibilityLabel={t('ui.tagPicker.removeA11y', { name: label(tag) })}
              >
                <Text style={[styles.chipText, styles.chipTextSelected]}>{label(tag)}  ✕</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={t('ui.tagPicker.searchPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t('ui.tagPicker.searchA11y')}
        />
        {searching ? (
          <TouchableOpacity onPress={() => setQuery('')} style={styles.clearSearch} accessibilityRole="button" accessibilityLabel={t('ui.tagPicker.clearSearchA11y')} hitSlop={8}>
            <Text style={styles.clearSearchText}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {groups.length === 0 ? <Text style={styles.noMatches}>{t('ui.tagPicker.noMatches')}</Text> : null}

      {groups.map((g) => {
        const open = searching || expanded.has(g.key);
        const count = selectedInGroup(g, chosen);
        const title = g.label ? `${g.icon ? `${g.icon} ` : ''}${names.group(g.key, g.label)}` : '';
        return (
          <View key={g.key} style={styles.group}>
            {g.label ? (
              <TouchableOpacity
                style={styles.groupHeader}
                onPress={() => toggleGroup(g.key)}
                disabled={searching}
                accessibilityRole="button"
                accessibilityLabel={title}
                accessibilityValue={count > 0 ? { text: t('ui.tagPicker.selectedCount', { count }) } : undefined}
                accessibilityState={{ expanded: open }}
              >
                <Text style={styles.groupTitle} numberOfLines={1}>{title}</Text>
                <View style={styles.groupRight}>
                  {count > 0 ? <Text style={styles.groupCount}>{t('ui.tagPicker.selectedCount', { count })}</Text> : null}
                  {searching ? null : <Text style={styles.chevron}>{open ? '⌃' : '⌄'}</Text>}
                </View>
              </TouchableOpacity>
            ) : null}
            {open || !g.label ? <View style={[styles.chipsWrap, styles.groupBody]}>{g.tags.map(renderChip)}</View> : null}
          </View>
        );
      })}
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    summary: { marginBottom: spacing.sm },
    summaryLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
    chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipDisabled: { opacity: 0.4 },
    chipText: { ...typography.caption, color: colors.textPrimary },
    chipTextSelected: { color: '#fff', fontWeight: '600' },
    searchRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, marginBottom: spacing.sm },
    searchInput: { flex: 1, ...typography.body, color: colors.textPrimary, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
    clearSearch: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    clearSearchText: { ...typography.body, color: colors.textTertiary },
    noMatches: { ...typography.caption, color: colors.textTertiary, paddingVertical: spacing.sm },
    group: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, minHeight: 44 },
    groupTitle: { ...typography.body, color: colors.textPrimary, flex: 1 },
    groupRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    groupCount: { ...typography.caption, color: colors.primary },
    chevron: { ...typography.body, color: colors.textTertiary },
    groupBody: { paddingBottom: spacing.md },
  });
}
