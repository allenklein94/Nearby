import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import InterestedSaved from '../motion/InterestedSaved';

// Owner, 2026-10-25: a narrow exception to item 200 for Discover's gathering cards only: a small, secondary ☆ beside the card's
// join action, so the private "maybe" can be marked without leaving Discover. Join stays the primary action; this is never a
// second button of equal weight. ☆ = not marked, ★ = Interested (shape, not colour alone, idea "346"); "✓" after a real save
// (item 30's moment, motion/InterestedSaved.js). Rules: utils/cardInterested.js; state: hooks/useCardInterested.js.
export default function CardInterestedStar({ title, on, flashKey, onPress, color }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
      style={styles.wrap}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      accessibilityLabel={t(on ? 'ui.home.removeInterestedA11y' : 'ui.home.markInterestedA11y', { title })}
    >
      <InterestedSaved
        flashKey={flashKey}
        label={on ? '★' : '☆'}
        savedLabel="✓"
        style={[styles.glyph, { color: on ? colors.primary : (color ?? colors.textTertiary) }]}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 4, minWidth: 22, alignItems: 'center' },
  glyph: { fontSize: 17, fontWeight: '600' },
});
