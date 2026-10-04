import React, { useState, useEffect } from 'react';
import useFormDraft from '../hooks/useFormDraft';
import DraftBanner from '../components/DraftBanner';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Platform, ScrollView, Keyboard, TouchableWithoutFeedback, ActivityIndicator, Image } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { createGathering } from '../services/gatherings';
import { recordBehaviorEvent } from '../services/behaviorSignals';
import { linkOccasionToPlan } from '../services/occasions';
import { linkOccasionGroupPlanToPlan } from '../services/occasionGroupPlans';
import { getMyCommunities } from '../services/communities';
import AgeRangePicker from '../components/AgeRangePicker';
import { cleanAgeRange } from '../utils/suitedAges';
import { FORMAT_OPTIONS, formatIcon } from '../constants/activityFormat';
import { skillContext, skillOptionsFor, cleanSkillLevel } from '../constants/skillLevel';
import { EFFORT_OPTIONS } from '../constants/intensityEffort';
import { EQUIPMENT_OPTIONS, DURATION_OPTIONS, GENRE_OPTIONS, GATHERING_FEATURE_OPTIONS, cleanFeatures, toggleFeature, isMusicTag } from '../utils/gatheringPractical';
import { searchNearbyPlaces, priceLevelLabel } from '../services/places';
import { checkTextModeration } from '../services/textModeration';
import { categoryStyleFor, CATEGORY_BUTTON_TEXT_COLOR } from '../constants/gatheringCategoryStyles';
import { curatedCoverPhotoFor } from '../constants/gatheringCoverPhotos';
import { CATEGORY_GROUPS, groupForTag } from '../constants/gatheringCategories';
import FriendInviteSelector, { selectedFriendIdList, selectionFromSuggested } from '../components/FriendInviteSelector';
import { sendGatheringInvites } from '../services/invites';
import { whatStepProblem, canSkipWhatStep, startAfterWhatStep, capacityForPartySize } from '../utils/gatheringStructure';
import useMyInterests from '../hooks/useMyInterests';
import { orderGroupsByInterests } from '../constants/interestGraph';
import { VISIBILITY_OPTIONS } from '../constants/gatheringVisibility';
import { WHEN_PRESETS, dateForPreset } from '../utils/whenPresets';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { displayDateTime } from '../i18n/display';
import { typography, spacing, radius } from '../theme';

import { NLoader } from '../motion';
import { getUserLocation } from '../services/userLocation';
import useCategoryNames from '../hooks/useCategoryNames';
// Real Free/$/$$/$$$ chip labels for the new Price field -- mirrors the
// visual convention services/places.js's own priceLevelLabel() already
// established for Google Places results, without reusing that function
// directly (it expects a Google 0-4 integer; this is a genuinely
// different, host-declared enum shape).
const PRICE_OPTIONS = [
  { key: null, labelKey: 'ui.gatheringOptions.notSpecified' },
  { key: 'free', labelKey: 'ui.gatheringOptions.free' },
  { key: '$', symbol: '$' },
  { key: '$$', symbol: '$$' },
  { key: '$$$', symbol: '$$$' },
];

// "Who's this for?" -- a real, host-declared field, deliberately not
// derived/guessed from group_size_feel or capacity (both measure
// something different -- a felt vibe, and a hard cap -- and fabricating
// this label from either would misrepresent real data). See CLAUDE.md's
// "Category/filter taxonomy pass" section.
// "What kind of plan is this?" (owner item 54): the same `party_type` column and vocabulary as everywhere else, worded as the KIND of
// plan. Networking is the existing `coworkers` value and a casual hangout is `friends` (one value each, no second list); a plan is one
// kind, so this stays single-select. Not specified stays the default.
// Item 187: the only rows the "From what you said" summary shows, in this order.
const SUMMARY_LAYERS = ['activity', 'purpose', 'time', 'people'];

const PARTY_TYPE_OPTIONS = [null, 'friends', 'date', 'family', 'coworkers', 'new_people', 'groups', 'solo'].map((key) => ({
  key, labelKey: key ? `ui.gatheringOptions.kind.${key}` : 'ui.gatheringOptions.notSpecified',
}));

// Capacity buckets match the original mockup language. "10+" doesn't map to
// a single hard number on its own, but a real waitlist needs one to
// enforce — so picking it reveals a plain stepper (default 15, editable)
// rather than leaving the cap ambiguous. See CLAUDE.md's "Outstanding:
// Capacity / Waitlist" section for the full design discussion.
// Capacity = TOTAL people including the host (migration 20270209): "2-4 people" stores 4 and holds 4 people, not 4 guests + host.
const CAPACITY_OPTIONS = [
  { key: 'no_limit' },
  { key: '2-4', capacity: 4 },
  { key: '5-10', capacity: 10 },
  { key: '10+' },
];


// Real venue category mapping — every interest tag belongs to exactly one
// of the 15 CATEGORY_GROUPS (gatheringCategories.js), and placeCategories.js
// maps that same group key straight to a real Google Places type, so this
// just resolves the tag's own group rather than re-deriving one from a
// separate hand-maintained keyword list.
function googlePlaceCategoryFor(interestTag) {
  return groupForTag(interestTag)?.key ?? 'food_drink';
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

function walkTimeLabel(miles, t) {
  const minutes = Math.max(1, Math.round(miles * 20));
  return t('ui.gatheringForm.walk', { min: minutes });
}
// Chip label for an option: a translation key, a price symbol, or (practical/format/skill/effort lists) its stored key.
const optionText = (t, ns, o) => (o.key === null || o.key === undefined ? t('ui.gatheringOptions.notSpecified') : t(`ui.gatheringOptions.${ns}.${o.key}`));
const equipmentText = (t, o) => (o.key === null ? t('ui.gatheringOptions.notSpecified') : t(o.key ? 'ui.gatheringOptions.equipment.provided' : 'ui.gatheringOptions.equipment.byo'));
const priceText = (t, o) => o.symbol ?? t(o.labelKey);
const formatText = (t, o) => (o.key === null ? t('ui.gatheringOptions.notSpecified') : `${formatIcon(o.key)} ${t(`ui.gatheringOptions.format.${o.key}`)}`);

// The conversational, one-decision-per-screen rebuild ("Create 2.0") —
// What (skippable via fromQuickPick) → When → Where → Anything people should know?
// (+ More options) → Settings (visibility, who can join, capacity, business requests, guest invites,
// notifications: the same controls Edit shows under "Gathering settings") → Publish.
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
  const names = useCategoryNames(); // category / occasion names shown in the person's language (display only)
  const { colors, shadow, isDark } = useTheme();
  const { t, language } = useLanguage();
  const myInterests = useMyInterests();
  const styles = getStyles(colors, shadow);

  const skipWhat = canSkipWhatStep(route.params);
  // Item 109: "Who do you want to invite?" comes right after When, only when the ask said who it is with (quickStartInvite,
  // set by createParamsFromAsk). Ordinary gatherings keep the same steps as before.
  // Celebrate Something's own suggested friends (explicit, organizer-picked) also open the step and start checked.
  const suggestedInviteeIds = Array.isArray(route.params?.suggestedInviteeIds) ? route.params.suggestedInviteeIds : [];
  const askInvite = route.params?.quickStartInvite === true || suggestedInviteeIds.length > 0;
  const STEP_DEFS = [
    { key: 'what', label: t('ui.gatheringForm.step.what') },
    { key: 'when', label: t('ui.gatheringForm.step.when') },
    ...(askInvite ? [{ key: 'invite', label: t('ui.gatheringForm.step.invite') }] : []),
    { key: 'where', label: t('ui.gatheringForm.step.where') },
    { key: 'details', label: t('ui.gatheringForm.step.details') },
    { key: 'settings', label: t('ui.gatheringForm.step.settings') },
    { key: 'publish', label: t('ui.gatheringForm.step.publish') },
  ].filter((s) => !(s.key === 'what' && skipWhat));

  const [step, setStep] = useState(() => (startAfterWhatStep(route.params) ? 1 : 0));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [interestTag, setInterestTag] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [visibility, setVisibility] = useState('everyone');
  const [discoverable, setDiscoverable] = useState(true);
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

  // "Start a Weekly Meetup" (CreateHubScreen's own "build something bigger"
  // section) deep-links here with quickStartRecurring instead of the usual
  // quickStartTitle/quickStartCategory -- title/category are still unknown,
  // so the "What" step isn't skipped, but "Repeats: Weekly" is pre-selected
  // AND the "More options" section that holds it is pre-expanded so the
  // user actually sees the real, editable state they're about to publish
  // rather than a choice silently sitting collapsed out of view.
  const [showMoreOptions, setShowMoreOptions] = useState(() => !!route.params?.quickStartRecurring);
  const [showOnMap, setShowOnMap] = useState(true);
  const [womenOnly, setWomenOnly] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState(() => (route.params?.quickStartRecurring ? 'weekly' : null));
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
  const [equipmentProvided, setEquipmentProvided] = useState(null);
  const [features, setFeatures] = useState([]);
  const [ageMin, setAgeMin] = useState(null);
  const [ageMax, setAgeMax] = useState(null);
  const [durationMinutes, setDurationMinutes] = useState(null);
  const [genre, setGenre] = useState(null);
  const [format, setFormat] = useState(null);
  const [effortLevel, setEffortLevel] = useState(null);
  const [skillLevel, setSkillLevel] = useState(null);
  const [partyType, setPartyType] = useState(null);
  const [showGroupInsights, setShowGroupInsights] = useState(true);
  const [allowAttendeeInvites, setAllowAttendeeInvites] = useState(true);
  const [hostNotifications, setHostNotifications] = useState(true);
  const [requiresApproval, setRequiresApproval] = useState(false);
  // Friends picked on the invite step ({ [friendId]: true }); sent only after the gathering is published.
  const [inviteIds, setInviteIds] = useState(() => selectionFromSuggested(suggestedInviteeIds));

  // Item 82: an unfinished gathering survives a failed publish, leaving the screen and an app restart.
  const gatheringSnapshot = {
    step, title, description, interestTag, visibility, discoverable, communityId,
    scheduledAt: scheduledAt instanceof Date ? scheduledAt.toISOString() : null, whenPreset,
    locationMode, customLocation, placeName, showOnMap, womenOnly, recurrenceRule, capacityOption, capacityCustom,
    askLocalBusinesses, priceLevel, partyType, showGroupInsights, allowAttendeeInvites, hostNotifications, requiresApproval, inviteIds, equipmentProvided, durationMinutes, genre, format, skillLevel, effortLevel, features, ageMin, ageMax,
  };
  const gatheringDraft = useFormDraft('gathering', gatheringSnapshot, {
    isEmpty: (d) => !String(d.title ?? '').trim() && !String(d.description ?? '').trim(),
    enabled: !route.params?.quickStartTitle && !route.params?.quickStartCategory,
  });
  function applyGatheringDraft(d) {
    setStep(Number.isInteger(d.step) ? d.step : 0);
    setTitle(d.title ?? ''); setDescription(d.description ?? ''); setInterestTag(d.interestTag ?? null);
    setVisibility(d.visibility ?? 'everyone'); setDiscoverable(d.discoverable !== false); setCommunityId(d.communityId ?? null);
    const when = d.scheduledAt ? new Date(d.scheduledAt) : null;
    if (when && when.getTime() > Date.now()) { setScheduledAt(when); setWhenPreset(d.whenPreset ?? null); }
    setLocationMode(d.locationMode ?? 'near_me'); setCustomLocation(d.customLocation ?? null); setPlaceName(d.placeName ?? null);
    setShowOnMap(d.showOnMap !== false); setWomenOnly(!!d.womenOnly); setRecurrenceRule(d.recurrenceRule ?? null);
    setCapacityOption(d.capacityOption ?? 'no_limit'); setCapacityCustom(d.capacityCustom ?? 15);
    setAskLocalBusinesses(!!d.askLocalBusinesses); setPriceLevel(d.priceLevel ?? null); setEquipmentProvided(d.equipmentProvided ?? null); setDurationMinutes(d.durationMinutes ?? null); setGenre(d.genre ?? null); setFormat(d.format ?? null); setSkillLevel(d.skillLevel ?? null); setEffortLevel(d.effortLevel ?? null); setFeatures(cleanFeatures(d.features)); setAgeMin(cleanAgeRange(d.ageMin, d.ageMax).min); setAgeMax(cleanAgeRange(d.ageMin, d.ageMax).max); setPartyType(d.partyType ?? null);
    setShowGroupInsights(d.showGroupInsights !== false); setAllowAttendeeInvites(d.allowAttendeeInvites !== false);
    setHostNotifications(d.hostNotifications !== false); setRequiresApproval(!!d.requiresApproval);
    setInviteIds(d.inviteIds && typeof d.inviteIds === 'object' ? d.inviteIds : {});
  }

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

  // Item 61: "Coffee tonight with some friends" -> Who: Friends, prefilled on the Details step and fully editable.
  useEffect(() => {
    const pt = route.params?.quickStartPartyType;
    if (pt && PARTY_TYPE_OPTIONS.some((o) => o.key === pt)) setPartyType(pt);
  }, [route.params?.quickStartPartyType]);
  const inferredRows = Array.isArray(route.params?.inferredSummary) ? route.params.inferredSummary : [];
  // Item 187: the summary describes the plan in the person's language; stored values (the canonical tag, party type, preset)
  // are only looked up for display, never renamed. A row from an older build with another layer is not shown.
  const summaryValue = (r) => {
    if (r.layer === 'activity') return names.tag(r.key ?? r.value);
    if (r.layer === 'purpose' && r.key) return t(`ui.gatheringOptions.kind.${r.key}`);
    if (r.layer === 'time' && r.key) return t(`ui.gatheringOptions.when.${r.key}`);
    return r.value;
  };
  const [inferredDismissed, setInferredDismissed] = useState(false);

  // "Planning for 4?": a headcount from the person's own words, suggested (visible + editable) rather than committed.
  const [suggestedPartySize, setSuggestedPartySize] = useState(null);
  useEffect(() => {
    const cap = capacityForPartySize(route.params?.quickStartPartySize);
    if (!cap) return;
    setCapacityOption(cap.option);
    setCapacityCustom(cap.custom);
    setSuggestedPartySize(cap.size);
  }, [route.params?.quickStartPartySize]);

  // Item 61 ("Celebrate Something", CLAUDE.md): the first caller of
  // quickStartTitle that also already knows a real When answer (the
  // wizard's own deterministic WHEN_PRESETS step) -- mirrors
  // quickStartTitle's own prefill-then-fully-editable pattern exactly,
  // never auto-submits. 'custom' carries a real picked ISO date/time
  // (quickStartWhenISO); every other preset is recomputed via
  // dateForPreset() same as a normal in-screen tap would.
  useEffect(() => {
    if (route.params?.quickStartWhenPreset) {
      const preset = route.params.quickStartWhenPreset;
      setWhenPreset(preset);
      if (preset === 'custom' && route.params?.quickStartWhenISO) {
        setScheduledAt(new Date(route.params.quickStartWhenISO));
      } else {
        setScheduledAt(dateForPreset(preset));
      }
    }
  }, [route.params?.quickStartWhenPreset, route.params?.quickStartWhenISO]);

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
    // Scheduling a new gathering under a paused/cancelled community makes
    // no sense -- getMyCommunities() is member-scoped so RLS won't filter
    // this for us the way it does for public discovery.
    setMyCommunities(list.filter((c) => c.status === 'active'));
    setLoadingCommunities(false);
  }

  async function loadPopularPlaces() {
    if (popularPlaces !== null || loadingPlaces) return;
    setLoadingPlaces(true);
    try {
      let loc = myLocation;
      if (!loc) {
        const position = await getUserLocation();
        if (!position) {
          setPopularPlaces([]);
          setLoadingPlaces(false);
          return;
        }
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
    if (key !== 'everyone') setDiscoverable(true); // Link only exists only for Everyone
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
    if (stepKey === 'what') {
      const problem = whatStepProblem({ title, interestTag });
      if (problem === 'title') return Alert.alert(t('ui.gatheringForm.alert.titleRequired'), t('ui.gatheringForm.alert.titleRequiredBody'));
      // Item 64: the category is structured input everything downstream reads (business requests, recommendations,
      // weather, demand), so it is asked for here rather than guessed later from the title.
      if (problem === 'category') return Alert.alert(t('ui.gatheringForm.alert.pickActivity'), t('ui.gatheringForm.alert.pickCategoryBody'));
    }
    if (stepKey === 'settings' && visibility === 'community' && !communityId) {
      if (!loadingCommunities && myCommunities.length === 0) {
        return Alert.alert(t('ui.gatheringForm.alert.noCommunities'), t('ui.gatheringForm.alert.noCommunitiesBody'));
      }
      return Alert.alert(t('ui.gatheringForm.alert.pickCommunity'), t('ui.gatheringForm.alert.pickCommunityBody'));
    }
    if (stepKey === 'when' && (!whenPreset || scheduledAt.getTime() <= Date.now())) {
      return Alert.alert(t('ui.gatheringForm.alert.pickTime'), t('ui.gatheringForm.alert.pickTimeBody'));
    }
    if (stepKey === 'where' && locationMode === 'choose_place' && !customLocation) {
      return Alert.alert(t('ui.gatheringForm.alert.pickPlace'), t('ui.gatheringForm.alert.pickPlaceBody'));
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
      return Alert.alert(t('ui.gatheringForm.alert.titleNotAllowed'), t('ui.gatheringForm.alert.reviseBody'));
    }
    if (description.trim()) {
      const descCheck = await checkTextModeration(description);
      if (!descCheck.safe) {
        return Alert.alert(t('ui.gatheringForm.alert.descNotAllowed'), t('ui.gatheringForm.alert.reviseDescBody'));
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
        discoverable: visibility === 'everyone' ? discoverable : true,
        communityId: visibility === 'community' ? communityId : null,
        capacity: capacityValue,
        askLocalBusinesses,
        priceLevel,
        equipmentProvided,
        features,
        suitedAgeMin: ageMin,
        suitedAgeMax: ageMax,
        durationMinutes,
        genre: isMusicTag(interestTag) ? genre : null,
        format,
        skillLevel: cleanSkillLevel(skillLevel, skillContext({ tag: interestTag, format })),
        // Effort is asked only where skill is (activities, sports, classes); elsewhere it is not saved.
        effortLevel: skillOptionsFor(skillContext({ tag: interestTag, format })) ? effortLevel : null,
        partyType,
        showGroupInsights,
        requiresApproval: visibility !== 'invite_only' && requiresApproval,
        allowAttendeeInvites,
        hostNotifications,
        // The typed ask this was explicitly created from ("Create it yourself"), else nothing. Recording only.
        submissionId: route.params?.quickStartSubmissionId ?? null,
      });
      gatheringDraft.clear();
      recordBehaviorEvent('create', 'gathering', created.id, interestTag);
      // Item 109: only now that the gathering exists; a failed send never undoes it (the count shows on the next screen).
      const preInviteResult = await sendGatheringInvites(created.id, selectedFriendIdList(inviteIds));

      // Checking the box only stores real consent/intent on the
      // gathering itself (ask_local_businesses) -- it deliberately does
      // NOT fire a business request here. There are zero real attendees
      // at this exact moment, so any request created now would carry a
      // fabricated party_size of 1 and permanently lock the gathering to
      // it (the RPC's own duplicate guard). The real request is created
      // later, once real gathering state exists, from
      // GatheringDetailScreen's own "Ready to see what's available?"
      // banner. See createGathering()'s own comment in gatherings.js.

      // "Occasion architecture should not be a silo" (CLAUDE.md): only
      // present when CelebrateSomethingScreen sent us here -- best-effort,
      // never blocks the real navigation below on failure.
      if (route.params?.linkOccasionGroupPlanId) {
        linkOccasionGroupPlanToPlan({ groupPlanId: route.params.linkOccasionGroupPlanId, resultingGatheringId: created.id }).catch(() => {});
      }
      if (route.params?.linkOccasionId) {
        linkOccasionToPlan({ occasionId: route.params.linkOccasionId, resultingGatheringId: created.id }).catch(() => {});
      }

      navigation.replace('GatheringConfirmation', {
        gatheringId: created.id,
        placeName,
        businessesAsked: askLocalBusinesses,
        preInviteResult,
      });
    } catch (e) {
      presentRecoverableError(Alert, { what: 'create your gathering', error: e, draftKept: true, onRetry: () => submit() });
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

        {gatheringDraft.draft && (
          <DraftBanner
            what="gathering"
            savedAt={gatheringDraft.draft.savedAt}
            onContinue={() => gatheringDraft.restore(applyGatheringDraft)}
            onDiscard={gatheringDraft.discard}
          />
        )}

        <View style={styles.progressRow} accessibilityLabel={t('ui.gatheringForm.stepA11y', { n: step + 1, total: STEP_DEFS.length, label: STEP_DEFS[step].label })}>
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
              accessibilityLabel={t('ui.gatheringForm.titleA11y')}
            />

            <Text style={styles.label}>{t('ui.gatheringForm.activityLabel')}</Text>
            {orderGroupsByInterests(CATEGORY_GROUPS, myInterests).map((group) => (
              <View key={group.key} style={{ marginBottom: spacing.sm }}>
                <Text style={styles.subLabel}>{group.icon} {names.group(group.key, group.label)}</Text>
                <View style={styles.chipsWrap}>
                  {group.tags.map((option) => {
                    const style = categoryStyleFor(option);
                    const isSelected = interestTag === option;
                    const photoUrl = curatedCoverPhotoFor(option);
                    return (
                      <TouchableOpacity
                        key={option}
                        style={[
                          styles.chip,
                          // Every category chip, not just the selected one,
                          // carries its own real category tint -- a "coffee"
                          // chip should never sit blank white just because
                          // it isn't picked yet.
                          !isSelected && { backgroundColor: `${style.color}20`, borderColor: `${style.color}40` },
                          isSelected && { backgroundColor: style.color, borderColor: style.color },
                        ]}
                        onPress={() => setInterestTag(interestTag === option ? null : option)}
                        activeOpacity={0.85}
                        accessibilityLabel={t('ui.gatheringForm.activityA11y', { name: names.tag(option) })}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                      >
                        {/* Real curated category photo (same map used for
                            gathering cover-photo fallbacks) as a small
                            swatch in place of the emoji, when one's been
                            sourced for this category -- a pill chip has no
                            room for a full photo background, but it should
                            still show a real picture, not just a tint. */}
                        {photoUrl ? <Image source={{ uri: photoUrl }} style={styles.chipPhoto} /> : null}
                        {/* Aug 30 2026 -- a scoped override, not a change
                            to the shared chipTextSelected style: that
                            style is also used by 4 other chip pickers on
                            this screen whose selected background is the
                            real brand colors.primary (fully saturated,
                            not affected), not this category palette
                            (deliberately low-saturation, measured
                            2.03-3.19:1 white-on-color contrast -- below
                            the WCAG floor). See gatheringCategoryStyles.js's
                            own CATEGORY_BUTTON_TEXT_COLOR comment. */}
                        <Text style={[styles.chipText, isSelected && styles.chipTextSelected, isSelected && { color: CATEGORY_BUTTON_TEXT_COLOR }]}>{photoUrl ? '' : `${style.icon} `}{names.tag(option)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </>
        )}

        {stepKey === 'when' && inferredRows.length > 0 && !inferredDismissed && (
          <View style={{ marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }} accessibilityLabel={t('ui.gatheringForm.fromWhatYouSaid')}>
            <Text style={[styles.label, { marginTop: 0 }]}>{t('ui.gatheringForm.fromWhatYouSaid')}</Text>
            {inferredRows.filter((r) => SUMMARY_LAYERS.includes(r.layer)).map((r) => (
              <Text key={r.layer} style={{ color: colors.text, marginTop: 2 }}>
                <Text style={{ color: colors.textSecondary }}>{t(`ui.gatheringForm.summary.${r.layer}`)}: </Text>{summaryValue(r)}
              </Text>
            ))}
            <Text style={{ color: colors.textSecondary, marginTop: spacing.xs }}>
              {whenPreset ? t('ui.gatheringForm.checkTimeThenPlace') : t('ui.gatheringForm.pickTimeThenPlace')} {t('ui.gatheringForm.changeOnStepActivity')}
            </Text>
            <TouchableOpacity onPress={() => setInferredDismissed(true)} accessibilityRole="button" accessibilityLabel={t('ui.gatheringForm.hideSummaryA11y')} style={{ marginTop: spacing.xs, alignSelf: 'flex-start' }}>
              <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>{t('ui.gatheringForm.hide')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {stepKey === 'when' && (
          <>
            <Text style={styles.label}>{t('ui.gatheringForm.whenQ')}</Text>
            <View style={styles.chipsWrap}>
              {WHEN_PRESETS.map((p) => {
                const selected = whenPreset === p.key;
                return (
                  <TouchableOpacity
                    key={p.key}
                    style={[styles.presetButton, selected && styles.presetButtonActive]}
                    onPress={() => pickPreset(p.key)}
                    activeOpacity={0.85}
                    accessibilityLabel={t(`ui.gatheringOptions.when.${p.key}`)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={styles.presetIcon}>{p.icon}</Text>
                    <Text style={[styles.presetLabel, selected && styles.presetLabelActive]}>{t(`ui.gatheringOptions.when.${p.key}`)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {whenPreset && (
              <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.whenResultRow} accessibilityLabel={t('ui.gatheringForm.adjustA11y')} accessibilityRole="button">
                <Text style={styles.whenResultText}>
                  {displayDateTime(scheduledAt, language)}
                </Text>
                <Text style={styles.whenAdjustLink}>{t('ui.gatheringForm.adjust')}</Text>
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

        {stepKey === 'invite' && (
          <>
            <Text style={styles.label}>{t('ui.gatheringForm.inviteQ')}</Text>
            <Text style={styles.helperText}>{t('ui.gatheringForm.inviteHelp')}</Text>
            {suggestedInviteeIds.length > 0 && (
              <Text style={styles.helperText}>
                {route.params?.suggestedInviteeLabel ? t('ui.gatheringForm.suggestedCheckedWith', { label: route.params.suggestedInviteeLabel }) : t('ui.gatheringForm.suggestedChecked')}
              </Text>
            )}
            <FriendInviteSelector selectedIds={inviteIds} onChange={setInviteIds} navigation={navigation} suggestedIds={suggestedInviteeIds} />
          </>
        )}

        {stepKey === 'where' && (
          <>
            <Text style={styles.label}>{t('ui.gatheringForm.whereQ')}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
              <TouchableOpacity
                style={[styles.publicToggle, locationMode === 'near_me' && styles.publicToggleActive]}
                onPress={() => pickLocationMode('near_me')}
                activeOpacity={0.85}
                accessibilityLabel={t('ui.gatheringForm.nearMeA11y')}
                accessibilityRole="button"
                accessibilityState={{ selected: locationMode === 'near_me' }}
              >
                <Text style={[styles.publicToggleText, locationMode === 'near_me' && styles.publicToggleTextActive]}>{t('ui.gatheringForm.nearMe')}</Text>
                <Text style={[styles.publicToggleHint, locationMode === 'near_me' && styles.publicToggleHintActive]}>{t('ui.gatheringForm.currentLocation')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.publicToggle, locationMode === 'choose_place' && styles.publicToggleActive]}
                onPress={() => pickLocationMode('choose_place')}
                activeOpacity={0.85}
                accessibilityLabel={t('ui.gatheringForm.choosePlaceA11y')}
                accessibilityRole="button"
                accessibilityState={{ selected: locationMode === 'choose_place' }}
              >
                <Text style={[styles.publicToggleText, locationMode === 'choose_place' && styles.publicToggleTextActive]}>{t('ui.gatheringForm.choosePlace')}</Text>
                <Text style={[styles.publicToggleHint, locationMode === 'choose_place' && styles.publicToggleHintActive]}>{t('ui.gatheringForm.choosePlaceHint')}</Text>
              </TouchableOpacity>
            </View>

            {locationMode === 'choose_place' && (
              <View>
                <Text style={styles.subLabel}>{t('ui.gatheringForm.popularNearby')}</Text>
                {loadingPlaces ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <NLoader fullScreen={false} size="inline" kind="places" />
                  </View>
                ) : (popularPlaces ?? []).length === 0 ? (
                  <Text style={styles.helperText}>{t('ui.gatheringForm.noPlaces')}</Text>
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
                              miles !== null ? walkTimeLabel(miles, t) : place.address,
                              place.rating !== null ? `⭐ ${place.rating}` : null,
                              priceLevelLabel(place.priceLevel),
                              place.openNow !== null ? (place.openNow ? t('ui.gatheringForm.openNow') : t('ui.gatheringForm.closed')) : null,
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
                  accessibilityLabel={t('ui.gatheringForm.dropPinA11y')}
                  accessibilityRole="button"
                >
                  <Text style={styles.mapPinLink}>{t('ui.gatheringForm.dropPin')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {stepKey === 'details' && (
          <>
            <Text style={styles.label}>{t('ui.gatheringForm.detailsQ')}</Text>
            <TextInput
              style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
              placeholder={t('gatherings.descriptionPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              value={description}
              onChangeText={setDescription}
              multiline
              accessibilityLabel={t('ui.gatheringForm.descriptionA11y')}
            />

            <TouchableOpacity
              onPress={() => setShowMoreOptions((v) => !v)}
              style={styles.moreOptionsToggle}
              accessibilityLabel={showMoreOptions ? t('ui.gatheringForm.hideMoreA11y') : t('ui.gatheringForm.showMoreA11y')}
              accessibilityRole="button"
            >
              <Text style={styles.moreOptionsToggleText}>{showMoreOptions ? '▾' : '▸'} {t('ui.gatheringForm.moreOptions')}</Text>
            </TouchableOpacity>

            {showMoreOptions && (
              <>
                <Text style={styles.label}>{t('ui.gatheringForm.repeats')}</Text>
                <View style={styles.chipsWrap}>
                  {[null, 'weekly', 'biweekly', 'monthly'].map((key) => ({ key, label: t(`ui.gatheringOptions.repeat.${key ?? 'none'}`) })).map((option) => {
                    const selected = recurrenceRule === option.key;
                    return (
                      <TouchableOpacity
                        key={option.label}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setRecurrenceRule(option.key)}
                        activeOpacity={0.85}
                        accessibilityLabel={option.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.label}>{t('ui.gatheringForm.price')}</Text>
                <View style={styles.chipsWrap}>
                  {PRICE_OPTIONS.map((o) => ({ ...o, label: priceText(t, o) })).map((option) => {
                    const selected = priceLevel === option.key;
                    return (
                      <TouchableOpacity
                        key={option.label}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setPriceLevel(option.key); }}
                        activeOpacity={0.85}
                        accessibilityLabel={option.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.label}>{t('ui.gatheringForm.features')}</Text>
                <View style={styles.chipsWrap}>
                  {GATHERING_FEATURE_OPTIONS.map((o) => ({ ...o, label: optionText(t, 'feature', o) })).map((option) => {
                    const selected = features.includes(option.key);
                    return (
                      <TouchableOpacity
                        key={option.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setFeatures((cur) => toggleFeature(cur, option.key)); }}
                        activeOpacity={0.85}
                        accessibilityLabel={option.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.icon} {option.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <AgeRangePicker min={ageMin} max={ageMax} onChange={(a, b) => { setAgeMin(a); setAgeMax(b); }} />

                <Text style={styles.label}>{t('ui.gatheringForm.equipment')}</Text>
                <View style={styles.chipsWrap}>
                  {EQUIPMENT_OPTIONS.map((o) => ({ ...o, label: equipmentText(t, o) })).map((option) => {
                    const selected = equipmentProvided === option.key;
                    return (
                      <TouchableOpacity
                        key={option.label}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setEquipmentProvided(option.key); }}
                        activeOpacity={0.85}
                        accessibilityLabel={option.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.label}>{t('ui.gatheringForm.howLong')}</Text>
                <View style={styles.chipsWrap}>
                  {DURATION_OPTIONS.map((o) => ({ ...o, label: optionText(t, 'duration', o) })).map((option) => {
                    const selected = durationMinutes === option.key;
                    return (
                      <TouchableOpacity
                        key={option.label}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setDurationMinutes(option.key); }}
                        activeOpacity={0.85}
                        accessibilityLabel={option.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {isMusicTag(interestTag) && (
                  <>
                    <Text style={styles.label}>{t('ui.gatheringForm.genre')}</Text>
                    <View style={styles.chipsWrap}>
                      {GENRE_OPTIONS.map((o) => ({ ...o, label: optionText(t, 'genre', o) })).map((option) => {
                        const selected = genre === option.key;
                        return (
                          <TouchableOpacity key={option.label} style={[styles.chip, selected && styles.chipSelected]} onPress={() => { Haptics.selectionAsync(); setGenre(option.key); }} activeOpacity={0.85} accessibilityLabel={option.label} accessibilityRole="button" accessibilityState={{ selected }}>
                            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                  </>
                )}
                <Text style={styles.label}>{t('ui.gatheringForm.formatQ')}</Text>
                <View style={styles.chipsWrap}>
                  {FORMAT_OPTIONS.map((o) => ({ ...o, label: formatText(t, o) })).map((option) => {
                    const selected = format === option.key;
                    return (
                      <TouchableOpacity key={option.label} style={[styles.chip, selected && styles.chipSelected]} onPress={() => { Haptics.selectionAsync(); setFormat(option.key); }} activeOpacity={0.85} accessibilityLabel={option.label} accessibilityRole="button" accessibilityState={{ selected }}>
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {skillOptionsFor(skillContext({ tag: interestTag, format })) && (
                  <>
                    <Text style={styles.label}>{t('ui.gatheringForm.skill')}</Text>
                    <View style={styles.chipsWrap}>
                      {skillOptionsFor(skillContext({ tag: interestTag, format })).map((o) => ({ ...o, label: optionText(t, 'skill', o) })).map((option) => {
                        const selected = skillLevel === option.key;
                        return (
                          <TouchableOpacity key={option.label} style={[styles.chip, selected && styles.chipSelected]} onPress={() => { Haptics.selectionAsync(); setSkillLevel(option.key); }} activeOpacity={0.85} accessibilityLabel={t('ui.gatheringForm.skillA11y', { level: option.label })} accessibilityRole="button" accessibilityState={{ selected }}>
                            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}
                {skillOptionsFor(skillContext({ tag: interestTag, format })) && (
                  <>
                    <Text style={styles.label}>{t('ui.gatheringForm.effort')}</Text>
                    <View style={styles.chipsWrap}>
                      {EFFORT_OPTIONS.map((o) => ({ ...o, label: optionText(t, 'effort', o) })).map((option) => {
                        const selected = effortLevel === option.key;
                        return (
                          <TouchableOpacity key={option.label} style={[styles.chip, selected && styles.chipSelected]} onPress={() => { Haptics.selectionAsync(); setEffortLevel(option.key); }} activeOpacity={0.85} accessibilityLabel={t('ui.gatheringForm.effortA11y', { level: option.label })} accessibilityRole="button" accessibilityState={{ selected }}>
                            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}
                <Text style={styles.label}>{t('ui.gatheringForm.kindQ')}</Text>
                <View style={styles.chipsWrap}>
                  {PARTY_TYPE_OPTIONS.map((o) => ({ ...o, label: t(o.labelKey) })).map((option) => {
                    const selected = partyType === option.key;
                    return (
                      <TouchableOpacity
                        key={option.label}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setPartyType(option.key); }}
                        activeOpacity={0.85}
                        accessibilityLabel={option.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity
                  style={styles.womenOnlyToggle}
                  onPress={() => { Haptics.selectionAsync(); setShowGroupInsights((v) => !v); }}
                  activeOpacity={0.85}
                  accessibilityLabel={showGroupInsights ? t('ui.gatheringForm.insightsOnA11y') : t('ui.gatheringForm.insightsOffA11y')}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: showGroupInsights }}
                >
                  <Text style={styles.womenOnlyToggleText}>{showGroupInsights ? '✓ ' : ''}{t('ui.gatheringForm.insights')}</Text>
                </TouchableOpacity>
                <Text style={styles.helperText}>
                  {t('ui.gatheringForm.insightsHelp')}
                </Text>
              </>
            )}
          </>
        )}

        {stepKey === 'settings' && (
          <>
            <Text style={styles.label}>{t('ui.gatheringForm.visibility')}</Text>
            {VISIBILITY_OPTIONS.map((o) => ({ ...o, label: t(`ui.gatheringVocab.visibility.${o.key}.label`), hint: t(`ui.gatheringVocab.visibility.${o.key}.hint`) })).map((opt) => {
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
                <NLoader fullScreen={false} size="inline" caption={t('ui.gatheringForm.loadingCommunities')} />
              ) : myCommunities.length === 0 ? (
                <Text style={styles.helperText}>{t('ui.gatheringForm.noCommunityYet')}</Text>
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

            {visibility === 'everyone' && (
              <>
                <Text style={[styles.label, { marginTop: spacing.lg }]}>{t('ui.gatheringForm.findQ')}</Text>
                {[
                  { key: true, title: t('ui.gatheringForm.discoverable'), hint: t('ui.gatheringForm.discoverableHint') },
                  { key: false, title: t('ui.gatheringForm.linkOnly'), hint: t('ui.gatheringForm.linkOnlyHint') },
                ].map((opt) => {
                  const selected = discoverable === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.title}
                      style={[styles.optionCard, selected && styles.optionCardActive]}
                      onPress={() => { Haptics.selectionAsync(); setDiscoverable(opt.key); }}
                      activeOpacity={0.85}
                      accessibilityLabel={`${opt.title} — ${opt.hint}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.optionCardTitle, selected && styles.optionCardTitleActive]}>{opt.title}</Text>
                        <Text style={styles.optionCardHint}>{opt.hint}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}

            {visibility !== 'invite_only' && (
              <>
                <Text style={[styles.label, { marginTop: spacing.lg }]}>{t('ui.gatheringForm.joinQ')}</Text>
                {[
                  { key: false, title: t('ui.gatheringForm.anyone'), hint: t('ui.gatheringForm.anyoneHint') },
                  { key: true, title: t('ui.gatheringForm.approval'), hint: t('ui.gatheringForm.approvalHint') },
                ].map((opt) => {
                  const selected = requiresApproval === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.title}
                      style={[styles.optionCard, selected && styles.optionCardActive]}
                      onPress={() => { Haptics.selectionAsync(); setRequiresApproval(opt.key); }}
                      activeOpacity={0.85}
                      accessibilityLabel={`${opt.title} — ${opt.hint}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.optionCardTitle, selected && styles.optionCardTitleActive]}>{opt.title}</Text>
                        <Text style={styles.optionCardHint}>{opt.hint}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}

            <Text style={[styles.label, { marginTop: spacing.lg }]}>{t('ui.gatheringForm.capacity')}</Text>
                {suggestedPartySize ? <Text style={styles.helperText}>{t('ui.gatheringForm.planningFor', { count: suggestedPartySize })}</Text> : null}
                <View style={styles.chipsWrap}>
                  {CAPACITY_OPTIONS.map((o) => ({ ...o, label: t(`ui.gatheringOptions.capacity.${o.key}`) })).map((option) => {
                    const selected = capacityOption === option.key;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setCapacityOption(option.key); }}
                        activeOpacity={0.85}
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
                      accessibilityLabel={t('ui.gatheringForm.decreaseA11y')}
                      accessibilityRole="button"
                    >
                      <Text style={styles.stepperButtonText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.stepperValue}>{t('ui.common.count.people', { count: capacityCustom })}</Text>
                    <TouchableOpacity
                      onPress={() => { Haptics.selectionAsync(); setCapacityCustom((n) => n + 1); }}
                      style={styles.stepperButton}
                      accessibilityLabel={t('ui.gatheringForm.increaseA11y')}
                      accessibilityRole="button"
                    >
                      <Text style={styles.stepperButtonText}>+</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {capacityOption !== 'no_limit' && (
                  <Text style={styles.helperText}>{t('ui.gatheringForm.capacityHelp')}</Text>
                )}


            <Text style={[styles.label, { marginTop: spacing.lg }]}>{t('ui.gatheringForm.businessRequests')}</Text>
                <TouchableOpacity
                  style={styles.womenOnlyToggle}
                  onPress={() => { Haptics.selectionAsync(); setAskLocalBusinesses((v) => !v); }}
                  activeOpacity={0.85}
                  accessibilityLabel={askLocalBusinesses ? t('ui.gatheringForm.askBizOnA11y') : t('ui.gatheringForm.askBizOffA11y')}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: askLocalBusinesses }}
                >
                  <Text style={styles.womenOnlyToggleText}>{askLocalBusinesses ? '✓ ' : ''}{t('ui.gatheringForm.askBiz')}</Text>
                </TouchableOpacity>
                <Text style={styles.helperText}>
                  {t('ui.gatheringForm.askBizHelp')}
                </Text>


                <TouchableOpacity
                  style={styles.womenOnlyToggle}
                  onPress={() => { Haptics.selectionAsync(); setWomenOnly(!womenOnly); }}
                  activeOpacity={0.85}
                  accessibilityLabel={womenOnly ? t('ui.gatheringForm.womenOnlyOnA11y') : t('ui.gatheringForm.womenOnlyOffA11y')}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: womenOnly }}
                >
                  <Text style={styles.womenOnlyToggleText}>{womenOnly ? '✓ ' : ''}{t('ui.gatheringForm.womenOnly')}</Text>
                </TouchableOpacity>

                {visibility === 'invite_only' && (
                  <>
                    <Text style={styles.label}>{t('ui.gatheringForm.mapVisibility')}</Text>
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }}>
                      <TouchableOpacity
                        style={[styles.publicToggle, showOnMap && styles.publicToggleActive]}
                        onPress={() => { Haptics.selectionAsync(); setShowOnMap(true); }}
                        activeOpacity={0.85}
                        accessibilityLabel={t('ui.gatheringForm.onMapA11y')}
                        accessibilityRole="button"
                        accessibilityState={{ selected: showOnMap }}
                      >
                        <Text style={[styles.publicToggleText, showOnMap && styles.publicToggleTextActive]}>{t('ui.gatheringForm.onMap')}</Text>
                        <Text style={[styles.publicToggleHint, showOnMap && styles.publicToggleHintActive]}>{t('ui.gatheringForm.onMapHint')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.publicToggle, !showOnMap && styles.publicToggleActive]}
                        onPress={() => { Haptics.selectionAsync(); setShowOnMap(false); }}
                        activeOpacity={0.85}
                        accessibilityLabel={t('ui.gatheringForm.offMapA11y')}
                        accessibilityRole="button"
                        accessibilityState={{ selected: !showOnMap }}
                      >
                        <Text style={[styles.publicToggleText, !showOnMap && styles.publicToggleTextActive]}>{t('ui.gatheringForm.offMap')}</Text>
                        <Text style={[styles.publicToggleHint, !showOnMap && styles.publicToggleHintActive]}>{t('ui.gatheringForm.offMapHint')}</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}


            <Text style={[styles.label, { marginTop: spacing.lg }]}>{t('ui.gatheringForm.invitesNotif')}</Text>
            <TouchableOpacity
              style={styles.womenOnlyToggle}
              onPress={() => { Haptics.selectionAsync(); setAllowAttendeeInvites((v) => !v); }}
              activeOpacity={0.85}
              accessibilityLabel={allowAttendeeInvites ? t('ui.gatheringForm.guestsInviteOnA11y') : t('ui.gatheringForm.guestsInviteOffA11y')}
              accessibilityRole="switch"
              accessibilityState={{ checked: allowAttendeeInvites }}
            >
              <Text style={styles.womenOnlyToggleText}>{allowAttendeeInvites ? '✓ ' : ''}{t('ui.gatheringForm.guestsInvite')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.womenOnlyToggle}
              onPress={() => { Haptics.selectionAsync(); setHostNotifications((v) => !v); }}
              activeOpacity={0.85}
              accessibilityLabel={hostNotifications ? t('ui.gatheringForm.notifyOnA11y') : t('ui.gatheringForm.notifyOffA11y')}
              accessibilityRole="switch"
              accessibilityState={{ checked: hostNotifications }}
            >
              <Text style={styles.womenOnlyToggleText}>{hostNotifications ? '✓ ' : ''}{t('ui.gatheringForm.notify')}</Text>
            </TouchableOpacity>
          </>
        )}

        {stepKey === 'publish' && (
          <View style={styles.previewCard}>
            <View style={styles.previewHeaderRow}>
              <Text style={styles.previewIcon}>{selectedStyle ? selectedStyle.icon : '🎉'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle}>{title || t('ui.gatheringForm.preview.untitled')}</Text>
                {interestTag ? <Text style={styles.previewMeta}>{names.tag(interestTag)}</Text> : null}
              </View>
            </View>
            {description ? <Text style={styles.previewDescription}>{description}</Text> : null}
            <View style={styles.previewRow}>
              <Text style={styles.previewRowIcon}>🗓️</Text>
              <Text style={styles.previewRowText}>
                {displayDateTime(scheduledAt, language)}
                {recurrenceRule ? t(`ui.gatheringForm.preview.repeats.${recurrenceRule}`) : ''}
              </Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewRowIcon}>📍</Text>
              <Text style={styles.previewRowText}>{placeName ? placeName : customLocation ? t('ui.gatheringForm.preview.customLocation') : t('ui.gatheringForm.currentLocation')}</Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewRowIcon}>{selectedVisibility?.icon}</Text>
              <Text style={styles.previewRowText}>
                {selectedVisibility ? t(`ui.gatheringVocab.visibility.${selectedVisibility.key}.label`) : null}{visibility === 'community' && selectedCommunity ? ` — ${selectedCommunity.name}` : ''}
                {visibility === 'invite_only' && !showOnMap ? t('ui.gatheringForm.preview.hiddenFromMap') : ''}
              </Text>
            </View>
            {womenOnly && (
              <View style={styles.previewRow}>
                <Text style={styles.previewRowIcon}>♀️</Text>
                <Text style={styles.previewRowText}>{t('ui.gatheringForm.preview.womenOnly')}</Text>
              </View>
            )}
            {capacityValue != null && (
              <View style={styles.previewRow}>
                <Text style={styles.previewRowIcon}>👥</Text>
                <Text style={styles.previewRowText}>{t('ui.gatheringForm.preview.upTo', { people: t('ui.common.count.people', { count: capacityValue }) })}</Text>
              </View>
            )}
            {selectedFriendIdList(inviteIds).length > 0 && (
              <View style={styles.previewRow}>
                <Text style={styles.previewRowIcon}>🤝</Text>
                <Text style={styles.previewRowText}>{t('ui.gatheringForm.preview.invites', { friends: t('ui.common.count.friends', { count: selectedFriendIdList(inviteIds).length }) })}</Text>
              </View>
            )}
            {askLocalBusinesses && (
              <View style={styles.previewRow}>
                <Text style={styles.previewRowIcon}>🍽️</Text>
                <Text style={styles.previewRowText}>{t('ui.gatheringForm.preview.business')}</Text>
              </View>
            )}
            {!showGroupInsights && (
              <View style={styles.previewRow}>
                <Text style={styles.previewRowIcon}>🙈</Text>
                <Text style={styles.previewRowText}>{t('ui.gatheringForm.preview.insightsHidden')}</Text>
              </View>
            )}
            {priceLevel && (
              <View style={styles.previewRow}>
                <Text style={styles.previewRowIcon}>💵</Text>
                <Text style={styles.previewRowText}>{priceText(t, PRICE_OPTIONS.find((o) => o.key === priceLevel))}</Text>
              </View>
            )}
            {partyType && (
              <View style={styles.previewRow}>
                <Text style={styles.previewRowIcon}>🙋</Text>
                <Text style={styles.previewRowText}>{t(PARTY_TYPE_OPTIONS.find((o) => o.key === partyType).labelKey)}</Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.navRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={goBack}
            activeOpacity={0.85}
            accessibilityLabel={step === 0 ? t('ui.common.cancel') : t('ui.gatheringForm.back')}
            accessibilityRole="button"
          >
            <Text style={styles.backButtonText}>{step === 0 ? t('ui.common.cancel') : t('ui.gatheringForm.back')}</Text>
          </TouchableOpacity>
          {step < STEP_DEFS.length - 1 ? (
            <TouchableOpacity
              style={[styles.nextButton, selectedStyle && { backgroundColor: selectedStyle.color }]}
              onPress={goNext}
              activeOpacity={0.85}
              accessibilityLabel={t('ui.common.next')}
              accessibilityRole="button"
            >
              <Text style={styles.nextButtonText}>{t('ui.common.next')}</Text>
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
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipPhoto: { width: 18, height: 18, borderRadius: 9 },
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
