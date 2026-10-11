import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES, infoOpacity } from './motionBudget';
import { OfferProgressGlow } from './OfferProgressSteps';

// Owner item 25 #4 (2026-10-11): the plan comes together. When the last piece of a multi-piece plan is confirmed while the
// person has the plan open (decided by planComesTogetherNow in utils/planAddonReadiness.js), its pieces settle in one after
// another, then the plan's outline glows once in the success colour. Played once per key; nothing is hidden or waits (every
// piece starts at the readable rest opacity); never touchable, no haptic, Reduce Motion = the settled plan.
const P = SEQUENCES.planTogether;
const Ctx = createContext(null);

export default function PlanComesTogether({ playKey = 0, pieces = 0, color, radius = 12, children }) {
  const reduceMotion = useReduceMotion();
  const animate = playKey > 0 && !reduceMotion;
  const values = useRef([]);
  const n = Math.min(Math.max(pieces, 0), P.maxPieces);
  while (values.current.length < P.maxPieces) values.current.push(new Animated.Value(1));

  useEffect(() => {
    if (!animate) return undefined;
    const vs = values.current.slice(0, n);
    vs.forEach((v) => v.setValue(0));
    const a = Animated.parallel(vs.map((v, i) => Animated.timing(v, {
      toValue: 1, duration: P.pieceMs, delay: i * P.staggerMs, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    })));
    a.start();
    return () => { a.stop(); vs.forEach((v) => v.setValue(1)); };
  }, [playKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Ctx.Provider value={animate ? values.current : null}>
      <View>
        {animate ? (
          <OfferProgressGlow
            key={playKey}
            play
            color={color}
            radius={radius}
            timing={{ glowInMs: P.glowInMs, glowOutMs: P.glowOutMs, delayMs: n * P.staggerMs }}
          />
        ) : null}
        {children}
      </View>
    </Ctx.Provider>
  );
}

// One piece of the plan (a timeline row). Pieces past maxPieces simply show as they are.
export function PlanPiece({ index, children }) {
  const values = useContext(Ctx);
  const v = values?.[index];
  if (!v) return <>{children}</>;
  return (
    <Animated.View
      pointerEvents="box-none"
      style={{ opacity: infoOpacity(v), transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [P.risePx, 0] }) }] }}
    >
      {children}
    </Animated.View>
  );
}
