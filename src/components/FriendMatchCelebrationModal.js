import React, { useEffect, useRef } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Modal, Animated } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Deliberately its own copy, not a reskin of MatchCelebrationModal --
// "you're now friends," never "it's a match!" (per the locked design:
// a mutual friend-discovery swipe reads as a clean new-friend moment,
// not a dating-style event with different semantics).
export default function FriendMatchCelebrationModal({ visible, theirPhotoUrl, theirName, onSayHi, onDismiss }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const scaleAnim = useRef(new Animated.Value(0.7)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, friction: 6, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    } else {
      scaleAnim.setValue(0.7);
      opacityAnim.setValue(0);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.content, { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
          <Text style={styles.emoji}>🤝🎉</Text>
          <Text style={styles.title}>New Friend!</Text>
          <Text style={styles.subtitle}>You and {theirName} are both interested in connecting.</Text>

          {theirPhotoUrl ? (
            <Image source={{ uri: theirPhotoUrl }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, styles.photoPlaceholder]} />
          )}

          <TouchableOpacity style={styles.primaryButton} onPress={onSayHi} activeOpacity={0.85}>
            <Text style={styles.primaryButtonText}>Say Hi →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={onDismiss} activeOpacity={0.7}>
            <Text style={styles.secondaryButtonText}>Keep Browsing</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  content: {
    width: '100%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl,
    alignItems: 'center', ...shadow.card,
  },
  emoji: { fontSize: 48, marginBottom: spacing.sm },
  title: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md },
  photo: { width: 96, height: 96, borderRadius: 48, marginBottom: spacing.lg, backgroundColor: colors.surfaceElevated },
  photoPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  primaryButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl, width: '100%', alignItems: 'center', marginBottom: spacing.sm, ...shadow.button,
  },
  primaryButtonText: { color: '#fff', ...typography.body, fontWeight: '700' },
  secondaryButton: { paddingVertical: spacing.sm },
  secondaryButtonText: { color: colors.textTertiary, ...typography.body },
});
