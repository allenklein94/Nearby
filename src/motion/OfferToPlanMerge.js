import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius as R, spacing } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES, offerToPlanAssembly, infoOpacity } from './motionBudget';
import { OfferProgressGlow } from './OfferProgressSteps';

// Owner item 32 (2026-10-11): the accepted offer merges into Your Plan. After "✓ You're booked" settles on the offer card
// (item 12), a "✓ Coastal Coffee" chip lifts off it and travels up into the plan card (MergeTravelChip) while the screen
// scrolls gently there (utils/offerToPlanMerge.js decides whether), and the plan card, now "Coffee at Coastal Coffee",
// assembles and glows once in the success colour (PlanMergeLanding: its four lines settle one after another, the logo
// settles into the place line, the connecting line draws top to bottom, then the glow; same moment). One moment: calm (item 122), no bounce, particles or
// confetti, no haptic of its own (the morph's success vibration is the only one). Both parts are decorative and never
// touchable; the plan's lines stay readable throughout (never below the info floor). Reduce Motion: neither plays (the
// finished card: lines in place, logo in, connecting line drawn).
// Decisions are the screen's (offerToPlanMergeNow); the timing tokens are SEQUENCES.offerToPlan.
const M = SEQUENCES.offerToPlan;
const ease = Easing.bezier(0.2, 0, 0, 1);

// Lives inside the scroll view's content (absolute, content coordinates), so a scroll during the travel carries it along.
export function MergeTravelChip({ label, fromY, toY, onLanded }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const animate = useRef(!reduceMotion).current;
  const v = useRef(new Animated.Value(0)).current;
  const landed = useRef(onLanded);
  landed.current = onLanded;

  useEffect(() => {
    if (!animate) { landed.current?.(); return undefined; }
    const a = Animated.timing(v, { toValue: 1, duration: M.travelMs, easing: ease, useNativeDriver: true });
    a.start(({ finished }) => { if (finished) landed.current?.(); });
    return () => a.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!animate) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.chip, {
        top: fromY,
        backgroundColor: colors.surface,
        borderColor: colors.success,
        opacity: v.interpolate({ inputRange: [0, M.chipFadeFrom, 1], outputRange: [1, 1, 0] }),
        transform: [
          { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, toY - fromY] }) },
          { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, M.chipToScale] }) },
        ],
      }]}
    >
      <Text style={[styles.chipCheck, { color: colors.success }]}>✓</Text>
      <Text style={[styles.chipText, { color: colors.textPrimary }]} numberOfLines={1}>{label}</Text>
    </Animated.View>
  );
}

// The plan card's assembly (owner, 2026-10-11): one timeline value `t` (0 -> 1 over the assembly, native driver) that the
// card's pieces read through PlanAssembly context. At rest (`t` = 1, also Reduce Motion and every reopen) the card is its
// finished self: lines in place, logo in, connecting line drawn. While `holding` (the chip is still on its way) `t` waits at
// 0: the lines stay readable (never below the info floor) and only the decorative logo and line wait. On `playKey` (> 0)
// the assembly runs (offerToPlanAssembly) and the card's outline glows once at its end.
const PlanAssembly = createContext(null);
const at = (ms, total) => Math.min(Math.max(ms / total, 0), 1);

export function PlanMergeLanding({ playKey = 0, holding = false, color, radius = R.lg, children }) {
  const reduceMotion = useReduceMotion();
  const animate = playKey > 0 && !reduceMotion;
  const t = useRef(new Animated.Value(1)).current;
  const plan = offerToPlanAssembly(M);

  useEffect(() => {
    if (holding && !reduceMotion && playKey === 0) t.setValue(0);
  }, [holding, reduceMotion, playKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (playKey === 0) return undefined;
    if (!animate) { t.setValue(1); return undefined; }
    t.setValue(0);
    const a = Animated.timing(t, { toValue: 1, duration: plan.glowStart, easing: Easing.linear, useNativeDriver: true });
    a.start();
    return () => { a.stop(); t.setValue(1); };
  }, [playKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PlanAssembly.Provider value={{ t, plan }}>
      <View>
        {children}
        {animate ? <OfferProgressGlow key={playKey} play color={color} radius={radius} timing={{ ...M, delayMs: plan.glowStart }} /> : null}
      </View>
    </PlanAssembly.Provider>
  );
}

// A segment of the timeline as 0 -> 1, eased out (piecewise, so it runs on the native driver, which takes no easing curve).
function segment(t, { start, end }, total) {
  const a = at(start, total);
  const b = Math.max(at(end, total), a + 0.002);
  const m = a + (b - a) * 0.4;
  return t.interpolate({ inputRange: [0, a, m, b, 1], outputRange: [0, 0, 0.75, 1, 1], extrapolate: 'clamp' });
}

// One of the plan's four lines (index: 0 activity, 1 time, 2 place, 3 people). Information: readable from the first frame
// (infoOpacity), it only rises lineFlowPx into place.
export function PlanAssemblyLine({ index, style, children }) {
  const ctx = useContext(PlanAssembly);
  if (!ctx) return <View style={style}>{children}</View>;
  const v = segment(ctx.t, ctx.plan.lines[index], ctx.plan.glowStart);
  return (
    <Animated.View style={[style, {
      opacity: infoOpacity(v),
      transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [M.lineFlowPx, 0] }) }],
    }]}
    >
      {children}
    </Animated.View>
  );
}

// The business's screened logo settling into the place line (decorative: the name is in the title).
export function PlanAssemblyLogo({ children }) {
  const ctx = useContext(PlanAssembly);
  if (!ctx) return children;
  const v = segment(ctx.t, ctx.plan.logo, ctx.plan.glowStart);
  return (
    <Animated.View style={{ opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [M.logoFromScale, 1] }) }] }}>
      {children}
    </Animated.View>
  );
}

// The connecting line on the card's left, joining the four lines (`state` from planJoinLine). 'settled' = one solid line in
// the success colour, drawn top to bottom during the assembly; 'open' = faint and broken, still; null = none. Decorative:
// never touchable, hidden from screen readers (the status pill says it in words).
const BROKEN_SEGMENTS = 40; // more than any card needs; the column clips the rest
export function PlanJoinRail({ state, color, faintColor }) {
  const ctx = useContext(PlanAssembly);
  if (!state) return null;
  const hidden = { pointerEvents: 'none', accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' };
  if (state === 'open') {
    return (
      <View {...hidden} style={styles.rail}>
        {Array.from({ length: BROKEN_SEGMENTS }, (_, i) => <View key={i} style={[styles.railDash, { backgroundColor: faintColor }]} />)}
      </View>
    );
  }
  const draw = ctx ? segment(ctx.t, ctx.plan.draw, ctx.plan.glowStart) : 1;
  return (
    <View {...hidden} style={styles.rail}>
      <Animated.View style={[styles.railSolid, { backgroundColor: color, transformOrigin: 'top', transform: [{ scaleY: draw }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute', left: spacing.lg, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    borderWidth: 1, borderRadius: R.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, maxWidth: '80%',
  },
  chipCheck: { fontSize: 14, fontWeight: '700', marginRight: 6 },
  chipText: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  rail: { position: 'absolute', left: 0, top: 6, bottom: 6, width: 2, overflow: 'hidden' },
  railSolid: { flex: 1, borderRadius: 1 },
  railDash: { width: 2, height: 4, marginBottom: 4, borderRadius: 1 },
});
