import React from 'react';
import { radius } from '../theme';
import { SEQUENCES } from './motionBudget';
import { PulseJourney } from './NearbyPulse';
import useReduceMotion from '../hooks/useReduceMotion';

// Owner item 44 (2026-10-11): the outline that grows from a tapped map pin into the business sheet's outline, then fades as it
// lands. Pure decoration (outline only, no text, no fill): it takes no touches and never covers the sheet's content. Rendered
// only when the pin's spot and the sheet's place are both known. Reduce Motion: the sheet never renders it, and it renders nothing.
// Item 55: it is the Nearby Pulse's journey form (motion/NearbyPulse.js), with this moment's own tokens, colour and corners.
const T = SEQUENCES.pinToSheet;
const JOURNEY = { frameMs: T.frameMs, framePeakOpacity: T.framePeakOpacity, originSize: T.pinSize };
export const BUSINESS_PIN_COLOR = '#5B9AA0';

export default function PinToSheetFrame({ pin, rect }) {
  const reduceMotion = useReduceMotion();
  return <PulseJourney origin={pin} rect={rect} tokens={JOURNEY} color={BUSINESS_PIN_COLOR} borderRadius={radius.lg} borderWidth={2} play={!reduceMotion} />;
}
