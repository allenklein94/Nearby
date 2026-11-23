import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';

// The one search box above a business category picker (utils/categorySearch.js decides what shows). No screen, sheet or
// navigation: it filters the chips in place. Clearing restores the full list; selections are owned by the picker.
// Collapsed pickers (owner, 2026-11-23) pass `expanded` + `onToggleExpanded` + `total`: with no search typed, one link
// "See all (N)" / "Show less" opens or closes the full list in place (existing ui.common strings, no new screen or sheet).
export default function CategorySearchField({ value, onChangeText, noMatch = false, style, expanded = false, onToggleExpanded, total }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const hasText = typeof value === 'string' && value.length > 0;
  return (
    <View style={style}>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={t('ui.bizComp.searchCategories')}
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel={t('ui.bizComp.searchCategories')}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          blurOnSubmit
        />
        {hasText ? (
          <TouchableOpacity
            onPress={() => onChangeText('')}
            style={styles.clear}
            accessibilityRole="button"
            accessibilityLabel={t('ui.bizComp.clearCategorySearch')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.clearText}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {!hasText && typeof onToggleExpanded === 'function' ? (
        <TouchableOpacity
          onPress={onToggleExpanded}
          style={styles.toggle}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={styles.toggleText}>
            {expanded ? t('ui.common.showLess') : `${t('ui.common.seeAllPlain')}${Number.isFinite(total) ? ` (${total})` : ''}`}
          </Text>
        </TouchableOpacity>
      ) : null}
      {hasText && noMatch ? (
        <Text style={styles.noMatch} accessibilityLiveRegion="polite">{t('ui.bizComp.noCategoriesMatch', { query: value.trim() })}</Text>
      ) : null}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border, minHeight: 44 },
  clear: { marginLeft: spacing.sm, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  clearText: { color: colors.textSecondary, fontSize: 16, fontWeight: '700' },
  toggle: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }, // + hitSlop 6 above/below = 44 px touch target
  toggleText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  noMatch: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.xs },
});
