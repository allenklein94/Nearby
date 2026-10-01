import React, { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { classifyBusinessDescription } from '../services/businessOnboardingAssistant';
import { updateBusinessProfile, setBusinessOfferedOccasions, setBusinessAccommodations } from '../services/brandOffers';
import { buildSetupPlan } from '../utils/businessSetupPlan';
import SettingConflictNotice from './SettingConflictNotice';
import { useSettingConflicts } from '../hooks/useSettingConflicts';
import { checkBusinessSettingConflicts } from '../services/brandOffers';
import { conflictMessages } from '../utils/settingConflicts';

// "Tell Nearby about your business": the owner describes the business in a sentence or two, Nearby reads it back as
// chips, and "Yes, continue" saves it through the existing setters. AI suggests, the owner confirms; nothing is saved
// before that tap, and the save only ADDS (see utils/businessSetupPlan.js). Availability and price are deliberately never
// read from text -- there is no per-business hours data, and a price would be a guess.
export default function TellNearbyBusinessCard({ partner, onApplied, onOpenProfileEditor }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [editing, setEditing] = useState(false);
  const [exclude, setExclude] = useState([]);
  const plan = result ? buildSetupPlan(partner, result, exclude) : null;
  const [saved, setSaved] = useState(false);
  // Item 86: a contradiction with what is already set (e.g. "No children" vs a Family group) is the server's to decide; shown here.
  const conflicts = useSettingConflicts(partner?.id ?? null);
  const conflictCheck = plan ? {
    kind: 'profile',
    patch: {
      ...(plan.patch.profile ? { attributes: plan.patch.profile.attributes } : {}),
      ...(plan.patch.offeredOccasions ? { offered_occasions: plan.patch.offeredOccasions } : {}),
      ...(plan.patch.partyTypes ? { accommodates_party_types: plan.patch.partyTypes } : {}),
    },
  } : null;
  const conflictKey = JSON.stringify(conflictCheck);
  useEffect(() => {
    if (conflicts.entries.tell && conflictCheck) conflicts.recheck('tell', conflictCheck);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictKey]);

  function reset() {
    conflicts.clear('tell');
    setResult(null);
    setExclude([]);
    setEditing(false);
  }

  function toggle(key) {
    setExclude((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function understand() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setSaved(false);
    try {
      setResult(await classifyBusinessDescription(text.trim()));
      setExclude([]);
      setEditing(false);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => understand() });
    }
    setBusy(false);
  }

  async function confirm() {
    if (!plan || busy) return;
    setBusy(true);
    try {
      // Asked first (same server rule, nothing saved) so a contradiction never leaves these saves half-applied.
      const lines = await checkBusinessSettingConflicts(partner.id, conflictCheck.kind, conflictCheck.patch);
      if (conflicts.report('tell', { conflicts: lines }, { check: conflictCheck })) {
        setBusy(false);
        return;
      }
      const applied = {};
      if (plan.patch.profile) {
        const p = plan.patch.profile;
        await updateBusinessProfile(partner.id, {
          name: partner.name,
          description: partner.description,
          address: partner.address,
          logoUrl: partner.logo_url,
          category: p.category,
          attributes: p.attributes,
          cuisine: p.cuisine,
          differentiator: partner.differentiator,
          subcategory: p.subcategory,
          categories: p.categories,
        });
        Object.assign(applied, { category: p.category, subcategory: p.subcategory, cuisine: p.cuisine, attributes: p.attributes, categories: p.categories });
      }
      if (plan.patch.offeredOccasions) {
        await setBusinessOfferedOccasions(partner.id, plan.patch.offeredOccasions);
        applied.offered_occasions = plan.patch.offeredOccasions;
      }
      if (plan.patch.partyTypes) {
        await setBusinessAccommodations(partner.id, plan.patch.partyTypes);
        applied.accommodates_party_types = plan.patch.partyTypes;
      }
      onApplied?.(applied);
      setSaved(true);
      reset();
      setText('');
    } catch (e) {
      if (!conflicts.report('tell', e, { check: conflictCheck })) {
        presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => confirm() });
      }
    }
    setBusy(false);
  }

  return (
    <View style={styles.card} accessibilityLabel={t('ui.bizComp.tellNearbyAboutYourBusinessA11y')}>
      <Text style={styles.title}>{t('ui.bizComp.tellNearbyAboutYourBusiness')}</Text>
      <Text style={styles.helper}>{t('ui.bizComp.aSentenceOrTwoIs')}</Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder={t('ui.bizComp.wereAnItalianRestaurantWith')}
        placeholderTextColor={colors.textSecondary}
        multiline
        maxLength={800}
        accessibilityLabel={t('ui.bizComp.describeYourBusinessA11y')}
      />
      {!plan ? (
        <TouchableOpacity
          style={[styles.primary, { opacity: busy || !text.trim() ? 0.6 : 1 }]}
          onPress={understand}
          disabled={busy || !text.trim()}
          accessibilityRole="button"
          accessibilityLabel={t('ui.bizComp.letNearbyUnderstandMyBusinessA11y')}
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryText}>{t('ui.bizComp.letNearbyUnderstand')}</Text>}
        </TouchableOpacity>
      ) : plan.understood ? (
        <View style={styles.result}>
          <Text style={styles.resultTitle}>{t('ui.bizComp.weUnderstoodYourBusiness')}</Text>
          <View style={styles.chips}>
            {plan.chips.map((c) => (
              <TouchableOpacity
                key={c.key}
                disabled={!editing || !c.isNew}
                onPress={() => toggle(c.key)}
                style={[styles.chip, c.isNew && !c.excluded && styles.chipNew, c.excluded && styles.chipOff]}
                accessibilityRole={editing && c.isNew ? 'checkbox' : 'text'}
                accessibilityState={editing && c.isNew ? { checked: !c.excluded } : undefined}
                accessibilityLabel={c.label}
              >
                <Text style={[styles.chipText, c.excluded && styles.chipTextOff]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.helper}>
            {editing
              ? t('ui.bizComp.tapAHighlightedItemTo')
              : plan.hasChanges ? t('ui.bizComp.looksRightHighlightedItemsWill') : t('ui.bizComp.allOfThisIsAlready')}
          </Text>
          <SettingConflictNotice messages={conflictMessages(conflicts.entries, 'tell')} />
          <View style={styles.row}>
            {plan.hasChanges ? (
              <TouchableOpacity style={[styles.primary, { flex: 1, opacity: busy ? 0.6 : 1 }]} onPress={confirm} disabled={busy} accessibilityRole="button" accessibilityLabel={t('ui.bizComp.yesContinueA11y')}>
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryText}>{t('ui.bizComp.yesContinue')}</Text>}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.secondary}
              onPress={() => (plan.hasChanges && !editing ? setEditing(true) : reset())}
              accessibilityRole="button"
              accessibilityLabel={plan.hasChanges && !editing ? t('ui.bizComp.editA11y') : t('ui.bizComp.doneA11y')}
            >
              <Text style={styles.secondaryText}>{plan.hasChanges && !editing ? t('ui.bizComp.edit') : t('ui.bizComp.done')}</Text>
            </TouchableOpacity>
          </View>
          {editing && onOpenProfileEditor ? (
            <TouchableOpacity onPress={onOpenProfileEditor} accessibilityRole="button" accessibilityLabel={t('ui.bizComp.openTheFullProfileEditorA11y')}>
              <Text style={styles.link}>{t('ui.bizComp.changeCategoryCuisineOrAttributes')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <View style={styles.result}>
          <Text style={styles.helper}>{t('ui.bizComp.weCouldntPickOutSpecifics')}</Text>
          <TouchableOpacity style={styles.secondary} onPress={reset} accessibilityRole="button" accessibilityLabel={t('ui.bizComp.tryAgainA11y')}>
            <Text style={styles.secondaryText}>{t('ui.bizComp.tryAgain')}</Text>
          </TouchableOpacity>
        </View>
      )}
      {saved ? <Text style={styles.savedText}>{t('ui.bizComp.savedNearbyWillUseThis')}</Text> : null}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  title: { ...typography.title, color: colors.textPrimary },
  helper: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.xs, marginBottom: spacing.sm },
  input: { minHeight: 72, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.textPrimary, textAlignVertical: 'top' },
  primary: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  primaryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  secondary: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: 'center', marginTop: spacing.sm, marginLeft: spacing.sm },
  secondaryText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  result: { marginTop: spacing.sm },
  resultTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', marginBottom: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 4, marginRight: spacing.xs, marginBottom: spacing.xs },
  chipNew: { borderColor: colors.primary },
  chipOff: { opacity: 0.45 },
  chipTextOff: { textDecorationLine: 'line-through' },
  link: { color: colors.primary, fontSize: 13, fontWeight: '600', marginTop: spacing.sm },
  chipText: { color: colors.textPrimary, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center' },
  savedText: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.sm },
});
