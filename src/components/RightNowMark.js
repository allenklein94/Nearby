import React from 'react';
import { PulseMark } from '../motion/NearbyPulse';

// Owner item 27 (2026-10-11): the "Right Now" radar mark -- a dot inside one faint ring, beside Home's Nearby Right Now and
// Discover's Happening Now headings. Drawn and still: it never moves on its own (items 15 + 22: no idle loop, no motion
// without a real event). The only motion is item 26's one ring (motion/HappeningRipple.js) when genuinely new activity
// appears; Reduce Motion = this mark alone. Decorative, so hidden from screen readers (the heading carries the label).
// Item 55: it is the Nearby Pulse's still form (PulseMark), same size, dot and ring opacity as before.
export default function RightNowMark({ color, style }) {
  return <PulseMark color={color} size={14} dot={6} ringOpacity={0.45} style={style} />;
}
