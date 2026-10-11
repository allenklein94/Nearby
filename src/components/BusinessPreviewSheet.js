import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Linking, Animated, Easing } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { modalAnimation, SEQUENCES, infoOpacity } from '../motion';
import PinToSheetFrame from '../motion/PinToSheetFrame';
import { toOverlayPoint } from '../motion/pinToSheet';
import useReduceMotion from '../hooks/useReduceMotion';
import { businessPreview, businessPreviewRoute } from '../utils/businessPreview';

// The one business sheet (owner item 17, 2026-10-04, LOCKED): a lightweight preview over Discover's business browsing surfaces
// (result rows, map pins). Not a screen and not a mini Business Profile: name, measured distance, open status, two declared
// qualities, the business's own action, and "View business" for the full profile. Closing (tap outside, Android Back, or opening
// something) leaves Discover exactly as it was underneath: search, filters and scroll belong to Discover and are never touched.
// Content comes only from utils/businessPreview.js; the screen passes the row it already holds.
// Owner item 44 (2026-10-11): opened from a map pin (`pinSpot`, a promise of the pin's window spot from GatheringsMapView), the
// sheet grows out of that pin instead of sliding up: it opens at the tap (text readable, buttons live from frame one), rises and
// grows into place while a pin-coloured outline travels from the pin into its edge (motion/PinToSheetFrame.js). Same content,
// same actions; Reduce Motion or any other opening = the plain modal animation as before.
const PIN = SEQUENCES.pinToSheet;

export default function BusinessPreviewSheet({ partner, pinSpot = null, navigation, onClose }) {
  const { t, language } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const preview = partner ? businessPreview(partner, { language }) : null;
  const reduceMotion = useReduceMotion();
  const fromPin = !!pinSpot && !reduceMotion;
  const grow = useRef(new Animated.Value(1)).current;
  const overlayRef = useRef(null);
  const [pin, setPin] = useState(null);
  const [sheetRect, setSheetRect] = useState(null);

  useEffect(() => {
    setPin(null);
    setSheetRect(null);
    if (!preview || !fromPin) { grow.setValue(1); return undefined; }
    grow.setValue(0);
    let settled = false;
    let anim = null;
    const start = (spot) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (spot) overlayRef.current?.measureInWindow?.((x, y) => { if (anim) setPin(toOverlayPoint(spot, { x, y })); });
      anim = Animated.timing(grow, { toValue: 1, duration: PIN.sheetMs, easing: Easing.bezier(0.2, 0, 0, 1), useNativeDriver: true });
      anim.start();
    };
    const timer = setTimeout(() => start(null), PIN.originWaitMs);
    Promise.resolve(pinSpot).then(start, () => start(null));
    return () => { settled = true; clearTimeout(timer); anim?.stop(); anim = null; grow.setValue(1); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partner, pinSpot, fromPin]);

  // Close first, then go (the same order ActionSheetModal uses), so the sheet is gone when the person comes Back.
  function go(fn) {
    onClose();
    setTimeout(fn, 0);
  }
  function runAction() {
    const route = businessPreviewRoute(partner, preview.action);
    if (!route) return;
    go(() => (route.kind === 'url' ? route.url && Linking.openURL(route.url) : navigation.navigate(route.screen, route.params)));
  }
  function viewBusiness() {
    go(() => navigation.navigate('BusinessProfile', { partnerId: partner.id }));
  }

  return (
    <Modal visible={!!preview} animationType={fromPin ? 'none' : modalAnimation('slide')} transparent onRequestClose={onClose}>
      <View ref={overlayRef} style={styles.overlay} collapsable={false}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: grow }]} />
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel={preview ? t('ui.businessSheet.closeA11y', { name: preview.title ?? '' }) : undefined}
        />
        {preview ? (
          <Animated.View
            style={[styles.sheet, {
              opacity: infoOpacity(grow),
              transform: [
                { translateY: grow.interpolate({ inputRange: [0, 1], outputRange: [PIN.risePx, 0] }) },
                { scale: grow.interpolate({ inputRange: [0, 1], outputRange: [PIN.fromScale, 1] }) },
              ],
            }]}
            onLayout={fromPin ? (e) => { const l = e.nativeEvent.layout; setSheetRect({ x: l.x, y: l.y, width: l.width, height: l.height }); } : undefined}
          >
            <View style={styles.grabber} />
            <Text style={styles.title} numberOfLines={2}>{preview.title}</Text>
            {preview.distance ? <Text style={styles.line}>{preview.distance}</Text> : null}
            {preview.hours ? <Text style={styles.line}>🕒 {preview.hours}</Text> : null}
            {preview.qualities.length > 0 ? <Text style={styles.line}>{preview.qualities.join(' · ')}</Text> : null}
            <TouchableOpacity style={styles.primary} onPress={runAction} accessibilityRole="button" accessibilityLabel={`${preview.action.label}, ${preview.title ?? ''}`}>
              <Text style={styles.primaryText}>{preview.action.label}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={viewBusiness} accessibilityRole="button" accessibilityLabel={t('ui.businessSheet.viewBusinessA11y', { name: preview.title ?? '' })}>
              <Text style={styles.secondaryText}>{t('ui.businessSheet.viewBusiness')}</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : null}
        {fromPin && pin && sheetRect ? <PinToSheetFrame pin={pin} rect={sheetRect} /> : null}
      </View>
    </Modal>
  );
}

const getStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
  line: { color: colors.textSecondary, fontSize: 14, marginBottom: spacing.xs },
  primary: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondary: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  secondaryText: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
});
