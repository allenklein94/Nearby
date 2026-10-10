import React, { useState, useEffect } from 'react';
import { Image, View, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { LOGO_FIT, logoBox } from '../utils/mediaFit';

// A business's screened logo as a small circle beside its name, always shown whole (a wordmark is never cropped, item 10) (utils/businessLogo.js). No uri, or an image that fails to
// load = nothing at all: no placeholder, no initials, no reserved space. Decorative: the name next to it is what is read.
export default function BusinessLogoMark({ uri, size = 22 }) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const [shape, setShape] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setShape(null);
    if (uri) Image.getSize(uri, (w, h) => { if (!cancelled) setShape({ w, h }); }, () => {});
    return () => { cancelled = true; };
  }, [uri]);
  if (!uri || failed) return null;
  // Sized to the largest box of its own shape inside the circle, so a wide wordmark's ends stay clear of the curve.
  const box = logoBox(shape?.w, shape?.h, size);
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.mark, { width: size, height: size, borderRadius: size / 2, borderColor: colors.border, backgroundColor: colors.surface }]}
    >
      <Image source={{ uri }} onError={() => setFailed(true)} resizeMode={LOGO_FIT} style={{ width: box.width, height: box.height }} />
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { borderWidth: StyleSheet.hairlineWidth, marginRight: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
