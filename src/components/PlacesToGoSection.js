// Owner item 189: the separate "Places to go" section under a typed ask's own results. Name, distance and "Get directions"
// only: never a reason, "our pick", availability, booking or business treatment. Renders nothing when there are no places.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, typography } from '../theme';
import { useLanguage } from '../context/LanguageContext';
import { openDestination } from '../services/openDestination';

export default function PlacesToGoSection({ places, navigation }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  if (!Array.isArray(places) || places.length === 0) return null;
  const s = styles(colors, spacing, typography);
  return (
    <View style={s.wrap} accessibilityLabel={t('ui.placesToGo.heading')}>
      <Text style={s.heading}>{t('ui.placesToGo.heading')}</Text>
      {places.map((p) => (
        <TouchableOpacity
          key={p.id}
          style={s.row}
          onPress={() => openDestination(navigation, p.destination)}
          accessibilityRole="button"
          accessibilityLabel={t('ui.placesToGo.directionsA11y', { name: p.name })}
        >
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{p.name}</Text>
            {!!p.context && <Text style={s.context}>{p.context}</Text>}
          </View>
          <Text style={s.action}>{t('ui.placesToGo.directions')}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = (colors, spacing, typography) => StyleSheet.create({
  wrap: { marginTop: spacing.md, marginBottom: spacing.sm },
  heading: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  name: { color: colors.text, fontWeight: '600' },
  context: { color: colors.textSecondary, marginTop: 2 },
  action: { color: colors.primary, fontWeight: '600', marginLeft: spacing.sm },
});
