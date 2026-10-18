import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, typography } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES, infoOpacity } from './motionBudget';
import { translate } from '../i18n/translate';
import { takeCollisionPlay } from '../utils/friendCollision';

// Owner item 40 (2026-10-11): "You + {Name} might like this" on the one Home card utils/friendCollision.js picked (it decides
// IF; this only shows it), in place of the card's "You might like this" headline. Your face and the nearby friend's slide in
// from either side and overlap -- the two signals converging on the activity -- then the line settles. A real event (the
// friend became nearby, item 39), medium tier, once per (friend, gathering) per session; afterwards the settled pair. Text is
// readable from the first frame (infoOpacity); takes no touches (the card's tap acts at once); no haptic. Reduce Motion = the
// settled pair. A missing photo is the person glyph.
const T = SEQUENCES.friendCollision;

function Face({ uri, style, colors }) {
  return uri
    ? <Image source={{ uri }} style={[styles.face, { borderColor: colors.surface }, style]} accessibilityIgnoresInvertColors />
    : <View style={[styles.face, styles.faceEmpty, { borderColor: colors.surface, backgroundColor: colors.border }, style]}><Ionicons name="person" size={10} color={colors.textTertiary} /></View>;
}

// `allowed` (idea "207", Home's one moment per visit): false = the settled pair, still counted as played.
export default function FriendCollision({ collision, myPhotoUrl, friendPhotoUrl, language, textStyle, allowed = true }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const [play] = useState(() => takeCollisionPlay(collision) && allowed && !reduceMotion);
  const meet = useRef(new Animated.Value(play ? 0 : 1)).current;
  const text = useRef(new Animated.Value(play ? 0 : 1)).current;

  useEffect(() => {
    if (!play) return undefined;
    const ease = Easing.bezier(0.2, 0, 0, 1);
    const anim = Animated.parallel([
      Animated.timing(meet, { toValue: 1, duration: T.avatarMs, easing: ease, useNativeDriver: true }),
      Animated.timing(text, { toValue: 1, duration: T.textMs, delay: T.textDelayMs, easing: ease, useNativeDriver: true }),
    ]);
    anim.start();
    return () => { anim.stop(); meet.setValue(1); text.setValue(1); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!collision?.friend?.name) return null;
  const from = (dir) => ({ transform: [{ translateX: meet.interpolate({ inputRange: [0, 1], outputRange: [dir * T.travelPx, 0] }) }], opacity: infoOpacity(meet) });
  return (
    <View pointerEvents="none" style={styles.row} accessible accessibilityLabel={translate(language, 'ui.friendNearby.togetherA11y', { name: collision.friend.name })}>
      <View style={styles.pair}>
        <Animated.View style={from(-1)}><Face uri={myPhotoUrl} colors={colors} /></Animated.View>
        <Animated.View style={[styles.second, from(1)]}><Face uri={friendPhotoUrl} colors={colors} /></Animated.View>
      </View>
      <Animated.Text style={[{ ...typography.caption, color: colors.textSecondary }, textStyle, { opacity: infoOpacity(text) }]} numberOfLines={1}>
        {translate(language, 'ui.friendNearby.together', { name: collision.friend.name })}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  pair: { flexDirection: 'row', marginRight: spacing.xs },
  second: { marginLeft: -6 },
  face: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5 },
  faceEmpty: { alignItems: 'center', justifyContent: 'center' },
});
