import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { MOTION_BUDGET } from '../motion/motionBudget';
import { navigationRef } from '../navigation/RootNavigator';
import { openOnTop } from '../navigation/openOnTop';
import { createOfferArrivals, arrivalDestination, emitViewedArrival } from '../services/offerArrivals';
import { fetchMyLiveReplies, fetchFirstReplyState, subscribeToOfferChanges } from '../services/offerArrivalSource';
import { arrivalSignalTitle, arrivalSignalA11y } from '../utils/offerCopy';
import { startOfferTravel } from '../motion/offerTravel';
import BusinessLogoMark from './BusinessLogoMark';
import { getScreenedLogos } from '../services/businessLogos';
import { pillLogoPartnerId, logoFor } from '../utils/businessLogo';

// Offer arrival signal, Layer 1 (owner, 2026-10-09). The rules for WHICH replies are announced live in
// services/offerArrivals.js; this file only listens (realtime, a push received while open, app foreground/background) and
// draws one small pill near the top. Restrained on purpose: a short fade, two soft pulses of the ✨, then it rests and
// leaves by itself. Never sound or vibration (the operating system handles the push itself), never blocks: the pill is the
// only touchable area, the rest of the screen stays usable. Reduce Motion: it simply appears and disappears.
// The sequential offer reveal and the "You're booked" celebration are deferred until the flow has been seen on a device.

const OFFER_PUSH_TYPES = new Set(['business_offer_received']);

const isViewingRequest = (requestId) => {
  if (!navigationRef.isReady()) return false;
  const route = navigationRef.getCurrentRoute();
  return route?.name === 'BusinessRequestDetail' && route?.params?.requestId === requestId;
};

export default function OfferArrivalHost() {
  const { session, profileComplete } = useAuth() ?? {};
  const userId = profileComplete ? session?.user?.id ?? null : null;
  const [signal, setSignal] = useState(null);
  const controllerRef = useRef(null);

  useEffect(() => {
    if (!userId) return undefined;
    const controller = createOfferArrivals({
      fetchReplies: () => fetchMyLiveReplies(userId),
      fetchFirstReplyState: () => fetchFirstReplyState(userId),
      isViewingRequest,
      onViewedArrival: emitViewedArrival,
      onChange: setSignal,
    });
    controllerRef.current = controller;
    let unsubscribe = null;
    const begin = () => {
      if (!unsubscribe) unsubscribe = subscribeToOfferChanges(userId, () => controller.check());
      controller.start();
    };
    const end = () => {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      controller.pause();
    };
    if (AppState.currentState !== 'background') begin();
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') begin();
      else if (state === 'background') end();
    });
    const pushSub = Notifications.addNotificationReceivedListener((n) => {
      if (OFFER_PUSH_TYPES.has(n?.request?.content?.data?.type)) controller.check();
    });
    return () => {
      appSub.remove();
      pushSub.remove();
      end();
      controller.reset();
      controllerRef.current = null;
      setSignal(null);
    };
  }, [userId]);

  // One offer: the offer travels from the signal into its card (motion/offerTravel.js). The screen opens at once either
  // way; the travel is drawn over it and never delays it. Several replies open a list, so there is nothing to travel to.
  const open = (fromRect) => {
    const current = controllerRef.current?.getSignal() ?? signal;
    const dest = arrivalDestination(current);
    controllerRef.current?.dismiss();
    if (!dest) return;
    if (dest.params?.focusOfferId && fromRect) startOfferTravel({ offerId: dest.params.focusOfferId, from: fromRect });
    openOnTop(navigationRef, dest.name, dest.params);
  };

  return <OfferArrivalSignal signal={signal} onPress={open} />;
}

export function OfferArrivalSignal({ signal, onPress }) {
  const { colors, shadow } = useTheme();
  const { language } = useLanguage();
  const reduceMotion = useReduceMotion();
  const [shown, setShown] = useState(null); // kept through the fade-out
  const opacity = useRef(new Animated.Value(0)).current;
  const sparkle = useRef(new Animated.Value(1)).current;
  const pillRef = useRef(null);
  // The business's screened logo, only when the pill names that one business (utils/businessLogo.js). Arrives a moment
  // after the pill; no logo = the pill exactly as before.
  const [logo, setLogo] = useState(null);
  const logoPartnerId = pillLogoPartnerId(shown);
  useEffect(() => {
    setLogo(null);
    if (!logoPartnerId) return undefined;
    let live = true;
    getScreenedLogos([logoPartnerId]).then((map) => { if (live) setLogo(logoFor(map, logoPartnerId)); });
    return () => { live = false; };
  }, [logoPartnerId]);
  const press = () => {
    const node = pillRef.current;
    if (!node?.measureInWindow) { onPress(null); return; }
    let done = false;
    const go = (rect) => { if (!done) { done = true; onPress(rect); } };
    node.measureInWindow((x, y, width, height) => go({ x, y, width, height }));
    setTimeout(() => go(null), 50); // a measurement that never answers never holds up the tap
  };

  useEffect(() => {
    if (signal) {
      const wasHidden = !shown;
      setShown(signal);
      if (reduceMotion) { opacity.setValue(1); sparkle.setValue(1); return; }
      if (wasHidden) {
        opacity.setValue(0);
        const pulse = (v) => Animated.timing(sparkle, { toValue: v, duration: MOTION_BUDGET.tiny.ms, useNativeDriver: true });
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: MOTION_BUDGET.small.ms, useNativeDriver: true }),
          pulse(0.35), pulse(1), pulse(0.35), pulse(1),
        ]).start();
      }
    } else if (shown) {
      if (reduceMotion) { opacity.setValue(0); setShown(null); return; }
      Animated.timing(opacity, { toValue: 0, duration: MOTION_BUDGET.small.ms, useNativeDriver: true }).start(({ finished }) => { if (finished) setShown(null); });
    }
  }, [signal, reduceMotion]);

  if (!shown) return null;
  const title = arrivalSignalTitle(shown);
  if (!title) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: (initialWindowMetrics?.insets?.top ?? 0) + spacing.xl * 2 }]}>
      <Animated.View style={{ opacity }}>
        <TouchableOpacity
          key={language}
          ref={pillRef}
          onPress={press}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLiveRegion="polite"
          accessibilityLabel={arrivalSignalA11y(shown)}
          style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.border }, shadow?.card]}
        >
          <Animated.Text style={[styles.sparkle, { opacity: sparkle }]}>✨</Animated.Text>
          <BusinessLogoMark uri={logo} size={20} />
          <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>{title}</Text>
          <Text style={[styles.chevron, { color: colors.textSecondary }]}>›</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: spacing.lg },
  pill: { maxWidth: 420, flexDirection: 'row', alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  sparkle: { marginRight: spacing.sm, fontSize: 15 },
  title: { ...typography.bodyBold, flexShrink: 1 },
  chevron: { ...typography.bodyBold, marginLeft: spacing.sm },
});
