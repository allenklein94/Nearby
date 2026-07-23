import React, { useEffect, useRef } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Modal, Animated } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

export default function MatchCelebrationModal({ visible, myPhotoUrl, theirPhotoUrl, theirName, gatheringTitle, onSendMessage, onDismiss }) {
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

  const subtitle = gatheringTitle
    ? `You met through "${gatheringTitle}"`
    : `You and ${theirName} noticed each other.`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.content, { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
          <Text style={styles.emoji}>🎉</Text>
          <Text style={styles.title}>It's a Match!</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <View style={styles.photosRow}>
            <View style={[styles.photoWrap, styles.photoWrapLeft]}>
              {myPhotoUrl ? (
                <Image source={{ uri: myPhotoUrl }} style={styles.photo} />
              ) : (
                <View style={[styles.photo, styles.photoPlaceholder]} />
              )}
            </View>
            <View style={[styles.photoWrap, styles.photoWrapRight]}>
              {theirPhotoUrl ? (
                <Image source={{ uri: theirPhotoUrl }} style={styles.photo} />
              ) : (
                <View style={[styles.photo, styles.photoPlaceholder]} />
              )}
            </View>
          </View>

          <TouchableOpacity style={styles.messageButton} onPress={onSendMessage} activeOpacity={0.85}>
            <Text style={styles.messageButtonText}>Send a Message</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismiss} style={{ marginTop: spacing.md }}>
            <Text style={styles.dismissText}>Keep Browsing</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  content: { alignItems: 'center', width: '100%' },
  emoji: { fontSize: 48, marginBottom: spacing.sm },
  title: { ...typography.display, color: '#fff', marginBottom: spacing.xs, textAlign: 'center' },
  subtitle: { ...typography.body, color: 'rgba(255,255,255,0.8)', marginBottom: spacing.xl, textAlign: 'center' },
  photosRow: { flexDirection: 'row', marginBottom: spacing.xl },
  photoWrap: {
    width: 110, height: 110, borderRadius: 55, borderWidth: 4, borderColor: colors.primary,
    overflow: 'hidden', backgroundColor: colors.surfaceElevated,
  },
  photoWrapLeft: { marginRight: -20, zIndex: 1 },
  photoWrapRight: { marginLeft: -20 },
  photo: { width: '100%', height: '100%' },
  photoPlaceholder: { backgroundColor: colors.surfaceElevated },
  messageButton: {
    backgroundColor: colors.primary, borderRadius: radius.full,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md, ...shadow.button,
  },
  messageButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  dismissText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
});