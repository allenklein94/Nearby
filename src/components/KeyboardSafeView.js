// One keyboard rule for full-screen text entry under a stack header (owner UX plan, 2026-11-21).
// iOS: the view shrinks by the keyboard's height, offset by the header that sits above it, so the composer / last input
// stays above the keyboard. Without the offset (the old per-screen code), the screen shrank too little by exactly the
// header's height and the composer sat under the keyboard. Android: the window resizes itself (Expo default), no padding.
// Use it as the full-screen wrapper of a SCREEN only, never inside a Modal or sheet (React context would hand it the
// screen's header height, which a modal doesn't have).
import React, { useContext } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { HeaderHeightContext } from '@react-navigation/elements';
import { keyboardOffsetFor } from '../utils/keyboardOffset';

export default function KeyboardSafeView({ style, children, ...rest }) {
  const headerHeight = useContext(HeaderHeightContext);
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={keyboardOffsetFor(Platform.OS, headerHeight)}
      {...rest}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
