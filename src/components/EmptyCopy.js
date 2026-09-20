import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing } from '../theme';
import { emptyCopy } from '../constants/emptyStates';

// The shared title + body of an empty section (item 80). Screens keep their own action row beneath it.
export default function EmptyCopy({ id, vars, style }) {
  const { colors } = useTheme();
  const copy = emptyCopy(id, vars);
  if (!copy) return null;
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
