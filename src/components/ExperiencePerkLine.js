import React from 'react';
import { Text } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing } from '../theme';

// An Experience item's perk add-on (assembleExperience attaches `item.perk`). Informational only: no tap target, no
// coral, no availability claim -- a perk decorates an item that already has confirmed supply.
export default function ExperiencePerkLine({ item }) {
  const { colors } = useTheme();
  if (!item?.perk?.title) return null;
  return (
    <Text style={{ ...typography.caption, color: colors.textSecondary, marginLeft: spacing.lg, marginBottom: spacing.xs }} numberOfLines={1}>
      + Perk: {item.perk.title}
    </Text>
  );
}
