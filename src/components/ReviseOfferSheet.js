import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform, KeyboardAvoidingView, Alert,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';
import { modalAnimation } from '../motion';
import PlatformDateTimeInput from './PlatformDateTimeInput';
import OfferCustomerBody from './OfferCustomerBody';
import BusinessLogoMark from './BusinessLogoMark';
import { presentOffer } from '../utils/offerPresentationEngine';
import { consumerOfferAction } from '../utils/primaryAction';
import { presentRecoverableError } from '../utils/recoverableError';
import {
  revisableTerms, revisionDraftFrom, revisionProblem, revisionParams, revisedOfferPreview,
} from '../utils/offerRevision';
import { reviseBusinessOffer } from '../services/businessFulfillment';

// Item 118 (owner, 2026-10-16): the business's ONE change to an offer it already sent: PRICE AND TIME ONLY. The sheet
// shows only the terms this reply has (its price, its discount, its time or two times) with Make an Offer's controls,
// and the live Customer Preview (item 49: same OfferCustomerBody + presentOffer as the customer's card, with "Updated").
// Description, items, media and validity are shown in the preview but can't be edited here. Rules: utils/offerRevision.js
// (mirrors revise_business_offer). Nothing animates; Send acts at once.
const HINT_KEYS = { priceHigher: 'ui.bizDash3.revisePriceOnlyLower', discountLower: 'ui.bizDash3.reviseDiscountOnlyBigger' };
const timeLabel = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function ReviseOfferSheet({ offer, business = {}, discountCap = null, onClose, onSent }) {
  const { colors, isDark } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors);
  const [draft, setDraft] = useState(() => revisionDraftFrom(offer));
  const [picker, setPicker] = useState(null); // 'time' | 'timeAlt' | null
  const [sending, setSending] = useState(false);

  useEffect(() => { setDraft(revisionDraftFrom(offer)); setPicker(null); setSending(false); }, [offer?.id]);

  if (!offer) return null;
  const terms = revisableTerms(offer);
  const problem = revisionProblem(offer, draft, { discountCap });
  const preview = revisedOfferPreview(offer, draft);
  const shown = presentOffer(preview, { business, context: { viewer: 'owner_preview' } });

  async function send() {
    if (problem || sending) return;
    setSending(true);
    try {
      await reviseBusinessOffer(revisionParams(offer, draft));
      Alert.alert(t('ui.bizDash3.updatedOfferOnItsWay'));
      onSent?.();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'send your response', error: e, draftKept: true, onRetry: send });
    }
    setSending(false);
  }

  const timeRow = (key) => (
    <TouchableOpacity
      key={key}
      style={[styles.input, { justifyContent: 'center', marginTop: spacing.sm }]}
      onPress={() => setPicker(key)}
      accessibilityLabel={t('ui.bizDash3.pickTheTimeYoureProposingA11y')}
      accessibilityRole="button"
    >
      <Text style={{ color: colors.textPrimary }}>{draft[key] ? timeLabel(draft[key]) : t('ui.bizDash3.pickATime')}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible animationType={modalAnimation('slide')} transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>{t('ui.bizDash3.changePriceOrTime')}</Text>
              <Text style={styles.helper}>{t('ui.bizDash3.youCanChangeThisOfferOnce')}</Text>
              {terms.price ? (
                <>
                  <Text style={styles.label}>{offer.price_is_per_person ? t('ui.bizDash3.pricePerPersonA11y') : t('ui.bizDash3.price')}</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    value={draft.price == null ? '' : String(draft.price)}
                    onChangeText={(v) => setDraft((d) => ({ ...d, price: v.replace(/[^0-9.]/g, '') }))}
                    accessibilityLabel={offer.price_is_per_person ? t('ui.bizDash3.pricePerPersonA11y') : t('ui.bizDash3.price')}
                  />
                </>
              ) : null}
              {terms.discount ? (
                <>
                  <Text style={styles.label}>{discountCap != null ? t('ui.bizDash3.discountMax', { discountCap }) : t('ui.bizDash3.discountPercentA11y')}</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="number-pad"
                    value={draft.discount == null ? '' : String(draft.discount)}
                    onChangeText={(v) => setDraft((d) => ({ ...d, discount: v.replace(/[^0-9.]/g, '') }))}
                    accessibilityLabel={t('ui.bizDash3.discountPercentA11y')}
                  />
                </>
              ) : null}
              {terms.times > 0 ? timeRow('time') : null}
              {terms.times === 2 ? timeRow('timeAlt') : null}
              {picker ? (
                <PlatformDateTimeInput
                  value={draft[picker] ? new Date(draft[picker]) : new Date()}
                  mode="datetime"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  themeVariant={isDark ? 'dark' : 'light'}
                  minimumDate={new Date()}
                  onChange={(event, selectedDate) => {
                    const key = picker;
                    if (Platform.OS !== 'ios') setPicker(null);
                    if (selectedDate && event?.type !== 'dismissed') setDraft((d) => ({ ...d, [key]: selectedDate.toISOString() }));
                  }}
                />
              ) : null}
              {HINT_KEYS[problem] ? <Text style={styles.problem}>{t(HINT_KEYS[problem])}</Text> : null}

              <Text style={styles.label}>{t('ui.bizDash3.customerPreview')}</Text>
              <View style={styles.previewCard}>
                <View style={styles.previewPartnerRow}>
                  <BusinessLogoMark uri={business.logoUri ?? null} />
                  <Text style={styles.previewName}>{business.name}</Text>
                </View>
                {!!preview.offer_title && <Text style={styles.previewName}>{preview.offer_title}</Text>}
                <OfferCustomerBody offer={preview} countdown={shown.countdown} updated={shown.updated} />
                <View style={[styles.submit, { opacity: 0.45 }]} accessible accessibilityRole="button" accessibilityState={{ disabled: true }} accessibilityLabel={t('ui.bizDash3.previewOfTheCustomersAcceptA11y')}>
                  <Text style={styles.submitText}>{consumerOfferAction({ status: 'offered' }, { request: { status: 'open' } }).label}</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.submit, (problem || sending) && { opacity: 0.5 }]}
                onPress={send}
                disabled={!!problem || sending}
                accessibilityRole="button"
                accessibilityState={{ disabled: !!problem || sending }}
                accessibilityLabel={sending ? t('ui.bizDash3.sendingA11y') : t('ui.bizDash3.send')}
              >
                <Text style={styles.submitText}>{sending ? t('ui.bizDash3.sending') : t('ui.bizDash3.send')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.md }} accessibilityLabel={t('ui.bizDash3.cancelA11y')} accessibilityRole="button">
                <Text style={styles.close}>{t('ui.bizDash3.cancel')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const getStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '90%' },
  sheetTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
  helper: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  label: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs, textTransform: 'uppercase' },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  problem: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
  previewCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  previewPartnerRow: { flexDirection: 'row', alignItems: 'center' },
  previewName: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 14, flexShrink: 1, marginTop: spacing.xs },
  submit: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  close: { color: colors.primary, fontWeight: '600', textAlign: 'center' },
});
