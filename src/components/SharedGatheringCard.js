import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { displayGatheringWhen } from '../i18n/display';
import { getSharedGatheringCard } from '../services/chatShare';

// A gathering shared into a one-to-one chat (migration 20270331): its title and when line (the cards' when engine), read
// through the viewer's own item 147 read. A gathering they may not see, or one since deleted, reads "isn't available"
// with nothing tappable. A tap opens that GatheringDetail on top of the chat (Back returns to the chat). Static, no motion.
export default function SharedGatheringCard({ gatheringId, isMe, senderLabel, onOpen, onLongPress }) {
  const { t, language } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [g, setG] = useState(undefined); // undefined = loading, null = not available

  useEffect(() => {
    let alive = true;
    getSharedGatheringCard(gatheringId)
      .then((row) => { if (alive) setG(row); })
      .catch(() => { if (alive) setG(null); });
    return () => { alive = false; };
  }, [gatheringId]);

  if (g === undefined) {
    return <View style={[styles.card, isMe && styles.mine]}><ActivityIndicator color={colors.textTertiary} /></View>;
  }
  if (!g) {
    return (
      <TouchableOpacity onLongPress={onLongPress} activeOpacity={1} style={[styles.card, isMe && styles.mine]}
        accessibilityLabel={t('ui.shareInChat.unavailableA11y', { sender: senderLabel })}>
        <Text style={styles.unavailable}>{t('ui.shareInChat.unavailable')}</Text>
      </TouchableOpacity>
    );
  }
  const when = displayGatheringWhen(g, language);
  return (
    <TouchableOpacity
      style={[styles.card, isMe && styles.mine]}
      onPress={() => onOpen(g.id, g.title)}
      onLongPress={onLongPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={when
        ? t('ui.shareInChat.cardA11y', { sender: senderLabel, title: g.title, when })
        : t('ui.shareInChat.cardA11yNoWhen', { sender: senderLabel, title: g.title })}
    >
      <Text style={styles.kicker}>{t('ui.shareInChat.cardKicker')}</Text>
      <Text style={styles.title} numberOfLines={2}>{g.title}</Text>
      {when ? <Text style={styles.when}>{when}</Text> : null}
    </TouchableOpacity>
  );
}

const getStyles = (colors) => StyleSheet.create({
  card: { width: 240, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  mine: { borderColor: colors.primary },
  kicker: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  when: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  unavailable: { color: colors.textTertiary, fontSize: 13 },
});
