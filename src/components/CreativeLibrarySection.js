import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, Alert, Platform, StyleSheet } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { presentRecoverableError } from '../utils/recoverableError';
import { creativeView, anyReviewing } from '../utils/creativeLibrary';
import { videoLimitProblem } from '../utils/offerMedia';
import {
  getMyCreatives, addCreativeToLibrary, retryCreativeCheck, archiveBusinessCreative,
  pickBusinessOfferMedia, getSignedBusinessOfferMediaUrl,
} from '../services/businessFulfillment';

// "Your photos & videos" on the business dashboard's Profile tab (owner, 2026-10-10, LOCKED). The owner adds media it
// already has; each item is screened on the server (screen-business-content, target 'creative') and shows one of three
// states: Reviewing… / Ready to use / Needs changes (with the reason). Only ready items appear in the offer form's
// "Use your saved creative" picker (utils/creativeLibrary.js pickerCreatives; the database refuses any other on an offer).
// Never on the business application form: an applicant has no business account to own these files yet.
const POLL_MS = 5000;

function LibraryThumb({ item, colors }) {
  const { t } = useLanguage();
  const [uri, setUri] = useState(null);
  const path = item.media_type === 'video' ? item.poster_path : item.media_path;
  useEffect(() => {
    let cancelled = false;
    getSignedBusinessOfferMediaUrl(path).then((u) => { if (!cancelled) setUri(u); });
    return () => { cancelled = true; };
  }, [path]);
  return (
    <View
      style={{ width: 64, height: 64, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border }}
      accessible
      accessibilityLabel={item.media_type === 'video' ? t('ui.bizHelp.library.videoA11y') : t('ui.bizHelp.library.photoA11y')}
    >
      {uri ? <Image source={{ uri }} style={{ width: 64, height: 64 }} /> : <Text>{item.media_type === 'video' ? '🎬' : '🖼️'}</Text>}
      {item.media_type === 'video' && uri ? <Text style={{ position: 'absolute', bottom: 2, right: 4 }}>🎬</Text> : null}
    </View>
  );
}

export default function CreativeLibrarySection({ partnerId, onLayout }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [items, setItems] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    if (!partnerId) return;
    try {
      const list = await getMyCreatives(partnerId);
      if (!mounted.current) return;
      setItems(list);
      setLoadFailed(false);
    } catch (_e) {
      if (mounted.current) setLoadFailed(true);
    }
  }, [partnerId]);

  useEffect(() => { load(); }, [load]);

  // Keep looking while something is being checked, so each answer shows up without a manual refresh.
  const reviewing = anyReviewing(items);
  useEffect(() => {
    if (!reviewing) return undefined;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [reviewing, load]);

  async function handleAdd() {
    if (adding) return;
    try {
      // The website adds photos and graphics only: a video is checked through frames sampled on the phone.
      const asset = await pickBusinessOfferMedia({ imagesOnly: Platform.OS === 'web' });
      if (!asset) return;
      const problem = videoLimitProblem(asset); // unknown length or over 30 seconds: refused, never trimmed by Nearby
      if (problem) { Alert.alert(problem); return; }
      setAdding(true);
      await addCreativeToLibrary(partnerId, asset);
      await load();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e });
    } finally {
      if (mounted.current) setAdding(false);
    }
  }

  async function handleRetry(item) {
    setBusyId(item.id);
    try { await retryCreativeCheck(partnerId, item.id); await load(); }
    catch (e) { presentRecoverableError(Alert, { what: 'complete that', error: e }); }
    finally { if (mounted.current) setBusyId(null); }
  }

  async function handleRemove(item) {
    setBusyId(item.id);
    try {
      await archiveBusinessCreative(item.id);
      setItems((list) => (list ?? []).filter((c) => c.id !== item.id));
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e });
    } finally {
      if (mounted.current) setBusyId(null);
    }
  }

  const toneColor = { progress: colors.textSecondary, success: colors.success, warning: colors.warning, danger: colors.danger };

  return (
    <View onLayout={onLayout} style={{ marginTop: spacing.xl }}>
      <Text style={styles.header}>{t('ui.bizHelp.library.title')}</Text>
      <Text style={styles.helper}>{t('ui.bizHelp.library.helper')}</Text>
      {Platform.OS === 'web' ? <Text style={styles.helper}>{t('ui.bizHelp.library.webNote')}</Text> : null}
      {loadFailed ? (
        <TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel={t('ui.bizHelp.library.tryAgain')}>
          <Text style={[styles.helper, { color: colors.danger }]}>
            {t('ui.bizHelp.library.loadFailed')} <Text style={styles.link}>{t('ui.bizHelp.library.tryAgain')}</Text>
          </Text>
        </TouchableOpacity>
      ) : null}
      {(items ?? []).map((item) => {
        const view = creativeView(item);
        return (
          <View key={item.id} style={styles.row}>
            <LibraryThumb item={item} colors={colors} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={[styles.state, { color: toneColor[view.tone] }]}>{view.title}</Text>
              {view.detail ? <Text style={styles.detail}>{view.detail}</Text> : null}
              <View style={{ flexDirection: 'row', marginTop: spacing.xs }}>
                {view.actions.includes('retry') ? (
                  <TouchableOpacity onPress={() => handleRetry(item)} disabled={busyId === item.id} accessibilityRole="button" accessibilityLabel={t('ui.bizHelp.library.tryAgain')}>
                    <Text style={[styles.link, { marginRight: spacing.lg }]}>{t('ui.bizHelp.library.tryAgain')}</Text>
                  </TouchableOpacity>
                ) : null}
                {view.actions.includes('remove') ? (
                  <TouchableOpacity onPress={() => handleRemove(item)} disabled={busyId === item.id} accessibilityRole="button" accessibilityLabel={t('ui.bizHelp.library.remove')}>
                    <Text style={styles.remove}>{t('ui.bizHelp.library.remove')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}
      <TouchableOpacity
        onPress={handleAdd}
        disabled={adding || !partnerId}
        style={[styles.addButton, adding && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={Platform.OS === 'web' ? t('ui.bizHelp.library.addPhoto') : t('ui.bizHelp.library.add')}
      >
        <Text style={styles.addText}>
          {adding ? t('ui.bizHelp.library.adding') : Platform.OS === 'web' ? t('ui.bizHelp.library.addPhoto') : t('ui.bizHelp.library.add')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  header: { ...typography.headline, color: colors.textPrimary },
  helper: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.md },
  state: { fontWeight: '700', fontSize: 15 },
  detail: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  link: { color: colors.primary, fontWeight: '600' },
  remove: { color: colors.danger, fontWeight: '600' },
  addButton: { marginTop: spacing.md, alignSelf: 'flex-start', paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary },
  addText: { color: colors.primary, fontWeight: '600' },
});
