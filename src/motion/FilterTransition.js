import React from 'react';
import { Animated } from 'react-native';
import useKeyChangeFade from './useKeyChangeFade';

// FilterTransition -- results changing after a filter, per the Nearby
// Motion Language: a brief dip-and-recover whenever `activeKey` (typically a
// signature of the active filter/category/search state) changes, cueing
// "these are new results" without a jarring pop or requiring the real data
// fetch to finish first. Distinct from StaggeredReveal, which handles each
// individual result card settling into place once real data has genuinely
// arrived -- this is the container-level "something changed" signal; the two
// compose naturally (wrap a results list in FilterTransition, and let each
// card inside still use its own StaggeredReveal). Reduce Motion: no dip at
// all, results just change as they already did.
export default function FilterTransition({ activeKey, children, style, duration }) {
  const opacity = useKeyChangeFade(activeKey, { duration });
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}
