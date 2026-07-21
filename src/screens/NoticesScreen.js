import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, TouchableOpacity, Image } from 'react-native';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import { isPremium } from '../services/purchases';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

export default function NoticesScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors, shadow);
  const [notices, setNotices] = useState([]);
  const [premium, setPremium] = useState(false);
  const [photoUrls, setPhotoUrls] = useState({});

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const premiumStatus = await isPremium().catch(() => false);
    setPremium(premiumStatus);

    const { data, error } = await supabase
      .from('notices')
      .select('id, from_user, created_at, is_super, profiles!notices_from_user_fkey(display_name, photo_url)')
      .order('is_super', { ascending: false })
      .order('created_at', { ascending: false });

    if (!error) {
      setNotices(data);
      const urlEntries = await Promise.all(
        data.map(async (n) => {
          const path = n.profiles?.photo_url;
          if (!path) return [n.id, null];
          const url = await getSignedPhotoUrl(path);
          return [n.id, url];
        })
      );
      setPhotoUrls(Object.fromEntries(urlEntries));
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('notices.title')}</Text>
      </View>

      {!premium && (
        <TouchableOpacity style={styles.upsell} onPress={() => navigation.navigate('Paywall')} activeOpacity={0.85}>
          <Text style={styles.upsellIcon}>✨</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.upsellTitle}>{t('notices.unlockPremium')}</Text>
            <Text style={styles.upsellText}>{t('notices.unlockPremiumText')}</Text>
          </View>
          <Text style={styles.upsellArrow}>›</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={notices}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>👋</Text>
            <Text style={styles.emptyText}>{t('notices.emptyText')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.card, item.is_super && styles.waveCard]}>
            {photoUrls[item.id] && (
              <Image source={{ uri: photoUrls[item.id] }} style={styles.avatar} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>
                {item.is_super && '👋 '}{item.profiles?.display_name} {t('notices.noticedYou')}
              </Text>
              {item.is_super && <Text style={styles.waveLabel}>{t('notices.wave')}</Text>}
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  upsell: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    ...shadow.button,
  },
  upsellIcon: { fontSize: 24, marginRight: spacing.md },
  upsellTitle: { color: '#fff', fontWeight: '700', fontSize: 15 },
  upsellText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 1 },
  upsellArrow: { color: '#fff', fontSize: 22, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  waveCard: {
    borderColor: colors.primary,
    borderWidth: 1.5,
    backgroundColor: colors.primaryMuted,
  },
  avatar: { width: 44, height: 44, borderRadius: radius.sm, marginRight: spacing.md, backgroundColor: colors.surfaceElevated },
  name: { ...typography.body, color: colors.textPrimary },
  waveLabel: { ...typography.small, color: colors.primary, fontWeight: '700', marginTop: 2 },
});