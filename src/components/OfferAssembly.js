import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES } from '../motion/motionBudget';
import { afterOfferTravel } from '../motion/offerTravel';
import { ASSEMBLY_STEPS, assemblySteps, shouldAssemble, markAssembled, stepDelay } from '../utils/offerAssembly';

// An open business reply's card assembling itself (owner, 2026-10-09; decisions in utils/offerAssembly.js): business ->
// "Heard your request" -> what they said -> the order -> price -> when, each a gentle fade with a slight upward settle.
// Presentation only: the same reply data, the same wording rule, and the action button is NOT part of it (it is visible and
// tappable from the first frame). Business tone (item 122): no bounce, no particles, no haptic (arrival-driven, item 130).
// Plays once for a newly received reply, after an offer travel into this card has finished; Reduce Motion = the finished
// card. Outside an assembly (the owner's Customer Preview, an accepted offer) every step renders as is.
const AssemblyContext = createContext(null);
const T = SEQUENCES.offerAssembly;

export default function OfferAssembly({ offer, children }) {
  const reduceMotion = useReduceMotion();
  const [animate] = useState(() => shouldAssemble(offer, { reduceMotion }));
  const values = useRef(null);
  if (!values.current) values.current = Object.fromEntries(ASSEMBLY_STEPS.map((k) => [k, new Animated.Value(animate ? 0 : 1)]));

  useEffect(() => {
    if (!animate) return undefined;
    markAssembled(offer.id);
    const steps = assemblySteps(offer);
    // A step this reply does not have is shown as is (if a screen still renders something under it, it is never hidden).
    ASSEMBLY_STEPS.filter((k) => !steps.includes(k)).forEach((k) => values.current[k].setValue(1));
    let running = null;
    const cancel = afterOfferTravel(offer.id, () => {
      running = Animated.parallel(steps.map((k) => Animated.timing(values.current[k], {
        toValue: 1, duration: T.stepMs, delay: stepDelay(steps, k), easing: Easing.out(Easing.cubic), useNativeDriver: true,
      })));
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
export function AssemblyStep({ step, children }) {
  const values = useContext(AssemblyContext);
  const v = values?.[step];
  if (!v) return <>{children}</>;
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [T.risePx, 0] });
  return <Animated.View style={{ opacity: v, transform: [{ translateY }] }}>{children}</Animated.View>;
}
