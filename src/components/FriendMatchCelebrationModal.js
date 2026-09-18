import React from 'react';
import MatchAnimation from '../motion/MatchAnimation';

// Canonical implementation moved to src/motion/MatchAnimation.js (the Nearby
// Motion System, CLAUDE.md Item 113) -- kept here as a thin wrapper so
// existing import sites (ActivityScreen/FriendsScreen/ViewProfileScreen/
// FriendDiscoveryScreen) don't need to change their props. New code should
// import MatchAnimation from '../motion' and pass kind="friend" directly.
export default function FriendMatchCelebrationModal(props) {
  return <MatchAnimation kind="friend" {...props} />;
}
