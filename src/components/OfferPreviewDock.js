// Make an Offer's preview dock (owner, 2026-11-22; rules in utils/offerPreviewDock.js). Sits under the form's scroll, inside
// the same sheet: a one-line "Customer preview" toggle that opens the ONE live preview card (passed in as `children`, rendered
// only here) in a bounded scroll, then Send Offer. No new screen, step or string; no motion (the panel simply opens/closes).
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Keyboard, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { previewDockState, previewPanelMaxHeight } from '../utils/offerPreviewDock';

function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // iOS: "will" events, so the dock shrinks before the keyboard lands; Android only has "did".
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEvt, () => setVisible(true));
    const b = Keyboard.addListener(hideEvt, () => setVisible(false));
    return () => { a?.remove?.(); b?.remove?.(); };
  }, []);
  return visible;
}

export default function OfferPreviewDock({ hasPreview, label, summary, sendButton, children, testID = 'offer-preview-dock' }) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const keyboardVisible = useKeyboardVisible();
  const [expanded, setExpanded] = useState(false);
  const state = previewDockState({ hasPreview, expanded, keyboardVisible });

  return (
    <View testID={testID} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.xs }}>
      {state.showToggle && (
        <Pressable
          testID="offer-preview-toggle"
          onPress={() => setExpanded((v) => !v)}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: spacing.sm }, pressed ? { opacity: 0.7 } : null]}
          accessibilityRole="button"
          accessibilityLabel={summary ? `${label}: ${summary}` : label}
          accessibilityState={{ expanded: state.showPanel }}
          hitSlop={4}
        >
          <Ionicons name="eye-outline" size={16} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }} numberOfLines={1}>{label}</Text>
          <Text style={{ flex: 1, color: colors.textTertiary, fontSize: 13 }} numberOfLines={1}>{state.showPanel ? '' : summary}</Text>
          <Ionicons name={state.showPanel ? 'chevron-down' : 'chevron-up'} size={18} color={colors.textSecondary} />
        </Pressable>
      )}
      {state.showPanel && (
        <ScrollView
          testID="offer-preview-panel"
          style={{ maxHeight: previewPanelMaxHeight(height), borderRadius: radius.md }}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      )}
      {sendButton}
    </View>
  );
}
