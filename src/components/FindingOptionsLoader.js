import React from 'react';
import NLoader from '../motion/NLoader';
import { PLANNING_CAPTIONS } from '../motion/loadingLanguage';

// Item 132: no longer its own visual -- the Occasion wizard's multi-stage "Nearby is finding
// options" loader is now just the universal N loader with the planning caption narration
// (Item 112 follow-up: honest generic narration of real work, never a fabricated count).
export default function FindingOptionsLoader() {
  return <NLoader fullScreen={false} size="compact" captions={PLANNING_CAPTIONS} />;
}
