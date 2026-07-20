import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography, spacing, radius, shadow } from '../theme';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    emoji: '👋',
    title: 'Nearby',
    text: "You've probably noticed someone nearby you wanted to talk to, but didn't. Nearby gives you a low-pressure way to let them know.",
  },
  {
    emoji: '🔔',
    title: 'Send a quiet Notice',
    text: "If you're interested, send a silent \"Notice.\" They're never told unless they notice you back — no rejection, no pressure.",
  },
  {
    emoji: '✨',
    title: 'Show your personality',
    text: 'Add multiple photos, your interests, and details like relationship goals or lifestyle preferences — as much or as little as you want to share.',
  },
  {
    emoji: '🔒',
    title: 'Your privacy comes first',
    text: 'Your exact location is never shown to anyone. No one can see who you\u2019ve noticed unless it\u2019s mutual.',
  },
];

export default function OnboardingScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef(null);

  function handleScroll(event) {
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    setActiveIndex(index);
  }

  function goNext() {
    if (activeIndex < SLIDES.length - 1) {
      scrollRef.current?.scrollTo({ x: width * (activeIndex + 1), animated: true });
    } else {
      navigation.navigate('Login');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        style={{ flex: 1 }}
      >
        {SLIDES.map((slide, i) => (
          <View key={i} style={[styles.slide, { width }]}>
            <View style={styles.emojiCircle}>
              <Text style={styles.emoji}>{slide.emoji}</Text>
            </View>
            <Text style={styles.title}>{slide.title}</Text>
            <Text style={styles.text}>{slide.text}</Text>
          </View>
        ))}
      </ScrollView>

      <TouchableOpacity style={[styles.skipButton, { top: insets.top + spacing.sm }]} onPress={() => navigation.navigate('Login')}>
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
          ))}
        </View>

        <TouchableOpacity style={styles.button} onPress={goNext} activeOpacity={0.85}>
          <Text style={styles.buttonText}>
            {activeIndex === SLIDES.length - 1 ? 'Get Started' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  skipButton: { position: 'absolute', right: spacing.lg, zIndex: 10, padding: spacing.sm },
  skipText: { color: colors.textTertiary, fontWeight: '600', fontSize: 14 },
  slide: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  emojiCircle: {
    width: 120, height: 120, borderRadius: radius.full,
    backgroundColor: colors.primaryMuted,
    justifyContent: 'center', alignItems: 'center', marginBottom: spacing.xl,
  },
  emoji: { fontSize: 56 },
  title: { ...typography.display, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.md },
  text: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  dots: { flexDirection: 'row', justifyContent: 'center', marginBottom: spacing.lg },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border, marginHorizontal: 4 },
  dotActive: { backgroundColor: colors.primary, width: 20 },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 18, alignItems: 'center', ...shadow.button },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});