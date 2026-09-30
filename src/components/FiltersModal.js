import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Modal, SafeAreaView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { DATING_QUICK_FILTER_CATALOG } from '../constants/quickFilterCatalog';
import { TapActiveChip, modalAnimation } from '../motion';
import { useLanguage } from '../context/LanguageContext';
import { basicsLabel, basicsOption } from '../i18n/basicsVocab';

// Aug 30 2026 (CLAUDE.md, external UX critique response): this used to be
// the Advanced Filters (Premium-only) modal alone -- a caller would only
// ever open it after passing its own premium check, so it never had to
// think about a free-tier state. It's now the one unified Filters sheet
// for Discovery -- Discovery Mode (Crossed Paths/Browse), Looking For, and
// Quick Filters are all real, free, already-existing controls that used
// to live as three separate persistent UI blocks on the screen itself;
// they now render here, ahead of the existing Age Range/Advanced Filters
// section, which is the only part still gated (via a real inline `isPremium`
// check + upsell, not by blocking the whole modal from opening). Every new
// section is optional -- gated on its own driving prop being passed -- so
// this stays a real, reusable component, not hardcoded to Dating's exact
// shape, even though DiscoveryScreen.js is still its only caller.
//
// Sep 6 2026 (CLAUDE.md, external UX critique item 9): the fixed 3-entry
// inline map here used to be the *only* customization surface -- Customize
// could only reorder/show-hide these same 3. The real catalog (now shared
// with QuickFilterCustomizeScreen, quickFilterCatalog.js) can include a
// configurable value (Match %'s threshold) -- the chip label reflects
// whatever the user actually set in Customize, defaulting to the catalog's
// default when unset.
// Labels read ui.dating.quick.<key> (the catalog's English label is the English entry).
function quickFilterChipLabel(info, quickFilterConfig, t) {
  if (info.kind === 'threshold') {
    const value = quickFilterConfig?.[info.key]?.value ?? info.defaultValue;
    return `${info.icon} ${t('ui.dating.quick.matchThreshold', { value, unit: info.unit ?? '' })}`;
  }
  return `${info.icon} ${t(`ui.dating.quick.${info.key}`)}`;
}

// Help line under the Discovery mode switch: ui.dating.modeHelp.<mode>.
const DISCOVERY_MODES = ['crossedPaths', 'browse'];

export default function FiltersModal({
  visible,
  onClose,
  fields = [],
  activeFilters,
  onApply,
  showAgeRange,
  ageRange,
  onAgeRangeChange,
  isPremium = true,
  onUpgrade,
  discoveryMode,
  onChangeDiscoveryMode,
  intentionOptions,
  intentionFilter = [],
  onToggleIntention,
  quickFilterOrder,
  quickFilterVisible,
  quickFilterConfig,
  quickFilters,
  onToggleQuickFilter,
  onCustomizeQuickFilters,
  onClearFreeFilters,
}) {
  const { colors, shadow } = useTheme();
  const { t, language } = useLanguage();
  const styles = getStyles(colors, shadow);
  const [draft, setDraft] = useState(activeFilters);
  const [draftMinAge, setDraftMinAge] = useState(String(ageRange?.min ?? 18));
  const [draftMaxAge, setDraftMaxAge] = useState(String(ageRange?.max ?? 99));

  useEffect(() => {
    if (visible) {
      setDraft(activeFilters);
      setDraftMinAge(String(ageRange?.min ?? 18));
      setDraftMaxAge(String(ageRange?.max ?? 99));
    }
  }, [visible, activeFilters, ageRange]);

  function toggleOption(fieldKey, option) {
    setDraft((prev) => {
      const current = prev[fieldKey] ?? [];
      const next = current.includes(option)
        ? current.filter((o) => o !== option)
        : [...current, option];
      return { ...prev, [fieldKey]: next };
    });
  }

  function clearAll() {
    setDraft({});
    setDraftMinAge('18');
    setDraftMaxAge('99');
    if (onClearFreeFilters) onClearFreeFilters();
  }

  function apply() {
    onApply(draft);
    if (showAgeRange && onAgeRangeChange) {
      const min = parseInt(draftMinAge, 10);
      const max = parseInt(draftMaxAge, 10);
      if (!isNaN(min) && !isNaN(max) && min >= 18 && max >= min) {
        onAgeRangeChange({ min, max });
      }
    }
    onClose();
  }

  const advancedDraftCount = Object.values(draft).reduce((sum, arr) => sum + (arr?.length ?? 0), 0);
  const ageActiveInDraft = showAgeRange
    && (parseInt(draftMinAge, 10) !== 18 || parseInt(draftMaxAge, 10) !== 99);
  const quickActiveCount = quickFilterOrder
    ? Object.values(quickFilters ?? {}).filter(Boolean).length
    : 0;
  const activeCount = intentionFilter.length + quickActiveCount + advancedDraftCount + (ageActiveInDraft ? 1 : 0);

  return (
    <Modal visible={visible} animationType={modalAnimation('slide')} onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} accessibilityLabel={t('ui.dating.cancelA11y')} accessibilityRole="button">
            <Text style={styles.headerButton}>{t('ui.dating.cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('ui.dating.filters')}</Text>
          <TouchableOpacity onPress={clearAll} accessibilityLabel={t('ui.dating.clearAllFiltersA11y')} accessibilityRole="button">
            <Text style={styles.headerButton}>{t('ui.dating.clear')}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          {onChangeDiscoveryMode && (
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>{t('ui.dating.discovery')}</Text>
              <View style={styles.chipsWrap}>
                <TapActiveChip
                  active={discoveryMode !== 'browse'}
                  style={[styles.chip, discoveryMode !== 'browse' && styles.chipActive]}
                  onPress={() => onChangeDiscoveryMode('crossedPaths')}
                  accessibilityLabel={t('ui.dating.crossedPathsPeopleYouveActuallyA11y')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: discoveryMode !== 'browse' }}
                >
                  <Text style={[styles.chipText, discoveryMode !== 'browse' && styles.chipTextActive]}>{t('ui.dating.crossedPaths2')}</Text>
                </TapActiveChip>
                <TapActiveChip
                  active={discoveryMode === 'browse'}
                  style={[styles.chip, discoveryMode === 'browse' && styles.chipActive]}
                  onPress={() => onChangeDiscoveryMode('browse')}
                  accessibilityLabel={t('ui.dating.browseAWiderPoolOfA11y')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: discoveryMode === 'browse' }}
                >
                  <Text style={[styles.chipText, discoveryMode === 'browse' && styles.chipTextActive]}>{t('ui.dating.browse2')}</Text>
                </TapActiveChip>
              </View>
              <Text style={styles.sectionHelp}>
                {t(`ui.dating.modeHelp.${DISCOVERY_MODES.includes(discoveryMode) ? discoveryMode : 'crossedPaths'}`)}
              </Text>
            </View>
          )}

          {intentionOptions && (
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>{t('ui.dating.lookingFor')}</Text>
              <View style={styles.chipsWrap}>
                {intentionOptions.map((option) => {
                  const active = intentionFilter.includes(option.value);
                  return (
                    <TapActiveChip
                      key={option.value}
                      active={active}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => onToggleIntention(option.value)}
                      accessibilityLabel={t('ui.dating.filterByA11y', { label: t(`ui.viewProfile.intention.${option.value}`) })}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.icon} {t(`ui.viewProfile.intention.${option.value}`)}</Text>
                    </TapActiveChip>
                  );
                })}
              </View>
            </View>
          )}

          {quickFilterOrder && (
            <View style={styles.fieldSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.fieldLabel}>{t('ui.dating.quickFilters')}</Text>
                {onCustomizeQuickFilters && (
                  <TouchableOpacity
                    onPress={onCustomizeQuickFilters}
                    accessibilityLabel={t('ui.dating.customizeWhichQuickFiltersShowA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.customizeLink}>{t('ui.dating.customize')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.chipsWrap}>
                {quickFilterOrder.filter((key) => quickFilterVisible?.includes(key)).map((key) => {
                  const info = DATING_QUICK_FILTER_CATALOG.find((f) => f.key === key);
                  if (!info) return null;
                  const active = !!quickFilters?.[key];
                  const label = quickFilterChipLabel(info, quickFilterConfig, t);
                  return (
                    <TapActiveChip
                      key={key}
                      active={active}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => onToggleQuickFilter(key)}
                      accessibilityLabel={info.a11y ? t(`ui.dating.quick.${info.key}A11y`) : label}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                    </TapActiveChip>
                  );
                })}
              </View>
            </View>
          )}

          <View style={styles.fieldSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.fieldLabel}>{t('ui.dating.advancedFilters')}</Text>
              {!isPremium && <Text style={styles.lockBadge}>{t('ui.dating.premium')}</Text>}
            </View>
            {isPremium ? (
              <>
                {showAgeRange && (
                  <View style={styles.ageBlock}>
                    <Text style={styles.ageBlockLabel}>{t('ui.dating.ageRange')}</Text>
                    <View style={styles.ageRow}>
                      <TextInput
                        style={styles.ageInput}
                        value={draftMinAge}
                        onChangeText={setDraftMinAge}
                        keyboardType="number-pad"
                        placeholderTextColor={colors.textTertiary}
                        accessibilityLabel={t('ui.dating.minimumAgeA11y')}
                      />
                      <Text style={styles.ageDash}>to</Text>
                      <TextInput
                        style={styles.ageInput}
                        value={draftMaxAge}
                        onChangeText={setDraftMaxAge}
                        keyboardType="number-pad"
                        placeholderTextColor={colors.textTertiary}
                        accessibilityLabel={t('ui.dating.maximumAgeA11y')}
                      />
                    </View>
                  </View>
                )}

                {fields.map((field) => (
                  <View key={field.key} style={styles.ageBlock}>
                    <Text style={styles.ageBlockLabel}>{field.icon} {basicsLabel(field, language)}</Text>
                    <View style={styles.chipsWrap}>
                      {field.options.map((option) => {
                        const active = (draft[field.key] ?? []).includes(option);
                        return (
                          <TouchableOpacity
                            key={option}
                            style={[styles.chip, active && styles.chipActive]}
                            onPress={() => toggleOption(field.key, option)}
                            accessibilityLabel={`${basicsLabel(field, language)}: ${basicsOption(field.key, option, language)}`}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                          >
                            <Text style={[styles.chipText, active && styles.chipTextActive]}>{basicsOption(field.key, option, language)}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </>
            ) : (
              <View style={styles.upsellBox}>
                <Text style={styles.upsellText}>
                  {t('ui.dating.filteringByEducationDrinkingReligion')}
                </Text>
                {onUpgrade && (
                  <TouchableOpacity style={styles.upsellButton} onPress={onUpgrade} accessibilityLabel={t('ui.dating.upgradeToPremiumA11y')} accessibilityRole="button">
                    <Text style={styles.upsellButtonText}>{t('ui.dating.upgradeToPremium')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.applyButton} onPress={apply} activeOpacity={0.85} accessibilityLabel={activeCount > 0 ? t('ui.dating.applyFiltersActiveA11y', { count: activeCount }) : t('ui.dating.applyFiltersA11y')} accessibilityRole="button">
            <Text style={styles.applyButtonText}>{activeCount > 0 ? t('ui.dating.showResultsCount', { count: activeCount }) : t('ui.dating.showResults')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerButton: { color: colors.primary, fontWeight: '600', fontSize: 15 },
  headerTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 17 },
  fieldSection: { marginBottom: spacing.lg },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  fieldLabel: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15, marginBottom: spacing.sm },
  sectionHelp: { ...typography.small, color: colors.textTertiary, marginTop: spacing.sm },
  customizeLink: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  ageBlock: { marginTop: spacing.md },
  ageBlockLabel: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15, marginBottom: spacing.sm },
  ageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ageInput: { flex: 1, backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.sm, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border, textAlign: 'center' },
  ageDash: { color: colors.textTertiary },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  lockBadge: { ...typography.small, color: colors.textTertiary, fontWeight: '700' },
  upsellBox: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md,
  },
  upsellText: { ...typography.small, color: colors.textSecondary, marginBottom: spacing.sm },
  upsellButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, alignItems: 'center' },
  upsellButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  applyButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', ...shadow.button },
  applyButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
