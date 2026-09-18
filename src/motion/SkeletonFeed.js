import React from 'react';
import { View, StyleSheet } from 'react-native';
import SkeletonCard from '../components/SkeletonCard';
import SkeletonGridCard from '../components/SkeletonGridCard';
import { spacing } from '../theme';

// Item 133: SKELETON = "content is loading" -- the shape of a large feed/list holding its place so
// the screen feels fast and doesn't jump when the real rows arrive. Distinct on purpose from NLoader
// (N + sweep = "Nearby is thinking/finding/matching"). Rule of thumb: if the user is waiting for
// their own known content (a list of matches, friends, plans, a feed) -> skeleton; if Nearby is
// doing work to find or decide something (search, recommendations, availability) -> NLoader.
// The pulse loop is the same ambient loop every skeleton had; motionPolicy.js makes it inert under
// Reduce Motion (bars simply sit at rest).
export default function SkeletonFeed({ variant = 'list', count = 3 }) {
  if (variant === 'grid') {
    return (
      <View style={styles.grid}>
        {[...Array(count)].map((_, i) => <SkeletonGridCard key={i} />)}
      </View>
    );
  }
  return (
    <View>
      {[...Array(count)].map((_, i) => <SkeletonCard key={i} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.lg },
});
