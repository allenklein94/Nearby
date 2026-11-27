import React, { useEffect, useState } from 'react';
// React Native's own SafeAreaView: the gate sits OUTSIDE the app's SafeAreaProvider, so it must not depend on one.
import { AppState, Image, Linking, Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { supabase, ENVIRONMENT, readAppVersionPolicy } from '../services/supabase';
import {
  appVersionSnapshot, dismissOptionalUpdate, initAppVersion, onAppVersionChange, recheckAppVersion,
} from '../services/appVersion';
import { safeUpdateUrl, showOptionalNotice } from '../utils/appUpdatePolicy';

// ONE reusable update gate (20270434), never a navigation destination. Wraps the app:
//   required = this screen INSTEAD of the app (nothing behind it renders, so nothing behind it makes requests)
//   optional = the app + one small dismissible notice at the top, once per newer build
//   current  = the app, untouched
// Rechecks at start-up, on sign-in, on return to the foreground and from "Check again"; the server's refusal of a request
// as too old switches to required at once (services/appVersion.js).
export default function AppUpdateGate({ children }) {
  const [snap, setSnap] = useState(appVersionSnapshot());

  useEffect(() => {
    const off = onAppVersionChange(setSnap);
    initAppVersion({ env: ENVIRONMENT, readPolicy: readAppVersionPolicy });
    const appState = AppState.addEventListener('change', (s) => { if (s === 'active') recheckAppVersion(); });
    let authSub = null;
    try {
      authSub = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN') recheckAppVersion();
      })?.data?.subscription;
    } catch { /* no client (environment error): App.js shows ConfigErrorScreen before this renders */ }
    return () => { off(); appState.remove(); authSub?.unsubscribe?.(); };
  }, []);

  if (snap.state === 'required') return <UpdateRequired snap={snap} />;
  return (
    <>
      {children}
      {showOptionalNotice({ state: snap.state, policy: snap.policy, dismissedLatest: snap.dismissedLatest })
        ? <OptionalUpdateNotice url={safeUpdateUrl(snap.policy?.update_url)} /> : null}
    </>
  );
}

function openUpdate(url) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.location.reload();
    return;
  }
  if (url) Linking.openURL(url).catch(() => {});
}

function UpdateRequired({ snap }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const web = Platform.OS === 'web';
  const url = safeUpdateUrl(snap.policy?.update_url);
  const [checkedOnce, setCheckedOnce] = useState(false);
  const check = async () => { await recheckAppVersion(); setCheckedOnce(true); };
  return (
    <SafeAreaView style={[styles.wrap, { backgroundColor: colors.background }]}>
      <View style={styles.inner}>
        <Image source={require('../../assets/branding/splash-mark.png')} style={styles.mark} resizeMode="contain"
          accessibilityIgnoresInvertColors accessible={false} />
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">{t('ui.appUpdate.requiredTitle')}</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {web ? t('ui.appUpdate.requiredBodyWeb') : t('ui.appUpdate.requiredBody')}
        </Text>
        {web || url ? (
          <Pressable onPress={() => openUpdate(url)} accessibilityRole="button"
            style={({ pressed }) => [styles.primary, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}>
            <Text style={styles.primaryText}>{web ? t('ui.appUpdate.reloadButton') : t('ui.appUpdate.updateButton')}</Text>
          </Pressable>
        ) : (
          <Text style={[styles.body, { color: colors.textSecondary }]}>{t('ui.appUpdate.noLink')}</Text>
        )}
        {web ? null : (
          <Pressable onPress={check} disabled={snap.checking} accessibilityRole="button" style={styles.secondary}
            accessibilityState={{ busy: !!snap.checking, disabled: !!snap.checking }}>
            <Text style={[styles.secondaryText, { color: colors.primary }]}>
              {snap.checking ? t('ui.appUpdate.checking') : t('ui.appUpdate.checkAgain')}
            </Text>
          </Pressable>
        )}
        {checkedOnce && !snap.checking ? (
          <Text style={[styles.note, { color: colors.textSecondary }]} accessibilityLiveRegion="polite">
            {t('ui.appUpdate.stillRequired')}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function OptionalUpdateNotice({ url }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const web = Platform.OS === 'web';
  return (
    <SafeAreaView pointerEvents="box-none" style={styles.noticeWrap}>
      <View style={[styles.notice, { backgroundColor: colors.surface, borderColor: colors.primaryMuted }]}
        accessibilityLiveRegion="polite">
        <Text style={[styles.noticeText, { color: colors.text }]}>{t('ui.appUpdate.optionalTitle')}</Text>
        {web || url ? (
          <Pressable onPress={() => openUpdate(url)} accessibilityRole="button" hitSlop={8} style={styles.noticeAction}>
            <Text style={[styles.noticeActionText, { color: colors.primary }]}>
              {web ? t('ui.appUpdate.reloadButton') : t('ui.appUpdate.optionalUpdate')}
            </Text>
          </Pressable>
        ) : null}
        <Pressable onPress={dismissOptionalUpdate} accessibilityRole="button" hitSlop={8} style={styles.noticeAction}
          accessibilityLabel={t('ui.appUpdate.notNowA11y')}>
          <Text style={[styles.noticeActionText, { color: colors.textSecondary }]}>{t('ui.appUpdate.notNow')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, maxWidth: 480, alignSelf: 'center', width: '100%' },
  mark: { width: 72, height: 72, marginBottom: 24 },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  body: { fontSize: 16, lineHeight: 22, textAlign: 'center', marginBottom: 24 },
  primary: { minHeight: 48, borderRadius: 24, paddingHorizontal: 28, justifyContent: 'center', alignSelf: 'stretch', alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  secondary: { minHeight: 44, justifyContent: 'center', marginTop: 12, paddingHorizontal: 12 },
  secondaryText: { fontSize: 15, fontWeight: '600' },
  note: { fontSize: 14, marginTop: 8, textAlign: 'center' },
  noticeWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  notice: { marginHorizontal: 12, marginTop: 8, borderRadius: 14, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  noticeText: { flexGrow: 1, flexShrink: 1, fontSize: 14, marginRight: 8 },
  noticeAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  noticeActionText: { fontSize: 14, fontWeight: '600' },
});
