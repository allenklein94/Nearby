import React, { useRef } from 'react';
import { Animated, Pressable } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';

// A consistent, subtle press-scale for primary buttons — matches the
// tactile feel already established on the tab bar (BouncyTabButton),
// applied to the app's other prominent call-to-action buttons rather
// than the plain opacity-fade TouchableOpacity gives by default.
export default function ScaleButton({ onPress, style, children, disabled, ...props }) {
  const scale = useRef(new Animated.Value(1)).current;
  // Item 127: Reduce Motion -> no press-scale; the Pressable's own pressed state is the feedback.
  const reduceMotion = useReduceMotion();

  function handlePressIn() {
    if (reduceMotion) return;
    Animated.spring(scale, { toValue: 0.95, speed: 50, useNativeDriver: true }).start();
  }

  function handlePressOut() {
    if (reduceMotion) return;
    Animated.spring(scale, { toValue: 1, speed: 20, bounciness: 6, useNativeDriver: true }).start();
  }

  return (
    <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut} disabled={disabled} {...props}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}