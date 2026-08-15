import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getBusinessRequestWithOffers, acceptBusinessOffer, cancelBusinessRequest, completeBusinessReservation, getPartnerAvgResponseTime, getPartnerOfferReputation, formatPartnerReliabilityLine } from '../services/businessFulfillment';
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
  // Finding 4: the original ask's own fields, carried forward so "Try a
  // Wider Radius" can push a fresh, pre-filled AskBusiness instead of
  // sending the user back to a blank form.
  const prefillFields = {
    prefillText: route.params?.prefillText ?? null,
    prefillCategory: route.params?.prefillCategory ?? null,
    prefillPartySize: route.params?.prefillPartySize ?? null,
    prefillBudgetMax: route.params?.prefillBudgetMax ?? null,
    prefillDateWindow: route.params?.prefillDateWindow ?? null,
    gatheringId: route.params?.gatheringId ?? null,
    gatheringTitle: route.params?.gatheringTitle ?? null,
    gatheringPartySize: route.params?.gatheringPartySize ?? null,
  };
  const priorRadiusMiles = route.params?.prefillRadiusMiles ?? 15;
  const widerRadiusMiles = priorRadiusMiles < 30 ? 30 : 50;

  function handleTryWiderRadius() {
    navigation.push('AskBusiness', { ...prefillFields, prefillRadiusMiles: widerRadiusMiles });
  }

  const [request, setRequest] = useState(null);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actingOfferId, setActingOfferId] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  // 10/10 roadmap Part 5 (see CLAUDE.md's "10/10 roadmap" plan) --
  // partnerId -> { reputation, responseTime }, fetched for every partner
  // with a real offer showing, so the consumer isn't blind to whether a
  // business actually follows through before deciding whether to accept.
  const [partnerStats, setPartnerStats] = useState({});

  // "Nearby V3/V4" plan, Phase C: order the consumer's own offer list by
  // the same real completion-rate signal Phase C's fan-out now prefers,
  // once several live offers exist to actually choose between -- reusing
  // the already-fetched partnerStats, no new query. Deliberately scoped
  // to just the 'offered' rows (the ones a consumer is genuinely deciding
  // between) rather than re-sorting the whole timeline -- pending/
  // declined/accepted/expired/completed rows keep their existing
  // created_at position, matching the plan's own "a partner below the
  // threshold is never penalized -- it's ordered exactly where it would
  // have landed today" for every row this reordering doesn't touch.
  const displayOffers = useMemo(() => {
    const offeredIndices = [];
    offers.forEach((o, i) => { if (o.status === 'offered') offeredIndices.push(i); });
    if (offeredIndices.length < 2) return offers;

    function reliabilityRank(offer) {
      const rep = partnerStats[offer.partner_id]?.reputation;
      const established = !!rep && rep.total_opportunities >= 5;
      return { established, completionRate: established ? (rep.completion_rate ?? -1) : null };
    }
    const reordered = offeredIndices
      .map((i) => offers[i])
      .sort((a, b) => {
        const rankA = reliabilityRank(a);
        const rankB = reliabilityRank(b);
        if (rankA.established !== rankB.established) return rankA.established ? -1 : 1;
        if (rankA.established) return rankB.completionRate - rankA.completionRate;
        return 0; // neither established -- stable sort preserves original (created_at) order
      });
    const result = [...offers];
    offeredIndices.forEach((originalIndex, k) => { result[originalIndex] = reordered[k]; });
    return result;
  }, [offers, partnerStats]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getBusinessRequestWithOffers(requestId);
      setRequest(result.request);
      setOffers(result.offers);
      setLoadError(false);

      const partnerIds = [...new Set(result.offers.filter((o) => o.status === 'offered' || o.status === 'accepted').map((o) => o.partner_id))];
      if (partnerIds.length > 0) {
        Promise.all(
          partnerIds.map(async (id) => [id, await Promise.all([getPartnerOfferReputation(id), getPartnerAvgResponseTime(id)])])
        )
          .then((entries) => setPartnerStats(Object.fromEntries(entries.map(([id, [reputation, responseTime]]) => [id, { reputation, responseTime }]))))
          .catch((e) => console.error('getPartnerOfferReputation/getPartnerAvgResponseTime failed', e));
      }
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
                : `We couldn't find a nearby business to ask within ${priorRadiusMiles} miles — try widening your search.`}
            </Text>
            {!isDuplicate && notifiedCount === 0 && (
              <TouchableOpacity
                style={styles.widerRadiusButton}
                onPress={handleTryWiderRadius}
                accessibilityLabel={`Try a wider radius, ${widerRadiusMiles} miles`}
                accessibilityRole="button"
              >
                <Text style={styles.widerRadiusButtonText}>Try a Wider Radius →</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <Text style={styles.rawText}>{request.raw_text}</Text>
        <Text style={[styles.statusLine, statusCopy.color === 'primary' && { color: colors.primary }]}>{statusCopy.label}</Text>

        {offers.length === 0 ? (
          <Text style={styles.emptyText}>No businesses have responded yet.</Text>
        ) : (
          displayOffers.map((o) => {
            const stats = partnerStats[o.partner_id];
            const reputationLine = formatPartnerReliabilityLine(stats?.reputation, stats?.responseTime);
            return (
            <View key={o.id} style={styles.offerCard}>
              <Text style={styles.offerPartnerName}>{o.brand_partners?.name ?? 'A business'}</Text>
              {reputationLine && (o.status === 'offered' || o.status === 'accepted') ? (
                <Text style={styles.offerReputationLine}>{reputationLine}</Text>
              ) : null}
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
            );
          })
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
  widerRadiusButton: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  widerRadiusButtonText: { ...typography.body, color: colors.primary, fontWeight: '700' },
  rawText: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
  statusLine: { ...typography.caption, color: colors.textTertiary, fontWeight: '600', marginBottom: spacing.lg },
  emptyText: { ...typography.body, color: colors.textSecondary },
  offerCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  offerPartnerName: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  offerReputationLine: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
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
