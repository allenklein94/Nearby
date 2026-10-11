import React from 'react';
import NLoader from '../motion/NLoader';
import { PLANNING_CAPTIONS } from '../motion/loadingLanguage';

// Item 132: no longer its own visual -- the Occasion wizard's multi-stage "Nearby is finding
// options" loader is now just the universal N loader with the planning caption narration
// (Item 112 follow-up: honest generic narration of real work, never a fabricated count).
// Owner rule (2026-10-11, motion amplifies correct data): the options are ONE resolveIntent call, so the loader says one thing
// for the whole wait. It used to cycle the four planning captions on a 900 ms timer and loop back to the first -- staged
// "progress" that no real stage drove (the fetch has no stages the screen can see).
export default function FindingOptionsLoader() {
  return <NLoader fullScreen={false} size="compact" caption={PLANNING_CAPTIONS[0]} />;
}
