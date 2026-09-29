import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing } from '../theme';
import { emptyCopy } from '../constants/emptyStates';
import { useLanguage } from '../context/LanguageContext';
import { hasOwnTranslation } from '../i18n/translate';

// The shared title + body of an empty section (item 80). Screens keep their own action row beneath it.
export default function EmptyCopy({ id, vars, style }) {
  const { colors } = useTheme();
  const { t, language } = useLanguage();
  const english = emptyCopy(id, vars);
  if (!english) return null;
  // Consumer empty states have ui.empty.<id> in every language (same {placeholders}, filled the registry's way: a missing
  // value is left blank). Business/admin ids have none and stay as the English registry wrote them.
  const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => (vars?.[k] != null ? String(vars[k]) : ''));
  const copy = language !== 'en' && hasOwnTranslation('en', `ui.empty.${id}.title`)
    ? { title: fill(t(`ui.empty.${id}.title`)), body: fill(t(`ui.empty.${id}.body`)) }
    : english;
  return (
    <View style={[styles.wrap, style]} accessible accessibilityLabel={`${copy.title}. ${copy.body}`}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{copy.title}</Text>
      <Text style={[styles.body, { color: colors.textTertiary }]}>{copy.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: spacing.lg },
  title: { ...typography.body, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  body: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
