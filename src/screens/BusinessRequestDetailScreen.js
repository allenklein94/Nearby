import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getBusinessRequestWithOffers, acceptBusinessOffer, cancelBusinessRequest, completeBusinessReservation } from '../services/businessFulfillment';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const STATUS_COPY = {
  open: { label: 'Open — waiting for responses', color: null },
  fulfilled: { label: 'You accepted an offer', color: 'primary' },
  expired: { label: 'This request expired', color: null },
  cancelled: { label: 'You cancelled this request', color: null },
};

const OFFER_STATUS_COPY = {
  pending: 'Waiting for a response',
  offered: 'Made you an offer',
  accepted: 'Accepted — your reservation',
  declined: "Can't help with this one",
  expired: 'No longer available',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

// business_request_offers.proposed_time was previously collected nowhere
// (the "Alt. time" offer-type chip had no time input attached to it at
// all) and rendered nowhere -- PRODUCT_AUDIT/
// INTENT_LAYER_UX_WALKTHROUGH_2026-08-14.md, finding 3. Now that
// BusinessDashboardScreen's "Make an Offer" modal actually collects it,
// render it here too, both before and after acceptance.
function formatProposedTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// The consumer-side offer-review/accept screen -- Phase 2 of the Intent
// Layer plan (CLAUDE.md). Reached right after submitting a request
// (AskBusinessScreen) and, later, via a real push notification
// (business_offer_received/business_offer_accepted) when a business
// responds -- no separate "My Requests" list screen was built this pass,
// matching the plan's own "a consumer-side offer-review/accept screen"
// (singular) scope; revisiting a request relies on the push deep link,
// same as this app's established gathering_invite precedent.
export default function BusinessRequestDetailScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const requestId = route.params?.requestId;
  const justSubmitted = route.params?.justSubmitted ?? false;
  const notifiedCount = route.params?.notifiedCount ?? 0;
  const isDuplicate = route.params?.duplicate ?? false;

  const [request, setRequest] = useState(null);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actingOfferId, setActingOfferId] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getBusinessRequestWithOffers(requestId);
      setRequest(result.request);
      setOffers(result.offers);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    }
    setLoading(false);
  }, [requestId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleAccept(offerId) {
    setActingOfferId(offerId);
    try {
      await acceptBusinessOffer(offerId);
      await load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setActingOfferId(null);
  }

  async function handleComplete(offerId) {
    setActingOfferId(offerId);
    try {
      await completeBusinessReservation(offerId);
      await load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setActingOfferId(null);
  }

  async function handleCancel() {
    Alert.alert('Cancel this request?', 'Businesses will no longer be able to respond.', [
      { text: 'Never mind', style: 'cancel' },
      {
        text: 'Cancel Request', style: 'destructive', onPress: async () => {
          setCancelling(true);
          try {
            await cancelBusinessRequest(requestId);
            await load();
          } catch (e) {
            Alert.alert('Error', e.message);
          }
          setCancelling(false);
        },
      },
    ]);
  }

  if (loading && !request) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load this request." onRetry={load} />
      </SafeAreaView>
    );
  }

  if (!request) return null;

  const statusCopy = STATUS_COPY[request.status] ?? { label: request.status, color: null };
  const hasWinner = offers.some((o) => o.status === 'accepted' || o.status === 'completed');

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {justSubmitted && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              {isDuplicate
                ? "You already have an open request just like this — here it is, no need to ask twice."
                : notifiedCount > 0
                ? `We asked ${notifiedCount} nearby business${notifiedCount === 1 ? '' : 'es'} — you'll be notified as offers come in.`
                : "We couldn't find a nearby business to ask right now — try widening what you're looking for."}
            </Text>
          </View>
        )}

        <Text style={styles.rawText}>{request.raw_text}</Text>
        <Text style={[styles.statusLine, statusCopy.color === 'primary' && { color: colors.primary }]}>{statusCopy.label}</Text>

        {offers.length === 0 ? (
          <Text style={styles.emptyText}>No businesses have responded yet.</Text>
        ) : (
          offers.map((o) => (
            <View key={o.id} style={styles.offerCard}>
              <Text style={styles.offerPartnerName}>{o.brand_partners?.name ?? 'A business'}</Text>
              <Text style={styles.offerStatus}>{OFFER_STATUS_COPY[o.status] ?? o.status}</Text>
              {o.status === 'offered' && (
                <>
                  {o.offer_description ? <Text style={styles.offerDescription}>{o.offer_description}</Text> : null}
                  {o.proposed_time ? <Text style={styles.offerProposedTime}>🕐 {formatProposedTime(o.proposed_time)}</Text> : null}
                  {o.offer_price !== null ? <Text style={styles.offerPrice}>${Number(o.offer_price).toFixed(2)}</Text> : null}
                  {!hasWinner && (
                    <TouchableOpacity
                      style={styles.acceptButton}
                      onPress={() => handleAccept(o.id)}
                      disabled={actingOfferId === o.id}
                      accessibilityLabel={`Accept offer from ${o.brand_partners?.name ?? 'this business'}`}
                      accessibilityRole="button"
                    >
                      {actingOfferId === o.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.acceptButtonText}>Accept This Offer</Text>}
                    </TouchableOpacity>
                  )}
                </>
              )}
              {o.status === 'accepted' && (
                <>
                  {o.offer_description ? <Text style={styles.offerDescription}>{o.offer_description}</Text> : null}
                  {o.proposed_time ? <Text style={styles.offerProposedTime}>🕐 {formatProposedTime(o.proposed_time)}</Text> : null}
                  {o.offer_price !== null ? <Text style={styles.offerPrice}>${Number(o.offer_price).toFixed(2)}</Text> : null}
                  <TouchableOpacity
                    style={styles.completeButton}
                    onPress={() => handleComplete(o.id)}
                    disabled={actingOfferId === o.id}
                    accessibilityLabel="Mark this reservation complete"
                    accessibilityRole="button"
                  >
                    {actingOfferId === o.id ? <ActivityIndicator color={colors.primary} size="small" /> : <Text style={styles.completeButtonText}>Mark as Completed</Text>}
                  </TouchableOpacity>
                </>
              )}
            </View>
          ))
        )}

        {request.status === 'open' && (
          <TouchableOpacity onPress={handleCancel} disabled={cancelling} accessibilityLabel="Cancel this request" accessibilityRole="button">
            <Text style={styles.cancelLink}>{cancelling ? 'Cancelling…' : 'Cancel Request'}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  banner: { backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  bannerText: { ...typography.body, color: colors.textSecondary },
  rawText: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
  statusLine: { ...typography.caption, color: colors.textTertiary, fontWeight: '600', marginBottom: spacing.lg },
  emptyText: { ...typography.body, color: colors.textSecondary },
  offerCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  offerPartnerName: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  offerStatus: { ...typography.caption, color: colors.textTertiary, marginTop: 2, marginBottom: spacing.xs },
  offerDescription: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.xs },
  offerProposedTime: { ...typography.body, color: colors.textPrimary, fontWeight: '600', marginBottom: spacing.xs },
  offerPrice: { ...typography.body, color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm },
  acceptButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  acceptButtonText: { color: '#fff', fontWeight: '700' },
  completeButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  completeButtonText: { color: colors.primary, fontWeight: '700' },
  cancelLink: { color: colors.textTertiary, fontSize: 14, textAlign: 'center', marginTop: spacing.lg },
});
