import React, { useCallback, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyRewardStatus } from '../services/rewards';
import { perkTierLine } from '../utils/perkTier';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing } from '../theme';

// Rule 14: the perk tier as one quiet line at the top of Discover -> Perks (utils/perkTier.js). Informational only, never
// a button; renders nothing while loading, on a failed lookup, or before the first redemption.
export default function PerkTierLine() {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const [status, setStatus] = useState(null);
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    getMyRewardStatus().then((s) => { if (!cancelled) setStatus(s); }).catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
  }, []));
  const line = perkTierLine(status, t);
  if (!line) return null;
  return <Text style={[styles.line, { color: colors.textSecondary }]}>{line}</Text>;
}

const styles = StyleSheet.create({
  line: { ...typography.caption, marginBottom: spacing.sm },
});
