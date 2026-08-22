import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Image, Platform, Linking, ScrollView } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '../services/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARDING_ANSWERS_KEY } from './OnboardingQuestionsScreen';
import { pickProfilePhoto, uploadProfilePhoto } from '../services/photos';
import { checkTextModeration } from '../services/textModeration';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const MIN_AGE = 18;
const TERMS_URL = 'https://allenklein94.github.io/Nearby/terms.html';
const PRIVACY_URL = 'https://allenklein94.github.io/Nearby/privacy.html';

const INTEREST_OPTIONS = [
  'Travel', 'Coffee', 'Hiking', 'Music', 'Movies', 'Foodie', 'Fitness',
  'Reading', 'Art', 'Gaming', 'Photography', 'Yoga', 'Dancing', 'Cooking',
  'Wine', 'Dogs', 'Cats', 'Outdoors', 'Sports', 'Concerts', 'Museums',
  'Volunteering', 'Meditation', 'Running',
];

function calculateAge(birthdate) {
  const today = new Date();
  let age = today.getFullYear() - birthdate.getFullYear();
  const monthDiff = today.getMonth() - birthdate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthdate.getDate())) {
    age--;
  }
  return age;
}

export default function CompleteProfileScreen() {
  const { refreshProfile } = useAuth();
  const { colors, isDark } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors);
  const [displayName, setDisplayName] = useState('');
  const [birthdate, setBirthdate] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [photoAsset, setPhotoAsset] = useState(null);
  const [interests, setInterests] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const maxSelectableDate = new Date();
  maxSelectableDate.setFullYear(maxSelectableDate.getFullYear() - MIN_AGE);

  function toggleInterest(interest) {
    setInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  }

  async function choosePhoto() {
    try {
      const asset = await pickProfilePhoto();
      if (asset) setPhotoAsset(asset);
    } catch (e) {
      Alert.alert('Couldn\u2019t access photos', e.message);
    }
  }

  // Required-gate safety valve: this screen must stay required (no way to
  // skip profile setup), but that's not the same as trapping someone here.
  // Signing out never marks onboarding complete and never touches the
  // profile row — it's purely Authenticated+Setup-Required ->
  // Signed-Out, so nothing is lost and setup picks up again on the
  // account's next real sign-in.
  function handleSignOut() {
    Alert.alert(
      'Sign Out?',
      'You can come back and finish setting up your profile anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => { supabase.auth.signOut(); } },
      ]
    );
  }

  async function submit() {
    if (!displayName.trim()) {
      return Alert.alert('Name required', 'Enter a display name.');
    }
    if (!birthdate) {
      return Alert.alert('Birthdate required', 'This app is 18+ only — enter your date of birth.');
    }
    const age = calculateAge(birthdate);
    if (age < MIN_AGE) {
      return Alert.alert('Age requirement not met', 'You must be 18 or older to use this app.');
    }
    if (!photoAsset) {
      return Alert.alert('Photo required', 'Add a profile photo to continue. It\u2019ll be reviewed before it\u2019s visible to others.');
    }
    if (!agreedToTerms) {
      return Alert.alert('Agreement required', 'You must agree to the Terms of Service and Privacy Policy to use Nearby.');
    }

    const nameCheck = await checkTextModeration(displayName);
    if (!nameCheck.safe) {
      return Alert.alert('Display name not allowed', 'Please choose a different display name.');
    }

    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;

      // Picks up whatever was answered during the pre-signup onboarding
      // questions, if any exist — someone could reach this screen
      // without having gone through that flow (e.g., an existing
      // account somehow ending up here), so this is genuinely optional.
      let onboardingAnswers = {};
      try {
        const stored = await AsyncStorage.getItem(ONBOARDING_ANSWERS_KEY);
        if (stored) {
          onboardingAnswers = JSON.parse(stored);
          await AsyncStorage.removeItem(ONBOARDING_ANSWERS_KEY);
        }
      } catch (e) {
        console.error('Failed to read onboarding answers', e);
      }

      const { error: profileError } = await supabase.from('profiles').upsert({
        id: userId,
        display_name: displayName.trim(),
        birthdate: birthdate.toISOString().split('T')[0],
        interests,
        terms_accepted_at: new Date().toISOString(),
        ...(onboardingAnswers.onboarding_motivations ? { onboarding_motivations: onboardingAnswers.onboarding_motivations } : {}),
        ...(onboardingAnswers.social_comfort_level ? { social_comfort_level: onboardingAnswers.social_comfort_level } : {}),
        ...(onboardingAnswers.monthly_interests ? { monthly_interests: onboardingAnswers.monthly_interests, monthly_interests_updated_at: new Date().toISOString() } : {}),
      });
      if (!profileError) {
        // Marks this as a fresh signup so the navigator shows the
        // recommendations screen first instead of jumping straight to
        // MainTabs — checked and cleared the very next time the app's
        // main stack renders, so it only ever fires once.
        await AsyncStorage.setItem('just_completed_signup', 'true').catch(() => null);
      }

      if (profileError) {
        setSubmitting(false);
        return Alert.alert('Error', profileError.message);
      }

      try {
        await uploadProfilePhoto(userId, photoAsset);
      } catch (e) {
        setSubmitting(false);
        return Alert.alert('Photo upload failed', e.message);
      }

      setSubmitting(false);
      Alert.alert(
        'Almost there',
        'Your profile is saved. Your photo is being reviewed and will appear to others shortly — usually within a few minutes.'
      );
      refreshProfile();
    } catch (e) {
      setSubmitting(false);
      Alert.alert('Error', e.message || 'Something went wrong saving your profile. Please try again.');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xl }}>
        <Text style={styles.header} accessibilityRole="header">{t('completeProfile.header')}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>18+ ONLY</Text>
        </View>

        <Text style={styles.label}>{t('completeProfile.displayName')}</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={t('completeProfile.displayNamePlaceholder')}
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel="Display name"
        />

        <Text style={styles.label}>{t('completeProfile.dateOfBirth')}</Text>
        <TouchableOpacity
          style={styles.input}
          onPress={() => setShowPicker(true)}
          accessibilityLabel={birthdate ? `Date of birth, ${birthdate.toLocaleDateString()}` : 'Date of birth, not set'}
          accessibilityRole="button"
        >
          <Text style={{ color: birthdate ? colors.textPrimary : colors.textTertiary }}>
            {birthdate ? birthdate.toLocaleDateString() : t('completeProfile.tapToSelect')}
          </Text>
        </TouchableOpacity>
        {showPicker && (
          <DateTimePicker
            value={birthdate || maxSelectableDate}
            mode="date"
            maximumDate={maxSelectableDate}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            themeVariant={isDark ? 'dark' : 'light'}
            onChange={(event, selectedDate) => {
              setShowPicker(Platform.OS === 'ios');
              if (selectedDate) setBirthdate(selectedDate);
            }}
          />
        )}

        <Text style={styles.label}>{t('completeProfile.profilePhoto')}</Text>
        <TouchableOpacity
          style={styles.photoPicker}
          onPress={choosePhoto}
          activeOpacity={0.85}
          accessibilityLabel={photoAsset ? 'Change your profile photo' : 'Choose a profile photo, required'}
          accessibilityRole="button"
        >
          {photoAsset ? (
            <Image source={{ uri: photoAsset.uri }} style={styles.photoPreview} />
          ) : (
            <Text style={styles.photoPickerText}>📷{'\n'}Tap to choose a photo</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.helperText}>{t('completeProfile.photoHelper')}</Text>

        <Text style={styles.label}>Interests (Optional)</Text>
        <Text style={styles.interestsHelper}>Helps us show you gatherings and people you'll actually click with.</Text>
        <View style={styles.chipsWrap}>
          {INTEREST_OPTIONS.map((interest) => {
            const selected = interests.includes(interest);
            return (
              <TouchableOpacity
                key={interest}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => toggleInterest(interest)}
                activeOpacity={0.8}
                accessibilityLabel={interest}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{interest}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={styles.consentRow}
          onPress={() => setAgreedToTerms(!agreedToTerms)}
          activeOpacity={0.7}
          accessibilityLabel="Agree to Terms of Service and Privacy Policy"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreedToTerms }}
        >
          <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
            {agreedToTerms && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.consentText}>
            {t('completeProfile.agreeText')}{' '}
            <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)}>{t('completeProfile.termsOfService')}</Text>
            {' '}{t('completeProfile.andText')}{' '}
            <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)}>{t('completeProfile.privacyPolicy')}</Text>
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, !agreedToTerms && styles.buttonDisabled]}
          onPress={submit}
          disabled={submitting || !agreedToTerms}
          activeOpacity={0.85}
          accessibilityLabel={submitting ? t('completeProfile.saving') : t('completeProfile.continue')}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{submitting ? t('completeProfile.saving') : t('completeProfile.continue')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.signOutLink}
          onPress={handleSignOut}
          accessibilityLabel="Sign out"
          accessibilityRole="button"
        >
          <Text style={styles.signOutLinkText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { ...typography.title, color: colors.textPrimary },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  badgeText: { color: colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, justifyContent: 'center', minHeight: 50, borderWidth: 1, borderColor: colors.border },
  photoPicker: {
    backgroundColor: colors.surface, borderRadius: radius.lg, height: 160, width: 160,
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden', alignSelf: 'center', marginTop: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  photoPreview: { width: '100%', height: '100%' },
  photoPickerText: { color: colors.textTertiary, textAlign: 'center', paddingHorizontal: spacing.md, fontSize: 13, lineHeight: 20 },
  helperText: { ...typography.small, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.sm },
  interestsHelper: { ...typography.small, color: colors.textTertiary, marginBottom: spacing.sm },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.lg, paddingHorizontal: spacing.xs },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.textTertiary,
    marginRight: spacing.sm, marginTop: 2, justifyContent: 'center', alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  consentText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 19 },
  link: { color: colors.primary, textDecorationLine: 'underline' },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.xl },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  signOutLink: { paddingVertical: spacing.sm, alignItems: 'center', marginBottom: spacing.lg },
  signOutLinkText: { color: colors.textTertiary, fontSize: 13 },
});