import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, Image } from 'react-native';
import { getActiveOffers, getMyRedemptions, redeemOffer } from '../services/brandOffers';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

export default function BrandOffersScreen() {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [offers, setOffers] = useState([]);
  const [redeemedIds, setRedeemedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [redeemingId, setRedeemingId] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const [offersData, redemptionsData] = await Promise.all([getActiveOffers(), getMyRedemptions()]);
    setOffers(offersData);
    setRedeemedIds(redemptionsData);
    setLoading(false);
  }

  async function handleRedeem(offer) {
    setRedeemingId(offer.id);
    try {
      await redeemOffer(offer.id);
      Alert.alert(
        'Redeemed!',
        offer.redemption_instructions || 'Check your account for details on how to use this.'
      );
      load();
    } catch (e) {
      if (e.message === 'ALREADY_REDEEMED') {
        Alert.alert('Already redeemed', "You've already claimed this offer.");
      } else {
        Alert.alert('Error', e.message);
      }
    }
    setRedeemingId(null);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.headerTitle} accessibilityRole="header">🎁 Offers & Perks</Text>
        <Text style={styles.headerSubtitle}>
          Deals from brands and local businesses partnering with Nearby.
        </Text>

        {offers.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🎁</Text>
            <Text style={styles.emptyText}>No offers available right now — check back soon.</Text>
          </View>
        )}

        {offers.map((offer) => {
          const alreadyRedeemed = redeemedIds.includes(offer.id);
          return (
            <View key={offer.id} style={styles.card}>
              <View style={styles.cardHeader}>
                {offer.brand_partners?.logo_url ? (
                  <Image source={{ uri: offer.brand_partners.logo_url }} style={styles.logo} />
                ) : (
                  <View style={[styles.logo, styles.logoPlaceholder]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.partnerName}>{offer.brand_partners?.name}</Text>
                  <Text style={styles.offerTitle}>{offer.title}</Text>
                </View>
              </View>
              {offer.description ? <Text style={styles.description}>{offer.description}</Text> : null}
              {alreadyRedeemed ? (
                <View style={styles.redeemedBadge}>
                  <Text style={styles.redeemedBadgeText}>✓ Redeemed</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.redeemButton}
                  onPress={() => handleRedeem(offer)}
                  disabled={redeemingId === offer.id}
                  activeOpacity={0.85}
                  accessibilityLabel={`Redeem: ${offer.title}, from ${offer.brand_partners?.name}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.redeemButtonText}>{redeemingId === offer.id ? 'Redeeming...' : 'Redeem'}</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  logo: { width: 44, height: 44, borderRadius: radius.md, marginRight: spacing.md, backgroundColor: colors.surfaceElevated },
  logoPlaceholder: {},
  partnerName: { ...typography.caption, color: colors.textTertiary },
  offerTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 16 },
  description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  redeemButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 12, alignItems: 'center' },
  redeemButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  redeemedBadge: { alignSelf: 'flex-start', backgroundColor: colors.primaryMuted, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  redeemedBadgeText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
});