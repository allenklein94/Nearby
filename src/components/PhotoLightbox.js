import React, { useRef, useState } from 'react';
import { Modal, View, Image, TouchableOpacity, Text, StyleSheet, Dimensions, PanResponder, Animated } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const DISMISS_THRESHOLD = 120;
const DOUBLE_TAP_DELAY = 280;

// A full-screen photo viewer: swipe down to dismiss, double-tap to
// toggle zoom. Deliberately not a continuous pinch-to-zoom — that's
// genuinely hard to make reliable with PanResponder alone, and
// double-tap zoom is a well-established, simpler alternative that
// covers the actual need (seeing more detail) just as well.
export default function PhotoLightbox({ visible, photoUri, onClose }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const [isZoomed, setIsZoomed] = useState(false);
  const lastTapRef = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => !isZoomed && Math.abs(gesture.dy) > 8,
      onPanResponderMove: Animated.event([null, { dy: translateY }], { useNativeDriver: false }),
      onPanResponderRelease: (_, gesture) => {
        if (Math.abs(gesture.dy) > DISMISS_THRESHOLD) {
          handleClose();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: false }).start();
        }
      },
    })
  ).current;

  function handleClose() {
    translateY.setValue(0);
    scale.setValue(1);
    setIsZoomed(false);
    onClose();
  }

  function handleTap() {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      const zoomingIn = !isZoomed;
      setIsZoomed(zoomingIn);
      Animated.spring(scale, { toValue: zoomingIn ? 2 : 1, useNativeDriver: true }).start();
    }
    lastTapRef.current = now;
  }

  const backgroundOpacity = translateY.interpolate({
    inputRange: [-SCREEN_HEIGHT / 2, 0, SCREEN_HEIGHT / 2],
    outputRange: [0.3, 1, 0.3],
    extrapolate: 'clamp',
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Animated.View style={[styles.overlay, { opacity: backgroundOpacity }]}>
        <TouchableOpacity style={styles.closeButton} onPress={handleClose} accessibilityLabel="Close photo" accessibilityRole="button">
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>

        <Animated.View
          style={[styles.imageWrap, { transform: [{ translateY }] }]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity activeOpacity={1} onPress={handleTap}>
            <Animated.Image
              source={{ uri: photoUri }}
              style={[styles.image, { transform: [{ scale }] }]}
              resizeMode="contain"
              accessibilityLabel="Photo, double tap to zoom, swipe down to close"
            />
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  closeButton: {
    position: 'absolute', top: 50, right: 20, zIndex: 10,
    width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
  closeButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  imageWrap: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, justifyContent: 'center', alignItems: 'center' },
  image: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.85 },
});