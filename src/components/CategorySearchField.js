import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';

// The one search box above a business category picker (utils/categorySearch.js decides what shows). No screen, sheet or
// navigation: it filters the chips in place. Clearing restores the full list; selections are owned by the picker.
export default function CategorySearchField({ value, onChangeText, noMatch = false, style }) {
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
  noMatch: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.xs },
});
