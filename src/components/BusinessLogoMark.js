import React, { useState } from 'react';
import { Image, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';

// A business's screened logo as a small circle beside its name (utils/businessLogo.js). No uri, or an image that fails to
// load = nothing at all: no placeholder, no initials, no reserved space. Decorative: the name next to it is what is read.
export default function BusinessLogoMark({ uri, size = 22 }) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  if (!uri || failed) return null;
  return (
    <Image
      source={{ uri }}
      onError={() => setFailed(true)}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.mark, { width: size, height: size, borderRadius: size / 2, borderColor: colors.border, backgroundColor: colors.surface }]}
    />
  );
}

const styles = StyleSheet.create({
  mark: { borderWidth: StyleSheet.hairlineWidth, marginRight: 8 },
});
