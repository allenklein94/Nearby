import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert, ActivityIndicator, Platform, KeyboardAvoidingView, Keyboard, TouchableWithoutFeedback } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { getMyFriends } from '../services/friends';
import { getMyCommunities } from '../services/communities';
import { addOccasion } from '../services/occasions';
import { celebrateOccasionOptions } from '../constants/businessAttributes';
import { WHEN_PRESETS, dateForPreset } from '../utils/whenPresets';
import {
  composeCelebrationTitle,
  composeCelebrationAskText,
  resolveCelebrationDestination,
  resolveCelebrationVisibility,
  celebrationCategoryHint,
  shouldOfferCalendarSave,
  buildOccasionSaveParams,
} from '../services/celebrateSomething';
import { PICK_DATE_KEY } from './AskBusinessScreen';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Item 61 ("Celebrate Something" life-events planning layer, CLAUDE.md):
// occasion -> who's it for -> what to do -> when -> who's involved, then
// hand off to a real existing screen (CreateGathering/AskBusiness/
// CreateHubScreen's own AI box) with full prefill. This screen creates
// nothing itself -- it's pure orchestration, same posture as
// SurpriseMeSheet.js. Full architecture rationale:
// PRODUCT_AUDIT/CELEBRATE_SOMETHING_2026-09-12.md.
const STEP_DEFS = [
  { key: 'occasion', label: 'Occasion' },
  { key: 'who_for', label: 'Who' },
  { key: 'activity', label: 'What' },
  { key: 'when', label: 'When' },
  { key: 'who_involved', label: 'Involve' },
];

const WHO_FOR_OPTIONS = [
  { key: 'me', label: 'Me', icon: '🙋' },
  { key: 'friend', label: 'A Friend', icon: '🤝' },
  { key: 'family', label: 'Family Member', icon: '👨‍👩‍👧' },
  { key: 'someone_else', label: 'Someone Else', icon: '✨' },
];

const ACTIVITY_OPTIONS = [
  { key: 'dinner', label: 'Dinner', icon: '🍽️' },
  { key: 'party', label: 'Party', icon: '🎉' },
  { key: 'surprise', label: 'Surprise', icon: '🎁' },
  { key: 'activity', label: 'Activity', icon: '🎯' },
  { key: 'night_out', label: 'Night Out', icon: '🌃' },
  { key: 'weekend_trip', label: 'Weekend Trip', icon: '🧳' },
  { key: 'custom', label: 'Something Custom', icon: '💡' },
];

const WHO_INVOLVED_OPTIONS = [
  { key: 'friends', label: 'Friends', icon: '👥' },
  { key: 'family', label: 'Family', icon: '👨‍👩‍👧‍👦' },
  { key: 'existing_group', label: 'Existing Group', icon: '👪' },
  { key: 'invite_specific', label: 'Invite Specific People', icon: '✋' },
];

export default function CelebrateSomethingScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [step, setStep] = useState(0);

  const [occasion, setOccasion] = useState(null);

  const [whoFor, setWhoFor] = useState(null);
  const [whoForName, setWhoForName] = useState('');
  const [whoForFriendId, setWhoForFriendId] = useState(null);
  const [friends, setFriends] = useState([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [friendsLoaded, setFriendsLoaded] = useState(false);

  const [activityType, setActivityType] = useState(null);

  const [whenPreset, setWhenPreset] = useState(null);
  const [scheduledAt, setScheduledAt] = useState(new Date(Date.now() + 60 * 60 * 1000));
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [whoInvolved, setWhoInvolved] = useState(null);
  const [communities, setCommunities] = useState([]);
  const [loadingCommunities, setLoadingCommunities] = useState(false);
  const [communitiesLoaded, setCommunitiesLoaded] = useState(false);
  const [communityId, setCommunityId] = useState(null);

  const [saveToCalendar, setSaveToCalendar] = useState(false);

  async function ensureFriendsLoaded() {
    if (friendsLoaded || loadingFriends) return;
    setLoadingFriends(true);
    const data = await getMyFriends();
    setFriends(data);
    setLoadingFriends(false);
    setFriendsLoaded(true);
  }

  async function ensureCommunitiesLoaded() {
    if (communitiesLoaded || loadingCommunities) return;
    setLoadingCommunities(true);
    const data = await getMyCommunities();
    setCommunities(data.filter((c) => c.status === 'active'));
    setLoadingCommunities(false);
    setCommunitiesLoaded(true);
  }

  function pickWhoFor(key) {
    Haptics.selectionAsync();
    setWhoFor(key);
    if (key !== 'me') ensureFriendsLoaded();
  }

  function pickWhoInvolved(key) {
    Haptics.selectionAsync();
    setWhoInvolved(key);
    if (key === 'existing_group') ensureCommunitiesLoaded();
  }

  function pickWhenPreset(key) {
    Haptics.selectionAsync();
    setWhenPreset(key);
    if (key === 'custom') {
      setShowDatePicker(true);
    } else {
      setScheduledAt(dateForPreset(key));
    }
  }

  const stepKey = STEP_DEFS[step].key;

  function goNext() {
    if (stepKey === 'occasion' && !occasion) {
      return Alert.alert('Pick an occasion', "What's the occasion for this celebration?");
    }
    if (stepKey === 'who_for' && !whoFor) {
      return Alert.alert('Pick who it’s for', 'Who is this celebration for?');
    }
    if (stepKey === 'activity' && !activityType) {
      return Alert.alert('Pick something to do', "What would you like to do?");
    }
    if (stepKey === 'when' && (!whenPreset || scheduledAt.getTime() <= Date.now())) {
      return Alert.alert('Pick a time', "When's this happening? Needs to be in the future.");
    }
    if (stepKey === 'who_involved') {
      if (!whoInvolved) {
        return Alert.alert('Pick who’s involved', 'Who should be involved?');
      }
      if (whoInvolved === 'existing_group' && !communityId) {
        if (!loadingCommunities && communities.length === 0) {
          return Alert.alert('No groups yet', "You're not a member of any active community yet — pick a different option instead.");
        }
        return Alert.alert('Pick a group', 'Choose which of your communities this is for.');
      }
      return proceedToDestination();
    }
    Haptics.selectionAsync();
    setStep((s) => Math.min(s + 1, STEP_DEFS.length - 1));
  }

  function goBack() {
    if (step === 0) {
      navigation.goBack();
      return;
    }
    Haptics.selectionAsync();
    setStep((s) => Math.max(s - 1, 0));
  }

  function proceedToDestination() {
    const trimmedName = whoForName.trim() || null;
    const title = composeCelebrationTitle({ occasion, whoFor, whoForName: trimmedName });
    const askText = composeCelebrationAskText({ occasion, whoFor, whoForName: trimmedName, activityType });
    const visibility = resolveCelebrationVisibility({ activityType, whoInvolved });
    const destination = resolveCelebrationDestination(activityType);

    if (saveToCalendar && shouldOfferCalendarSave(occasion)) {
      // Optional, additive side effect -- never blocks or fails the real
      // navigation below (this repo's own "no dead ends" spirit run in
      // reverse: an optional extra never becomes a required gate either).
      addOccasion(buildOccasionSaveParams({ occasion, title, scheduledAt, connectedUserId: whoForFriendId })).catch(() => {});
    }

    if (destination === 'gathering') {
      const params = { quickStartTitle: title, initialVisibility: visibility };
      if (visibility === 'community' && communityId) params.initialCommunityId = communityId;
      if (whenPreset) {
        params.quickStartWhenPreset = whenPreset;
        if (whenPreset === 'custom') params.quickStartWhenISO = scheduledAt.toISOString();
      }
      navigation.navigate('CreateGathering', params);
      return;
    }

    if (destination === 'business') {
      const params = { prefillText: askText, prefillOccasion: occasion };
      const categoryHint = celebrationCategoryHint(activityType);
      if (categoryHint) params.prefillCategory = categoryHint;
      if (whenPreset === 'now' || whenPreset === 'tonight') {
        params.prefillDateWindow = 'today';
      } else if (whenPreset === 'tomorrow') {
        params.prefillDateWindow = 'tomorrow';
      } else if (whenPreset === 'custom') {
        params.prefillDateWindow = PICK_DATE_KEY;
        params.prefillPickedDateISO = scheduledAt.toISOString().slice(0, 10);
      }
      navigation.navigate('AskBusiness', params);
      return;
    }

    // 'custom' -- no structured destination; hand off to CreateHubScreen's
    // own existing free-text AI-classification box, pre-typed only, never
    // auto-submitted (this repo's own "AI suggests, never silently commits"
    // rule).
    navigation.navigate('Create', { prefillSomethingElseText: askText });
  }

  const finalStep = stepKey === 'who_involved';

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
            <Text style={styles.header} accessibilityRole="header">🎉 Celebrate Something</Text>
            <Text style={styles.subheader}>Let's turn this into a real plan.</Text>

            <View style={styles.progressRow} accessibilityLabel={`Step ${step + 1} of ${STEP_DEFS.length}: ${STEP_DEFS[step].label}`}>
              {STEP_DEFS.map((s, i) => (
                <View key={s.key} style={styles.progressStep}>
                  <View style={[styles.progressDot, i <= step && styles.progressDotActive]} />
                  <Text style={[styles.progressLabel, i === step && styles.progressLabelActive]}>{s.label}</Text>
                </View>
              ))}
            </View>

            {stepKey === 'occasion' && (
              <>
                <Text style={styles.label}>What are you celebrating?</Text>
                <View style={styles.chipRow}>
                  {celebrateOccasionOptions().map((o) => {
                    const selected = occasion === o.key;
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setOccasion(o.key); }}
                        activeOpacity={0.8}
                        accessibilityLabel={o.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {stepKey === 'who_for' && (
              <>
                <Text style={styles.label}>Who is this for?</Text>
                <View style={styles.chipRow}>
                  {WHO_FOR_OPTIONS.map((o) => {
                    const selected = whoFor === o.key;
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => pickWhoFor(o.key)}
                        activeOpacity={0.8}
                        accessibilityLabel={o.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {whoFor && whoFor !== 'me' && (
                  <>
                    {loadingFriends && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />}
                    {!loadingFriends && friends.length > 0 && (
                      <>
                        <Text style={styles.sublabel}>Pick a real friend (optional)</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
                          {friends.map((f) => {
                            const selected = whoForName === f.display_name;
                            return (
                              <TouchableOpacity
                                key={f.id}
                                style={[styles.chip, selected && styles.chipSelected]}
                                onPress={() => {
                                  Haptics.selectionAsync();
                                  setWhoForName(selected ? '' : f.display_name);
                                  setWhoForFriendId(selected ? null : f.id);
                                }}
                                activeOpacity={0.8}
                                accessibilityLabel={f.display_name}
                                accessibilityRole="button"
                                accessibilityState={{ selected }}
                              >
                                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{f.display_name}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </>
                    )}
                    <Text style={styles.sublabel}>Or type a name (optional)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Sarah"
                      placeholderTextColor={colors.textTertiary}
                      value={whoForName}
                      onChangeText={(t) => { setWhoForName(t); setWhoForFriendId(null); }}
                      accessibilityLabel="Name (optional)"
                    />
                  </>
                )}
              </>
            )}

            {stepKey === 'activity' && (
              <>
                <Text style={styles.label}>What would you like to do?</Text>
                <View style={styles.chipRow}>
                  {ACTIVITY_OPTIONS.map((o) => {
                    const selected = activityType === o.key;
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setActivityType(o.key); }}
                        activeOpacity={0.8}
                        accessibilityLabel={o.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {stepKey === 'when' && (
              <>
                <Text style={styles.label}>When?</Text>
                <View style={styles.chipRow}>
                  {WHEN_PRESETS.map((p) => {
                    const selected = whenPreset === p.key;
                    return (
                      <TouchableOpacity
                        key={p.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => pickWhenPreset(p.key)}
                        activeOpacity={0.8}
                        accessibilityLabel={p.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{p.icon} {p.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {whenPreset && (
                  <TouchableOpacity style={styles.dateDisplay} onPress={() => setShowDatePicker(true)} accessibilityRole="button" accessibilityLabel="Change date and time">
                    <Text style={styles.dateDisplayText}>
                      {scheduledAt.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  </TouchableOpacity>
                )}
                {showDatePicker && (
                  <DateTimePicker
                    value={scheduledAt}
                    mode="datetime"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    themeVariant={colors.background === '#000000' || colors.background === '#0a0a0a' ? 'dark' : 'light'}
                    onChange={(event, selectedDate) => {
                      setShowDatePicker(Platform.OS === 'ios');
                      if (selectedDate) {
                        setScheduledAt(selectedDate);
                        setWhenPreset('custom');
                      }
                    }}
                  />
                )}
              </>
            )}

            {stepKey === 'who_involved' && (
              <>
                <Text style={styles.label}>Who should be involved?</Text>
                <View style={styles.chipRow}>
                  {WHO_INVOLVED_OPTIONS.map((o) => {
                    const selected = whoInvolved === o.key;
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => pickWhoInvolved(o.key)}
                        activeOpacity={0.8}
                        accessibilityLabel={o.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {whoInvolved === 'existing_group' && (
                  <>
                    {loadingCommunities && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />}
                    {!loadingCommunities && communities.length === 0 && communitiesLoaded && (
                      <Text style={styles.helperText}>You're not a member of any active community yet — pick a different option above.</Text>
                    )}
                    {!loadingCommunities && communities.length > 0 && (
                      <View style={styles.chipRow}>
                        {communities.map((c) => {
                          const selected = communityId === c.id;
                          return (
                            <TouchableOpacity
                              key={c.id}
                              style={[styles.chip, selected && styles.chipSelected]}
                              onPress={() => { Haptics.selectionAsync(); setCommunityId(c.id); }}
                              activeOpacity={0.8}
                              accessibilityLabel={c.name}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                            >
                              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{c.name}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </>
                )}

                {(whoInvolved === 'friends' || whoInvolved === 'family' || whoInvolved === 'invite_specific') && (
                  <Text style={styles.helperText}>
                    We'll take you to your new plan — from there, "Invite Friends" lets you pick exactly who should know.
                  </Text>
                )}

                {shouldOfferCalendarSave(occasion) && (
                  <TouchableOpacity
                    style={styles.calendarToggleRow}
                    onPress={() => { Haptics.selectionAsync(); setSaveToCalendar((v) => !v); }}
                    activeOpacity={0.8}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: saveToCalendar }}
                    accessibilityLabel="Also save to your Occasions calendar"
                  >
                    <View style={[styles.checkbox, saveToCalendar && styles.checkboxChecked]}>
                      {saveToCalendar && <Text style={styles.checkboxMark}>✓</Text>}
                    </View>
                    <Text style={styles.calendarToggleText}>🗓️ Also save this to your Occasions calendar</Text>
                  </TouchableOpacity>
                )}
              </>
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
              <TouchableOpacity
                style={styles.nextButton}
                onPress={goNext}
                activeOpacity={0.85}
                accessibilityLabel={finalStep ? "Let's Plan It" : 'Next'}
                accessibilityRole="button"
              >
                <Text style={styles.nextButtonText}>{finalStep ? "Let's Plan It →" : 'Next'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
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
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.md, textTransform: 'uppercase', letterSpacing: 0.5 },
  sublabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  helperText: { color: colors.textTertiary, fontSize: 13, marginTop: spacing.md, lineHeight: 18 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs },
  dateDisplay: {
    marginTop: spacing.md, backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  dateDisplayText: { color: colors.textPrimary, fontWeight: '600' },
  calendarToggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingVertical: spacing.xs },
  checkbox: {
    width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  calendarToggleText: { color: colors.textPrimary, fontSize: 14, flex: 1 },
  navRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  backButton: {
    paddingVertical: 16, paddingHorizontal: spacing.lg, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  backButtonText: { color: colors.textSecondary, fontWeight: '700', fontSize: 15 },
  nextButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', ...shadow.button },
  nextButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
