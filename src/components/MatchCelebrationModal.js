import React from 'react';
import MatchAnimation from '../motion/MatchAnimation';

// Canonical implementation moved to src/motion/MatchAnimation.js (the Nearby
// Motion System, CLAUDE.md Item 113) -- kept here as a thin wrapper so the
// existing import site (MatchesScreen.js) doesn't need to change its props.
// New code should import MatchAnimation from '../motion' and pass
// kind="dating" directly.
export default function MatchCelebrationModal(props) {
  return <MatchAnimation kind="dating" {...props} />;
}
