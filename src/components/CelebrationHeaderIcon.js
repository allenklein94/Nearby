import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

// Item 112 follow-up (CLAUDE.md, "the finished plan could have a living
// header... extremely subtle motion... 🎈 gently floating or a tiny
// shimmer through the celebration icon. It doesn't need to constantly
// move. Motion should happen when something changes"): a small, reusable
// animated icon. It sits perfectly still by default -- no idle/looping
// motion at all -- and plays one gentle float+pulse only when `changeKey`
// genuinely changes from what it last saw, never on first mount (mounting
// isn't a "change," it's just the initial display) and never on a
// re-render with the same key.
export default function CelebrationHeaderIcon({ icon, changeKey, size = 20, style }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const seenKeyRef = useRef(changeKey);

  useEffect(() => {
    if (seenKeyRef.current === changeKey) return;
    seenKeyRef.current = changeKey;
    translateY.setValue(0);
    scale.setValue(1);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(translateY, { toValue: -5, duration: 380, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.16, duration: 380, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, friction: 4, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }),
      ]),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeKey]);

  return (
    <Animated.Text
      style={[{ fontSize: size, transform: [{ translateY }, { scale }] }, style]}
    >
      {icon}
    </Animated.Text>
  );
}
