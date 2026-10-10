import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES } from '../motion/motionBudget';
import { afterOfferTravel } from '../motion/offerTravel';
import { ASSEMBLY_STEPS, assemblySteps, shouldAssemble, markAssembled, stepDelay, finishDelay } from '../utils/offerAssembly';

// An open business reply's card assembling itself (owner, 2026-10-09; decisions in utils/offerAssembly.js): business ->
// "Heard your request" -> what they said -> the order -> price -> when, each a gentle fade with a slight upward settle.
// Then the finish (2026-10-10): "I'll take this one" settles in as the final slot (fade from actionRestOpacity + the same
// rise; visible and tappable from the first frame, never disabled or covered) while the coral outline glows once (~300 ms).
// Presentation only: the same reply data, the same wording rule, the same booking action. Business tone (item 122): no bounce, no particles, no haptic (arrival-driven, item 130).
// Plays once for a newly received reply, after an offer travel into this card has finished; Reduce Motion = the finished
// card. Outside an assembly (the owner's Customer Preview, an accepted offer) every step renders as is.
const AssemblyContext = createContext(null);
const T = SEQUENCES.offerAssembly;

export default function OfferAssembly({ offer, children }) {
  const reduceMotion = useReduceMotion();
  const [animate] = useState(() => shouldAssemble(offer, { reduceMotion }));
  const values = useRef(null);
  if (!values.current) {
    values.current = Object.fromEntries([...ASSEMBLY_STEPS, 'action'].map((k) => [k, new Animated.Value(animate ? 0 : 1)]));
    values.current.glow = new Animated.Value(0); // the outline glow rests at 0 (never shown without an assembly)
  }

  useEffect(() => {
    if (!animate) return undefined;
    markAssembled(offer.id);
    const steps = assemblySteps(offer);
    // A step this reply does not have is shown as is (if a screen still renders something under it, it is never hidden).
    ASSEMBLY_STEPS.filter((k) => !steps.includes(k)).forEach((k) => values.current[k].setValue(1));
    let running = null;
    const cancel = afterOfferTravel(offer.id, () => {
      const finishAt = finishDelay(steps);
      running = Animated.parallel([
        ...steps.map((k) => Animated.timing(values.current[k], {
          toValue: 1, duration: T.stepMs, delay: stepDelay(steps, k), easing: Easing.out(Easing.cubic), useNativeDriver: true,
        })),
        // the final slot: the button settles in (it was already visible and tappable)
        Animated.timing(values.current.action, {
          toValue: 1, duration: T.stepMs, delay: finishAt, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
        // and at the same moment the outline glows once and fades back
        Animated.sequence([
          Animated.delay(finishAt),
          Animated.timing(values.current.glow, { toValue: 1, duration: T.glowInMs, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(values.current.glow, { toValue: 0, duration: T.glowOutMs, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]),
      ]);
      running.start();
    });
    return () => {
      cancel();
      if (running) running.stop();
    };
    // Decided once per mount: a reload, a realtime arrival or a push for the same reply never replays it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AssemblyContext.Provider value={animate ? values.current : null}>
      {children}
    </AssemblyContext.Provider>
  );
}

// One step of the card. Outside an assembly (or once the decision was not to animate) it renders its children untouched.
// step="action" is the booking button: it fades from actionRestOpacity (never invisible) and keeps every touch.
export function AssemblyStep({ step, children }) {
  const values = useContext(AssemblyContext);
  const v = values?.[step];
  if (!v) return <>{children}</>;
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [T.risePx, 0] });
  const opacity = step === 'action' ? v.interpolate({ inputRange: [0, 1], outputRange: [T.actionRestOpacity, 1] }) : v;
  return <Animated.View pointerEvents="box-none" style={{ opacity, transform: [{ translateY }] }}>{children}</Animated.View>;
}

// The card's one outline glow: a coral border laid over the card's own edge, never taking touches. Renders nothing outside
// an assembly (Reduce Motion, a seen reply, the Customer Preview). inset = the card's border width, radius = its corner.
export function AssemblyGlow({ color, radius = 12, inset = 1 }) {
  const values = useContext(AssemblyContext);
  if (!values?.glow) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, {
        top: -inset, left: -inset, right: -inset, bottom: -inset,
        borderRadius: radius + inset, borderWidth: 2, borderColor: color,
        shadowColor: color, shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
        opacity: values.glow,
      }]}
    />
  );
}
