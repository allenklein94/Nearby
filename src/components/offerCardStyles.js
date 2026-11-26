// The ONE look of a business reply card's frame: card, business row, "Heard your request" / status lines, offer title
// headline and the "I'll take this one" button. The customer's card (BusinessRequestDetailScreen) and the owner's live
// Customer Preview in Make an Offer (BusinessDashboardScreen, item 49) both read these, so the preview can't drift
// from the card the customer actually gets. The body below the header is OfferCustomerBody (shared too).
import { StyleSheet } from 'react-native';
import { typography, spacing, radius } from '../theme';

export const offerCardStyleSpec = (colors) => ({
  offerCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  offerPartnerName: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  offerPartnerRow: { flexDirection: 'row', alignItems: 'center' },
  offerPartnerNameFlex: { flexShrink: 1 },
  // Item 92: a real, named offer title reads as its own headline, distinct from the business-name line above it.
  offerTitleHeadline: { ...typography.headline, color: colors.textPrimary, marginTop: 2 },
  offerReputationLine: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  offerStatus: { ...typography.caption, color: colors.textTertiary, marginTop: 2, marginBottom: spacing.xs },
  acceptButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  acceptButtonWaiting: { opacity: 0.5 },
  acceptButtonText: { color: '#fff', fontWeight: '700' },
});

export const getOfferCardStyles = (colors) => StyleSheet.create(offerCardStyleSpec(colors));
