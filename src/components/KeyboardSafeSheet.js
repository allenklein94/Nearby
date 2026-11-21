// The keyboard rule for text entry inside a Modal or bottom sheet (owner UX plan, 2026-11-21). A Modal is its own window
// with no stack header above it, so the offset is always 0 (KeyboardSafeView reads the SCREEN's header height and must
// never be used here). iOS: the sheet's container shrinks by the keyboard's height, so a flex-end sheet rises and its
// active field + submit controls sit above the keyboard. Android: React Native's Modal window resizes itself, no padding.
// Use it in place of the sheet's full-size overlay (or as the outer wrapper of a full-screen Modal's content).
import React from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { keyboardOffsetFor } from '../utils/keyboardOffset';

export default function KeyboardSafeSheet({ style, children, ...rest }) {
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={keyboardOffsetFor(Platform.OS, 0)}
      {...rest}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
