import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Linking, Alert } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing, typography } from '../theme';
import { SPONSORED_LABEL } from '../constants/sponsored';
import { checkMySponsoredSlot, getMySponsoredPlacements, cancelMySponsoredHold, startSponsoredCheckout, cancelPaidSponsoredPlacement } from '../services/sponsored';
import { SPONSORED_TERMS_VERSION, SPONSORED_TERMS_SECTIONS } from '../constants/sponsoredTerms';
import { placementStatusLine, statsLine, priceLabel, startDateOptions, dayLabel } from '../utils/sponsoredPromotions';

// Owner-side "Promotions" (design section 7). A paid, clearly labeled spotlight; never an Opportunity, never in Demand.
// Shown only when the database says this business can buy one (empty allow-list = the section says nothing is available
// yet). Payment happens in Stripe Checkout; the row below only reflects what the database recorded.
const ELIGIBILITY_TEXT = {
  category_not_sponsorable: "Spotlights aren't available for your category yet.",
  needs_address: 'Add your business address first so Nearby knows who to show it to.',
  business_inactive: 'Your business needs to be active to run a spotlight.',
  already_holding: 'You already have a spotlight scheduled or waiting for payment.',
};

export default function SponsoredPromotionsPanel({ offers = [] }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [eligibility, setEligibility] = useState(undefined); // undefined = loading, null = failed
  const [placements, setPlacements] = useState(null);
  const [startDate, setStartDate] = useState(null);
  const [kind, setKind] = useState('business');
  const [offerId, setOfferId] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [slotProblem, setSlotProblem] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  const load = useCallback(async () => {
    const [el, rows] = await Promise.all([checkMySponsoredSlot(null), getMySponsoredPlacements()]);
    setEligibility(el);
    setPlacements(rows);
  }, []);
  useEffect(() => { load(); }, [load]);

  const pickDate = async (d) => {
    setStartDate(d);
    setSlotProblem(null);
    const r = await checkMySponsoredSlot(`${d}T00:00:00Z`);
    if (r && !r.ok) setSlotProblem(r.problem === 'slot_taken' ? 'That week is already taken in your area for this category. Try another start date.' : 'That start date is not available.');
  };

  const buy = async () => {
    setBusy(true);
    setMessage(null);
    const res = await startSponsoredCheckout({ itemKind: kind, itemId: kind === 'offer' ? offerId : null, startDate, title, description, termsVersion: SPONSORED_TERMS_VERSION, acceptedTerms: accepted });
    setBusy(false);
    if (res.error) { setMessage(res.error); return; }
    Linking.openURL(res.url).catch(() => setMessage("Couldn't open checkout. You have not been charged."));
    load();
  };

  const cancelHold = (p) => {
    Alert.alert('Release this slot?', 'You have not paid, so nothing is charged.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Release', style: 'destructive', onPress: async () => { await cancelMySponsoredHold(p.placement_id); load(); } },
    ]);
  };

  const cancelPaid = (p) => {
    Alert.alert(
      'Cancel this spotlight?',
      `It hasn't started, so you'll be refunded in full (${priceLabel(p.amount_cents, p.currency) || 'the full amount'}) to your original payment method.`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Cancel and refund', style: 'destructive', onPress: async () => {
          setBusy(true); setMessage(null);
          const res = await cancelPaidSponsoredPlacement(p.placement_id);
          setBusy(false);
          setMessage(res.error || 'Cancelled. Your refund is on its way.');
          load();
        } },
      ]
    );
  };

  const price = eligibility ? priceLabel(eligibility.amount_cents, eligibility.currency) : null;
  const canSubmit = !busy && startDate && !slotProblem && title.trim().length > 0 && accepted && (kind === 'business' || offerId);
  const hasHeld = (placements || []).some((p) => p.status === 'awaiting_payment');

  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>Promotions</Text>
      <Text style={styles.helper}>
        A paid spotlight shown to people browsing Places and Perks near you. It is always labeled "{SPONSORED_LABEL}" and is
        separate from your opportunities.
      </Text>

      {eligibility === undefined ? <Text style={styles.helper}>Checking…</Text> : null}
      {eligibility === null ? <Text style={styles.helper}>Couldn't load promotions right now.</Text> : null}
      {eligibility && !eligibility.ok ? (
        <Text style={styles.helper}>
          {ELIGIBILITY_TEXT[eligibility.problem] || "Spotlights aren't available for your business right now."}
        </Text>
      ) : null}

      {eligibility?.ok && !hasHeld ? (
        <View>
          <Text style={styles.label}>What to promote</Text>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.chip, kind === 'business' && styles.chipOn]} onPress={() => setKind('business')} accessibilityRole="button">
              <Text style={[styles.chipText, kind === 'business' && styles.chipTextOn]}>Your business</Text>
            </TouchableOpacity>
            {offers.length > 0 ? (
              <TouchableOpacity style={[styles.chip, kind === 'offer' && styles.chipOn]} onPress={() => setKind('offer')} accessibilityRole="button">
                <Text style={[styles.chipText, kind === 'offer' && styles.chipTextOn]}>One of your offers</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {kind === 'offer' ? (
            <View style={styles.row}>
              {offers.filter((o) => o.active).map((o) => (
                <TouchableOpacity key={o.id} style={[styles.chip, offerId === o.id && styles.chipOn]} onPress={() => setOfferId(o.id)} accessibilityRole="button">
                  <Text style={[styles.chipText, offerId === o.id && styles.chipTextOn]} numberOfLines={1}>{o.title}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          <Text style={styles.label}>Headline</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={80} placeholder="What people will see" placeholderTextColor={colors.textSecondary} />
          <Text style={styles.label}>Description (optional)</Text>
          <TextInput style={[styles.input, { minHeight: 60 }]} value={description} onChangeText={setDescription} maxLength={200} multiline placeholder="One or two lines" placeholderTextColor={colors.textSecondary} />

          <Text style={styles.label}>Start date (runs 7 days)</Text>
          <View style={styles.row}>
            {startDateOptions().map((d) => (
              <TouchableOpacity key={d} style={[styles.chip, startDate === d && styles.chipOn]} onPress={() => pickDate(d)} accessibilityRole="button">
                <Text style={[styles.chipText, startDate === d && styles.chipTextOn]}>{dayLabel(`${d}T00:00:00Z`)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {slotProblem ? <Text style={styles.error}>{slotProblem}</Text> : null}
          {message ? <Text style={styles.error}>{message}</Text> : null}

          <TouchableOpacity style={[styles.cta, !canSubmit && { opacity: 0.5 }]} disabled={!canSubmit} onPress={buy} accessibilityRole="button" accessibilityLabel="Continue to payment">
            <Text style={styles.ctaText}>{price ? `Continue to payment · ${price}` : 'Continue to payment'}</Text>
          </TouchableOpacity>
          <View style={[styles.row, { alignItems: 'center', marginTop: spacing.md }]}>
            <TouchableOpacity onPress={() => setAccepted((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} accessibilityLabel="I accept the spotlight terms on behalf of my business">
              <Text style={styles.ctaCheck}>{accepted ? '☑' : '☐'}</Text>
            </TouchableOpacity>
            <Text style={[styles.helper, { flex: 1, marginTop: 0 }]}>I accept the spotlight terms on behalf of my business.</Text>
          </View>
          <TouchableOpacity onPress={() => setTermsOpen((v) => !v)} accessibilityRole="button" accessibilityLabel="Read the spotlight terms">
            <Text style={styles.link}>{termsOpen ? 'Hide the terms' : 'Read the terms'}</Text>
          </TouchableOpacity>
          {termsOpen ? SPONSORED_TERMS_SECTIONS.map(([h, b]) => (
            <View key={h}><Text style={styles.label}>{h}</Text><Text style={styles.helper}>{b}</Text></View>
          )) : null}
        </View>
      ) : null}
      {hasHeld && eligibility?.ok ? <Text style={styles.helper}>You have a spotlight waiting for payment. Finish or release it below to start another.</Text> : null}

      {placements && placements.length > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <Text style={styles.label}>Your spotlights</Text>
          {placements.map((p) => {
            const status = placementStatusLine(p);
            const stats = statsLine(p);
            return (
              <View key={p.placement_id} style={styles.item}>
                <Text style={styles.itemTitle} numberOfLines={1}>{p.title}</Text>
                <Text style={styles.helper}>{dayLabel(p.starts_at)} – {dayLabel(p.ends_at)}{priceLabel(p.amount_cents, p.currency) ? ` · ${priceLabel(p.amount_cents, p.currency)}` : ''}</Text>
                {status ? <Text style={styles.helper}>{status}</Text> : null}
                {stats ? <Text style={styles.helper}>{stats}</Text> : null}
                {p.status === 'scheduled' && p.payment_status === 'paid' && new Date(p.starts_at) > new Date() ? (
                  <TouchableOpacity onPress={() => cancelPaid(p)} disabled={busy} accessibilityRole="button" accessibilityLabel="Cancel this spotlight for a full refund">
                    <Text style={styles.link}>Cancel for a full refund</Text>
                  </TouchableOpacity>
                ) : null}
                {p.status === 'awaiting_payment' ? (
                  <TouchableOpacity onPress={() => cancelHold(p)} accessibilityRole="button" accessibilityLabel="Release this slot">
                    <Text style={styles.link}>Release this slot</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  wrap: { marginTop: spacing.lg },
  header: { ...typography.headline, color: colors.text },
  helper: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  label: { ...typography.caption, color: colors.text, fontWeight: '600', marginTop: spacing.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipText: { ...typography.caption, color: colors.text },
  chipTextOn: { color: '#fff' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: spacing.xs },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.xs },
  cta: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md },
  ctaText: { ...typography.body, color: '#fff', fontWeight: '600' },
  item: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.xs },
  itemTitle: { ...typography.body, color: colors.text, fontWeight: '600' },
  ctaCheck: { fontSize: 22, color: colors.primary, marginRight: spacing.sm },
  link: { ...typography.caption, color: colors.primary, marginTop: spacing.xs },
});
