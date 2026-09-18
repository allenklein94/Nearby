import React from 'react';
import { Animated } from 'react-native';
import useKeyChangeFade from './useKeyChangeFade';
import { anticipationTier } from '../utils/anticipationTier';
import { useTheme } from '../context/ThemeContext';

// AnticipationText -- Item 123 ("Use 'anticipation' animations"): a subtle color-intensity
// treatment for a real day-count/due-date fragment, scoped to contexts where the date itself is
// the point (an occasion reminder) -- never a generic countdown added to every date in the app.
// Renders `children` completely unstyled when the real day count is more than 2 weeks out (or
// unknown) -- "don't create a countdown on everything" -- and warms from the default text color
// through amber ("close", 1-3 days) to the app's own primary coral ("today") as the count shrinks.
// Discrete tiers (anticipationTier.js), not a fabricated continuous progress percentage -- most
// occasions have no honest "started N days ago" baseline to compute a true ring from.
//
// Plays one brief dip-and-recover (the same useKeyChangeFade mechanic ModeTransition/
// FilterTransition already use) whenever the tier itself changes during a mounted session -- e.g.
// the app was left open across midnight and "building" became "close" -- never a continuous/
// looping pulse (this app's own animation discipline reserves that for genuine in-flight loading).
// Reduce Motion: re-colors with no dip, same as every other motion piece in this library.
export default function AnticipationText({ daysUntil, children, style }) {
  const { colors } = useTheme();
  const tier = anticipationTier(daysUntil);
  const opacity = useKeyChangeFade(tier);
  const toneStyle =
    tier === 'today' ? { color: colors.primary, fontWeight: '700' }
    : tier === 'close' ? { color: '#B8791F', fontWeight: '700' } // same amber "in progress" tint Item 91 already established
    : tier === 'building' ? { color: colors.textPrimary, fontWeight: '600' }
    : null;
  return (
    <Animated.Text style={[style, toneStyle, tier !== 'none' && { opacity }]}>
      {children}
    </Animated.Text>
  );
}
