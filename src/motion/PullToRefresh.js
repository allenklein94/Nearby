import React from 'react';
import { RefreshControl, Platform } from 'react-native';
import { useTheme } from '../context/ThemeContext';

// PullToRefresh -- N-branded refresh, per the Nearby Motion Language.
//
// Honest limitation, disclosed rather than glossed over: React Native's
// native RefreshControl does not support rendering arbitrary custom content
// (e.g. the N mark itself, visibly appearing mid-pull) inside the OS's own
// pull gesture on either platform. Doing that for real would mean replacing
// the native control with a custom gesture-driven implementation (tracking
// scroll offset, a PanResponder or reanimated gesture, a custom header
// reveal) -- a materially bigger, higher-risk rebuild this component does
// not attempt, especially with no simulator/device tooling available in this
// project to verify a custom gesture surface actually feels right.
//
// What this DOES give every future screen for real, for free: the correct
// Nearby brand color on both platforms' native spinner, every time, without
// a developer needing to remember `tintColor` (iOS) and `colors` (Android)
// by hand -- previously only `tintColor` was ever set anywhere in this app;
// `colors` (the Android-only multi-color spinner prop) was never set at all.
export default function PullToRefresh({ refreshing, onRefresh, ...rest }) {
  const { colors } = useTheme();
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.primary}
      colors={Platform.OS === 'android' ? [colors.primary] : undefined}
      {...rest}
    />
  );
}
