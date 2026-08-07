import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Platform, ScrollView, Keyboard, TouchableWithoutFeedback } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { createGathering } from '../services/gatherings';
import { checkTextModeration } from '../services/textModeration';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const INTEREST_OPTIONS = [
  'Travel', 'Coffee', 'Hiking', 'Music', 'Movies', 'Foodie', 'Fitness',
  'Reading', 'Art', 'Gaming', 'Photography', 'Yoga', 'Dancing', 'Cooking',
  'Wine', 'Dogs', 'Cats', 'Outdoors', 'Sports', 'Concerts', 'Museums',
  'Volunteering', 'Meditation', 'Running',
];

const STEPS = ['What', 'When', 'Where & Who', 'Preview'];

// A real guided multi-step flow — What → When → Where & Who → Preview
// — instead of every field on one long form. "Invite friends" (from
// the roadmap doc this closes) was deliberately not added as a step:
// there is no working delivery mechanism for it anywhere in this
// codebase. notifications.js already has a `case 'gathering_invite':`
// tap-routing entry, but nothing anywhere ever sends one — no table,
// no trigger, no push. Building a real version needs its own schema/
// RLS/push-wiring pass, not a step bolted onto this one. See CLAUDE.md.
export default function CreateGatheringScreen({ navigation, route }) {
  const { colors, shadow, isDark } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors, shadow);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [interestTag, setInterestTag] = useState(null);
  const [scheduledAt, setScheduledAt] = useState(new Date(Date.now() + 60 * 60 * 1000));
  const [showPicker, setShowPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [customLocation, setCustomLocation] = useState(null);
  const [showOnMap, setShowOnMap] = useState(true);
  const [womenOnly, setWomenOnly] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState(null);

  useEffect(() => {
    if (route.params?.selectedLat && route.params?.selectedLng) {
      setCustomLocation({ latitude: route.params.selectedLat, longitude: route.params.selectedLng });
    }
  }, [route.params?.selectedLat, route.params?.selectedLng]);

  useEffect(() => {
    if (route.params?.quickStartTitle) {
      setTitle(route.params.quickStartTitle);
    }
    if (route.params?.quickStartCategory) {
      setInterestTag(route.params.quickStartCategory);
    }
  }, [route.params?.quickStartTitle, route.params?.quickStartCategory]);

  function goNext() {
    if (step === 0 && !title.trim()) {
      return Alert.alert('Title required', 'Give your gathering a short title.');
    }
    if (step === 1 && scheduledAt.getTime() <= Date.now()) {
      return Alert.alert('Pick a future time', "Your gathering's date and time needs to be in the future.");
    }
    Haptics.selectionAsync();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function goBack() {
    if (step === 0) {
      navigation.goBack();
      return;
    }
    Haptics.selectionAsync();
    setStep((s) => Math.max(s - 1, 0));
  }

  async function submit() {
    const titleCheck = await checkTextModeration(title);
    if (!titleCheck.safe) {
      return Alert.alert('Title not allowed', 'Please revise your title and try again.');
    }
    if (description.trim()) {
      const descCheck = await checkTextModeration(description);
      if (!descCheck.safe) {
        return Alert.alert('Description not allowed', 'Please revise your description and try again.');
      }
    }

    setSubmitting(true);
    try {
      await createGathering({
        title: title.trim(),
        description: description.trim() || null,
        interestTag,
        scheduledAt: scheduledAt.toISOString(),
        isPublic,
        customLocation,
        showOnMap: isPublic ? true : showOnMap,
        womenOnly,
        recurrenceRule: recurrenceRule || null,
      });
      Alert.alert('Posted!', 'Your gathering is now visible to people nearby.');
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSubmitting(false);
  }

  const selectedStyle = interestTag ? categoryStyleFor(interestTag) : null;

  return (
    <SafeAreaView style={styles.container}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
        <Text style={styles.header} accessibilityRole="header">{t('gatherings.createHeader')}</Text>
        <Text style={styles.subheader}>{t('gatherings.createSubheader')}</Text>

        <View style={styles.progressRow} accessibilityLabel={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
          {STEPS.map((label, i) => (
            <View key={label} style={styles.progressStep}>
              <View style={[styles.progressDot, i <= step && styles.progressDotActive]} />
              <Text style={[styles.progressLabel, i === step && styles.progressLabelActive]}>{label}</Text>
            </View>
          ))}
        </View>

        {step === 0 && (
          <>
            <Text style={styles.label}>{t('gatherings.titleLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('gatherings.titlePlaceholder')}
              placeholderTextColor={colors.textTertiary}
              value={title}
              onChangeText={setTitle}
              accessibilityLabel="Gathering title"
            />

            <Text style={styles.label}>{t('gatherings.descriptionLabel')}</Text>
            <TextInput
              style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
              placeholder={t('gatherings.descriptionPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              value={description}
              onChangeText={setDescription}
              multiline
              accessibilityLabel="Gathering description, optional"
            />

            <Text style={styles.label}>{t('gatherings.categoryLabel')}</Text>
            <View style={styles.chipsWrap}>
              {INTEREST_OPTIONS.map((option) => {
                const style = categoryStyleFor(option);
                const isSelected = interestTag === option;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.chip,
                      isSelected && { backgroundColor: style.color, borderColor: style.color },
                    ]}
                    onPress={() => setInterestTag(interestTag === option ? null : option)}
                    activeOpacity={0.8}
                    accessibilityLabel={`Category: ${option}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                      {style.icon} {option}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {step === 1 && (
          <>
            <Text style={styles.label}>{t('gatherings.whenLabel')}</Text>
            <TouchableOpacity
              style={styles.input}
              onPress={() => setShowPicker(true)}
              accessibilityLabel={`When: ${scheduledAt.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.textPrimary }}>
                {scheduledAt.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </Text>
            </TouchableOpacity>
            {showPicker && (
              <DateTimePicker
                value={scheduledAt}
                mode="datetime"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                themeVariant={isDark ? 'dark' : 'light'}
                minimumDate={new Date()}
                onChange={(event, selectedDate) => {
                  setShowPicker(Platform.OS === 'ios');
                  if (selectedDate) setScheduledAt(selectedDate);
                }}
              />
            )}

            <Text style={styles.label}>Repeats</Text>
            <View style={styles.chipsWrap}>
              {[
                { key: null, label: "Doesn't repeat" },
                { key: 'weekly', label: 'Weekly' },
                { key: 'biweekly', label: 'Every 2 weeks' },
                { key: 'monthly', label: 'Monthly' },
              ].map((option) => {
                const selected = recurrenceRule === option.key;
                return (
                  <TouchableOpacity
                    key={option.label}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => setRecurrenceRule(option.key)}
                    activeOpacity={0.8}
                    accessibilityLabel={option.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {recurrenceRule && (
              <Text style={styles.helperText}>A new one will be created automatically after each one passes.</Text>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.label}>Where</Text>
            <TouchableOpacity
              style={styles.input}
              onPress={() => navigation.navigate('SelectGatheringLocation', {
                initialLat: customLocation?.latitude,
                initialLng: customLocation?.longitude,
              })}
              accessibilityLabel={customLocation ? 'Location set, tap to change' : 'Set the gathering location, defaults to your current location if not set'}
              accessibilityRole="button"
            >
              <Text style={{ color: customLocation ? colors.textPrimary : colors.textTertiary }}>
                {customLocation ? '📍 Custom location set — tap to change' : '📍 Use my current location (tap to set a different spot)'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.label}>Who can join</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }}>
              <TouchableOpacity
                style={[styles.publicToggle, isPublic && styles.publicToggleActive]}
                onPress={() => { Haptics.selectionAsync(); setIsPublic(true); }}
                activeOpacity={0.85}
                accessibilityLabel="Public - anyone interested joins automatically, no approval needed"
                accessibilityRole="button"
                accessibilityState={{ selected: isPublic }}
              >
                <Text style={[styles.publicToggleText, isPublic && styles.publicToggleTextActive]}>🌍 Public</Text>
                <Text style={[styles.publicToggleHint, isPublic && styles.publicToggleHintActive]}>Anyone interested joins instantly</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.publicToggle, !isPublic && styles.publicToggleActive]}
                onPress={() => { Haptics.selectionAsync(); setIsPublic(false); }}
                activeOpacity={0.85}
                accessibilityLabel="Private - you approve each person before they join"
                accessibilityRole="button"
                accessibilityState={{ selected: !isPublic }}
              >
                <Text style={[styles.publicToggleText, !isPublic && styles.publicToggleTextActive]}>🔒 Private</Text>
                <Text style={[styles.publicToggleHint, !isPublic && styles.publicToggleHintActive]}>You approve each person</Text>
              </TouchableOpacity>
            </View>

            {!isPublic && (
              <>
                <Text style={styles.label}>Map Visibility</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }}>
                  <TouchableOpacity
                    style={[styles.publicToggle, showOnMap && styles.publicToggleActive]}
                    onPress={() => { Haptics.selectionAsync(); setShowOnMap(true); }}
                    activeOpacity={0.85}
                    accessibilityLabel="Show an approximate pin on the map"
                    accessibilityRole="button"
                    accessibilityState={{ selected: showOnMap }}
                  >
                    <Text style={[styles.publicToggleText, showOnMap && styles.publicToggleTextActive]}>🗺️ On Map</Text>
                    <Text style={[styles.publicToggleHint, showOnMap && styles.publicToggleHintActive]}>Approximate pin shown</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.publicToggle, !showOnMap && styles.publicToggleActive]}
                    onPress={() => { Haptics.selectionAsync(); setShowOnMap(false); }}
                    activeOpacity={0.85}
                    accessibilityLabel="Hide from the map entirely, only visible in list search"
                    accessibilityRole="button"
                    accessibilityState={{ selected: !showOnMap }}
                  >
                    <Text style={[styles.publicToggleText, !showOnMap && styles.publicToggleTextActive]}>🚫 Off Map</Text>
                    <Text style={[styles.publicToggleHint, !showOnMap && styles.publicToggleHintActive]}>List only, hidden from map</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            <TouchableOpacity
              style={styles.womenOnlyToggle}
              onPress={() => { Haptics.selectionAsync(); setWomenOnly(!womenOnly); }}
              activeOpacity={0.85}
              accessibilityLabel={womenOnly ? 'Women-only gathering, tap to make open to everyone' : 'Open to everyone, tap to make women-only'}
              accessibilityRole="switch"
              accessibilityState={{ checked: womenOnly }}
            >
              <Text style={styles.womenOnlyToggleText}>{womenOnly ? '✓ ' : ''}Women-Only Gathering</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 3 && (
          <View style={styles.previewCard}>
            <View style={styles.previewHeaderRow}>
              <Text style={styles.previewIcon}>{selectedStyle ? selectedStyle.icon : '🎉'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle}>{title || 'Untitled gathering'}</Text>
                {interestTag ? <Text style={styles.previewMeta}>{interestTag}</Text> : null}
              </View>
            </View>
            {description ? <Text style={styles.previewDescription}>{description}</Text> : null}
            <View style={styles.previewRow}>
              <Text style={styles.previewRowIcon}>🗓️</Text>
              <Text style={styles.previewRowText}>
                {scheduledAt.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {recurrenceRule ? ` · repeats ${recurrenceRule === 'biweekly' ? 'every 2 weeks' : recurrenceRule}` : ''}
              </Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewRowIcon}>📍</Text>
              <Text style={styles.previewRowText}>{customLocation ? 'Custom location set' : 'Your current location'}</Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewRowIcon}>{isPublic ? '🌍' : '🔒'}</Text>
              <Text style={styles.previewRowText}>
                {isPublic ? 'Public — anyone interested joins instantly' : `Private — you approve each person${!showOnMap ? ', hidden from map' : ''}`}
              </Text>
            </View>
            {womenOnly && (
              <View style={styles.previewRow}>
                <Text style={styles.previewRowIcon}>♀️</Text>
                <Text style={styles.previewRowText}>Women-only gathering</Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.navRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={goBack}
            activeOpacity={0.85}
            accessibilityLabel={step === 0 ? 'Cancel' : 'Back'}
            accessibilityRole="button"
          >
            <Text style={styles.backButtonText}>{step === 0 ? 'Cancel' : 'Back'}</Text>
          </TouchableOpacity>
          {step < STEPS.length - 1 ? (
            <TouchableOpacity
              style={[styles.nextButton, selectedStyle && { backgroundColor: selectedStyle.color }]}
              onPress={goNext}
              activeOpacity={0.85}
              accessibilityLabel="Next"
              accessibilityRole="button"
            >
              <Text style={styles.nextButtonText}>Next</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.nextButton, selectedStyle && { backgroundColor: selectedStyle.color }]}
              onPress={submit}
              disabled={submitting}
              activeOpacity={0.85}
              accessibilityLabel={submitting ? t('gatherings.posting') : t('gatherings.postButton')}
              accessibilityRole="button"
            >
              <Text style={styles.nextButtonText}>{submitting ? t('gatherings.posting') : t('gatherings.postButton')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  subheader: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg, lineHeight: 18 },
  progressRow: { flexDirection: 'row', marginBottom: spacing.xl },
  progressStep: { flex: 1, alignItems: 'center' },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border, marginBottom: 6 },
  progressDotActive: { backgroundColor: colors.primary },
  progressLabel: { fontSize: 10, color: colors.textTertiary, fontWeight: '600' },
  progressLabelActive: { color: colors.primary },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  helperText: { color: colors.textTertiary, fontSize: 12, marginTop: spacing.xs },
  navRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  backButton: {
    paddingVertical: 16, paddingHorizontal: spacing.lg, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  backButtonText: { color: colors.textSecondary, fontWeight: '700', fontSize: 15 },
  nextButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', ...shadow.button },
  nextButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  publicToggle: {
    flex: 1, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  publicToggleActive: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  publicToggleText: { color: colors.textPrimary, fontWeight: '700', fontSize: 14, marginBottom: 2 },
  publicToggleTextActive: { color: colors.primary },
  publicToggleHint: { color: colors.textTertiary, fontSize: 11 },
  publicToggleHintActive: { color: colors.primary, opacity: 0.8 },
  womenOnlyToggle: {
    flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.lg,
  },
  womenOnlyToggleText: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
  previewCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.lg, ...shadow.card,
  },
  previewHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  previewIcon: { fontSize: 32, marginRight: spacing.md },
  previewTitle: { ...typography.headline, color: colors.textPrimary },
  previewMeta: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  previewDescription: { color: colors.textSecondary, fontSize: 14, marginBottom: spacing.md, lineHeight: 20 },
  previewRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  previewRowIcon: { fontSize: 16, marginRight: spacing.sm, width: 22 },
  previewRowText: { color: colors.textPrimary, fontSize: 13, flex: 1 },
});
