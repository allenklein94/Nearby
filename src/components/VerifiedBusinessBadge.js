import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';

// "✓ Verified Business" (owner, 2026-11-02; migration 20270371 decides who shows it; the screen passes nothing but whether to show it).
// The ONE rendering of the badge, used by every place it appears (business preview sheet, Business Profile; the business
// website is the web export of the same screens), so the explanation is the same words everywhere. A tap shows the
// explanation in place under the badge and a second tap hides it (item 45: expand inline, never a new screen or sheet).
// Static: no animation. The explanation states what was checked and what verification does NOT promise; it never claims
// quality, safety, trust or ranking.
export const VERIFIED_BUSINESS_EXPLANATION_KEY = 'ui.businessProfile.verifiedBusinessExplanation';

export default function VerifiedBusinessBadge({ style }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={style}>
      <TouchableOpacity
        onPress={() => setOpen((o) => !o)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('ui.businessProfile.verifiedBusiness')}
        testID="verified-business-badge"
      >
        <Text style={[styles.badge, { color: colors.success }]}>✓ {t('ui.businessProfile.verifiedBusiness')}</Text>
      </TouchableOpacity>
      {open ? (
        <Text style={[styles.explanation, { color: colors.textSecondary }]} accessibilityLiveRegion="polite" testID="verified-business-explanation">
          {t(VERIFIED_BUSINESS_EXPLANATION_KEY)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { fontSize: 13, fontWeight: '600' },
  explanation: { fontSize: 12, lineHeight: 17, marginTop: 2 },
});
