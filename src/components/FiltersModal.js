import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Modal, SafeAreaView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

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
const QUICK_FILTER_CONFIG = {
  verified: { label: '✓ Verified Only', a11y: 'Filter to only photo-verified profiles' },
  highCompat: { label: '🎯 70%+ Match', a11y: 'Filter to 70 percent compatible or higher' },
  online: { label: '🟢 Online Now', a11y: 'Filter to only people online now' },
};

const DISCOVERY_MODE_HELP = {
  crossedPaths: "People you've actually been near recently (about 35 feet, with the app open).",
  browse: 'A wider pool of people matching your filters — not limited to physical proximity.',
};

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
  quickFilters,
  onToggleQuickFilter,
  onCustomizeQuickFilters,
  onClearFreeFilters,
}) {
  const { colors, shadow } = useTheme();
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
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} accessibilityLabel="Cancel" accessibilityRole="button">
            <Text style={styles.headerButton}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Filters</Text>
          <TouchableOpacity onPress={clearAll} accessibilityLabel="Clear all filters" accessibilityRole="button">
            <Text style={styles.headerButton}>Clear</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          {onChangeDiscoveryMode && (
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>🔀 Discovery</Text>
              <View style={styles.chipsWrap}>
                <TouchableOpacity
                  style={[styles.chip, discoveryMode !== 'browse' && styles.chipActive]}
                  onPress={() => onChangeDiscoveryMode('crossedPaths')}
                  accessibilityLabel="Crossed Paths, people you've actually been near"
                  accessibilityRole="button"
                  accessibilityState={{ selected: discoveryMode !== 'browse' }}
                >
                  <Text style={[styles.chipText, discoveryMode !== 'browse' && styles.chipTextActive]}>📍 Crossed Paths</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, discoveryMode === 'browse' && styles.chipActive]}
                  onPress={() => onChangeDiscoveryMode('browse')}
                  accessibilityLabel="Browse, a wider pool of people matching your filters"
                  accessibilityRole="button"
                  accessibilityState={{ selected: discoveryMode === 'browse' }}
                >
                  <Text style={[styles.chipText, discoveryMode === 'browse' && styles.chipTextActive]}>🔎 Browse</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.sectionHelp}>
                {DISCOVERY_MODE_HELP[discoveryMode] ?? DISCOVERY_MODE_HELP.crossedPaths}
              </Text>
            </View>
          )}

          {intentionOptions && (
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>💘 Looking For</Text>
              <View style={styles.chipsWrap}>
                {intentionOptions.map((option) => {
                  const active = intentionFilter.includes(option.value);
                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => onToggleIntention(option.value)}
                      accessibilityLabel={`Filter by ${option.label}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.icon} {option.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {quickFilterOrder && (
            <View style={styles.fieldSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.fieldLabel}>⚡ Quick Filters</Text>
                {onCustomizeQuickFilters && (
                  <TouchableOpacity
                    onPress={onCustomizeQuickFilters}
                    accessibilityLabel="Customize which Quick Filters show and their order"
                    accessibilityRole="button"
                  >
                    <Text style={styles.customizeLink}>⚙️ Customize</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.chipsWrap}>
                {quickFilterOrder.filter((key) => quickFilterVisible?.includes(key)).map((key) => {
                  const config = QUICK_FILTER_CONFIG[key];
                  if (!config) return null;
                  const active = !!quickFilters?.[key];
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => onToggleQuickFilter(key)}
                      accessibilityLabel={config.a11y}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{config.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          <View style={styles.fieldSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.fieldLabel}>🔧 Advanced Filters</Text>
              {!isPremium && <Text style={styles.lockBadge}>🔒 Premium</Text>}
            </View>
            {isPremium ? (
              <>
                {showAgeRange && (
                  <View style={styles.ageBlock}>
                    <Text style={styles.ageBlockLabel}>🎂 Age Range</Text>
                    <View style={styles.ageRow}>
                      <TextInput
                        style={styles.ageInput}
                        value={draftMinAge}
                        onChangeText={setDraftMinAge}
                        keyboardType="number-pad"
                        placeholderTextColor={colors.textTertiary}
                        accessibilityLabel="Minimum age"
                      />
                      <Text style={styles.ageDash}>to</Text>
                      <TextInput
                        style={styles.ageInput}
                        value={draftMaxAge}
                        onChangeText={setDraftMaxAge}
                        keyboardType="number-pad"
                        placeholderTextColor={colors.textTertiary}
                        accessibilityLabel="Maximum age"
                      />
                    </View>
                  </View>
                )}

                {fields.map((field) => (
                  <View key={field.key} style={styles.ageBlock}>
                    <Text style={styles.ageBlockLabel}>{field.icon} {field.label}</Text>
                    <View style={styles.chipsWrap}>
                      {field.options.map((option) => {
                        const active = (draft[field.key] ?? []).includes(option);
                        return (
                          <TouchableOpacity
                            key={option}
                            style={[styles.chip, active && styles.chipActive]}
                            onPress={() => toggleOption(field.key, option)}
                            accessibilityLabel={`${field.label}: ${option}`}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                          >
                            <Text style={[styles.chipText, active && styles.chipTextActive]}>{option}</Text>
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
                  Filtering by education, drinking, religion, love language, and more is a
                  Premium feature. Looking For, Quick Filters, and Discovery mode stay free.
                </Text>
                {onUpgrade && (
                  <TouchableOpacity style={styles.upsellButton} onPress={onUpgrade} accessibilityLabel="Upgrade to Premium" accessibilityRole="button">
                    <Text style={styles.upsellButtonText}>Upgrade to Premium</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.applyButton} onPress={apply} activeOpacity={0.85} accessibilityLabel={`Apply filters${activeCount > 0 ? `, ${activeCount} active` : ''}`} accessibilityRole="button">
            <Text style={styles.applyButtonText}>Show Results{activeCount > 0 ? ` (${activeCount} filter${activeCount === 1 ? '' : 's'})` : ''}</Text>
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
