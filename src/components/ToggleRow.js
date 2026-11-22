// The ONE on/off row (owner, 2026-11-21): the whole row (label, helper text, switch) toggles, never just the small switch.
// Drop-in for the old row View holding labels and a Switch with value + onValueChange: same style, same children,
// same Switch props. The row is the single touch + accessibility target (role "switch", checked state, the switch's own
// label); the Switch inside only shows the state (no touches, hidden from screen readers), so a tap on the switch itself
// lands on the row and toggles exactly once. `onValueChange` gets the new value, as Switch gave it.
// Not for rows that hold another button (a move arrow, a "reset" link): those keep a plain Switch.
import React from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { toggleRowA11y } from '../utils/toggleRow';

export default function ToggleRow({ value, onValueChange, disabled = false, style, children, accessibilityLabel, accessibilityHint, trackColor, thumbColor, testID }) {
  const { colors } = useTheme();
  const on = !!value;
  return (
    <Pressable
      testID={testID}
      style={({ pressed }) => [style, pressed && !disabled ? { opacity: 0.7 } : null]}
      onPress={() => { if (!disabled) onValueChange?.(!on); }}
      disabled={disabled}
      hitSlop={4}
      {...toggleRowA11y({ on, disabled, label: accessibilityLabel, hint: accessibilityHint })}
    >
      {children}
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Switch
          value={on}
          disabled={disabled}
          trackColor={trackColor ?? { true: colors.primary, false: colors.border }}
          thumbColor={thumbColor}
        />
      </View>
    </Pressable>
  );
}
