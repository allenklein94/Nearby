import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { formatOfferSummary, getSignedBusinessOfferMediaUrl } from '../services/businessFulfillment';
import { openUberToDestination } from '../utils/uberDeepLink';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Phase 4 (media upload, CLAUDE.md) -- a real uploaded offer photo,
// rendered INSIDE this existing card, never as its own standalone card.
// Video is shown as an honest label, not a fabricated inline player -- no
// video player component exists elsewhere in this codebase to mirror.
function OfferMediaPreview({ path, type, colors }) {
  const [signedUrl, setSignedUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (path) {
      getSignedBusinessOfferMediaUrl(path).then((url) => {
        if (!cancelled) setSignedUrl(url);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) return null;
  if (type === 'video') {
    return <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs }}>🎬 Video attached</Text>;
  }
  if (!signedUrl) return null;
  return (
    <Image
      source={{ uri: signedUrl }}
      style={{ width: '100%', height: 140, borderRadius: radius.md, marginTop: spacing.xs }}
      resizeMode="cover"
    />
  );
}

function formatOfferTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Convergence pass P1 follow-up (CLAUDE.md): the same "here's the real
// accepted business offer" block was independently written, byte-for-byte
// the same content, in GatheringDetailScreen (Gap #1) and DateProposalScreen
// (Gap #2) -- two different entry points into the same
// business_requests/business_request_offers lifecycle rendering the
// identical fact with two different style names. Factored out here so the
// "same underlying experience regardless of how the plan started" claim is
// literally true, not just similar-looking copies. BusinessRequestDetailScreen's
// own per-offer accepted state is deliberately NOT rebuilt onto this
// component -- it's a genuinely richer view (multiple offers, live payment
// status, accept/decline actions), not the same duplication.
//
// `bordered` controls the container treatment: `true` (default) renders a
// real standalone card, matching GatheringDetailScreen's own host-banner
// context; `false` renders as a plain inline block with just a top divider,
// for a caller (DateProposalScreen) that's already nesting this inside its
// own bordered card.
export default function AcceptedBusinessOfferCard({
  offer,
  kicker = '🍽️ Local Business Confirmed',
  partySize = null,
  onViewRequest,
  bordered = true,
  style,
}) {
  const { colors } = useTheme();
  const styles = getStyles(colors, bordered);

  if (!offer) return null;

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.kicker}>{kicker}</Text>
      <Text style={styles.venue}>{offer.brand_partners?.name ?? 'A local business'}</Text>
      {offer.proposed_time && <Text style={styles.sub}>{formatOfferTime(offer.proposed_time)}</Text>}
      {partySize != null && (
        <Text style={styles.sub}>
          Confirmed for {partySize} {partySize === 1 ? 'person' : 'people'}
        </Text>
      )}
      {formatOfferSummary(offer) && <Text style={styles.sub}>{formatOfferSummary(offer)}</Text>}
      {offer.offer_description ? <Text style={styles.desc}>{offer.offer_description}</Text> : null}
      <OfferMediaPreview path={offer.media_path} type={offer.media_type} colors={colors} />
      {offer.brand_partners?.latitude != null && offer.brand_partners?.longitude != null && (
        <TouchableOpacity
          onPress={() => openUberToDestination({
            latitude: offer.brand_partners.latitude,
            longitude: offer.brand_partners.longitude,
            nickname: offer.brand_partners.name,
            address: offer.brand_partners.address,
          })}
          style={styles.linkRow}
          accessibilityLabel="Get an Uber there"
          accessibilityRole="button"
        >
          <Text style={styles.link}>🚗 Get an Uber there</Text>
        </TouchableOpacity>
      )}
      {onViewRequest && (
        <TouchableOpacity
          onPress={onViewRequest}
          style={styles.linkRow}
          accessibilityLabel="View your business request"
          accessibilityRole="button"
        >
          <Text style={styles.link}>View request →</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const getStyles = (colors, bordered) => StyleSheet.create({
  container: bordered
    ? { backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.primary, padding: spacing.md }
    : { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  kicker: { ...typography.caption, color: colors.primary, fontWeight: '700', marginBottom: 2 },
  venue: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  sub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  desc: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  linkRow: { marginTop: spacing.xs },
  link: { color: colors.primary, fontWeight: '700', fontSize: 14 },
});
