import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert, ActivityIndicator, Platform, KeyboardAvoidingView, Keyboard, TouchableWithoutFeedback } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { getMyFriends } from '../services/friends';
import { getMyCommunities } from '../services/communities';
import { addOccasion } from '../services/occasions';
import { resolveIntent } from '../services/intentResolver';
import { submitBusinessRequest } from '../services/businessFulfillment';
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
  dateWindowForWhenPreset,
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
//
// "Connect it to businesses" follow-up (direct user request): for a
// business-destined activity type (dinner/night_out/activity), the final
// step becomes a real live-options step ("options") instead of the
// otherwise-vestigial "who's involved" question -- that question never
// actually fed anything for a business ask (visibility only matters for
// the gathering destination), so this replaces it rather than bolting on
// a 6th step. Every other destination keeps "who's involved" unchanged.
function buildStepDefs(activityType) {
  const base = [
    { key: 'occasion', label: 'Occasion' },
    { key: 'who_for', label: 'Who' },
    { key: 'activity', label: 'What' },
    { key: 'when', label: 'When' },
  ];
  base.push(
    resolveCelebrationDestination(activityType) === 'business'
      ? { key: 'options', label: 'Options' }
      : { key: 'who_involved', label: 'Involve' }
  );
  return base;
}

// A real, optional guest count -- feeds resolveIntent()'s own real hard
// feasibility filter (a posting whose capacity can't fit this many people
// is excluded server-side, not just ranked lower) and the submitted
// business_request's own party_size column. Left unset (null) is honest
// and common -- never defaulted to a guessed number.
const PARTY_SIZE_OPTIONS = [2, 4, 6, 8, 10];

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
  const [partySize, setPartySize] = useState(null);

  const [whenPreset, setWhenPreset] = useState(null);
  const [scheduledAt, setScheduledAt] = useState(new Date(Date.now() + 60 * 60 * 1000));
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [whoInvolved, setWhoInvolved] = useState(null);
  const [communities, setCommunities] = useState([]);
  const [loadingCommunities, setLoadingCommunities] = useState(false);
  const [communitiesLoaded, setCommunitiesLoaded] = useState(false);
  const [communityId, setCommunityId] = useState(null);

  const [saveToCalendar, setSaveToCalendar] = useState(false);

  // "Connect it to businesses": resolveIntent()'s own real, already-scored
  // candidate pool (business_availability + gathering), fetched using the
  // wizard's own structured answers -- no free text, no AI classification
  // needed, since every field it needs is already real ground truth by the
  // time the user reaches this step.
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsFetched, setOptionsFetched] = useState(false);
  const [optionsResult, setOptionsResult] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [submittingOptions, setSubmittingOptions] = useState(false);

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

  const stepDefs = buildStepDefs(activityType);
  const stepKey = stepDefs[step].key;

  useEffect(() => {
    if (stepKey === 'options' && !optionsFetched && !optionsLoading) {
      fetchOptions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  // A real staleness guard: going Back from 'options' to change occasion/
  // when/party size (all real inputs to the query above) must force a
  // fresh fetch next time 'options' is reached, not silently keep serving
  // results computed from the answers the user just changed.
  useEffect(() => {
    setOptionsFetched(false);
    setOptionsResult(null);
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occasion, activityType, whenPreset, scheduledAt, partySize]);

  async function fetchOptions() {
    setOptionsLoading(true);
    try {
      const result = await resolveIntent({
        category: null,
        dateWindow: dateWindowForWhenPreset(whenPreset),
        rawText: '',
        partySize,
        occasion,
      });
      setOptionsResult(result);
    } catch (e) {
      console.error('CelebrateSomething fetchOptions error', e);
      setOptionsResult({ items: [], experience: null });
    }
    setOptionsFetched(true);
    setOptionsLoading(false);
  }

  // Every real, selectable business_availability candidate resolveIntent()
  // found -- bundles, per-component items, and (when no experience
  // assembled) the flat list, deduped by id since the same posting could
  // otherwise appear in more than one of those buckets.
  const allCandidates = useMemo(() => {
    if (!optionsResult) return [];
    const byId = new Map();
    (optionsResult.experience?.bundles ?? []).forEach((c) => byId.set(c.id, c));
    (optionsResult.experience?.components ?? []).forEach((comp) => {
      comp.items.forEach((c) => { if (c.type === 'business_availability') byId.set(c.id, c); });
    });
    if (!optionsResult.experience) {
      optionsResult.items
        .filter((c) => c.type === 'business_availability')
        .forEach((c) => byId.set(c.id, c));
    }
    return Array.from(byId.values());
  }, [optionsResult]);

  function toggleSelected(candidate) {
    if (candidate.type !== 'business_availability') return;
    Haptics.selectionAsync();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(candidate.id)) next.delete(candidate.id); else next.add(candidate.id);
      return next;
    });
  }

  // Submits one real business_request per selected candidate, each bound
  // via preferredAvailabilityId -- same "skip straight to offered" RPC
  // path AskBusinessScreen's own "Find options nearby" step (Item 53)
  // already uses for a single pick, extended here to several at once
  // since a birthday plan can genuinely need dinner AND something fun.
  // Never a blind bulk-submit with no visible outcome: a single success
  // lands on that request's own real detail screen exactly like a normal
  // solo ask would; several successes land on Plans, where every one of
  // them is independently already visible (Item 52).
  async function submitSelectedBusinessRequests() {
    const selected = allCandidates.filter((c) => selectedIds.has(c.id));
    if (selected.length === 0) return;
    setSubmittingOptions(true);
    const trimmedName = whoForName.trim() || null;
    const title = composeCelebrationTitle({ occasion, whoFor, whoForName: trimmedName });
    const askText = composeCelebrationAskText({ occasion, whoFor, whoForName: trimmedName, activityType });
    if (saveToCalendar && shouldOfferCalendarSave(occasion, !!whoForFriendId)) {
      addOccasion(buildOccasionSaveParams({ occasion, title, scheduledAt, connectedUserId: whoForFriendId })).catch(() => {});
    }
    const dateParam = scheduledAt.toISOString().slice(0, 10);
    const results = await Promise.allSettled(
      selected.map((c) => submitBusinessRequest({
        text: askText,
        category: c.category ?? null,
        partySize,
        date: dateParam,
        occasion,
        preferredAvailabilityId: c.id,
      }))
    );
    setSubmittingOptions(false);
    const succeeded = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (succeeded.length === 0) {
      Alert.alert('Something went wrong', "We couldn't send those requests. Please try again.");
      return;
    }
    if (succeeded.length === 1) {
      navigation.replace('BusinessRequestDetail', {
        requestId: succeeded[0].requestId,
        justSubmitted: true,
        notifiedCount: succeeded[0].notifiedCount,
        duplicate: succeeded[0].duplicate,
        prefillText: askText,
        prefillOccasion: occasion,
        prefillPartySize: partySize,
        prefillDateWindow: whenPreset === 'custom' ? PICK_DATE_KEY : whenPreset,
        prefillPickedDateISO: whenPreset === 'custom' ? scheduledAt.toISOString() : null,
      });
      return;
    }
    Alert.alert('Requests sent', `🎉 Sent ${succeeded.length} requests — track them all from your Plans tab.`);
    navigation.navigate('Plans');
  }

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
    setStep((s) => Math.min(s + 1, stepDefs.length - 1));
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

    if (saveToCalendar && shouldOfferCalendarSave(occasion, !!whoForFriendId)) {
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
      if (partySize) params.prefillPartySize = partySize;
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

  const finalStep = step === stepDefs.length - 1;

  // A real gathering candidate (assembleExperience() can bucket one into a
  // component alongside business_availability, e.g. a live-music gathering
  // filling "Something Fun") can't be requested from a business -- it's
  // already a real, already-happening thing, so it renders as a plain
  // tap-to-view row instead of a selectable checkbox.
  function renderOptionCard(item) {
    if (item.type === 'gathering') {
      return (
        <TouchableOpacity
          key={`gathering-${item.id}`}
          style={styles.optionCard}
          onPress={() => navigation.navigate('GatheringDetail', { gatheringId: item.id })}
          activeOpacity={0.8}
          accessibilityLabel={item.title}
          accessibilityRole="button"
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.optionTitle}>🎊 {item.title}</Text>
            {item.subtitle ? <Text style={styles.optionSubtitle}>{item.subtitle}</Text> : null}
            <Text style={styles.optionHint}>Already happening — tap to view</Text>
          </View>
        </TouchableOpacity>
      );
    }
    const selected = selectedIds.has(item.id);
    const isBundle = Array.isArray(item.componentLabels);
    return (
      <TouchableOpacity
        key={`business-${item.id}`}
        style={[styles.optionCard, selected && styles.optionCardSelected]}
        onPress={() => toggleSelected(item)}
        activeOpacity={0.8}
        accessibilityLabel={item.title}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
      >
        <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
          {selected && <Text style={styles.checkboxMark}>✓</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.optionTitle}>{item.title}</Text>
          {item.subtitle ? <Text style={styles.optionSubtitle}>{item.subtitle}</Text> : null}
          {isBundle && <Text style={styles.optionHint}>Covers: {item.componentLabels.join(', ')}</Text>}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
            <Text style={styles.header} accessibilityRole="header">🎉 Celebrate Something</Text>
            <Text style={styles.subheader}>Let's turn this into a real plan.</Text>

            <View style={styles.progressRow} accessibilityLabel={`Step ${step + 1} of ${stepDefs.length}: ${stepDefs[step].label}`}>
              {stepDefs.map((s, i) => (
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

                <Text style={styles.sublabel}>How many people? (optional)</Text>
                <View style={styles.chipRow}>
                  {PARTY_SIZE_OPTIONS.map((n, i) => {
                    const selected = partySize === n;
                    const label = i === PARTY_SIZE_OPTIONS.length - 1 ? `${n}+` : String(n);
                    return (
                      <TouchableOpacity
                        key={n}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setPartySize(selected ? null : n); }}
                        activeOpacity={0.8}
                        accessibilityLabel={`${label} people`}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
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

                {shouldOfferCalendarSave(occasion, !!whoForFriendId) && (
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

            {stepKey === 'options' && (
              <>
                <Text style={styles.label}>Nearby found these options</Text>
                {optionsLoading && <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />}
                {!optionsLoading && optionsResult && (
                  <>
                    {optionsResult.experience ? (
                      <>
                        {optionsResult.experience.bundles.length > 0 && (
                          <View style={{ marginBottom: spacing.md }}>
                            <Text style={styles.sublabel}>✨ One place has it all</Text>
                            {optionsResult.experience.bundles.map((item) => renderOptionCard(item))}
                          </View>
                        )}
                        {optionsResult.experience.components.map((comp) => (
                          <View key={comp.key} style={{ marginBottom: spacing.md }}>
                            <Text style={styles.sublabel}>{comp.label}</Text>
                            {comp.items.map((item) => renderOptionCard(item))}
                          </View>
                        ))}
                      </>
                    ) : optionsResult.items.some((i) => i.type === 'business_availability') ? (
                      <View style={{ marginBottom: spacing.md }}>
                        <Text style={styles.sublabel}>🍽️ Nearby options</Text>
                        {optionsResult.items
                          .filter((i) => i.type === 'business_availability')
                          .slice(0, 5)
                          .map((item) => renderOptionCard(item))}
                      </View>
                    ) : (
                      <Text style={styles.helperText}>
                        Nothing live nearby right now — no worries, you can still post a request and businesses will respond.
                      </Text>
                    )}
                  </>
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
              </>
            )}

            <View style={styles.navRow}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={goBack}
                activeOpacity={0.85}
                accessibilityLabel={step === 0 ? 'Cancel' : 'Back'}
                accessibilityRole="button"
                disabled={submittingOptions}
              >
                <Text style={styles.backButtonText}>{step === 0 ? 'Cancel' : 'Back'}</Text>
              </TouchableOpacity>
              {stepKey === 'options' ? (
                <TouchableOpacity
                  style={[styles.nextButton, (selectedIds.size === 0 || submittingOptions) && styles.nextButtonDisabled]}
                  onPress={submitSelectedBusinessRequests}
                  activeOpacity={0.85}
                  disabled={selectedIds.size === 0 || submittingOptions}
                  accessibilityLabel={`Ask These Businesses (${selectedIds.size})`}
                  accessibilityRole="button"
                >
                  <Text style={styles.nextButtonText}>
                    {submittingOptions ? 'Sending…' : `Ask These Businesses (${selectedIds.size}) →`}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.nextButton}
                  onPress={goNext}
                  activeOpacity={0.85}
                  accessibilityLabel={finalStep ? "Let's Plan It" : 'Next'}
                  accessibilityRole="button"
                >
                  <Text style={styles.nextButtonText}>{finalStep ? "Let's Plan It →" : 'Next'}</Text>
                </TouchableOpacity>
              )}
            </View>
            {stepKey === 'options' && !optionsLoading && (
              <TouchableOpacity
                style={styles.skipRow}
                onPress={proceedToDestination}
                activeOpacity={0.7}
                disabled={submittingOptions}
                accessibilityLabel="Skip, I'll ask myself"
                accessibilityRole="button"
              >
                <Text style={styles.skipRowText}>Skip — I'll post a general request myself →</Text>
              </TouchableOpacity>
            )}
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
  optionCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.xs,
  },
  optionCardSelected: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  optionTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  optionSubtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  optionHint: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  navRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  backButton: {
    paddingVertical: 16, paddingHorizontal: spacing.lg, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  backButtonText: { color: colors.textSecondary, fontWeight: '700', fontSize: 15 },
  nextButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', ...shadow.button },
  nextButtonDisabled: { opacity: 0.5 },
  nextButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  skipRow: { alignItems: 'center', paddingVertical: spacing.md },
  skipRowText: { color: colors.textTertiary, fontSize: 13, fontWeight: '600' },
});
