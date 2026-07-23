import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, TouchableOpacity, Image, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import { isPremium } from '../services/purchases';
import { calculateCompatibility } from '../services/compatibility';
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
  const [refreshing, setRefreshing] = useState(false);
  const [compatScores, setCompatScores] = useState({});

  const load = useCallback(async () => {
    const premiumStatus = await isPremium().catch(() => false);
    setPremium(premiumStatus);

    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    const { data: myProfile } = await supabase.from('profiles').select('interests, basics').eq('id', myId).single();

    const { data, error } = await supabase
      .from('notices')
      .select('id, from_user, created_at, is_super, profiles!notices_from_user_fkey(display_name, photo_url, interests, basics)')
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

      const scoreEntries = data.map((n) => [n.id, calculateCompatibility(myProfile, n.profiles)]);
      setCompatScores(Object.fromEntries(scoreEntries));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function compatibilityColor(score) {
    if (score >= 70) return colors.success;
    if (score >= 40) return colors.primary;
    return colors.textTertiary;
  }

  function handleCardPress(item) {
    if (premium) {
      navigation.navigate('ViewProfile', { userId: item.from_user });
    } else {
      navigation.navigate('Paywall');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">{t('notices.title')}</Text>
      </View>

      {!premium && (
        <TouchableOpacity
          style={styles.upsell}
          onPress={() => navigation.navigate('Paywall')}
          activeOpacity={0.85}
          accessibilityLabel={`${t('notices.unlockPremium')}. ${t('notices.unlockPremiumText')}`}
          accessibilityRole="button"
        >
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
        numColumns={2}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>👋</Text>
            <Text style={styles.emptyText}>{t('notices.emptyText')}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const score = compatScores[item.id];
          const hasScore = score !== null && score !== undefined;
          const label = premium
            ? [
                item.profiles?.display_name,
                item.is_super ? 'sent you a Wave' : 'noticed you',
                hasScore ? `${score} percent compatible` : null,
              ].filter(Boolean).join(', ')
            : `Someone ${item.is_super ? 'sent you a Wave' : 'noticed you'}${hasScore ? `, ${score} percent compatible` : ''}, unlock Premium to see who`;

          return (
            <TouchableOpacity
              style={[styles.card, item.is_super && styles.waveCard]}
              onPress={() => handleCardPress(item)}
              activeOpacity={0.85}
              accessibilityLabel={label}
              accessibilityRole="button"
            >
              {photoUrls[item.id] ? (
                <Image
                  source={{ uri: photoUrls[item.id] }}
                  style={styles.avatar}
                  blurRadius={premium ? 0 : 25}
                />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]} />
              )}
              {!premium && (
                <View style={styles.lockOverlay}>
                  <Text style={styles.lockIcon}>🔒</Text>
                </View>
              )}
              {item.is_super && (
                <View style={styles.waveBadge}>
                  <Text style={styles.waveBadgeText}>👋 Wave</Text>
                </View>
              )}
              {hasScore && (
                <View style={[styles.compatBadge, { borderColor: compatibilityColor(score) }]}>
                  <Text style={[styles.compatText, { color: compatibilityColor(score) }]}>
                    {score}%
                  </Text>
                </View>
              )}
              <View style={styles.cardFooter}>
                <Text style={styles.name} numberOfLines={1}>
                  {premium ? item.profiles?.display_name : 'Someone noticed you'}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
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
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl, width: '100%' },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center' },
  card: {
    flex: 1,
    margin: spacing.xs,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    aspectRatio: 0.85,
    ...shadow.card,
  },
  waveCard: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  avatar: { width: '100%', height: '75%', backgroundColor: colors.surfaceElevated },
  avatarPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  lockOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, height: '75%',
    justifyContent: 'center', alignItems: 'center',
  },
  lockIcon: { fontSize: 28 },
  waveBadge: {
    position: 'absolute', top: spacing.xs, left: spacing.xs,
    backgroundColor: colors.primary, paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: radius.full,
  },
  waveBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  compatBadge: {
    position: 'absolute', top: spacing.xs, right: spacing.xs,
    backgroundColor: colors.background, borderWidth: 1,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.full,
  },
  compatText: { fontSize: 10, fontWeight: '700' },
  cardFooter: { padding: spacing.sm, justifyContent: 'center' },
  name: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 14 },
});