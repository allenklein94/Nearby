import React, { useRef } from 'react';
import Svg, { Defs, LinearGradient, Stop, Line, Circle } from 'react-native-svg';
import {
  STROKE_WIDTH,
  MARK_STROKES,
  MARK_HEADS,
  BRAND_CORAL,
  BRAND_PEACH,
} from './markGeometry';

let instanceCounter = 0;

/**
 * The approved Nearby "N Connection" mark — the only logo mark this app
 * uses. Two rounded uprights (each topped by a floating circle) joined by
 * a diagonal band, drawn last so it crosses over both uprights. The shape
 * is measured off the real brand artwork (see markGeometry.js's own
 * comment for how) — never redesign it by eye; if the source artwork ever
 * changes, re-measure src/components/brand/markGeometry.js and re-run
 * scripts/generate-brand-assets.py for the app icon/splash/notification
 * assets.
 *
 * variant:
 *  - 'gradient' (default) — the coral→peach gradient fill. Works on any
 *    background per the approved brand sheet (dark, light, cream, coral,
 *    photo) — this is what "dark mode" and "light mode" usage both mean
 *    in practice: the same gradient mark, placed on whichever background.
 *  - 'white'  — solid white, for a colored/dark background needing a flat
 *    monochrome mark (e.g. sitting directly on brand coral).
 *  - 'black'  — solid black, for a light/print context needing a flat
 *    monochrome mark.
 */
export default function NearbyMark({ size = 40, variant = 'gradient', style }) {
  const idRef = useRef(null);
  if (idRef.current === null) {
    instanceCounter += 1;
    idRef.current = `nearbyMarkGradient${instanceCounter}`;
  }
  const gradientId = idRef.current;

  const color =
    variant === 'white' ? '#FFFFFF' : variant === 'black' ? '#000000' : `url(#${gradientId})`;

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" style={style}>
      {variant === 'gradient' && (
        <Defs>
          <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0" stopColor={BRAND_CORAL} />
            <Stop offset="1" stopColor={BRAND_PEACH} />
          </LinearGradient>
        </Defs>
      )}
      {MARK_STROKES.map(([from, to], i) => (
        <Line
          key={`stroke-${i}`}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
        />
      ))}
      {MARK_HEADS.map((head, i) => (
        <Circle key={`head-${i}`} cx={head.cx} cy={head.cy} r={head.r} fill={color} />
      ))}
    </Svg>
  );
}
