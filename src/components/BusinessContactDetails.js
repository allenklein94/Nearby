import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Alert } from 'react-native';
import { disabledButtonStyle } from '../constants/buttonStates';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { getBusinessContactDetails, setBusinessContactDetails } from '../services/brandOffers';
import { contactDetailsProblem, contactDetailsRefusal } from '../utils/businessContactDetails';
import { presentRecoverableError } from '../utils/recoverableError';

// Business phone + website (owner, 2026-11-15; migration 20270423): ONE optional row in Profile > Business Profile, opens
// in place like Hours (no new screen). Private: read and saved only through the business's own functions; customers,
// offers and discovery never see them. Read from the server on mount and after every save (what is shown is what is stored).
export default function BusinessContactDetails({ partnerId }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [saved, setSaved] = useState(null); // { phone, website } | null
  const [loadState, setLoadState] = useState('loading'); // loading | ready | failed
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [problem, setProblem] = useState(null); // 'phone' | 'website' | null
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!partnerId) return;
    setLoadState('loading');
    try {
      setSaved(await getBusinessContactDetails(partnerId));
      setLoadState('ready');
    } catch (e) {
      setLoadState('failed');
    }
  }, [partnerId]);

  useEffect(() => { load(); }, [load]);

  function startEditing() {
    setPhone(saved?.phone ?? '');
    setWebsite(saved?.website ?? '');
    setProblem(null);
    setOpen(true);
  }

  async function save() {
    const local = contactDetailsProblem({ phone, website });
    if (local) { setProblem(local); return; }
    setSaving(true);
    try {
      const stored = await setBusinessContactDetails(partnerId, { phone, website });
      setSaved(stored);
      setOpen(false);
    } catch (e) {
      const refusal = contactDetailsRefusal(e);
      if (refusal) setProblem(refusal);
      else presentRecoverableError(Alert, { what: 'save your phone and website', error: e, draftKept: true, onRetry: save });
    } finally {
      setSaving(false);
    }
  }

  if (!partnerId) return null;
  const has = !!(saved?.phone || saved?.website);

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.row}
        onPress={open ? () => setOpen(false) : startEditing}
        disabled={loadState !== 'ready'}
        accessibilityRole="button"
        accessibilityLabel={t('ui.bizComp.contactDetailsEditA11y')}
      >
        <Text style={styles.rowTitle}>{t('ui.bizComp.contactDetailsTitle')}</Text>
        {loadState === 'ready' ? <Text style={styles.rowAction}>{open ? t('ui.bizComp.close') : t('ui.bizComp.edit')}</Text> : null}
      </TouchableOpacity>
      {loadState === 'failed' ? (
        <TouchableOpacity onPress={load} accessibilityRole="button">
          <Text style={styles.helper}>{t('ui.bizComp.contactDetailsLoadFailed')} <Text style={styles.link}>{t('ui.shared.errors.tryAgain')}</Text></Text>
        </TouchableOpacity>
      ) : null}
      {loadState === 'ready' && !open ? (
        has ? (
          <View>
            <Text style={styles.summary}>{t('ui.bizComp.contactDetailsPhone')}: {saved?.phone || t('ui.bizComp.contactDetailsNotSet')}</Text>
            <Text style={styles.summary}>{t('ui.bizComp.contactDetailsWebsite')}: {saved?.website || t('ui.bizComp.contactDetailsNotSet')}</Text>
          </View>
        ) : (
          <Text style={styles.helper}>{t('ui.bizComp.contactDetailsNotSet')}</Text>
        )
      ) : null}
      {open ? (
        <View>
          <Text style={styles.label}>{t('ui.bizComp.contactDetailsPhone')}</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={(v) => { setPhone(v); setProblem(null); }}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            maxLength={30}
            accessibilityLabel={t('ui.bizComp.contactDetailsPhone')}
          />
          {problem === 'phone' ? <Text style={styles.problem}>{t('ui.bizComp.contactDetailsInvalidPhone')}</Text> : null}
          <Text style={styles.label}>{t('ui.bizComp.contactDetailsWebsite')}</Text>
          <TextInput
            style={styles.input}
            value={website}
            onChangeText={(v) => { setWebsite(v); setProblem(null); }}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="URL"
            maxLength={200}
            accessibilityLabel={t('ui.bizComp.contactDetailsWebsite')}
          />
          {problem === 'website' ? <Text style={styles.problem}>{t('ui.bizComp.contactDetailsInvalidWebsite')}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.primary, saving && disabledButtonStyle(colors)]} onPress={save} disabled={saving} accessibilityRole="button" accessibilityLabel={t('ui.bizComp.contactDetailsSave')}>
              <Text style={styles.primaryText}>{saving ? t('ui.bizComp.saving') : t('ui.bizComp.contactDetailsSave')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {loadState === 'ready' ? <Text style={styles.helper}>{t('ui.bizComp.contactDetailsPrivate')}</Text> : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { marginTop: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.xs },
  rowTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  rowAction: { color: colors.primary, fontWeight: '700' },
  summary: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  helper: { color: colors.textTertiary, fontSize: 12, marginTop: spacing.xs, lineHeight: 17 },
  label: { color: colors.textSecondary, fontWeight: '700', marginTop: spacing.sm, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.textPrimary, backgroundColor: colors.surface },
  link: { color: colors.primary, fontWeight: '700' },
  problem: { color: colors.danger, marginTop: spacing.xs, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  primary: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md },
  primaryText: { color: '#fff', fontWeight: '700' },
});
