import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView, Dimensions, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const { width } = Dimensions.get('window');

export default function OnboardingScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef(null);
  const styles = getStyles(colors, shadow);
  const emojiScale = useRef(new Animated.Value(1)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;

 const SLIDES = [
    { emoji: '👋', title: t('onboarding.slide1Title'), text: t('onboarding.slide1Text') },
    { emoji: '🔔', title: t('onboarding.slide2Title'), text: t('onboarding.slide2Text') },
    { emoji: '✨', title: t('onboarding.slide3Title'), text: t('onboarding.slide3Text') },
    { emoji: '🔒', title: t('onboarding.slide4Title'), text: t('onboarding.slide4Text') },
    { emoji: '🔎', title: t('onboarding.slide6Title'), text: t('onboarding.slide6Text') },
    { emoji: '🧭', title: t('onboarding.slide5Title'), text: t('onboarding.slide5Text') },
  ];

  // A gentle bounce on the emoji and a quick fade on the text each
  // time the active slide changes, so paging feels a little more
  // alive without needing a complex scroll-linked interpolation.
  useEffect(() => {
    emojiScale.setValue(0.6);
    contentOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(emojiScale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }),
      Animated.timing(contentOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start();
  }, [activeIndex]);

  function handleScroll(event) {
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    if (index !== activeIndex) setActiveIndex(index);
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
          <View
            key={i}
            style={[styles.slide, { width }]}
            accessible={true}
            accessibilityLabel={`Slide ${i + 1} of ${SLIDES.length}: ${slide.title}. ${slide.text}`}
          >
            <Animated.View style={[styles.emojiCircle, i === activeIndex && { transform: [{ scale: emojiScale }] }]}>
              <Text style={styles.emoji}>{slide.emoji}</Text>
            </Animated.View>
            <Animated.View style={i === activeIndex ? { opacity: contentOpacity } : undefined}>
              <Text style={styles.title}>{slide.title}</Text>
              <Text style={styles.text}>{slide.text}</Text>
            </Animated.View>
          </View>
        ))}
      </ScrollView>

      <TouchableOpacity
        style={[styles.skipButton, { top: insets.top + spacing.sm }]}
        onPress={() => navigation.navigate('Login')}
        accessibilityLabel="Skip introduction"
        accessibilityRole="button"
      >
        <Text style={styles.skipText}>{t('onboarding.skip')}</Text>
      </TouchableOpacity>

      <View style={styles.footer}>
        <View style={styles.dots} accessible={false}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
          ))}
        </View>

        <TouchableOpacity
          style={styles.button}
          onPress={goNext}
          activeOpacity={0.85}
          accessibilityLabel={activeIndex === SLIDES.length - 1 ? t('onboarding.getStarted') : `${t('onboarding.next')}, slide ${activeIndex + 1} of ${SLIDES.length}`}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>
            {activeIndex === SLIDES.length - 1 ? t('onboarding.getStarted') : t('onboarding.next')}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
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