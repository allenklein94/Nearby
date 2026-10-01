import React, { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
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
// Each problem's wording is ui.bizComp.eligibility.<problem> (11 languages).
const ELIGIBILITY_PROBLEMS = new Set(['category_not_sponsorable', 'needs_address', 'business_inactive', 'already_holding']);

export default function SponsoredPromotionsPanel({ offers = [] }) {
  const { t } = useLanguage();
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
    if (r && !r.ok) setSlotProblem(r.problem === 'slot_taken' ? t('ui.bizComp.thatWeekIsAlreadyTaken') : t('ui.bizComp.thatStartDateIsNot'));
  };

  const buy = async () => {
    setBusy(true);
    setMessage(null);
    const res = await startSponsoredCheckout({ itemKind: kind, itemId: kind === 'offer' ? offerId : null, startDate, title, description, termsVersion: SPONSORED_TERMS_VERSION, acceptedTerms: accepted });
    setBusy(false);
    if (res.error) { setMessage({ text: res.error }); return; }
    Linking.openURL(res.url).catch(() => setMessage({ key: 'ui.bizComp.couldntOpenCheckoutYouHave' }));
    load();
  };

  const cancelHold = (p) => {
    Alert.alert(t('ui.bizComp.releaseThisSlot'), t('ui.bizComp.youHaveNotPaidSo'), [
      { text: t('ui.bizComp.keepIt'), style: 'cancel' },
      { text: t('ui.bizComp.release'), style: 'destructive', onPress: async () => { await cancelMySponsoredHold(p.placement_id); load(); } },
    ]);
  };

  const cancelPaid = (p) => {
    Alert.alert(
      t('ui.bizComp.cancelThisSpotlight'),
      t('ui.bizComp.itHasntStartedSoYoull', { priceLabel: priceLabel(p.amount_cents, p.currency) || 'the full amount' }),
      [
        { text: t('ui.bizComp.keepIt'), style: 'cancel' },
        { text: t('ui.bizComp.cancelAndRefund'), style: 'destructive', onPress: async () => {
          setBusy(true); setMessage(null);
          const res = await cancelPaidSponsoredPlacement(p.placement_id);
          setBusy(false);
          setMessage(res.error ? { text: res.error } : { key: 'ui.bizComp.cancelledYourRefundIsOn' });
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
      <Text style={styles.header}>{t('ui.bizComp.promotions')}</Text>
      <Text style={styles.helper}>{t('ui.bizComp.aPaidSpotlightShownTo', { sponsoredLabel: SPONSORED_LABEL })}</Text>

      {eligibility === undefined ? <Text style={styles.helper}>{t('ui.bizComp.checking')}</Text> : null}
      {eligibility === null ? <Text style={styles.helper}>{t('ui.bizComp.couldntLoadPromotionsRightNow')}</Text> : null}
      {eligibility && !eligibility.ok ? (
        <Text style={styles.helper}>
          {ELIGIBILITY_PROBLEMS.has(eligibility.problem) ? t(`ui.bizComp.eligibility.${eligibility.problem}`) : t('ui.bizComp.spotlightsArentAvailableForYour2')}
        </Text>
      ) : null}

      {eligibility?.ok && !hasHeld ? (
        <View>
          <Text style={styles.label}>{t('ui.bizComp.whatToPromote')}</Text>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.chip, kind === 'business' && styles.chipOn]} onPress={() => setKind('business')} accessibilityRole="button">
              <Text style={[styles.chipText, kind === 'business' && styles.chipTextOn]}>{t('ui.bizComp.yourBusiness')}</Text>
            </TouchableOpacity>
            {offers.length > 0 ? (
              <TouchableOpacity style={[styles.chip, kind === 'offer' && styles.chipOn]} onPress={() => setKind('offer')} accessibilityRole="button">
                <Text style={[styles.chipText, kind === 'offer' && styles.chipTextOn]}>{t('ui.bizComp.oneOfYourOffers')}</Text>
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

          <Text style={styles.label}>{t('ui.bizComp.headline')}</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={80} placeholder={t('ui.bizComp.whatPeopleWillSee')} placeholderTextColor={colors.textSecondary} />
          <Text style={styles.label}>{t('ui.bizComp.descriptionOptional')}</Text>
          <TextInput style={[styles.input, { minHeight: 60 }]} value={description} onChangeText={setDescription} maxLength={200} multiline placeholder={t('ui.bizComp.oneOrTwoLines')} placeholderTextColor={colors.textSecondary} />

          <Text style={styles.label}>{t('ui.bizComp.startDateRuns7Days')}</Text>
          <View style={styles.row}>
            {startDateOptions().map((d) => (
              <TouchableOpacity key={d} style={[styles.chip, startDate === d && styles.chipOn]} onPress={() => pickDate(d)} accessibilityRole="button">
                <Text style={[styles.chipText, startDate === d && styles.chipTextOn]}>{dayLabel(`${d}T00:00:00Z`)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {slotProblem ? <Text style={styles.error}>{slotProblem}</Text> : null}
          {message ? <Text style={styles.error}>{message.key ? t(message.key) : message.text}</Text> : null}

          <TouchableOpacity style={[styles.cta, !canSubmit && { opacity: 0.5 }]} disabled={!canSubmit} onPress={buy} accessibilityRole="button" accessibilityLabel={t('ui.bizComp.continueToPaymentA11y')}>
            <Text style={styles.ctaText}>{price ? t('ui.bizComp.continueToPayment', { price: price }) : t('ui.bizComp.continueToPayment2')}</Text>
          </TouchableOpacity>
          <View style={[styles.row, { alignItems: 'center', marginTop: spacing.md }]}>
            <TouchableOpacity onPress={() => setAccepted((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} accessibilityLabel={t('ui.bizComp.iAcceptTheSpotlightTermsA11y')}>
              <Text style={styles.ctaCheck}>{accepted ? '☑' : '☐'}</Text>
            </TouchableOpacity>
            <Text style={[styles.helper, { flex: 1, marginTop: 0 }]}>{t('ui.bizComp.iAcceptTheSpotlightTerms')}</Text>
          </View>
          <TouchableOpacity onPress={() => setTermsOpen((v) => !v)} accessibilityRole="button" accessibilityLabel={t('ui.bizComp.readTheSpotlightTermsA11y')}>
            <Text style={styles.link}>{termsOpen ? t('ui.bizComp.hideTheTerms') : t('ui.bizComp.readTheTerms')}</Text>
          </TouchableOpacity>
          {termsOpen ? SPONSORED_TERMS_SECTIONS.map(([h, b]) => (
            <View key={h}><Text style={styles.label}>{h}</Text><Text style={styles.helper}>{b}</Text></View>
          )) : null}
        </View>
      ) : null}
      {hasHeld && eligibility?.ok ? <Text style={styles.helper}>{t('ui.bizComp.youHaveASpotlightWaiting')}</Text> : null}

      {placements && placements.length > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <Text style={styles.label}>{t('ui.bizComp.yourSpotlights')}</Text>
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
                  <TouchableOpacity onPress={() => cancelPaid(p)} disabled={busy} accessibilityRole="button" accessibilityLabel={t('ui.bizComp.cancelThisSpotlightForAA11y')}>
                    <Text style={styles.link}>{t('ui.bizComp.cancelForAFullRefund')}</Text>
                  </TouchableOpacity>
                ) : null}
                {p.status === 'awaiting_payment' ? (
                  <TouchableOpacity onPress={() => cancelHold(p)} accessibilityRole="button" accessibilityLabel={t('ui.bizComp.releaseThisSlotA11y')}>
                    <Text style={styles.link}>{t('ui.bizComp.releaseThisSlot2')}</Text>
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
