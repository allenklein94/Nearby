import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Platform, ScrollView, Keyboard, TouchableWithoutFeedback, ActivityIndicator } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { createGathering } from '../services/gatherings';
import { getMyCommunities } from '../services/communities';
import { searchNearbyPlaces, priceLevelLabel } from '../services/places';
import { checkTextModeration } from '../services/textModeration';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { WHEN_PRESETS, dateForPreset } from '../utils/whenPresets';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

// Real Free/$/$$/$$$ chip labels for the new Price field -- mirrors the
// visual convention services/places.js's own priceLevelLabel() already
// established for Google Places results, without reusing that function
// directly (it expects a Google 0-4 integer; this is a genuinely
// different, host-declared enum shape).
const PRICE_OPTIONS = [
  { key: null, label: 'Not specified' },
  { key: 'free', label: 'Free' },
  { key: '$', label: '$' },
  { key: '$$', label: '$$' },
  { key: '$$$', label: '$$$' },
];

// "Who's this for?" -- a real, host-declared field, deliberately not
// derived/guessed from group_size_feel or capacity (both measure
// something different -- a felt vibe, and a hard cap -- and fabricating
// this label from either would misrepresent real data). See CLAUDE.md's
// "Category/filter taxonomy pass" section.
const PARTY_TYPE_OPTIONS = [
  { key: null, label: 'Not specified' },
  { key: 'solo', label: '🧍 Solo-Friendly' },
  { key: 'friends', label: '👥 Bring Friends' },
  { key: 'groups', label: '👨‍👩‍👧‍👦 Big Group' },
  { key: 'date', label: '💕 A Date Idea' },
];

const VISIBILITY_OPTIONS = [
  { key: 'everyone', icon: '🌍', label: 'Everyone', hint: 'Anyone nearby can discover this' },
  { key: 'friends', icon: '👥', label: 'Friends', hint: 'Only your friends can find this' },
  { key: 'community', icon: '🏘', label: 'Community', hint: 'Only members of one of your communities' },
  { key: 'invite_only', icon: '🔒', label: 'Invite Only', hint: "Only people you personally invite — you'll approve each person" },
];

// Capacity buckets match the original mockup language. "10+" doesn't map to
// a single hard number on its own, but a real waitlist needs one to
// enforce — so picking it reveals a plain stepper (default 15, editable)
// rather than leaving the cap ambiguous. See CLAUDE.md's "Outstanding:
// Capacity / Waitlist" section for the full design discussion.
const CAPACITY_OPTIONS = [
  { key: 'no_limit', label: 'No Limit' },
  { key: '2-4', label: '2-4 people', capacity: 4 },
  { key: '5-10', label: '5-10 people', capacity: 10 },
  { key: '10+', label: '10+ people' },
];


// Real venue category mapping — same PLACE_CATEGORIES key set
// DiscoverHubScreen's Places filter already uses (coffee/restaurants/
// parks/hubs), since that's what searchNearbyPlaces (Google Places)
// actually accepts. A gathering category with no obvious match falls
// back to "hubs" rather than guessing.
function googlePlaceCategoryFor(interestTag) {
  if (interestTag === 'Coffee') return 'coffee';
  if (['Foodie', 'Wine', 'Cooking'].includes(interestTag)) return 'restaurants';
  if (['Outdoors', 'Hiking', 'Running', 'Yoga', 'Sports'].includes(interestTag)) return 'parks';
  return 'hubs';
}

// Plain equirectangular approximation, not a Distance Matrix API call —
// same convention already established for the Unified Map's business
// layer (services/brandOffers.js's getNearbyBusinesses) and plenty
// accurate at walking-distance scale.
function approxMiles(lat1, lng1, lat2, lng2) {
  const milesPerDegreeLat = 69;
  const dLat = (lat2 - lat1) * milesPerDegreeLat;
  const dLng = (lng2 - lng1) * milesPerDegreeLat * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function walkTimeLabel(miles) {
  const minutes = Math.max(1, Math.round(miles * 20));
  return `${minutes} min walk`;
}

// The conversational, one-decision-per-screen rebuild ("Create 2.0") —
// What (skippable via fromQuickPick) → Who should discover this? → When
// → Where → Anything people should know? (+ More options) → Publish.
// Same route, same createGathering() call, every existing caller
// (StartSomethingModal, CreateHubScreen's grid, the Create Assistant)
// keeps working unmodified. See CLAUDE.md's "Create 2.0" section for
// the full design discussion and what was deliberately deferred (a true
// skip-location state, AI-picked date/time). Capacity/waitlist, also
// originally deferred there, was built later — see CLAUDE.md's
// "Outstanding: Capacity / Waitlist" section — and lives in "More
// options" below (optional, defaults to No Limit, matching every
// pre-existing gathering's real behavior).
export default function CreateGatheringScreen({ navigation, route }) {
  const { colors, shadow, isDark } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors, shadow);

  const skipWhat = !!route.params?.fromQuickPick && !!route.params?.quickStartTitle;
  const STEP_DEFS = [
    { key: 'what', label: 'What' },
    { key: 'who', label: 'Who' },
    { key: 'when', label: 'When' },
    { key: 'where', label: 'Where' },
    { key: 'details', label: 'Details' },
    { key: 'publish', label: 'Publish' },
  ].filter((s) => !(s.key === 'what' && skipWhat));

  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [interestTag, setInterestTag] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [visibility, setVisibility] = useState('everyone');
  const [communityId, setCommunityId] = useState(null);
  const [myCommunities, setMyCommunities] = useState([]);
  const [loadingCommunities, setLoadingCommunities] = useState(false);

  const [scheduledAt, setScheduledAt] = useState(new Date(Date.now() + 60 * 60 * 1000));
  const [whenPreset, setWhenPreset] = useState(null);
  const [showPicker, setShowPicker] = useState(false);

  const [locationMode, setLocationMode] = useState('near_me');
  const [customLocation, setCustomLocation] = useState(null);
  const [placeName, setPlaceName] = useState(null);
  const [myLocation, setMyLocation] = useState(null);
  const [popularPlaces, setPopularPlaces] = useState(null);
  const [loadingPlaces, setLoadingPlaces] = useState(false);

  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [showOnMap, setShowOnMap] = useState(true);
  const [womenOnly, setWomenOnly] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState(null);
  const [capacityOption, setCapacityOption] = useState('no_limit');
  const [capacityCustom, setCapacityCustom] = useState(15);
  // CLAUDE.md, Aug 23-24 2026 locked decision: an explicit, unticked-by-
  // default opt-in -- checking it means "make this gathering eligible for
  // business matching," not "contact businesses immediately." The actual
  // fan-out still runs through the exact same create_business_request_for_gathering()
  // RPC the existing post-creation "Ask Local Businesses" link already
  // uses -- this is an earlier consent point onto the same real mechanism,
  // not a second one.
  const [askLocalBusinesses, setAskLocalBusinesses] = useState(false);
  const [priceLevel, setPriceLevel] = useState(null);
  const [partyType, setPartyType] = useState(null);

  useEffect(() => {
    if (route.params?.selectedLat && route.params?.selectedLng) {
      setCustomLocation({ latitude: route.params.selectedLat, longitude: route.params.selectedLng });
      setPlaceName(null);
      setLocationMode('choose_place');
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

  // Reached from a specific CommunityDetailScreen's "Host a Gathering" entry
  // point — carries that community's context into the same one Create flow
  // instead of making the user re-pick it on the Who step.
  useEffect(() => {
    if (route.params?.initialVisibility) {
      setVisibility(route.params.initialVisibility);
      if (route.params.initialVisibility === 'community') {
        loadCommunities();
      }
    }
    if (route.params?.initialCommunityId) {
      setCommunityId(route.params.initialCommunityId);
    }
  }, [route.params?.initialVisibility, route.params?.initialCommunityId]);

  async function loadCommunities() {
    if (myCommunities.length > 0 || loadingCommunities) return;
    setLoadingCommunities(true);
    const list = await getMyCommunities();
    setMyCommunities(list);
    setLoadingCommunities(false);
  }

  async function loadPopularPlaces() {
    if (popularPlaces !== null || loadingPlaces) return;
    setLoadingPlaces(true);
    try {
      let loc = myLocation;
      if (!loc) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setPopularPlaces([]);
          setLoadingPlaces(false);
          return;
        }
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        loc = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setMyLocation(loc);
      }
      const places = await searchNearbyPlaces(loc.latitude, loc.longitude, googlePlaceCategoryFor(interestTag));
      setPopularPlaces(places.slice(0, 8));
    } catch (e) {
      setPopularPlaces([]);
    }
    setLoadingPlaces(false);
  }

  function pickPreset(preset) {
    Haptics.selectionAsync();
    setWhenPreset(preset);
    if (preset === 'custom') {
      setShowPicker(true);
      return;
    }
    setScheduledAt(dateForPreset(preset));
  }

  function pickVisibility(key) {
    Haptics.selectionAsync();
    setVisibility(key);
    if (key === 'community') loadCommunities();
  }

  function pickLocationMode(mode) {
    Haptics.selectionAsync();
    setLocationMode(mode);
    if (mode === 'choose_place') loadPopularPlaces();
    else {
      setCustomLocation(null);
      setPlaceName(null);
    }
  }

  function pickPlace(place) {
    Haptics.selectionAsync();
    setCustomLocation({ latitude: place.latitude, longitude: place.longitude });
    setPlaceName(place.name);
  }

  const stepKey = STEP_DEFS[step].key;

  const capacityValue = capacityOption === 'no_limit'
    ? null
    : capacityOption === '10+'
      ? Math.max(10, capacityCustom)
      : CAPACITY_OPTIONS.find((c) => c.key === capacityOption)?.capacity ?? null;

  function goNext() {
    if (stepKey === 'what' && !title.trim()) {
      return Alert.alert('Title required', 'Give your gathering a short title.');
    }
    if (stepKey === 'who' && visibility === 'community' && !communityId) {
      if (!loadingCommunities && myCommunities.length === 0) {
        return Alert.alert('No communities yet', "You're not a member of any community yet — pick a different option, or join a community first.");
      }
      return Alert.alert('Pick a community', 'Choose which community can discover this gathering.');
    }
    if (stepKey === 'when' && (!whenPreset || scheduledAt.getTime() <= Date.now())) {
      return Alert.alert('Pick a time', "Your gathering's date and time needs to be in the future.");
    }
    if (stepKey === 'where' && locationMode === 'choose_place' && !customLocation) {
      return Alert.alert('Pick a place', 'Choose a suggested spot, or switch to "Near Me".');
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
      const isPublic = visibility !== 'invite_only';
      const created = await createGathering({
        title: title.trim(),
        description: description.trim() || null,
        interestTag,
        scheduledAt: scheduledAt.toISOString(),
        isPublic,
        customLocation,
        showOnMap: isPublic ? true : showOnMap,
        womenOnly,
        recurrenceRule: recurrenceRule || null,
        visibility,
        communityId: visibility === 'community' ? communityId : null,
        capacity: capacityValue,
        askLocalBusinesses,
        priceLevel,
        partyType,
      });

      // Checking the box only stores real consent/intent on the
      // gathering itself (ask_local_businesses) -- it deliberately does
      // NOT fire a business request here. There are zero real attendees
      // at this exact moment, so any request created now would carry a
      // fabricated party_size of 1 and permanently lock the gathering to
      // it (the RPC's own duplicate guard). The real request is created
      // later, once real gathering state exists, from
      // GatheringDetailScreen's own "Ready to see what's available?"
      // banner. See createGathering()'s own comment in gatherings.js.
      navigation.replace('GatheringConfirmation', { gatheringId: created.id, placeName, businessesAsked: askLocalBusinesses });
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSubmitting(false);
  }

  const selectedStyle = interestTag ? categoryStyleFor(interestTag) : null;
  const selectedVisibility = VISIBILITY_OPTIONS.find((v) => v.key === visibility);
  const selectedCommunity = myCommunities.find((c) => c.id === communityId);

  return (
    <SafeAreaView style={styles.container}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
        <Text style={styles.header} accessibilityRole="header">{t('gatherings.createHeader')}</Text>
        <Text style={styles.subheader}>{t('gatherings.createSubheader')}</Text>

        <View style={styles.progressRow} accessibilityLabel={`Step ${step + 1} of ${STEP_DEFS.length}: ${STEP_DEFS[step].label}`}>
          {STEP_DEFS.map((s, i) => (
            <View key={s.key} style={styles.progressStep}>
              <View style={[styles.progressDot, i <= step && styles.progressDotActive]} />
              <Text style={[styles.progressLabel, i === step && styles.progressLabelActive]}>{s.label}</Text>
            </View>
          ))}
        </View>

        {stepKey === 'what' && (
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

            <Text style={styles.label}>{t('gatherings.categoryLabel')}</Text>
            {CATEGORY_GROUPS.map((group) => (
              <View key={group.key} style={{ marginBottom: spacing.sm }}>
                <Text style={styles.subLabel}>{group.icon} {group.label}</Text>
                <View style={styles.chipsWrap}>
                  {group.tags.map((option) => {
                    const style = categoryStyleFor(option);
                    const isSelected = interestTag === option;
                    return (
                      <TouchableOpacity
                        key={option}
                        style={[styles.chip, isSelected && { backgroundColor: style.color, borderColor: style.color }]}
                        onPress={() => setInterestTag(interestTag === option ? null : option)}
                        activeOpacity={0.8}
                        accessibilityLabel={`Category: ${option}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                      >
                        <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{style.icon} {option}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </>
        )}

        {stepKey === 'who' && (
          <>
            <Text style={styles.label}>Who should discover this?</Text>
            {VISIBILITY_OPTIONS.map((opt) => {
              const selected = visibility === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.optionCard, selected && styles.optionCardActive]}
                  onPress={() => pickVisibility(opt.key)}
                  activeOpacity={0.85}
                  accessibilityLabel={`${opt.label} — ${opt.hint}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={styles.optionCardIcon}>{opt.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optionCardTitle, selected && styles.optionCardTitleActive]}>{opt.label}</Text>
                    <Text style={styles.optionCardHint}>{opt.hint}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}

            {visibility === 'community' && (
              loadingCommunities ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
              ) : myCommunities.length === 0 ? (
                <Text style={styles.helperText}>You're not a member of any community yet.</Text>
              ) : (
                <View style={{ marginTop: spacing.sm }}>
                  {myCommunities.map((c) => {
                    const selected = communityId === c.id;
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.communityRow, selected && styles.optionCardActive]}
                        onPress={() => { Haptics.selectionAsync(); setCommunityId(c.id); }}
                        activeOpacity={0.85}
                        accessibilityLabel={c.name}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.communityRowText, selected && styles.optionCardTitleActive]}>{c.name}</Text>
                        {selected && <Text style={styles.checkmark}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )
            )}
          </>
        )}

        {stepKey === 'when' && (
          <>
            <Text style={styles.label}>When?</Text>
            <View style={styles.chipsWrap}>
              {WHEN_PRESETS.map((p) => {
                const selected = whenPreset === p.key;
                return (
                  <TouchableOpacity
                    key={p.key}
                    style={[styles.presetButton, selected && styles.presetButtonActive]}
                    onPress={() => pickPreset(p.key)}
                    activeOpacity={0.85}
                    accessibilityLabel={p.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={styles.presetIcon}>{p.icon}</Text>
                    <Text style={[styles.presetLabel, selected && styles.presetLabelActive]}>{p.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {whenPreset && (
              <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.whenResultRow} accessibilityLabel="Adjust the exact time" accessibilityRole="button">
                <Text style={styles.whenResultText}>
                  {scheduledAt.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </Text>
                <Text style={styles.whenAdjustLink}>✏️ Adjust</Text>
              </TouchableOpacity>
            )}
            {showPicker && (
              <DateTimePicker
                value={scheduledAt}
                mode="datetime"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                themeVariant={isDark ? 'dark' : 'light'}
                minimumDate={new Date()}
                onChange={(event, selectedDate) => {
                  setShowPicker(Platform.OS === 'ios');
                  if (selectedDate) {
                    setScheduledAt(selectedDate);
                    setWhenPreset('custom');
                  }
                }}
              />
            )}
          </>
        )}

        {stepKey === 'where' && (
          <>
            <Text style={styles.label}>Where?</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
              <TouchableOpacity
                style={[styles.publicToggle, locationMode === 'near_me' && styles.publicToggleActive]}
                onPress={() => pickLocationMode('near_me')}
                activeOpacity={0.85}
                accessibilityLabel="Near Me — use your current location"
                accessibilityRole="button"
                accessibilityState={{ selected: locationMode === 'near_me' }}
              >
                <Text style={[styles.publicToggleText, locationMode === 'near_me' && styles.publicToggleTextActive]}>📍 Near Me</Text>
                <Text style={[styles.publicToggleHint, locationMode === 'near_me' && styles.publicToggleHintActive]}>Your current location</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.publicToggle, locationMode === 'choose_place' && styles.publicToggleActive]}
                onPress={() => pickLocationMode('choose_place')}
                activeOpacity={0.85}
                accessibilityLabel="Choose a Place — pick a real nearby venue"
                accessibilityRole="button"
                accessibilityState={{ selected: locationMode === 'choose_place' }}
              >
                <Text style={[styles.publicToggleText, locationMode === 'choose_place' && styles.publicToggleTextActive]}>🔍 Choose a Place</Text>
                <Text style={[styles.publicToggleHint, locationMode === 'choose_place' && styles.publicToggleHintActive]}>Pick a real spot nearby</Text>
              </TouchableOpacity>
            </View>

            {locationMode === 'choose_place' && (
              <View>
                <Text style={styles.subLabel}>Popular Nearby</Text>
                {loadingPlaces ? (
                  <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.sm }} />
                ) : (popularPlaces ?? []).length === 0 ? (
                  <Text style={styles.helperText}>No nearby places found — try "Near Me" instead, or drop a pin below.</Text>
                ) : (
                  popularPlaces.map((place) => {
                    const selected = placeName === place.name && customLocation?.latitude === place.latitude;
                    const miles = myLocation ? approxMiles(myLocation.latitude, myLocation.longitude, place.latitude, place.longitude) : null;
                    return (
                      <TouchableOpacity
                        key={place.placeId}
                        style={[styles.placeRow, selected && styles.optionCardActive]}
                        onPress={() => pickPlace(place)}
                        activeOpacity={0.85}
                        accessibilityLabel={place.name}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.placeRowTitle, selected && styles.optionCardTitleActive]}>{place.name}</Text>
                          <Text style={styles.placeRowSub}>
                            {[
                              miles !== null ? walkTimeLabel(miles) : place.address,
                              place.rating !== null ? `⭐ ${place.rating}` : null,
                              priceLevelLabel(place.priceLevel),
                              place.openNow !== null ? (place.openNow ? 'Open now' : 'Closed') : null,
                            ].filter(Boolean).join('  ·  ')}
                          </Text>
                        </View>
                        {selected && <Text style={styles.checkmark}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })
                )}
                <TouchableOpacity
                  onPress={() => navigation.navigate('SelectGatheringLocation', {
                    initialLat: customLocation?.latitude,
                    initialLng: customLocation?.longitude,
                  })}
                  style={{ marginTop: spacing.sm }}
                  accessibilityLabel="Drop a pin on the map instead"
                  accessibilityRole="button"
                >
                  <Text style={styles.mapPinLink}>📍 Or drop a pin on the map</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {stepKey === 'details' && (
          <>
            <Text style={styles.label}>Anything people should know?</Text>
            <TextInput
              style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
              placeholder={t('gatherings.descriptionPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              value={description}
              onChangeText={setDescription}
              multiline
              accessibilityLabel="Gathering description, optional"
            />

            <TouchableOpacity
              onPress={() => setShowMoreOptions((v) => !v)}
              style={styles.moreOptionsToggle}
              accessibilityLabel={showMoreOptions ? 'Hide more options' : 'Show more options'}
              accessibilityRole="button"
            >
              <Text style={styles.moreOptionsToggleText}>{showMoreOptions ? '▾' : '▸'} More options</Text>
            </TouchableOpacity>

            {showMoreOptions && (
              <>
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

                <Text style={styles.label}>How many people?</Text>
                <View style={styles.chipsWrap}>
                  {CAPACITY_OPTIONS.map((option) => {
                    const selected = capacityOption === option.key;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setCapacityOption(option.key); }}
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
                {capacityOption === '10+' && (
                  <View style={styles.stepperRow}>
                    <TouchableOpacity
                      onPress={() => { Haptics.selectionAsync(); setCapacityCustom((n) => Math.max(10, n - 1)); }}
                      style={styles.stepperButton}
                      accessibilityLabel="Decrease capacity"
                      accessibilityRole="button"
                    >
                      <Text style={styles.stepperButtonText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.stepperValue}>{capacityCustom} people</Text>
                    <TouchableOpacity
                      onPress={() => { Haptics.selectionAsync(); setCapacityCustom((n) => n + 1); }}
                      style={styles.stepperButton}
                      accessibilityLabel="Increase capacity"
                      accessibilityRole="button"
                    >
                      <Text style={styles.stepperButtonText}>+</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {capacityOption !== 'no_limit' && (
                  <Text style={styles.helperText}>Once full, new joins go to a waitlist — if a spot opens, the next person in line is added automatically.</Text>
                )}

                <Text style={styles.label}>Price</Text>
                <View style={styles.chipsWrap}>
                  {PRICE_OPTIONS.map((option) => {
                    const selected = priceLevel === option.key;
                    return (
                      <TouchableOpacity
                        key={option.label}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setPriceLevel(option.key); }}
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

                <Text style={styles.label}>Who's this for?</Text>
                <View style={styles.chipsWrap}>
                  {PARTY_TYPE_OPTIONS.map((option) => {
                    const selected = partyType === option.key;
                    return (
                      <TouchableOpacity
                        key={option.label}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setPartyType(option.key); }}
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

                {visibility === 'invite_only' && (
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

                <TouchableOpacity
                  style={styles.womenOnlyToggle}
                  onPress={() => { Haptics.selectionAsync(); setAskLocalBusinesses((v) => !v); }}
                  activeOpacity={0.85}
                  accessibilityLabel={askLocalBusinesses ? 'Ask local businesses about this gathering, tap to turn off' : "Let relevant local businesses know about this gathering, so they can potentially offer options"}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: askLocalBusinesses }}
                >
                  <Text style={styles.womenOnlyToggleText}>{askLocalBusinesses ? '✓ ' : ''}Ask Local Businesses</Text>
                </TouchableOpacity>
                <Text style={styles.helperText}>
                  Let relevant local businesses know about this gathering so they can potentially offer options — never contacted on your behalf beyond that.
                </Text>
              </>
            )}
          </>
        )}

        {stepKey === 'publish' && (
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
              <Text style={styles.previewRowText}>{placeName ? placeName : customLocation ? 'Custom location set' : 'Your current location'}</Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewRowIcon}>{selectedVisibility?.icon}</Text>
              <Text style={styles.previewRowText}>
                {selectedVisibility?.label}{visibility === 'community' && selectedCommunity ? ` — ${selectedCommunity.name}` : ''}
                {visibility === 'invite_only' ? `${!showOnMap ? ', hidden from map' : ''}` : ''}
              </Text>
            </View>
            {womenOnly && (
              <View style={styles.previewRow}>
                <Text style={styles.previewRowIcon}>♀️</Text>
                <Text style={styles.previewRowText}>Women-only gathering</Text>
              </View>
            )}
            {capacityValue != null && (
              <View style={styles.previewRow}>
                <Text style={styles.previewRowIcon}>👥</Text>
                <Text style={styles.previewRowText}>Up to {capacityValue} people — waitlist after that</Text>
              </View>
            )}
            {askLocalBusinesses && (
              <View style={styles.previewRow}>
                <Text style={styles.previewRowIcon}>🍽️</Text>
                <Text style={styles.previewRowText}>We'll look for local business options once your gathering has real attendees</Text>
              </View>
            )}
            {priceLevel && (
              <View style={styles.previewRow}>
                <Text style={styles.previewRowIcon}>💵</Text>
                <Text style={styles.previewRowText}>{PRICE_OPTIONS.find((o) => o.key === priceLevel)?.label}</Text>
              </View>
            )}
            {partyType && (
              <View style={styles.previewRow}>
                <Text style={styles.previewRowIcon}>🙋</Text>
                <Text style={styles.previewRowText}>{PARTY_TYPE_OPTIONS.find((o) => o.key === partyType)?.label}</Text>
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
          {step < STEP_DEFS.length - 1 ? (
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
  subLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.sm, fontSize: 12 },
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
  optionCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  optionCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  optionCardIcon: { fontSize: 24, marginRight: spacing.md },
  optionCardTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  optionCardTitleActive: { color: colors.primary },
  optionCardHint: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  communityRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.xs,
  },
  communityRowText: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
  checkmark: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  presetButton: {
    width: '48%', flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  presetButtonActive: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  presetIcon: { fontSize: 18, marginRight: spacing.xs },
  presetLabel: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  presetLabelActive: { color: colors.primary },
  whenResultRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  whenResultText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  whenAdjustLink: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  placeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.xs,
  },
  placeRowTitle: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
  placeRowSub: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  mapPinLink: { color: colors.primary, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  moreOptionsToggle: { marginTop: spacing.md, marginBottom: spacing.xs },
  moreOptionsToggleText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  stepperButton: {
    width: 36, height: 36, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  stepperButtonText: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  stepperValue: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
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
