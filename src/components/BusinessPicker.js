import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Image } from 'react-native';
import { NLoader } from '../motion';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { getActivePartnersByName, getAllActivePartners } from '../services/brandOffers';
import { BUSINESS_CATEGORIES } from '../screens/BusinessPartnerApplyScreen';
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { groupName } from '../i18n/categoryNames';
import { tr } from '../i18n/translate';
import { typography, spacing, radius } from '../theme';

// A business category chip/label in the person's language: the group's icon + its translated name (ui.requestPartner.otherCategory for
// a business filed under Other).
export function categoryLabel(key, language) {
  const g = CATEGORY_GROUPS.find((x) => x.key === key);
  return g ? `${g.icon} ${groupName(key, language)}` : `✨ ${tr('ui.requestPartner.otherCategory')}`;
}

// Pick ONE business: search by name, or browse every active business with category chips. Shared by Ask a business
// (a gathering's "Request a specific business", screen-reduction audit B7, 2026-10-09) and the community partnership
// request, so there is one picker, not two. Renders rows with .map (it sits inside a parent ScrollView).
export default function BusinessPicker({ initialQuery = '', onPick }) {
  const { t, language } = useLanguage();
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [businessQuery, setBusinessQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [browsablePartners, setBrowsablePartners] = useState([]);
  const [loadingBrowsable, setLoadingBrowsable] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState(null);

  // Every active business on the platform, shown by default underneath the search box: without it, a business you don't
  // already know the name of is undiscoverable, since search only matches a typed name.
  useEffect(() => {
    let cancelled = false;
    getAllActivePartners().then((data) => {
      if (!cancelled) { setBrowsablePartners(data); setLoadingBrowsable(false); }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (initialQuery.trim().length >= 2) search(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search(text) {
    setBusinessQuery(text);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const data = await getActivePartnersByName(text);
    setResults(data);
    setSearching(false);
  }

  // Only categories at least one real business has, never every key (a chip promising results a tap would never return).
  const availableCategories = useMemo(() => {
    const present = new Set(browsablePartners.map((p) => p.category ?? 'uncategorized'));
    return BUSINESS_CATEGORIES.filter((c) => present.has(c.key)).concat(
      present.has('uncategorized') ? [{ key: 'uncategorized', label: t('ui.requestPartner.uncategorized') }] : []
    );
  }, [browsablePartners, t]);

  const isSearching = businessQuery.trim().length >= 2;
  const sourceData = isSearching ? results : browsablePartners;
  const listData = categoryFilter ? sourceData.filter((p) => (p.category ?? 'uncategorized') === categoryFilter) : sourceData;
  const busy = isSearching ? searching : loadingBrowsable;

  return (
    <View>
      <TextInput
        style={styles.input}
        placeholder={t('ui.requestPartner.searchBusinessesByName')}
        placeholderTextColor={colors.textTertiary}
        value={businessQuery}
        onChangeText={search}
        accessibilityLabel={t('ui.requestPartner.searchBusinessesA11y')}
      />
      {availableCategories.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.md }} contentContainerStyle={{ gap: spacing.xs }}>
          <TouchableOpacity
            style={[styles.chip, !categoryFilter && styles.chipActive]}
            onPress={() => setCategoryFilter(null)}
            accessibilityRole="button"
            accessibilityLabel={t('ui.requestPartner.allCategoriesA11y')}
            accessibilityState={{ selected: !categoryFilter }}
          >
            <Text style={[styles.chipText, !categoryFilter && styles.chipTextActive]}>{t('ui.requestPartner.all')}</Text>
          </TouchableOpacity>
          {availableCategories.map((c) => {
            const label = c.key === 'uncategorized' ? c.label : categoryLabel(c.key, language);
            return (
              <TouchableOpacity
                key={c.key}
                style={[styles.chip, categoryFilter === c.key && styles.chipActive]}
                onPress={() => setCategoryFilter(categoryFilter === c.key ? null : c.key)}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: categoryFilter === c.key }}
              >
                <Text style={[styles.chipText, categoryFilter === c.key && styles.chipTextActive]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
      {!isSearching && !loadingBrowsable && browsablePartners.length > 0 && (
        <Text style={styles.browseLabel}>{t('ui.requestPartner.businessesOnNearby')}</Text>
      )}
      {busy && <NLoader fullScreen={false} size="inline" kind="businesses" />}
      <View style={{ paddingTop: spacing.md }}>
        {!busy && listData.length === 0 && (
          <Text style={styles.emptyText}>
            {isSearching
              ? t('ui.requestPartner.noMatchingBusinessesFound')
              : categoryFilter
                ? t('ui.requestPartner.noBusinessesInThisCategory')
                : t('ui.requestPartner.noBusinessesOnNearbyYet')}
          </Text>
        )}
        {listData.map((item) => (
          <TouchableOpacity key={item.id} style={styles.row} activeOpacity={0.85} onPress={() => onPick(item)} accessibilityRole="button" accessibilityLabel={item.name}>
            {item.logo_url ? (
              <Image source={{ uri: item.logo_url }} style={styles.logo} />
            ) : (
              <View style={[styles.logo, styles.logoFallback]}>
                <Text style={styles.logoFallbackText}>🏪</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{item.name}</Text>
              {item.category && <Text style={styles.rowSubtitle}>{categoryLabel(item.category, language)}</Text>}
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  browseLabel: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.md },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, color: colors.textPrimary, ...typography.body,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm, ...shadow.card,
  },
  rowTitle: { ...typography.headline, color: colors.textPrimary },
  rowSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  logo: { width: 36, height: 36, borderRadius: 18, marginRight: spacing.md },
  logoFallback: { backgroundColor: colors.surfaceElevated, justifyContent: 'center', alignItems: 'center' },
  logoFallbackText: { fontSize: 18 },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg },
});
