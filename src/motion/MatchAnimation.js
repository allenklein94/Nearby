import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Modal, Animated } from 'react-native';
import { playHaptic, HAPTIC_MOMENTS } from './haptics';
import { SEQUENCES } from './motionBudget';
import { NearbyMark } from '../components/brand';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';

// MatchAnimation -- connection established, per the Nearby Motion Language:
// ❤️ for a romantic (dating) match, 🤝 for a platonic (friend) match. One
// shared entrance mechanic (spring+fade, Reduce-Motion-aware -- previously
// duplicated verbatim across the two original components); `kind` selects a
// genuinely different real content variant, not a cosmetic skin -- "you're
// now friends" and "it's a match!" are different real moments with different
// real actions available (a friend has no "Plan Together" the way a dating
// match does yet, a dating match's own two photos are a different shape than
// a single friend photo), so this deliberately does NOT force one identical
// layout onto both.
function useModalEntrance(visible, { delay = 0 } = {}) {
  const reduceMotion = useReduceMotion();
  const scaleAnim = useRef(new Animated.Value(0.7)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      if (reduceMotion) {
        scaleAnim.setValue(1);
        opacityAnim.setValue(1);
        return undefined;
      }
      scaleAnim.setValue(0.7);
      opacityAnim.setValue(0);
      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.spring(scaleAnim, { toValue: 1, friction: 6, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 1, duration: SEQUENCES.matchIntro.entranceMs, useNativeDriver: true }),
        ]).start();
      }, delay);
      return () => clearTimeout(timer);
    }
    scaleAnim.setValue(reduceMotion ? 1 : 0.7);
    opacityAnim.setValue(0);
    return undefined;
  }, [visible, reduceMotion, delay]);

  return { scaleAnim, opacityAnim };
}

// Item 118 ("match animations should be restrained"): the ❤️ briefly animates into the Nearby N
// before settling into the real "It's a Match!" content -- the brand mark appearing at the exact
// moment a connection is created, same "the mark itself becomes part of the moment" idea
// SuccessAnimation already established for N -> ✨ -> ✓, just a different two-beat sequence here
// (heart -> mark) since this is a connection moment, not a completion one. Deliberately brief
// (~250ms per beat, under 600ms total) and self-dismissing into the real content underneath it --
// never a second thing to wait through, never gates the real Message/Plan buttons, which are
// already mounted (just at opacity 0 until this beat clears). Reduce Motion skips it outright and
// lands directly on the real settled content, matching every other decorative beat in this
// codebase (see useReduceMotion.js's own header comment).
const INTRO_STAGE_MS = SEQUENCES.matchIntro.stageMs; // Item 131 budget tokens
export const MATCH_INTRO_TOTAL_MS = INTRO_STAGE_MS * 2;

function useHeartToMarkIntro(visible) {
  const reduceMotion = useReduceMotion();
  const [stage, setStage] = useState('heart'); // 'heart' -> 'mark'
  const [show, setShow] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (!visible || reduceMotion) {
      setShow(false);
      return undefined;
    }
    setShow(true);
    const playStage = (next) => {
      setStage(next);
      opacity.setValue(0);
      scale.setValue(0.6);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: INTRO_STAGE_MS, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]).start();
    };
    playStage('heart');
    const toMark = setTimeout(() => playStage('mark'), INTRO_STAGE_MS);
    const toHide = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => setShow(false));
    }, MATCH_INTRO_TOTAL_MS);
    return () => {
      clearTimeout(toMark);
      clearTimeout(toHide);
    };
  }, [visible, reduceMotion]);

  return { show, stage, opacity, scale };
}

export default function MatchAnimation(props) {
  return props.kind === 'friend' ? <FriendVariant {...props} /> : <DatingVariant {...props} />;
}

function DatingVariant({
  haptic = false, visible, myPhotoUrl, theirPhotoUrl, theirName, gatheringTitle, wasWave, isFirstMatch,
  onSendMessage, onPlanTogether, onDismiss,
}) {
  const { colors, shadow } = useTheme();
  const styles = getDatingStyles(colors, shadow);
  const reduceMotion = useReduceMotion();
  const intro = useHeartToMarkIntro(visible);
  // Item 129/130: one subtle haptic when the match appears -- independent of Reduce Motion, and
  // ONLY when the caller says this celebration is the direct result of the user's own action.
  useEffect(() => { if (visible && haptic) playHaptic(HAPTIC_MOMENTS.match); }, [visible]);
  // Delay computed directly from reduceMotion (known synchronously) rather than intro.show
  // (which only flips true a render later, inside an effect) -- avoids a race where the content's
  // own entrance would briefly start with delay=0 before the intro's own effect has a chance to
  // set delay=MATCH_INTRO_TOTAL_MS.
  const { scaleAnim, opacityAnim } = useModalEntrance(visible, { delay: reduceMotion ? 0 : MATCH_INTRO_TOTAL_MS });

  const subtitle = gatheringTitle
    ? `You met through "${gatheringTitle}"`
    : wasWave
      ? `${theirName} waved at you, and you noticed them back.`
      : `You and ${theirName} noticed each other.`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        {intro.show && (
          <Animated.View style={[styles.introGlyph, { opacity: intro.opacity, transform: [{ scale: intro.scale }] }]}>
            {intro.stage === 'heart' ? (
              <Text style={styles.emoji}>❤️</Text>
            ) : (
              <NearbyMark size={48} variant="white" />
            )}
          </Animated.View>
        )}
        <Animated.View style={[styles.content, { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
          {/* ❤️ = connection (romantic), per the Nearby Motion Language -- not 🎉, which is
              reserved for occasion/plan/milestone celebration. */}
          <Text style={styles.emoji}>{isFirstMatch ? '❤️🌟' : '❤️'}</Text>
          <Text style={styles.title}>{isFirstMatch ? 'Your First Match!' : "It's a Match!"}</Text>
          <Text style={styles.subtitle}>
            {subtitle}{isFirstMatch ? ' This is the start of something new.' : ''}
          </Text>

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

          {/* Item 118: the product thesis is connection -> real-world interaction, so the
              success state is never just "start chatting" -- Plan Something Together sits right
              beside Message as a co-equal action, not a lesser afterthought, at the exact moment
              the connection is created. */}
          <TouchableOpacity style={styles.messageButton} onPress={onSendMessage} activeOpacity={0.85}>
            <Text style={styles.messageButtonText}>Message</Text>
          </TouchableOpacity>
          {onPlanTogether && (
            <TouchableOpacity style={styles.planButton} onPress={onPlanTogether} activeOpacity={0.85}>
              <Text style={styles.planButtonText}>🤝 Plan Something Together</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onDismiss} style={{ marginTop: spacing.md }}>
            <Text style={styles.dismissText}>Keep Browsing</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

// Deliberately its own render, not a reskin of the dating variant -- "you're
// now friends," never "it's a match!" (per the locked design: a mutual
// friend-discovery swipe reads as a clean new-friend moment, not a
// dating-style event with different semantics).
function FriendVariant({ haptic = false, visible, theirPhotoUrl, theirName, onSayHi, onDismiss }) {
  const { colors, shadow } = useTheme();
  const styles = getFriendStyles(colors, shadow);
  const { scaleAnim, opacityAnim } = useModalEntrance(visible);
  // Item 129: one subtle haptic when a friendship becomes real.
  useEffect(() => { if (visible && haptic) playHaptic(HAPTIC_MOMENTS.friendAccepted); }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.content, { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
          {/* 🤝 = connection (platonic), per the Nearby Motion Language -- not 🎉, which is
              reserved for occasion/plan/milestone celebration. */}
          <Text style={styles.emoji}>🤝</Text>
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
          <TouchableOpacity style={styles.secondaryButton} onPress={onDismiss} activeOpacity={0.85}>
            <Text style={styles.secondaryButtonText}>Keep Browsing</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const getDatingStyles = (colors, shadow) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  introGlyph: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  content: { alignItems: 'center', width: '100%' },
  emoji: { fontSize: 48, marginBottom: spacing.sm },
  title: { ...typography.display, color: '#fff', marginBottom: spacing.xs, textAlign: 'center' },
  subtitle: { ...typography.body, color: 'rgba(255,255,255,0.8)', marginBottom: spacing.xl, textAlign: 'center' },
  photosRow: { flexDirection: 'row', marginBottom: spacing.xl },
  photoWrap: {
    width: 110, height: 110, borderRadius: 55, borderWidth: 4, borderColor: 'rgba(255,255,255,0.3)',
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
  planButton: {
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)', borderRadius: radius.full,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md, marginTop: spacing.sm,
  },
  planButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  dismissText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
});

const getFriendStyles = (colors, shadow) => StyleSheet.create({
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
