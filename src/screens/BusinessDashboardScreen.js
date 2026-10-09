import BusinessAIAutomationPanel from '../components/BusinessAIAutomationPanel';
import { windowPhrase } from '../utils/timeWindow';
import { useLanguage } from '../context/LanguageContext';
import { activityHints } from '../constants/activityLayer';
import { canRespondToOpportunity } from '../utils/objectLifecycle';
import { presentRecoverableError } from '../utils/recoverableError';
import EmptyCopy from '../components/EmptyCopy';
import { displayAgo, displayClock, displayDateTime, displayDay } from '../i18n/display';
import { bizWindowPhrase } from '../i18n/bizFormat';
import { attributeLabel, experienceOptionLabel } from '../i18n/optionLabels';
import { cuisineName } from '../i18n/businessProfileDisplay';
import { categoryName } from '../i18n/categoryNames';
import DraftBanner from '../components/DraftBanner';
import AgeRangePicker from '../components/AgeRangePicker';
import SettingConflictNotice from '../components/SettingConflictNotice';
import { useSettingConflicts } from '../hooks/useSettingConflicts';
import { conflictMessages, hasPending, shownValue } from '../utils/settingConflicts';
import OfferCustomerBody from '../components/OfferCustomerBody';
import { offerFunnelView } from '../utils/offerFunnel';
import { heardYourRequest, businessReplyStatus } from '../utils/offerCopy';
import { replySentConfirmation, offerQueuedConfirmation } from '../utils/actionConfirmations';
import useFormDraft from '../hooks/useFormDraft';
import { serializableAsset, assetStillExists } from '../services/formDrafts';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, Modal, TextInput, Alert, Switch, Keyboard, TouchableWithoutFeedback, KeyboardAvoidingView, Platform, Share, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PlatformDateTimeInput from '../components/PlatformDateTimeInput';
import BusinessHoursEditor from '../components/BusinessHoursEditor';
import QRCode from 'react-native-qrcode-svg';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { billingBreakdownLines } from '../utils/billingBreakdown';
import { invoiceRow } from '../utils/invoiceDisplay';
import { getMyBusinessOffers, toggleOfferActive, getMyBusinessGatherings, getBusinessInsights, updateBusinessAddress, updateBusinessProfile, submitBusinessProfileForScreening, submitBusinessOfferForScreening, submitBusinessUpdateForScreening, getRedemptionCounts, getEstimatedAmountOwed, getMyInvoices, getMyManagedPartner, confirmOfferRedemption, getBusinessDiscoveryStats, setBusinessAvailabilityPulse, getBusinessExperiences, createBusinessExperience, updateBusinessExperience, submitBusinessExperienceForScreening, deleteBusinessExperience, setBusinessAccommodations, setBusinessOfferedOccasions, setBusinessWeatherSetting, setBusinessPriceLevel, setBusinessSuitedAges, setBusinessBookingMode, setBusinessMaxGroupSize, setBusinessSpaceCapacity, setBusinessTypicalSpend, setBusinessNotAccommodated, setBusinessWantMore, setBusinessDietaryOptions } from '../services/brandOffers';
import { cleanMaxGroupSize, maxGroupSizeProblem, SPACES, spaceCapacityProblem } from '../constants/businessCapabilities';
import { BUSINESS_PRICE_LEVELS, typicalSpendProblem } from '../constants/businessPrice';
import { getBusinessCommunities } from '../services/communities';
import { getBusinessConversations, replyAsBusinessOwner, getBusinessMessagesPage, getBusinessTopMembers, getBusinessVisitFrequency, getBusinessMemberGatheringHistory, getBusinessCustomerNote, saveBusinessCustomerNote, getMyPendingContentScreenings } from '../services/brandOffers';
// P2 remediation item 11 (CLAUDE.md) -- reuse the admin queue's own real
// target-type label map rather than a second, drifting copy.
import { TARGET_TYPE_LABELS } from './AdminContentReviewScreen';
import { getPendingPartnershipRequestsForPartner, respondToBusinessPartnershipRequest } from '../services/businessPartnerships';
import CancellationReasonSheet from '../components/CancellationReasonSheet';
import { CANCELLATION_REASONS, CANCELLATION_ACTOR_LABELS } from '../constants/cancellationReasons';
import { getPartnerCancellationPatterns } from '../services/cancellationReasons';
import { creativeFormPatch, detectedSummary, extractedDiscountWarning, canReadCreative, hasAnySuggestion, sanitizeCreativeSuggestions } from '../utils/creativeExtraction';
import { sanitizePlainLanguageSuggestion, plainLanguageDiffers, plainLanguageContext, claimProblem, acceptPlainLanguage } from '../utils/plainLanguageOffer';
import { videoLimitProblem, MAX_REDEMPTION_LENGTH, validUntilFromChoice, availableWindowFromChoice } from '../utils/offerMedia';
import { priorityTimeRangeFromChoice, priorityTimeStringToDate, priorityTimeRangeLabel } from '../utils/priorityTimeRange';
import { getBusinessOpportunities, submitBusinessOfferResponseForScreening, declineBusinessOpportunity, submitBusinessAvailabilityForScreening, cancelBusinessAvailability, cancelBusinessReservation, markBusinessNoShow, getMyBusinessNoShows, getMyBusinessAvailability, getAggregatedDemandForPartner, getPartnerDemandSignals, getOccasionDemandForPartner, getMyBusinessFulfillmentPolicy, upsertBusinessFulfillmentPolicy, formatOfferSummary, getMissedMatchSummary, getPartnerCategoryOutcomes, MISSED_MATCH_REASON_LABELS, DECLINE_REASON_OPTIONS, DECLINE_REASON_LABELS, getPartnerDeclinePatterns, DAY_OF_WEEK_OPTIONS, getPartnerOfferPerformance, pickBusinessOfferMedia, uploadBusinessOfferMedia, uploadOfferVideoFrames, readOfferCreative, rewriteOfferPlainLanguage, getMyCreatives, archiveBusinessCreative, getSignedBusinessOfferMediaUrl, getAvailabilityDemandPreview, getPartnerMatchFit, getMyOfferSubmissions, dismissOfferSubmission, retryOfferSubmission, getPartnerOfferValue, getPartnerOfferFunnel } from '../services/businessFulfillment';
import { submissionView, inFlightRequestIds, payloadToForm } from '../utils/offerSubmission';
// Item 68 (CLAUDE.md): a business's own durable, named occasion package.
import { getMyOccasionPackages, createOccasionPackage, updateOccasionPackage, setOccasionPackageActive, deleteOccasionPackage, formatOccasionPackageDetail, formatIncludedItemsLabel, findMatchingOccasionPackage, getBusinessReturningOccasionCustomers, sendBusinessRecallOutreach } from '../services/occasionPackages';
import { logBusinessAcquisitionEvent } from '../services/businessAcquisitionEvents';
import { getMyStripeConnectStatus, startStripeOnboarding, isStripeConfigured, stripeMode } from '../services/stripeConnect';
import { getMyReservationProviderStatus, updateReservationProvider } from '../services/reservationProvider';
import { getBusinessEntitlements, hasEntitlement, entitlementLimit, checkLimit, parseEntitlementError, tierDisplayLabel, ENTITLEMENT_FEATURE_LABELS } from '../services/entitlements';
import { captureStoryMedia, uploadBusinessMoment } from '../services/stories';
import { recordBusinessAttributeSuggestion, respondToBusinessAttributeSuggestion, getBusinessAttributeSuggestions, setBusinessPrioritySignal, clearBusinessPrioritySignal, getActiveBusinessPrioritySignals } from '../services/businessIntelligence';
import { scoreBusinessOpportunity } from '../services/businessOpportunityScoring';
// Phase 5 (CLAUDE.md) -- the digest card reuses the exact same canonical
// weather-reason text scoreBusinessOpportunity() already stamps onto a
// boosted opportunity's own reasons array, so the card never invents a
// second wording of the identical real signal.
import { REASON_TEXT } from '../constants/recommendationReasonVocabulary';
import { isWeatherIndoorBiased, isWeatherOutdoorBiased } from '../utils/weatherBias';
// Item 70 (CLAUDE.md): a real, honest "when" label for a pending request's
// own date/time window, shown on the business's opportunity card.
import { budgetMeetsMinSpend } from '../utils/budgetTier';
import { businessLocationNotice } from '../utils/businessLocationNotice';
import { dashboardGlance, visitHasPassed } from '../utils/dashboardGlance';
import { businessHomeTiles } from '../utils/businessHomeTiles';
import { businessPipeline, PIPELINE_STAGES, isPipelineWon } from '../utils/businessPipeline';
import { buildOpportunityCard, buildMatchReasons, availabilityCoversRequest } from '../utils/businessOpportunityCard';
import { matchFitLine } from '../utils/matchFitLine';
import { buildAlternativeText, alternativePickerStart, usualTermsLine, standardAvailabilityText, requestedWindowDefaults } from '../utils/quickOfferResponse';
import { formatPlanTimeLabel } from '../utils/planAddonReadiness';
import { defaultScheduledWindow, resolveAvailabilityWindow, scheduledWindowProblem, shiftEndAfterStart, demandPreviewLine } from '../utils/availabilityWindow';
import { activeDiscountCap, parseDiscountPct, discountCapProblem } from '../utils/discountCap';
// P1 item 7 (CLAUDE.md, Aug 28 Full Coherence Audit): the same real,
// already-deployed async submit-then-poll weather RPC every other
// weather-aware surface already calls -- never a new one.
import { getSocialForecast } from '../services/homeDashboard';
import { computeOfferTypeAcceptanceRates, bestAcceptedOfferType, rankExperiencesForOpportunity, buildOfferTitleScaffold, buildOccasionOfferTitle } from '../services/businessOfferRecommendation';
import { BUSINESS_CATEGORIES } from './BusinessPartnerApplyScreen';
import DemandNearYouCard from '../components/DemandNearYouCard';
import TellNearbyBusinessCard from '../components/TellNearbyBusinessCard';
import { describeDemandSignals } from '../utils/demandSignals';
import { opportunityPrimaryAction, consumerOfferAction } from '../utils/primaryAction';
import { BOOKING_MODE_OPTIONS, LEGACY_RESERVATION_ATTRIBUTE, bookingModeOf } from '../constants/bookingMode';
import { NOT_ACCOMMODATED_OPTIONS, ADULT_AGE_RULES, notAccommodatedOf, toggleNotAccommodated } from '../constants/businessRestrictions';
import { BUSINESS_DIETARY_OPTIONS, dietaryOptionsOf, dietaryRelevantFor } from '../constants/dietaryOptions';
import { BUSINESS_ATTRIBUTE_OPTIONS, CUISINE_OPTIONS, businessAttributeLabel, cuisineLabel, AVAILABILITY_PULSE_OPTIONS, availabilityPulseLabel, availabilityPulseIcon, isAvailabilityPulseFresh, EXPERIENCE_PRICE_OPTIONS, EXPERIENCE_PARTY_TYPE_OPTIONS, experiencePriceLabel, experiencePartyTypeLabel, ACCOMMODATE_PARTY_TYPE_OPTIONS, PRIORITY_TIME_WINDOW_OPTIONS, priorityTimeWindowLabel, OCCASION_OPTIONS, OFFERED_OCCASION_OPTIONS, WEATHER_SETTING_OPTIONS, occasionLabel, occasionPhrase, dietaryLabel, requestedItemLabel } from '../constants/businessAttributes';
import { planAddonLabel } from '../constants/planAddons';
import { EXPERIENCE_LEVEL_OPTIONS } from '../services/celebrateSomething';
import { deriveSignatureExperienceSuggestions } from '../constants/businessExperienceSuggestions';
import { bundleableOccasions, experienceComponentOptionsForOccasion } from '../constants/experienceTemplates';
import { classifyBusinessCategory } from '../constants/businessCategoryClassifier';
import { extractAttributesFromText } from '../constants/businessAttributeExtraction';
import { INTEREST_OPTIONS, subcategoryOptionsFor, businessTagOptions } from '../constants/gatheringCategories';
import SponsoredPromotionsPanel from '../components/SponsoredPromotionsPanel';
import LoadErrorState from '../components/LoadErrorState';
import BusinessNotificationPreferences from '../components/BusinessNotificationPreferences';
import BusinessEmailNotifications from '../components/BusinessEmailNotifications';
import { useTheme } from '../context/ThemeContext';
import { formatDateTime, formatAgo } from '../utils/timeLabels';
import { focusedOpportunityView, focusFirst } from '../utils/focusedOpportunity';
import { localWhen, localClock } from '../i18n/format';
import { spacing, radius, typography } from '../theme';

import { NLoader, modalAnimation, showSuccessToast } from '../motion';
import { isGatheringUpcoming } from '../utils/objectState';
import { categoryOutcomeLine, categoryRatingLine, offerPriceLabel } from '../utils/outcomeDisplay';
import { countLabel } from '../utils/plural';
import { bestTimeLine } from '../utils/bestTime';
// Tab, tool, offer-type and duration labels live in ui.bizDash3 (11 languages), keyed by `key`.
const SECTIONS = [
  { key: 'home', icon: '🏠' },
  { key: 'opportunities', icon: '🎯' },
  { key: 'bookings', icon: '📅' },
  { key: 'offers', icon: '🗓️' },
  { key: 'profile', icon: '🏪' },
];

// Older names for these places (push routing's initialSection, "view it" links) still resolve, to the tab that now
// holds that content. 'inbox_modal' is not a tab; it stays a full-screen conversation view.
// Item 140: a reply deadline as a clock time today ("7:30 PM"), else the localized day + time. Never "Starts in ...".
function deadlineLabel(iso, language) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return localClock(d.getHours() * 60 + d.getMinutes(), language);
  return localWhen(iso, now, language);
}
const LEGACY_SECTION_TAB = { requests: 'opportunities', gatherings: 'bookings', community: 'bookings', insights: 'home', business: 'profile' };
const MORE_TOOLS = [
  { key: 'ai', icon: '🤖' },
  { key: 'analytics', icon: '📊' },
  { key: 'weather', icon: '🌦️' },
  { key: 'demand', icon: '📈' },
];

const OFFER_TYPE_OPTIONS = [
  { key: 'standard' },
  { key: 'discount' },
  { key: 'perk' },
  { key: 'upgrade' },
  { key: 'alt_time' },
];

const RESERVATION_PROVIDER_OPTIONS = [
  { key: 'resy', label: 'Resy' },
  { key: 'opentable', label: 'OpenTable' },
];

// Same canonical 26-tag list business_requests/business_availability's own
// (now-widened) category CHECK constraints validate against -- see
// CLAUDE.md's "Category/filter taxonomy pass" section.
const AVAILABILITY_CATEGORY_OPTIONS = INTEREST_OPTIONS;

// "Time-boxed... right now" per the plan's own framing -- starts_at is
// always the moment of posting, the business only ever picks how long it
// stays valid. Keeps this a quick posting action, not a full date/time
// picker for something meant to be posted in the moment.
const AVAILABILITY_DURATION_OPTIONS = [
  { key: '1h', hours: 1 },
  { key: '2h', hours: 2 },
  { key: '4h', hours: 4 },
  { key: 'restOfDay', hours: null },
];

const AVAILABILITY_STATUSES = new Set(['active', 'filled', 'expired', 'cancelled']);

// Phase 4 (media upload, CLAUDE.md) -- shared optional photo/video picker
// used by both the Make-an-Offer modal and the Signature Experience modal.
// Renders a small thumbnail + Remove once something's attached (either a
// not-yet-uploaded local asset, or an already-saved existingPath resolved
// to a real signed URL), otherwise a single "Add a photo or video" button.
function BusinessMediaPicker({ pickedAsset, existingPath, existingType, onPick, onRemove, colors }) {
  const { t } = useLanguage();
  const [existingSignedUrl, setExistingSignedUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (existingPath && !pickedAsset) {
      getSignedBusinessOfferMediaUrl(existingPath).then((url) => {
        if (!cancelled) setExistingSignedUrl(url);
      });
    } else {
      setExistingSignedUrl(null);
    }
    return () => {
      cancelled = true;
    };
  }, [existingPath, pickedAsset]);

  const hasMedia = !!(pickedAsset || existingPath);
  const previewUri = pickedAsset?.uri ?? existingSignedUrl;
  const mediaType = pickedAsset ? (pickedAsset.type === 'video' ? 'video' : 'image') : existingType;

  if (!hasMedia) {
    return (
      <TouchableOpacity
        onPress={onPick}
        style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, alignSelf: 'flex-start', marginTop: spacing.sm }}
        accessibilityLabel={t('ui.bizDash1.addAPhotoOrVideoA11y')}
        accessibilityRole="button"
      >
        <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{t('ui.bizDash1.addAPhotoOrVideo')}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
      {previewUri && mediaType === 'image' ? (
        <Image source={{ uri: previewUri }} style={{ width: 64, height: 64, borderRadius: radius.md }} />
      ) : (
        <View style={{ width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
          <Text>🎬</Text>
        </View>
      )}
      <TouchableOpacity onPress={onRemove} accessibilityLabel={t('ui.bizDash1.removeMediaA11y')} accessibilityRole="button">
        <Text style={{ color: colors.danger, fontWeight: '600' }}>{t('ui.bizDash1.remove')}</Text>
      </TouchableOpacity>
    </View>
  );
}

// Phase 4 (media upload, CLAUDE.md) -- renders a real uploaded offer/
// experience photo INSIDE an existing card wrapper (never its own
// standalone card -- Nearby's own presentation frame is never bypassed).
// Video is intentionally not rendered inline here (no video player
// component exists elsewhere in this codebase to mirror) -- shown as a
// small honest "🎬 Video attached" label instead of a fabricated player.
// A saved creative in the offer form: a small thumbnail (a video shows its screened poster) the owner taps to reuse.
function CreativeThumb({ creative, selected, colors, onPress }) {
  const { t } = useLanguage();
  const [uri, setUri] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getSignedBusinessOfferMediaUrl(creative.media_type === 'video' ? creative.poster_path : creative.media_path).then((u) => { if (!cancelled) setUri(u); });
    return () => { cancelled = true; };
  }, [creative]);
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{ marginRight: spacing.sm, borderRadius: radius.md, borderWidth: 2, borderColor: selected ? colors.primary : colors.border, overflow: 'hidden', width: 72, height: 72, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={creative.media_type === 'video' ? t('ui.bizDash1.savedVideoCreativeA11y') : t('ui.bizDash1.savedPhotoCreativeA11y')}
    >
      {uri ? <Image source={{ uri }} style={{ width: 72, height: 72 }} /> : <Text>{creative.media_type === 'video' ? '🎬' : '🖼️'}</Text>}
    </TouchableOpacity>
  );
}

function BusinessOfferMediaPreview({ path, type, colors }) {
  const { t } = useLanguage();
  const [signedUrl, setSignedUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (path) {
      getSignedBusinessOfferMediaUrl(path).then((url) => {
        if (!cancelled) setSignedUrl(url);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) return null;

  if (type === 'video') {
    return <Text style={[{ color: colors.textSecondary, marginTop: spacing.xs }]}>{t('ui.bizDash1.videoAttached')}</Text>;
  }

  if (!signedUrl) return null;

  return (
    <Image
      source={{ uri: signedUrl }}
      style={{ width: '100%', height: 140, borderRadius: radius.md, marginTop: spacing.xs }}
      resizeMode="cover"
    />
  );
}

export default function BusinessDashboardScreen({ navigation, route }) {
  const { t, language } = useLanguage();
  const offerTypeLabel = (key) => (OFFER_TYPE_OPTIONS.some((o) => o.key === key) ? t(`ui.bizDash3.offerType.${key}`) : key);
  const { colors, shadow, isDark } = useTheme();
  const styles = getStyles(colors, shadow);
  const [showAiAutomation, setShowAiAutomation] = useState(false); // AI Automation opens in place (audit B10)
  const [section, setSectionRaw] = useState(() => {
    const initial = route?.params?.initialSection ?? 'home';
    return LEGACY_SECTION_TAB[initial] ?? initial;
  });
  // "More tools" (bottom of Home): which supporting tool is expanded in place. Never a tab of its own.
  const [openTool, setOpenTool] = useState(route?.params?.initialSection === 'insights' ? 'analytics' : null);
  const setSection = (key) => {
    setSectionRaw(LEGACY_SECTION_TAB[key] ?? key);
    setOpenTool(key === 'insights' ? 'analytics' : null);
  };
  const on = (...tabs) => tabs.includes(section);
  const tool = (key) => section === 'home' && openTool === key;
  // Item 36: the Performance tile opens Offer Performance (More tools -> Analytics) and scrolls to it once it has laid out.
  const mainScrollRef = useRef(null);
  const scrollToPerformanceRef = useRef(false);
  const performanceYRef = useRef(null);
  function openHomeTile(target) {
    if (target === 'performance' && section === 'home' && openTool === 'analytics' && performanceYRef.current != null) {
      mainScrollRef.current?.scrollTo({ y: performanceYRef.current, animated: true }); // already open: just go there
    } else if (target === 'performance') {
      scrollToPerformanceRef.current = true;
      setSection('insights');
    } else {
      setSection(target);
    }
  }
  // Secondary areas stay collapsed: Availability leads with "tell us when you have room", Profile with "tell us what you offer".
  const [moreOffersOpen, setMoreOffersOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState(null);
  // Item 86: contradictory settings are refused by the server and shown inline under the control (never an alert, never a
  // silent change). One entry per editing surface; see hooks/useSettingConflicts.js.
  const settingConflicts = useSettingConflicts(selectedPartner?.id ?? null);
  const [savingPendingSetting, setSavingPendingSetting] = useState(null);
  // Item 80: the "Largest group you can host" field; null = not yet edited (shows the saved value).
  const [maxGroupDraft, setMaxGroupDraft] = useState(null);
  const [spendDraft, setSpendDraft] = useState(null);
  const [savingSpend, setSavingSpend] = useState(false);
  const [savingMaxGroup, setSavingMaxGroup] = useState(false);
  // Item 81: per-space drafts ({ private_room: '20' }); a key is present only while being edited.
  const [spaceDrafts, setSpaceDrafts] = useState({});
  const [savingSpace, setSavingSpace] = useState(null);
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [addressModalVisible, setAddressModalVisible] = useState(false);
  const [offerRedemptionCounts, setOfferRedemptionCounts] = useState({});
  const [pastInvoices, setPastInvoices] = useState([]);
  const [estimatedOwed, setEstimatedOwed] = useState({ redemptionCount: 0, estimatedAmount: 0, billingModel: null, includedUnits: 0, billableCount: 0 });
  const [addressInput, setAddressInput] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);
  const [editProfileModalVisible, setEditProfileModalVisible] = useState(false);
  const [editNameInput, setEditNameInput] = useState('');
  const [editDescriptionInput, setEditDescriptionInput] = useState('');
  const [editLogoUrlInput, setEditLogoUrlInput] = useState('');
  const [editCategoryInput, setEditCategoryInput] = useState(null);
  const [editAttributesInput, setEditAttributesInput] = useState([]);
  const [editCuisineInput, setEditCuisineInput] = useState(null);
  // Intent engine vision, layer 2 (subcategory) first increment
  // (2026-09-06).
  const [editSubcategoryInput, setEditSubcategoryInput] = useState(null);
  // Intent engine vision, multi-classification businesses (resumed
  // 2026-09-10) -- secondary, cross-major self-classification, distinct
  // from editSubcategoryInput (one leaf tag under the primary major).
  const [editCategoriesInput, setEditCategoriesInput] = useState([]);
  const [editDifferentiatorInput, setEditDifferentiatorInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  // "Business Story" plan, Phase 2 -- Business Goals ("what we want more
  // of"), a lightweight signal distinct from the full Edit Profile form.
  const [priorityAttributesInput, setPriorityAttributesInput] = useState([]);
  // "Business Profile Phase 1" addendum -- the Timing half of "What You
  // Want More Of," saved together with priorityAttributesInput via the
  // same Save button (one card, one action, two RPCs underneath).
  const [priorityTimeWindowsInput, setPriorityTimeWindowsInput] = useState([]);
  // Owner item 56 follow-up -- an optional exact time-of-day preference ("4-7 PM") additive to the coarse
  // buckets above; Date objects while editing (picker-friendly), saved together via the same Save button.
  const [priorityTimeStartInput, setPriorityTimeStartInput] = useState(null);
  const [priorityTimeEndInput, setPriorityTimeEndInput] = useState(null);
  const [priorityTimeRangePicker, setPriorityTimeRangePicker] = useState(null);
  // "Intelligent demand inbox" Phase 2 (CLAUDE.md, Sep 3 2026) -- the real
  // WHY half of "What You're Looking For," saved via the same Save button
  // and RPC batch as the two fields above.
  const [priorityOccasionsInput, setPriorityOccasionsInput] = useState([]);
  const [savingPriorityAttributes, setSavingPriorityAttributes] = useState(false);
  // Phase 3 -- Availability Pulse, a real self-reported "how's business
  // right now" signal.
  const [pulseNoteInput, setPulseNoteInput] = useState('');
  const [savingPulse, setSavingPulse] = useState(false);
  // "Business Profile Phase 1" addendum -- "What You Can Accommodate."
  const [accommodatePartyTypesInput, setAccommodatePartyTypesInput] = useState([]);
  const [savingAccommodations, setSavingAccommodations] = useState(false);
  // Same addendum -- the AI Category Classification banner. Dismissal is
  // local-device-only (AsyncStorage), keyed by partner id + the specific
  // suggested category, same "have you seen this nudge" convention as
  // TabHeaderActions' own first-open hint elsewhere in this app.
  const [categorySuggestion, setCategorySuggestion] = useState(null);
  const [savingCategorySuggestion, setSavingCategorySuggestion] = useState(false);
  // Business Intelligence & Opportunity Engine, Phase 1 -- the durable,
  // cross-device provenance record for this same suggestion (the
  // AsyncStorage dismiss key above still governs "never re-nag on this
  // device"; this id is what respond_to_business_attribute_suggestion
  // actually approves/rejects, closing the real audit trail). Null when
  // the record call itself failed -- callers must not call respond-to
  // with a null id.
  const [categorySuggestionId, setCategorySuggestionId] = useState(null);
  // Same addendum -- "Teach Nearby." Never auto-applies -- the extracted
  // chips are always shown for explicit confirm/edit/discard first.
  const [teachNearbyInput, setTeachNearbyInput] = useState('');
  const [teachNearbyExtracted, setTeachNearbyExtracted] = useState(null);
  const [savingTeachNearby, setSavingTeachNearby] = useState(false);
  // Business Intelligence & Opportunity Engine, Phase 1 -- one suggestion
  // id per currently-extracted attribute, keyed by attribute name, so
  // removing/confirming/discarding a specific chip can mark that exact
  // suggestion's own provenance row, not a blanket batch action.
  const [teachNearbySuggestionIds, setTeachNearbySuggestionIds] = useState({});
  // Real, durable AI Suggestion / Audit log (Phase 1) -- the last 10
  // suggestion attempts for this business, whatever their source/status.
  const [recentSuggestions, setRecentSuggestions] = useState([]);
  // Business Priority Engine (Phase 1) -- a real, time-bounded "want more
  // of X right now" layer, additive to (never replacing) the permanent
  // priority_attributes/priority_time_windows chips above.
  const [activePrioritySignals, setActivePrioritySignals] = useState([]);
  const [boostCategoryInput, setBoostCategoryInput] = useState(null);
  const [boostDurationInput, setBoostDurationInput] = useState('today');
  const [savingBoost, setSavingBoost] = useState(false);
  // Phase 6 -- Signature Experiences.
  const [experiences, setExperiences] = useState([]);
  const [loadingExperiences, setLoadingExperiences] = useState(false);
  // Suggestion attributes explicitly addressed this session (kept via
  // Edit, or explicitly Removed) -- keeps a multi-item "review all 4"
  // flow correct without a new persisted flag: once every real
  // suggestion for a confirmed attribute has either become a real saved
  // experience or been explicitly dismissed, the whole review card
  // disappears on its own.
  const [dismissedSuggestionAttrs, setDismissedSuggestionAttrs] = useState([]);
  const [experienceModalVisible, setExperienceModalVisible] = useState(false);
  const [editingExperienceId, setEditingExperienceId] = useState(null);
  const [expTitleInput, setExpTitleInput] = useState('');
  const [expDescriptionInput, setExpDescriptionInput] = useState('');
  const [expIconInput, setExpIconInput] = useState('');
  const [expAttributesInput, setExpAttributesInput] = useState([]);
  const [expPriceLevelInput, setExpPriceLevelInput] = useState(null);
  const [expPartyTypeInput, setExpPartyTypeInput] = useState(null);
  // Phase 4 (media upload, CLAUDE.md) -- existingMediaPath/Type is the
  // already-saved value (preserved when editing without picking a new
  // file); pickedMediaAsset is a not-yet-uploaded local asset, uploaded
  // only at Save time so cancelling the modal never orphans a file.
  const [expExistingMediaPath, setExpExistingMediaPath] = useState(null);
  const [expExistingMediaType, setExpExistingMediaType] = useState(null);
  const [expPickedMediaAsset, setExpPickedMediaAsset] = useState(null);
  const [savingExperience, setSavingExperience] = useState(false);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [offers, setOffers] = useState([]);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newInstructions, setNewInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [gatherings, setGatherings] = useState([]);
  const [insights, setInsights] = useState(null);
  // Business Intelligence & Opportunity Engine, Phase 4 -- "Learning"
  // (see CLAUDE.md's own plan). Both real, aggregated-only over data
  // this screen fetches once per selectedPartner, not per render.
  const [missedMatchSummary, setMissedMatchSummary] = useState([]);
  const [missedMatchLocked, setMissedMatchLocked] = useState(false);
  const [categoryOutcomes, setCategoryOutcomes] = useState([]);
  const [categoryOutcomesLocked, setCategoryOutcomesLocked] = useState(false);
  // Phase 1 -- decline reasons + the owner-visible "What You've Declined"
  // insight, a real sibling to "Why You Might Be Missing Requests" above.
  const [declineModalRequestId, setDeclineModalRequestId] = useState(null);
  const [declineReasonInput, setDeclineReasonInput] = useState(null);
  const [declineNoteInput, setDeclineNoteInput] = useState('');
  const [declinePatterns, setDeclinePatterns] = useState([]);
  const [cancellationPatterns, setCancellationPatterns] = useState([]);
  const [matchFit, setMatchFit] = useState(null);
  const [reasonAsk, setReasonAsk] = useState(null);
  // "Business Web as an Operating System" Phase 3 -- the real per-template
  // offer-performance rollup shown on the Insights tab.
  const [offerPerformance, setOfferPerformance] = useState([]);
  const [offerValue, setOfferValue] = useState(null); // Item 85: redemptions + the owner's own prices on them
  const [offerFunnel, setOfferFunnel] = useState(null); // Item 150: this month's stage counts
  const [entitlements, setEntitlements] = useState(null);
  const [communities, setCommunities] = useState([]);
  const [updateModalVisible, setUpdateModalVisible] = useState(false);
  const [updateTitle, setUpdateTitle] = useState('');
  const [updateBody, setUpdateBody] = useState('');
  const [postingUpdate, setPostingUpdate] = useState(false);
  const [postingMoment, setPostingMoment] = useState(false);
  const [needsAttention, setNeedsAttention] = useState([]);
  const [topMembers, setTopMembers] = useState([]);
  const [expandedMemberId, setExpandedMemberId] = useState(null);
  const [memberHistories, setMemberHistories] = useState({});
  const [loadingMemberHistory, setLoadingMemberHistory] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [tagsDraft, setTagsDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [visitFrequency, setVisitFrequency] = useState(null);
  const [discoveryStats, setDiscoveryStats] = useState(null);
  const [partnershipRequests, setPartnershipRequests] = useState([]);
  // "The Offer System" Phase 2 (see CLAUDE.md's own plan, Gap 2): a real,
  // standing fulfillment policy the owner sets once, instead of a
  // one-time availability posting.
  // Declared up here (not next to its loader) because the opportunity-scoring useMemo below reads it in
  // its dependency array during render; a later `const` is a TDZ ReferenceError in a real browser.
  const [fulfillmentPolicy, setFulfillmentPolicy] = useState(null);
  // (Also declared early for the same reason: the opportunity-scoring useMemo reads it during render.)
  // P1 item 7 (CLAUDE.md, Aug 28 Full Coherence Audit): supplementary,
  // non-blocking -- null until the business's own real coordinates are
  // known AND the async weather request resolves. scoreBusinessOpportunity()
  // already treats a null weather as "no bonus, ever," so a business with
  // no address set (or before this resolves) sees the ranking exactly as
  // it always has, never a stuck/loading state.
  const [businessWeather, setBusinessWeather] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  // Item 140: a push about ONE request ("Request expires soon") opens on it. null until the list has loaded once.
  const focusRequestId = route?.params?.focusRequestId ?? null;
  const [opportunitiesLoaded, setOpportunitiesLoaded] = useState(null); // null = not yet, true = loaded, false = failed
  // Item 83: offers being screened in the background / recently decided ("Reviewing your offer…").
  const [offerSubmissions, setOfferSubmissions] = useState([]);
  const [resendingSubmissionId, setResendingSubmissionId] = useState(null);
  const [busySubmissionId, setBusySubmissionId] = useState(null);
  const [offerPreviewing, setOfferPreviewing] = useState(false); // Item 84: the owner's "Customer preview" step
  const offerInFlight = useMemo(() => inFlightRequestIds(offerSubmissions), [offerSubmissions]);
  const [aggregatedDemand, setAggregatedDemand] = useState([]);
  // "Demand near you" card: null = not loaded yet; otherwise the privacy-floored RPC payload.
  const [demandSignals, setDemandSignals] = useState(null);
  // Item 79 (CLAUDE.md, "businesses get a new demand signal"): the
  // occasion-primary sibling of aggregatedDemand above.
  const [occasionDemand, setOccasionDemand] = useState([]);
  // Business Intelligence & Opportunity Engine, Phase 2 -- a real,
  // itemized opportunity_score computed at READ time (not frozen at
  // insert time -- see businessOpportunityScoring.js's own header comment
  // for why), reusing only data already fetched (opportunities' own
  // business_requests.attributes/cuisine/category/date/time_window_start,
  // the already-loaded selectedPartner, and Phase 1's already-loaded
  // activePrioritySignals). Only reorders the subset still genuinely
  // awaiting the business's own decision (pending offer, open request) --
  // matches BusinessRequestDetailScreen's own "Compare Your Options"
  // precedent of never reordering already-resolved history.
  const scoredOpportunities = useMemo(() => {
    const withScores = opportunities.map((o) => {
      const req = o.business_requests ?? {};
      const { score, reasons } = scoreBusinessOpportunity({
        requestAttributes: req.attributes ?? [],
        requestCuisine: req.cuisine ?? null,
        requestCategory: req.category ?? null,
        requestDate: req.date ?? null,
        requestTimeWindowStart: req.time_window_start ?? null,
        requestBudgetMax: req.budget_max ?? null,
        requestPartySize: req.party_size ?? null,
        requestOccasion: req.occasion ?? null,
        requestDietary: req.dietary ?? [],
        businessDietaryOptions: selectedPartner?.dietary_options ?? [],
        businessAttributes: selectedPartner?.attributes ?? [],
        businessCuisine: selectedPartner?.cuisine ?? null,
        businessPriorityAttributes: selectedPartner?.priority_attributes ?? [],
        businessPriorityTimeWindows: selectedPartner?.priority_time_windows ?? [],
        businessPriorityTimeStart: selectedPartner?.priority_time_start ?? null,
        businessPriorityTimeEnd: selectedPartner?.priority_time_end ?? null,
        businessPriorityOccasions: selectedPartner?.priority_occasions ?? [],
        businessOfferedOccasions: selectedPartner?.offered_occasions ?? [],
        activePrioritySignals,
        fulfillmentPolicy,
        weather: businessWeather,
      });
      return { ...o, opportunityScore: score, opportunityReasons: reasons };
    });
    const isAwaitingDecision = (o) => canRespondToOpportunity(o);
    const awaiting = withScores.filter(isAwaitingDecision).sort((a, b) => b.opportunityScore - a.opportunityScore);
    const resolved = withScores.filter((o) => !isAwaitingDecision(o));
    return [...awaiting, ...resolved];
  }, [opportunities, selectedPartner, activePrioritySignals, fulfillmentPolicy, businessWeather]);
  // Phase 5 (CLAUDE.md) -- a real count of how many currently-open
  // opportunities the already-computed weather signal is boosting right
  // now, derived entirely from scoredOpportunities' own already-stamped
  // reasons (zero new query). null (not 0) when there's no real weather
  // signal at all, so the digest card can tell "no boost happening" apart
  // from "weather data hasn't resolved yet" -- matches this app's own
  // "no invented numbers" convention rather than defaulting to a zero.
  const weatherBoostedOpenCount = useMemo(() => {
    if (!businessWeather) return null;
    return scoredOpportunities.filter(
      (o) =>
        canRespondToOpportunity(o) &&
        o.opportunityReasons?.some(
          (r) => r.label === REASON_TEXT.WEATHER_GOOD_INDOOR.text || r.label === REASON_TEXT.WEATHER_GOOD_OUTDOOR.text
        )
    ).length;
  }, [scoredOpportunities, businessWeather]);
  // Business Intelligence & Opportunity Engine, Phase 3 -- a real,
  // deterministic offer-recommendation ranking, entirely client-side over
  // data this screen already has loaded (this partner's own full
  // opportunity history in `opportunities`, its own active Signature
  // Experiences in `experiences`, its own fulfillment policy) -- no new
  // query, matching Phase 2's own "computed at read time" precedent.
  const offerTypeAcceptance = useMemo(() => computeOfferTypeAcceptanceRates(opportunities), [opportunities]);
  const suggestedOfferType = useMemo(() => bestAcceptedOfferType(offerTypeAcceptance), [offerTypeAcceptance]);
  const [respondingOpportunityId, setRespondingOpportunityId] = useState(null);
  const [cancellingReservationOfferId, setCancellingReservationOfferId] = useState(null);
  // Visits this business marked "Didn't show up" (offer ids); they leave the visits list. Analysis only.
  const [noShowIds, setNoShowIds] = useState(() => new Set());
  const [markingNoShowId, setMarkingNoShowId] = useState(null);
  const [offerModalRequestId, setOfferModalRequestId] = useState(null);
  // Phase 3 -- which real Signature Experience (if any) the currently-open
  // offer was built from, so it's actually recorded on submit and can feed
  // the per-template performance funnel. Null when typed from scratch or
  // built from the offer-title scaffold fallback.
  const [selectedExperienceIdInput, setSelectedExperienceIdInput] = useState(null);
  const [myAvailability, setMyAvailability] = useState([]);
  // Phase 4(c): a real, persistent "N tables available -- we found M
  // matching requests" card, sourced from post_business_availability()'s
  // own already-real matchedCount -- no new backend logic. Replaces the
  // old one-shot Alert (which vanished the instant it was dismissed) with
  // a real card that stays visible until the owner dismisses it.
  const [lastPostedAvailability, setLastPostedAvailability] = useState(null);
  const [postAvailabilityModalVisible, setPostAvailabilityModalVisible] = useState(false);
  // Item 68 (CLAUDE.md): a business's own durable, named occasion packages
  // -- distinct from myAvailability (one-time posted slots) above.
  const [myOccasionPackages, setMyOccasionPackages] = useState([]);
  // Item 102 (CLAUDE.md, "Businesses can participate in recurring
  // occasions"): real, consented returning customers -- see
  // getBusinessReturningOccasionCustomers's own header comment for the
  // full consent/privacy boundary.
  const [returningCustomers, setReturningCustomers] = useState([]);
  const [outreachExpandedOccasionId, setOutreachExpandedOccasionId] = useState(null);
  const [outreachPackageChoice, setOutreachPackageChoice] = useState(null);
  const [sendingOutreachOccasionId, setSendingOutreachOccasionId] = useState(null);
  const [packageModalVisible, setPackageModalVisible] = useState(false);
  const [editingPackageId, setEditingPackageId] = useState(null);
  const [packageOccasionInput, setPackageOccasionInput] = useState(null);
  const [packageNameInput, setPackageNameInput] = useState('');
  const [packageDescriptionInput, setPackageDescriptionInput] = useState('');
  const [packageIncludedItemsInput, setPackageIncludedItemsInput] = useState([]);
  const [packageIncludedItemDraft, setPackageIncludedItemDraft] = useState('');
  const [packageMinGuestsInput, setPackageMinGuestsInput] = useState('');
  const [packagePriceInput, setPackagePriceInput] = useState('');
  const [packageAvailableDaysInput, setPackageAvailableDaysInput] = useState([]);
  const [savingPackage, setSavingPackage] = useState(false);
  const [availabilityTitleInput, setAvailabilityTitleInput] = useState('');
  const [availabilityDescriptionInput, setAvailabilityDescriptionInput] = useState('');
  const [availabilityCategoryInput, setAvailabilityCategoryInput] = useState(null);
  const [availabilityOfferTypeInput, setAvailabilityOfferTypeInput] = useState('standard');
  const [availabilityPriceInput, setAvailabilityPriceInput] = useState('');
  const [availabilityDiscountInput, setAvailabilityDiscountInput] = useState('');
  const [availabilityCapacityInput, setAvailabilityCapacityInput] = useState('');
  const [availabilityDurationKey, setAvailabilityDurationKey] = useState('2h');
  // 'now' = the existing "live for N hours"; 'scheduled' = an explicit picked window (e.g. Friday 6-8 PM).
  const [availabilityWhenMode, setAvailabilityWhenMode] = useState('now');
  const [availabilityStart, setAvailabilityStart] = useState(null);
  const [availabilityEnd, setAvailabilityEnd] = useState(null);
  const [showAvailabilityPicker, setShowAvailabilityPicker] = useState(null); // 'start' | 'end' | null
  const [availabilityDemandPeople, setAvailabilityDemandPeople] = useState(null);
  // Business-side Experience Bundles (2026-09-10, direct user request): both
  // optional, and only meaningful together -- clearing the occasion also
  // clears any ticked components (enforced client-side here, and again by
  // the RPC/CHECK constraint layer, same belt-and-suspenders pattern every
  // other business-declared vocabulary in this schema already follows).
  const [availabilityBundleOccasionInput, setAvailabilityBundleOccasionInput] = useState(null);
  const [availabilityBundleComponentsInput, setAvailabilityBundleComponentsInput] = useState([]);
  const [postingAvailability, setPostingAvailability] = useState(false);
  const [cancelingAvailabilityId, setCancelingAvailabilityId] = useState(null);
  // The request the "Make an Offer" modal is currently open for --
  // looked up from the already-loaded `opportunities` list, not a second
  // fetch. Business Intelligence & Opportunity Engine, Phase 3 (see
  // CLAUDE.md's own plan).
  const offerModalRequest = useMemo(
    () => opportunities.find((o) => o.request_id === offerModalRequestId)?.business_requests ?? null,
    [opportunities, offerModalRequestId]
  );
  const offerSuggestions = useMemo(() => {
    if (!offerModalRequest) return [];
    return rankExperiencesForOpportunity({
      requestAttributes: offerModalRequest.attributes ?? [],
      requestPriceLevel: offerModalRequest.gatherings?.price_level ?? null,
      requestPartySize: offerModalRequest.party_size ?? null,
      experiences,
      fulfillmentPolicy,
    });
  }, [offerModalRequest, experiences, fulfillmentPolicy]);
  // Phase 4(e): a real, honest offer-title scaffold, only ever buildable
  // when the request's own real occasion (Phase 1) AND category are both
  // present -- null otherwise, never a guessed fallback.
  const offerTitleScaffold = useMemo(() => {
    if (!offerModalRequest) return null;
    return buildOfferTitleScaffold({
      occasion: offerModalRequest.occasion ?? null,
      category: offerModalRequest.category ?? null,
    });
  }, [offerModalRequest]);
  // Item 92: the business's own already-built, already-active Occasion
  // Package that genuinely fits this specific request (same occasion,
  // real party size clears the package's own min_guests) -- the
  // strongest, most specific real starting point for a structured
  // response, since it's the business's own already-declared standing
  // offering, not a guessed scaffold.
  const matchingOccasionPackage = useMemo(() => {
    if (!offerModalRequest) return null;
    return findMatchingOccasionPackage({
      occasion: offerModalRequest.occasion ?? null,
      partySize: offerModalRequest.party_size ?? null,
      packages: myOccasionPackages,
    });
  }, [offerModalRequest, myOccasionPackages]);
  // A real occasion-only title suggestion ("Special Birthday Offer") for
  // the new dedicated title field -- shown only when no matching package
  // already covers this (that suggestion is stronger and takes priority)
  // and no title has been typed yet.
  const occasionOfferTitleSuggestion = useMemo(() => {
    if (!offerModalRequest || matchingOccasionPackage) return null;
    return buildOccasionOfferTitle({ occasion: offerModalRequest.occasion ?? null });
  }, [offerModalRequest, matchingOccasionPackage]);
  const [policyModalVisible, setPolicyModalVisible] = useState(false);
  const [policyPartySizeMinInput, setPolicyPartySizeMinInput] = useState('');
  const [policyPartySizeMaxInput, setPolicyPartySizeMaxInput] = useState('');
  const [policyActiveHoursStartInput, setPolicyActiveHoursStartInput] = useState('');
  const [policyActiveHoursEndInput, setPolicyActiveHoursEndInput] = useState('');
  const [policyMinSpendInput, setPolicyMinSpendInput] = useState('');
  const [policyMaxDiscountInput, setPolicyMaxDiscountInput] = useState('');
  const [policyAutoAcceptMaxInput, setPolicyAutoAcceptMaxInput] = useState('');
  const [policyDepositInput, setPolicyDepositInput] = useState('');
  const [policyCancellationWindowInput, setPolicyCancellationWindowInput] = useState('');
  const [policyActiveInput, setPolicyActiveInput] = useState(true);
  const [policyWeatherDependentInput, setPolicyWeatherDependentInput] = useState(false);
  // Business Web as an Operating System, Phase 2: an array of selected
  // day-of-week keys (0=Sunday .. 6=Saturday). An empty array is the UI's
  // own shorthand for "every day" -- saved as a real null, never an empty
  // array, matching active_days' own established "absent means every day"
  // convention.
  const [policyActiveDaysInput, setPolicyActiveDaysInput] = useState([]);
  const [savingPolicy, setSavingPolicy] = useState(false);
  // Effortless response: Accept -> standard availability / special offer, and Offer Alternative (another time).
  const [acceptSheetRequestId, setAcceptSheetRequestId] = useState(null);
  const [altSheetRequestId, setAltSheetRequestId] = useState(null);
  const [altTime, setAltTime] = useState(null);
  const [altNote, setAltNote] = useState('');
  const [showAltPicker, setShowAltPicker] = useState(false);
  const [offerTypeInput, setOfferTypeInput] = useState('standard');
  const [offerDescriptionInput, setOfferDescriptionInput] = useState('');
  const [offerPriceInput, setOfferPriceInput] = useState('');
  const [offerDiscountInput, setOfferDiscountInput] = useState('');
  const discountCap = activeDiscountCap(fulfillmentPolicy);
  // Item 93 follow-up (CLAUDE.md): an explicit, business-set flag -- never
  // inferred -- so the consumer's own comparison card can honestly render
  // "$70/person" instead of a bare, ambiguous "$70." Defaults false (a
  // flat/total price), matching what every existing offer_price has always
  // meant.
  const [offerPriceIsPerPerson, setOfferPriceIsPerPerson] = useState(false);
  // Item 92 ("Businesses should be able to respond specifically to the
  // occasion", CLAUDE.md) -- a real, optional structured title ("Special
  // Birthday Offer") and a real included-items checklist, both purely
  // additive to the existing free-text offerDescriptionInput above. Same
  // add-one-at-a-time editor shape the Occasion Package section already
  // established for its own included_items (packageIncludedItemsInput/
  // packageIncludedItemDraft below) -- one input pattern, not two.
  const [offerTitleInput, setOfferTitleInput] = useState('');
  const [offerIncludedItemsInput, setOfferIncludedItemsInput] = useState([]);
  const [offerRedemptionInput, setOfferRedemptionInput] = useState('');
  // Saved creative (reuse) + structured end time ("Valid today until 7 PM").
  const [creatives, setCreatives] = useState([]);
  const [offerCreativeId, setOfferCreativeId] = useState(null);
  const [offerValidDay, setOfferValidDay] = useState(null); // null = no end time | 'today' | 'tomorrow'
  const [offerValidTime, setOfferValidTime] = useState(null);
  const [showValidTimePicker, setShowValidTimePicker] = useState(false);
  const [offerAvailFrom, setOfferAvailFrom] = useState(null); // Date | null -- start of the "Available" window
  const [offerAvailUntil, setOfferAvailUntil] = useState(null);
  const [availPicker, setAvailPicker] = useState(null); // null | 'from' | 'until'
  const [quickFrom, setQuickFrom] = useState(null); // one-tap Standard availability window (prefilled from the request)
  const [quickUntil, setQuickUntil] = useState(null);
  const [quickPicker, setQuickPicker] = useState(null);
  // Name of the owner's own package the editor was pre-filled from (null = nothing pre-filled).
  const [offerPrefilledFrom, setOfferPrefilledFrom] = useState(null);
  const [offerIncludedItemDraft, setOfferIncludedItemDraft] = useState('');
  // Only meaningful when offerTypeInput === 'alt_time' -- proposedTime
  // stays null for every other offer type, matching submit_business_
  // offer's own default. Previously the "Alt. time" chip changed the
  // stored offer_type with no attached time input anywhere (PRODUCT_AUDIT/
  // INTENT_LAYER_UX_WALKTHROUGH_2026-08-14.md, finding 3).
  const [offerProposedTime, setOfferProposedTime] = useState(null);
  const [showOfferTimePicker, setShowOfferTimePicker] = useState(false);
  // Phase 4 (media upload, CLAUDE.md) -- an offer response's own optional
  // photo/video, uploaded only at Send time (never orphans a file on
  // Cancel).
  const [offerPickedMediaAsset, setOfferPickedMediaAsset] = useState(null);
  // "Read this for me": the picked media once uploaded for reading (reused at send so it is not uploaded twice), and what was read.
  const [creativeUpload, setCreativeUpload] = useState(null);
  const [readingCreative, setReadingCreative] = useState(false);
  const [creativeDetected, setCreativeDetected] = useState(null); // { summary, warning } | { none: true }
  // "See it in plain language" (owner item 59): a SUGGESTED rewrite of the owner's own title/description, shown
  // side-by-side; nothing is applied until the owner explicitly taps "Use this wording" (utils/plainLanguageOffer.js).
  const [requestingPlainLanguage, setRequestingPlainLanguage] = useState(false);
  const [plainLanguageSuggestion, setPlainLanguageSuggestion] = useState(null);
  const [redemptionCodeInput, setRedemptionCodeInput] = useState('');
  const [confirmingCode, setConfirmingCode] = useState(false);
  const [respondingToRequestId, setRespondingToRequestId] = useState(null);
  const [offerGatheringId, setOfferGatheringId] = useState(null);
  const [newRedemptionLimit, setNewRedemptionLimit] = useState('');
  const [newTargetInterestTag, setNewTargetInterestTag] = useState('');
  const [unlockEnabled, setUnlockEnabled] = useState(false);
  const [unlockCommunityId, setUnlockCommunityId] = useState(null);
  const [newUnlockMinMembers, setNewUnlockMinMembers] = useState('');
  const [growth, setGrowth] = useState(null);
  const [gatheringBreakdowns, setGatheringBreakdowns] = useState({});
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [conversationMessages, setConversationMessages] = useState([]);
  const [replyText, setReplyText] = useState('');

  // Business Partner acquisition experience, Milestone 6 (see CLAUDE.md): a
  // real per-mount session id, same randomUUID() pattern
  // BusinessPartnerApplyScreen.js already established -- groups this
  // screen visit's own dashboard_viewed/profile_completed/first_offer_created
  // events, deliberately not threaded through to the earlier apply-flow
  // session (matches Milestone 1's own disclosed, honest scope boundary).
  // Real crash fix (Aug 23 2026, TestFlight build 73, see CLAUDE.md): Hermes
  // has no global `crypto` object -- crypto.randomUUID() threw a
  // ReferenceError the instant this screen mounted, crashing every real
  // attempt to open Business Mode. expo-crypto's randomUUID() is the same
  // synchronous, real-UUID-v4 call, just Hermes-safe.
  const [sessionId] = useState(() => randomUUID());

  const [stripeStatus, setStripeStatus] = useState(null);
  const [connectingStripe, setConnectingStripe] = useState(false);

  const [reservationProviderStatus, setReservationProviderStatus] = useState(null);
  const [editingReservationProvider, setEditingReservationProvider] = useState(false);

  // P2 remediation item 11 (CLAUDE.md): the real, persistent counterpart
  // to the six one-time "Submitted for Review" alerts scattered across
  // this screen's own save handlers -- re-fetched on every real dashboard
  // load, so navigating away and back still shows what's genuinely still
  // pending, not just a toast the owner may have missed.
  const [pendingScreenings, setPendingScreenings] = useState([]);
  const [reservationProviderInput, setReservationProviderInput] = useState(null);
  const [reservationVenueIdInput, setReservationVenueIdInput] = useState('');
  const [savingReservationProvider, setSavingReservationProvider] = useState(false);

  // Real user ask, not a code audit (Aug 24 2026): "a way to start seeing
  // demand and posting offers... with a tutorial almost." A brand-new
  // business owner landing here for the first time (right after admin
  // approval -- see CLAUDE.md's Business Partner Onboarding history for why
  // that step is a deliberate manual review, not something this card
  // touches) had no orientation at all, just the same dashboard a
  // long-established partner sees. Shown once per real business (keyed by
  // partner id, matching this app's own "shown once, flip a local flag"
  // convention elsewhere -- e.g. TabHeaderActions' first-open hint), always
  // dismissible, never blocking anything below it.
  const [showWelcomeCard, setShowWelcomeCard] = useState(false);

  useEffect(() => {
    loadMyPartner();
  }, []);

  // Fires once real coordinates exist on the loaded partner -- never
  // blocks the rest of the dashboard, matching every other weather fetch
  // in this app (Home's own social-forecast card, the ask box's parallel
  // resolver branches). A business with no address set never fires this
  // at all, and this effect's own failure is swallowed rather than
  // surfaced -- weather is a real bonus signal here, never a required one.
  useEffect(() => {
    if (selectedPartner?.latitude == null || selectedPartner?.longitude == null) return;
    getSocialForecast(selectedPartner.latitude, selectedPartner.longitude)
      .then(setBusinessWeather)
      .catch(() => setBusinessWeather(null));
  }, [selectedPartner?.id, selectedPartner?.latitude, selectedPartner?.longitude]);

  async function loadMyPartner() {
    let loadedPartnerId = null;
    try {
      const partner = await getMyManagedPartner();
      setSelectedPartner(partner);
      setLoadError(false);
      if (partner) {
        loadedPartnerId = partner.id;
        setPriorityAttributesInput(partner.priority_attributes ?? []);
        setPriorityTimeWindowsInput(partner.priority_time_windows ?? []);
        setPriorityTimeStartInput(priorityTimeStringToDate(partner.priority_time_start));
        setPriorityTimeEndInput(priorityTimeStringToDate(partner.priority_time_end));
        setPriorityOccasionsInput(partner.priority_occasions ?? []);
        setPulseNoteInput(partner.availability_pulse_note ?? '');
        setAccommodatePartyTypesInput(partner.accommodates_party_types ?? []);
        logBusinessAcquisitionEvent(sessionId, 'dashboard_viewed', { partnerId: partner.id });
        const seenKey = `business_dashboard_welcome_seen_${partner.id}`;
        const seen = await AsyncStorage.getItem(seenKey);
        if (!seen) setShowWelcomeCard(true);

        // "Business Profile Phase 1" addendum -- AI Category
        // Classification, computed purely from the real, already-loaded
        // name/description, never a new fetch. Only shown when it
        // genuinely differs from the stored category (nothing to confirm
        // otherwise) and hasn't already been dismissed for this exact
        // suggestion on this device.
        const suggestion = classifyBusinessCategory({ name: partner.name, description: partner.description });
        if (suggestion && suggestion.category !== partner.category) {
          const dismissKey = `business_category_suggestion_dismissed_${partner.id}_${suggestion.category}`;
          const dismissed = await AsyncStorage.getItem(dismissKey);
          if (!dismissed) {
            setCategorySuggestion(suggestion);
            // Business Intelligence & Opportunity Engine, Phase 1 -- log
            // this real suggestion into the durable, cross-device
            // provenance table, alongside (not instead of) the local
            // dismiss key above. Fire-and-forget, non-blocking -- a
            // failed log must never stop the banner itself from showing.
            recordBusinessAttributeSuggestion(
              partner.id,
              'category',
              suggestion.category,
              'ai_inferred',
              suggestion.matchedKeywords?.length ? `Matched: ${suggestion.matchedKeywords.join(', ')}` : null
            ).then(setCategorySuggestionId);
          }
        }
      }
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
    // Non-fatal secondary loader, matching this screen's own established
    // convention (loadPartnershipRequests/loadOffers/etc.) — Stripe status
    // failing to load never blocks the rest of the dashboard.
    try {
      const status = await getMyStripeConnectStatus();
      setStripeStatus(status);
    } catch (e) {
      console.error('loadMyStripeConnectStatus failed', e);
    }
    try {
      const status = await getMyReservationProviderStatus();
      setReservationProviderStatus(status);
    } catch (e) {
      console.error('loadMyReservationProviderStatus failed', e);
    }
    // Business Intelligence & Opportunity Engine, Phase 1 -- same
    // non-fatal secondary-loader convention as Stripe/reservation-provider
    // status above.
    if (loadedPartnerId) {
      try {
        setRecentSuggestions(await getBusinessAttributeSuggestions(loadedPartnerId));
      } catch (e) {
        console.error('getBusinessAttributeSuggestions failed', e);
      }
      try {
        setActivePrioritySignals(await getActiveBusinessPrioritySignals(loadedPartnerId));
      } catch (e) {
        console.error('getActiveBusinessPrioritySignals failed', e);
      }
      // P2 remediation item 11 (CLAUDE.md) -- same non-fatal
      // secondary-loader convention as everything else in this block.
      try {
        setPendingScreenings(await getMyPendingContentScreenings(loadedPartnerId));
      } catch (e) {
        console.error('getMyPendingContentScreenings failed', e);
      }
    }
  }

  async function dismissWelcomeCard() {
    setShowWelcomeCard(false);
    if (selectedPartner) {
      await AsyncStorage.setItem(`business_dashboard_welcome_seen_${selectedPartner.id}`, 'true');
    }
  }

  async function handleConnectStripe() {
    setConnectingStripe(true);
    try {
      const status = await startStripeOnboarding();
      setStripeStatus(status);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleConnectStripe() });
    }
    setConnectingStripe(false);
  }

  function openEditReservationProvider() {
    setReservationProviderInput(reservationProviderStatus?.provider ?? null);
    setReservationVenueIdInput(reservationProviderStatus?.venueId ?? '');
    setEditingReservationProvider(true);
  }

  async function handleSaveReservationProvider() {
    if (!selectedPartner || !reservationProviderInput) return;
    setSavingReservationProvider(true);
    try {
      await updateReservationProvider(
        selectedPartner.id,
        reservationProviderInput,
        reservationVenueIdInput.trim() || null
      );
      const status = await getMyReservationProviderStatus();
      setReservationProviderStatus(status);
      setEditingReservationProvider(false);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSaveReservationProvider() });
    }
    setSavingReservationProvider(false);
  }

  function handleDisconnectReservationProvider() {
    if (!selectedPartner) return;
    Alert.alert(t('ui.bizDash1.removeReservationProvider'), t('ui.bizDash1.thisJustClearsWhatYou'), [
      { text: t('ui.bizDash1.cancel'), style: 'cancel' },
      {
        text: t('ui.bizDash1.remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            await updateReservationProvider(selectedPartner.id, null, null);
            setReservationProviderStatus({ ...reservationProviderStatus, provider: null, venueId: null, connectedAt: null });
          } catch (e) {
            presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleDisconnectReservationProvider() });
          }
        },
      },
    ]);
  }

  async function handleUpdateAddress() {
    if (!addressInput.trim()) return;
    setSavingAddress(true);
    try {
      const coords = await updateBusinessAddress(selectedPartner.id, addressInput.trim());
      setSelectedPartner((prev) => ({ ...prev, address: addressInput.trim(), latitude: coords?.latitude ?? prev.latitude, longitude: coords?.longitude ?? prev.longitude }));
      setAddressModalVisible(false);
      showSuccessToast(t('ui.bizDash1.saved'), t('ui.bizDash1.yourBusinessAddressIsNow'));
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleUpdateAddress() });
    }
    setSavingAddress(false);
  }

  // Decision 6, Phase 1 (CLAUDE.md's Aug 27 2026 plan) -- this is the one
  // confirmed gap the whole content-screening layer was built to close:
  // this exact call used to go straight to update_business_profile() with
  // zero screening on any of its 7 fields, including the two real
  // free-text fields (description/differentiator) rendered directly on
  // the public BusinessProfileScreen every consumer sees. Now routes
  // through screen-business-content instead -- a LOW result still
  // publishes immediately (same as before, zero added friction for the
  // overwhelming majority of real businesses); MEDIUM/UNCERTAIN holds the
  // change for a real admin decision, nothing published yet; HIGH is
  // rejected outright, never saved. Only a genuinely published result
  // updates the local, on-screen selectedPartner state -- a held/blocked
  // result must never make the UI claim something changed that didn't.
  // Opens the existing Edit Profile modal pre-filled from the saved profile (shared by the Profile tab and
  // "Tell Nearby about your business").
  // Item 86: keep inline conflict messages true. When anything the server's rule reads changes (a profile save, an experience,
  // package or posting added/removed), ask again; a resolved conflict's message clears. The server answers; nothing decided here.
  const { recheck: recheckConflicts, clear: clearConflictSurface } = settingConflicts;
  const conflictSurfacesOpen = Object.keys(settingConflicts.entries).length > 0;
  useEffect(() => {
    if (conflictSurfacesOpen) recheckConflicts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPartner, experiences, myOccasionPackages, myAvailability]);
  // A form's own edits re-ask for that form only (e.g. switching the package off Family Gathering clears its message).
  const conflictFormChecks = [
    ['profile_edit', { kind: 'profile', patch: { attributes: editAttributesInput } }],
    ['priority', { kind: 'profile', patch: { priority_attributes: priorityAttributesInput, priority_occasions: priorityOccasionsInput } }],
    ['accommodations', { kind: 'profile', patch: { accommodates_party_types: accommodatePartyTypesInput } }],
    ['experience', { kind: 'experience', patch: { party_type: expPartyTypeInput, attributes: expAttributesInput } }],
    ['package', { kind: 'package', patch: { occasion_type: packageOccasionInput } }],
    ['availability', { kind: 'availability', patch: { bundle_occasion: availabilityBundleOccasionInput } }],
  ];
  const conflictFormKey = JSON.stringify(conflictFormChecks);
  useEffect(() => {
    for (const [surface, check] of conflictFormChecks) {
      if (settingConflicts.entries[surface] && JSON.stringify(settingConflicts.entries[surface].check) !== JSON.stringify(check)) {
        recheckConflicts(surface, check);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictFormKey]);
  // Closing a form without saving drops its message (the form's values are not kept as a change).
  useEffect(() => { if (!editProfileModalVisible) clearConflictSurface('profile_edit'); }, [editProfileModalVisible, clearConflictSurface]);
  useEffect(() => { if (!experienceModalVisible) clearConflictSurface('experience'); }, [experienceModalVisible, clearConflictSurface]);
  useEffect(() => { if (!packageModalVisible) clearConflictSurface('package'); }, [packageModalVisible, clearConflictSurface]);
  useEffect(() => { if (!postAvailabilityModalVisible) clearConflictSurface('availability'); }, [postAvailabilityModalVisible, clearConflictSurface]);

  function openEditProfileModal() {
    setEditNameInput(selectedPartner?.name ?? '');
    setEditDescriptionInput(selectedPartner?.description ?? '');
    setEditLogoUrlInput(selectedPartner?.logo_url ?? '');
    setEditCategoryInput(selectedPartner?.category ?? null);
    setEditAttributesInput(selectedPartner?.attributes ?? []);
    setEditCuisineInput(selectedPartner?.cuisine ?? null);
    setEditDifferentiatorInput(selectedPartner?.differentiator ?? '');
    setEditSubcategoryInput(selectedPartner?.subcategory ?? null);
    setEditCategoriesInput(selectedPartner?.categories ?? []);
    setEditProfileModalVisible(true);
  }

  async function handleSaveProfile() {
    if (!editNameInput.trim()) return;
    setSavingProfile(true);
    try {
      const result = await submitBusinessProfileForScreening(selectedPartner.id, {
        name: editNameInput.trim(),
        description: editDescriptionInput.trim() || null,
        logoUrl: editLogoUrlInput.trim() || null,
        category: editCategoryInput,
        attributes: editAttributesInput,
        cuisine: editCategoryInput === 'food_drink' ? editCuisineInput : null,
        differentiator: editDifferentiatorInput.trim() || null,
        subcategory: editSubcategoryInput,
        categories: editCategoriesInput,
      });

      if (result.published) {
        setSelectedPartner((prev) => ({
          ...prev,
          name: editNameInput.trim(),
          description: editDescriptionInput.trim() || null,
          logo_url: editLogoUrlInput.trim() || null,
          category: editCategoryInput,
          attributes: editAttributesInput,
          cuisine: editCategoryInput === 'food_drink' ? editCuisineInput : null,
          differentiator: editDifferentiatorInput.trim() || null,
          subcategory: editSubcategoryInput,
          categories: editCategoriesInput,
        }));
        settingConflicts.clear('profile_edit');
        setEditProfileModalVisible(false);
        showSuccessToast(t('ui.bizDash1.saved'), t('ui.bizDash1.yourBusinessProfileHasBeen'));
        logBusinessAcquisitionEvent(sessionId, 'profile_completed', { partnerId: selectedPartner.id });
      } else if (result.blocked) {
        Alert.alert(
          t('ui.bizDash1.couldntPublish'),
          t('ui.bizDash1.thisContentCouldntBePublished')
        );
      } else {
        setEditProfileModalVisible(false);
        Alert.alert(
          t('ui.bizDash1.submittedForReview'),
          t('ui.bizDash1.yourChangesAreBeingReviewed')
        );
      }
    } catch (e) {
      if (!settingConflicts.report('profile_edit', e, { check: { kind: 'profile', patch: { attributes: editAttributesInput } } })) {
        presentRecoverableError(Alert, { what: 'save your changes', error: e, draftKept: true, onRetry: () => handleSaveProfile() });
      }
    }
    setSavingProfile(false);
  }

  // "Business Story" plan, Phase 2 -- a real, small, dedicated save,
  // distinct from the full Edit Profile form since this is meant to be
  // revisited often, not part of an identity edit. "Business Profile
  // Phase 1" addendum: also saves priorityTimeWindowsInput in the same
  // tap. "Intelligent demand inbox" Phase 2: also saves
  // priorityOccasionsInput -- one card, one Save button, three RPCs
  // underneath (each field lives in its own column/RPC since "customers
  // you want," "when you want them," and "why they're coming" are
  // genuinely different vocabularies).
  // "Occasions we offer": saves per tap, reverting the chip if the save fails.
  // Item 86: one save path for the save-per-tap rows. The row shows the owner's choice; the server decides. A contradiction keeps
  // the choice visible but UNSAVED (the persisted value is put back) with the server's lines under the row; tapping the choice off
  // again, or Save once it is resolved, ends it. Any other failure puts the saved value back and uses the usual recovery.
  async function savePerTapSetting(surface, next, saved, { save, field, patch, retry }) {
    const same = Array.isArray(next)
      ? JSON.stringify([...next].sort()) === JSON.stringify([...(saved ?? [])].sort())
      : JSON.stringify(next) === JSON.stringify(saved);
    if (same && hasPending(settingConflicts.entries, surface)) { settingConflicts.clear(surface); return; }
    setSelectedPartner((prev) => ({ ...prev, ...field(next) }));
    try {
      await save(next);
      settingConflicts.clear(surface);
    } catch (e) {
      setSelectedPartner((prev) => ({ ...prev, ...field(saved) }));
      if (!settingConflicts.report(surface, e, { pending: next, check: { kind: 'profile', patch: patch(next) } })) {
        presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: retry });
      }
    }
  }

  function pendingSaveFor(surface, handler) {
    if (!hasPending(settingConflicts.entries, surface)) return null;
    return async () => {
      setSavingPendingSetting(surface);
      try { await handler(settingConflicts.entries[surface].pending); } finally { setSavingPendingSetting(null); }
    };
  }

  async function handleToggleOfferedOccasion(key) {
    if (!selectedPartner) return;
    const saved = selectedPartner.offered_occasions ?? [];
    const shown = shownValue(settingConflicts.entries, 'offered_occasions', saved);
    const next = shown.includes(key) ? shown.filter((k) => k !== key) : [...shown, key];
    await saveOfferedOccasions(next, saved);
  }

  function saveOfferedOccasions(next, saved = selectedPartner?.offered_occasions ?? []) {
    return savePerTapSetting('offered_occasions', next, saved, {
      save: (v) => setBusinessOfferedOccasions(selectedPartner.id, v),
      field: (v) => ({ offered_occasions: v }),
      patch: (v) => ({ offered_occasions: v }),
      retry: () => saveOfferedOccasions(next, saved),
    });
  }

  // Item 63: tap a setting to choose it, tap it again to clear (= not said, no weather effect). Saves per tap.
  async function handlePickWeatherSetting(key) {
    if (!selectedPartner) return;
    const saved = selectedPartner.weather_setting ?? null;
    const shown = shownValue(settingConflicts.entries, 'weather_setting', saved);
    await saveWeatherSetting(shown === key ? null : key, saved);
  }

  function saveWeatherSetting(next, saved = selectedPartner?.weather_setting ?? null) {
    return savePerTapSetting('weather_setting', next, saved, {
      save: (v) => setBusinessWeatherSetting(selectedPartner.id, v),
      field: (v) => ({ weather_setting: v }),
      patch: (v) => ({ weather_setting: v }),
      retry: () => saveWeatherSetting(next, saved),
    });
  }

  // Item 86: what you don't accommodate. Tap to add, tap again to remove; saves per tap. A contradiction (Family-friendly, Family
  // group, Pet friendly, suited ages, a Family Gathering package or posting...) is refused by the server alone; shown inline.
  async function handleToggleNotAccommodated(key) {
    if (!selectedPartner) return;
    const saved = notAccommodatedOf(selectedPartner);
    const shown = shownValue(settingConflicts.entries, 'not_accommodated', saved);
    const next = toggleNotAccommodated(shown, key);
    await saveNotAccommodated(next, saved);
  }

  // Item 88: dietary options the business offers. Tap to add, tap again to remove; saves per tap. Declared only, never inferred.
  async function handleToggleDietaryOption(key) {
    if (!selectedPartner) return;
    const saved = dietaryOptionsOf(selectedPartner);
    const shown = shownValue(settingConflicts.entries, 'dietary_options', saved);
    const next = shown.includes(key) ? shown.filter((k) => k !== key) : [...shown, key];
    await savePerTapSetting('dietary_options', next, saved, {
      save: (v) => setBusinessDietaryOptions(selectedPartner.id, v),
      field: (v) => ({ dietary_options: v }),
      patch: (v) => ({ dietary_options: v }),
      retry: () => handleToggleDietaryOption(key),
    });
  }

  function saveNotAccommodated(next, saved = notAccommodatedOf(selectedPartner)) {
    return savePerTapSetting('not_accommodated', next, saved, {
      save: (v) => setBusinessNotAccommodated(selectedPartner.id, v),
      field: (v) => ({ not_accommodated: v }),
      patch: (v) => ({ not_accommodated: v }),
      retry: () => saveNotAccommodated(next, saved),
    });
  }

  // Item 72: how customers come in. Tap to choose, tap again to clear (= not said). Saves per tap; drives the customer's button.
  async function handlePickBookingMode(key) {
    if (!selectedPartner) return;
    const current = selectedPartner.booking_mode ?? null;
    const currentAttrs = selectedPartner.attributes ?? [];
    const next = bookingModeOf(selectedPartner) === key ? null : key;
    setSelectedPartner((prev) => ({ ...prev, booking_mode: next, attributes: (prev.attributes ?? []).filter((a) => a !== LEGACY_RESERVATION_ATTRIBUTE) }));
    try {
      await setBusinessBookingMode(selectedPartner.id, next);
    } catch (e) {
      setSelectedPartner((prev) => ({ ...prev, booking_mode: current, attributes: currentAttrs }));
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handlePickBookingMode(key) });
    }
  }

  // Item 40: tap a price tier to choose it, tap again to clear (= not said). Saves per tap.
  async function handlePickPriceLevel(key) {
    if (!selectedPartner) return;
    const current = selectedPartner.price_level ?? null;
    const next = current === key ? null : key;
    setSelectedPartner((prev) => ({ ...prev, price_level: next }));
    try {
      await setBusinessPriceLevel(selectedPartner.id, next);
    } catch (e) {
      setSelectedPartner((prev) => ({ ...prev, price_level: current }));
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handlePickPriceLevel(key) });
    }
  }

  // Item 82: optional typical spend per person, whole dollars. Blank = not said. Saved on tap.
  async function handleSaveTypicalSpend() {
    if (!selectedPartner || spendDraft === null) return;
    const problem = typicalSpendProblem(spendDraft);
    if (problem) { Alert.alert(t('ui.bizDash1.checkTheAmount'), problem); return; }
    const next = spendDraft.trim() ? Number(spendDraft.trim()) : null;
    setSavingSpend(true);
    try {
      await setBusinessTypicalSpend(selectedPartner.id, next);
      setSelectedPartner((prev) => ({ ...prev, typical_spend_per_person: next }));
      setSpendDraft(null);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'save your typical spend', error: e, onRetry: () => handleSaveTypicalSpend() });
    }
    setSavingSpend(false);
  }

  // Item 80: largest group the business can host (total people). Blank = not said; never guessed. Saved on tap.
  async function handleSaveMaxGroupSize() {
    if (!selectedPartner || maxGroupDraft === null) return;
    const problem = maxGroupSizeProblem(maxGroupDraft);
    if (problem) { Alert.alert(t('ui.bizDash1.checkTheGroupSize'), problem); return; }
    const next = cleanMaxGroupSize(maxGroupDraft);
    setSavingMaxGroup(true);
    try {
      await setBusinessMaxGroupSize(selectedPartner.id, next);
      setSelectedPartner((prev) => ({ ...prev, max_group_size: next }));
      setMaxGroupDraft(null);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'save your group size', error: e, onRetry: () => handleSaveMaxGroupSize() });
    }
    setSavingMaxGroup(false);
  }

  // Item 81: a space's capacity (private room / outdoor area). Shown only while that capability is declared; the server re-checks.
  async function handleSaveSpaceCapacity(space) {
    if (!selectedPartner || spaceDrafts[space.key] === undefined) return;
    const problem = spaceCapacityProblem(spaceDrafts[space.key], selectedPartner.max_group_size);
    if (problem) { Alert.alert(t('ui.bizDash1.checkTheGroupSize'), problem); return; }
    const next = cleanMaxGroupSize(spaceDrafts[space.key]);
    setSavingSpace(space.key);
    try {
      await setBusinessSpaceCapacity(selectedPartner.id, space.key, next);
      setSelectedPartner((prev) => ({ ...prev, [space.column]: next }));
      setSpaceDrafts((prev) => { const n = { ...prev }; delete n[space.key]; return n; });
    } catch (e) {
      presentRecoverableError(Alert, { what: 'save that size', error: e, onRetry: () => handleSaveSpaceCapacity(space) });
    }
    setSavingSpace(null);
  }

  // Item 50: suited ages (descriptive, 0-18). Saves per tap; a failure puts the previous range back.
  function handlePickSuitedAges(min, max) {
    if (!selectedPartner) return;
    return saveSuitedAges({ min, max });
  }

  function saveSuitedAges(next, saved = { min: selectedPartner?.suited_age_min ?? null, max: selectedPartner?.suited_age_max ?? null }) {
    return savePerTapSetting('suited_ages', next, saved, {
      save: (v) => setBusinessSuitedAges(selectedPartner.id, v.min, v.max),
      field: (v) => ({ suited_age_min: v.min, suited_age_max: v.max }),
      patch: (v) => ({ suited_age_min: v.min, suited_age_max: v.max }),
      retry: () => saveSuitedAges(next, saved),
    });
  }

  async function handleSavePriorityAttributes() {
    if (!selectedPartner) return;
    // Owner item 56 follow-up: an invalid exact window is an input problem, not a service failure -- fix it in
    // place, don't send any of the three RPCs (matches the rest of this app's "no draft loss, no partial save
    // on a bad input" pattern; see utils/recoverableError.js).
    const timeRange = priorityTimeRangeFromChoice(priorityTimeStartInput, priorityTimeEndInput);
    if (timeRange.error) {
      Alert.alert(t('ui.bizDash1.fixTheExactTimeWindow'), timeRange.error);
      return;
    }
    setSavingPriorityAttributes(true);
    const priorityCheck = { kind: 'profile', patch: { priority_attributes: priorityAttributesInput, priority_occasions: priorityOccasionsInput } };
    try {
      // Item 86: one server transaction -- a conflict or an invalid part saves nothing (no half-applied preferences).
      await setBusinessWantMore(selectedPartner.id, {
        priorityAttributes: priorityAttributesInput,
        timeWindows: priorityTimeWindowsInput,
        timeStart: timeRange.start,
        timeEnd: timeRange.end,
        occasions: priorityOccasionsInput,
      });
      setSelectedPartner((prev) => ({
        ...prev,
        priority_attributes: priorityAttributesInput,
        priority_time_windows: priorityTimeWindowsInput,
        priority_time_start: timeRange.start,
        priority_time_end: timeRange.end,
        priority_occasions: priorityOccasionsInput,
      }));
      settingConflicts.clear('priority');
      showSuccessToast(t('ui.bizDash1.saved'), t('ui.bizDash1.wellFlagOpportunitiesThatMatch'));
    } catch (e) {
      if (!settingConflicts.report('priority', e, { check: priorityCheck })) {
        presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSavePriorityAttributes() });
      }
    }
    setSavingPriorityAttributes(false);
  }

  // Business Intelligence & Opportunity Engine, Phase 1 -- the Business
  // Priority Engine. A real, time-bounded "want more of X right now"
  // signal, additive to the permanent priority_attributes/
  // priority_time_windows above -- never replaces them, never edits them.
  function boostExpiryFor(duration) {
    const now = new Date();
    if (duration === 'today') {
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return end;
    }
    if (duration === 'weekend') {
      const end = new Date(now);
      const daysUntilSunday = (7 - end.getDay()) % 7 || 7;
      end.setDate(end.getDate() + daysUntilSunday);
      end.setHours(23, 59, 59, 999);
      return end;
    }
    // '1week'
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    return end;
  }

  async function handleSetBoost() {
    if (!selectedPartner || !boostCategoryInput) return;
    setSavingBoost(true);
    try {
      await setBusinessPrioritySignal(
        selectedPartner.id,
        boostCategoryInput,
        1.0,
        boostExpiryFor(boostDurationInput).toISOString()
      );
      setActivePrioritySignals(await getActiveBusinessPrioritySignals(selectedPartner.id));
      setBoostCategoryInput(null);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSetBoost() });
    }
    setSavingBoost(false);
  }

  async function handleClearBoost(signalId) {
    try {
      await clearBusinessPrioritySignal(signalId);
      setActivePrioritySignals((prev) => prev.filter((s) => s.id !== signalId));
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleClearBoost(signalId) });
    }
  }

  // "Business Profile Phase 1" addendum -- "What You Can Accommodate."
  async function handleSaveAccommodations() {
    if (!selectedPartner) return;
    setSavingAccommodations(true);
    try {
      await setBusinessAccommodations(selectedPartner.id, accommodatePartyTypesInput);
      setSelectedPartner((prev) => ({ ...prev, accommodates_party_types: accommodatePartyTypesInput }));
      settingConflicts.clear('accommodations');
    } catch (e) {
      if (!settingConflicts.report('accommodations', e, { check: { kind: 'profile', patch: { accommodates_party_types: accommodatePartyTypesInput } } })) {
        presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSaveAccommodations() });
      }
    }
    setSavingAccommodations(false);
  }

  // Same addendum -- AI Category Classification. "Looks right" writes the
  // suggested category through the existing update_business_profile RPC,
  // carrying every other field forward unchanged -- never a partial patch.
  async function handleConfirmCategorySuggestion() {
    if (!selectedPartner || !categorySuggestion) return;
    setSavingCategorySuggestion(true);
    try {
      await updateBusinessProfile(selectedPartner.id, {
        name: selectedPartner.name,
        description: selectedPartner.description,
        address: selectedPartner.address,
        logoUrl: selectedPartner.logo_url,
        category: categorySuggestion.category,
        attributes: selectedPartner.attributes ?? [],
        cuisine: selectedPartner.cuisine,
        differentiator: selectedPartner.differentiator,
        // Secondary categories are independent of the primary major this
        // AI suggestion is changing -- carry the business's own current
        // value forward unchanged, same reasoning attributes/cuisine
        // above already follow.
        categories: selectedPartner.categories ?? [],
      });
      setSelectedPartner((prev) => ({ ...prev, category: categorySuggestion.category }));
      setCategorySuggestion(null);
      // Business Intelligence & Opportunity Engine, Phase 1 -- close out
      // the real provenance record for this suggestion (fire-and-forget:
      // the canonical category write above already succeeded, this is
      // only the durable audit trail catching up).
      if (categorySuggestionId) {
        respondToBusinessAttributeSuggestion(categorySuggestionId, true).catch((err) =>
          console.error('respondToBusinessAttributeSuggestion failed', err)
        );
        setCategorySuggestionId(null);
      }
      getBusinessAttributeSuggestions(selectedPartner.id).then(setRecentSuggestions).catch(() => {});
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleConfirmCategorySuggestion() });
    }
    setSavingCategorySuggestion(false);
  }

  async function handleDismissCategorySuggestion() {
    if (!selectedPartner || !categorySuggestion) return;
    const dismissKey = `business_category_suggestion_dismissed_${selectedPartner.id}_${categorySuggestion.category}`;
    await AsyncStorage.setItem(dismissKey, 'true');
    setCategorySuggestion(null);
    if (categorySuggestionId) {
      respondToBusinessAttributeSuggestion(categorySuggestionId, false).catch((err) =>
        console.error('respondToBusinessAttributeSuggestion failed', err)
      );
      setCategorySuggestionId(null);
      getBusinessAttributeSuggestions(selectedPartner.id).then(setRecentSuggestions).catch(() => {});
    }
  }

  // Same addendum -- "Teach Nearby." Never auto-applies: extraction is
  // purely local, and nothing writes anywhere until the owner explicitly
  // confirms the real extracted chips.
  function handleInterpretTeachNearby() {
    const extracted = extractAttributesFromText(teachNearbyInput);
    setTeachNearbyExtracted(extracted);
    // Business Intelligence & Opportunity Engine, Phase 1 -- log each real
    // extracted attribute into the durable provenance table, fire-and-
    // forget, non-blocking. One suggestion row per attribute, matching
    // this flow's own per-chip confirm/edit/discard shape.
    if (selectedPartner) {
      extracted.forEach((attribute) => {
        recordBusinessAttributeSuggestion(
          selectedPartner.id,
          'attribute',
          attribute,
          'ai_inferred',
          t('ui.bizDash1.extractedFromWhatYouTyped')
        ).then((id) => {
          if (id) setTeachNearbySuggestionIds((prev) => ({ ...prev, [attribute]: id }));
        });
      });
    }
  }

  function handleDiscardTeachNearby() {
    Object.values(teachNearbySuggestionIds).forEach((id) => {
      respondToBusinessAttributeSuggestion(id, false).catch((err) =>
        console.error('respondToBusinessAttributeSuggestion failed', err)
      );
    });
    setTeachNearbySuggestionIds({});
    setTeachNearbyInput('');
    setTeachNearbyExtracted(null);
    if (selectedPartner) {
      getBusinessAttributeSuggestions(selectedPartner.id).then(setRecentSuggestions).catch(() => {});
    }
  }

  function handleRemoveTeachNearbyChip(attribute) {
    const id = teachNearbySuggestionIds[attribute];
    if (id) {
      respondToBusinessAttributeSuggestion(id, false).catch((err) =>
        console.error('respondToBusinessAttributeSuggestion failed', err)
      );
      setTeachNearbySuggestionIds((prev) => {
        const next = { ...prev };
        delete next[attribute];
        return next;
      });
    }
    setTeachNearbyExtracted((prev) => (prev ?? []).filter((a) => a !== attribute));
  }

  // Confirming merges the extracted attributes into the business's own
  // real attributes array (union, never a duplicate, never removing an
  // attribute already confirmed elsewhere) and writes through the same
  // real update_business_profile RPC every other profile edit already
  // uses -- this never invents a new write path for attributes.
  async function handleConfirmTeachNearby() {
    if (!selectedPartner || !teachNearbyExtracted || teachNearbyExtracted.length === 0) return;
    setSavingTeachNearby(true);
    try {
      const merged = Array.from(new Set([...(selectedPartner.attributes ?? []), ...teachNearbyExtracted]));
      await updateBusinessProfile(selectedPartner.id, {
        name: selectedPartner.name,
        description: selectedPartner.description,
        address: selectedPartner.address,
        logoUrl: selectedPartner.logo_url,
        category: selectedPartner.category,
        attributes: merged,
        cuisine: selectedPartner.cuisine,
        differentiator: selectedPartner.differentiator,
        // Category is unchanged here -- must re-pass the current
        // subcategory/categories or updateBusinessProfile's non-coalesce
        // contract would silently null them out on this unrelated
        // attributes-only write.
        subcategory: selectedPartner.subcategory,
        categories: selectedPartner.categories ?? [],
      });
      setSelectedPartner((prev) => ({ ...prev, attributes: merged }));
      // Business Intelligence & Opportunity Engine, Phase 1 -- close out
      // the real provenance record for every attribute that survived to
      // this confirm (any explicitly removed chip was already rejected in
      // handleRemoveTeachNearbyChip). Fire-and-forget -- the canonical
      // merge write above already succeeded.
      teachNearbyExtracted.forEach((attribute) => {
        const id = teachNearbySuggestionIds[attribute];
        if (id) {
          respondToBusinessAttributeSuggestion(id, true).catch((err) =>
            console.error('respondToBusinessAttributeSuggestion failed', err)
          );
        }
      });
      setTeachNearbySuggestionIds({});
      setTeachNearbyInput('');
      setTeachNearbyExtracted(null);
      getBusinessAttributeSuggestions(selectedPartner.id).then(setRecentSuggestions).catch(() => {});
      Alert.alert(t('ui.bizDash1.addedToYourProfile'), t('ui.bizDash1.theseNowShowUpUnder'));
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleConfirmTeachNearby() });
    }
    setSavingTeachNearby(false);
  }

  // Phase 3 -- one tap sets and saves the pulse (matches the vision doc's
  // own "that's it" simplicity) using whatever note is currently typed.
  async function handleSavePulse(pulse) {
    if (!selectedPartner) return;
    setSavingPulse(true);
    try {
      const note = pulseNoteInput.trim() || null;
      await setBusinessAvailabilityPulse(selectedPartner.id, pulse, note);
      setSelectedPartner((prev) => ({
        ...prev,
        availability_pulse: pulse,
        availability_pulse_note: note,
        availability_pulse_updated_at: new Date().toISOString(),
      }));
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSavePulse(pulse) });
    }
    setSavingPulse(false);
  }

  // "Business Story" plan, Phase 6 -- Signature Experiences. existing =
  // null means "creating brand new"; passing a real row means editing it
  // (id set) or, from a suggestion, pre-filling a not-yet-saved draft
  // (id left null so Save creates rather than updates).
  function openExperienceModal(existing = null, { fromSuggestionId = null } = {}) {
    // Business Intelligence Phase 8: a real, honest pre-check before
    // opening the form -- create_business_experience() is the real
    // server-side gate either way (a stale/unfetched entitlements value
    // never bypasses it), this just avoids someone filling out a whole
    // new experience only to have it rejected at the very end. Only
    // applies to creating a genuinely new row -- editing an existing one
    // never counts against the cap.
    if (!existing && entitlements) {
      const { atLimit, limit } = checkLimit(entitlements, 'signature_experiences', experiences.length);
      if (atLimit) {
        Alert.alert(
          t('ui.bizDash1.upgradeForMoreSignatureExperiences'),
          t('ui.bizDash1.yourCurrentPlanIsCapped', { count: limit })
        );
        return;
      }
    }
    setEditingExperienceId(existing?.id ?? null);
    setExpTitleInput(existing?.title ?? '');
    setExpDescriptionInput(existing?.description ?? '');
    setExpIconInput(existing?.icon ?? '');
    setExpAttributesInput(existing?.attributes ?? []);
    setExpPriceLevelInput(existing?.price_level ?? existing?.priceLevel ?? null);
    setExpPartyTypeInput(existing?.party_type ?? existing?.partyType ?? null);
    setExpExistingMediaPath(existing?.media_path ?? null);
    setExpExistingMediaType(existing?.media_type ?? null);
    setExpPickedMediaAsset(null);
    if (fromSuggestionId) {
      // Editing a suggestion is itself how it gets "addressed" -- whatever
      // ends up saved, this specific suggestion shouldn't linger in the
      // review list waiting for a second decision.
      setDismissedSuggestionAttrs((prev) => [...prev, fromSuggestionId]);
    }
    setExperienceModalVisible(true);
  }

  // Decision 6, Phase 2 (CLAUDE.md's Aug 27 2026 plan) -- this is the real
  // confirmed gap that phase exists to close: this exact save used to go
  // straight to create/update_business_experience() with zero screening
  // on title/description. Now routes through screen-business-content
  // instead -- a LOW result still calls the real underlying RPC (so the
  // real entitlement cap still applies exactly as before), MEDIUM/
  // UNCERTAIN holds the change for a real admin decision (nothing
  // published, the modal closes without reloading the list -- a new
  // experience genuinely doesn't exist yet, and an edited one's live
  // version stays exactly as it was), HIGH is rejected outright.
  async function handleSaveExperience() {
    if (!selectedPartner || !expTitleInput.trim()) return;
    setSavingExperience(true);
    try {
      let mediaPath = expExistingMediaPath;
      let mediaType = expExistingMediaType;
      if (expPickedMediaAsset) {
        const uploaded = await uploadBusinessOfferMedia(selectedPartner.id, expPickedMediaAsset, 'experience');
        mediaPath = uploaded.path;
        mediaType = uploaded.mediaType;
      }

      const result = await submitBusinessExperienceForScreening(selectedPartner.id, {
        experienceId: editingExperienceId ?? null,
        title: expTitleInput.trim(),
        description: expDescriptionInput.trim() || null,
        icon: expIconInput.trim() || null,
        attributes: expAttributesInput,
        priceLevel: expPriceLevelInput,
        partyType: expPartyTypeInput,
        mediaPath,
        mediaType,
      });

      settingConflicts.clear('experience');
      if (result.published) {
        await loadExperiences(selectedPartner.id);
        setExperienceModalVisible(false);
      } else if (result.blocked) {
        Alert.alert(
          t('ui.bizDash1.couldntPublish'),
          t('ui.bizDash1.thisContentCouldntBePublished')
        );
      } else {
        setExperienceModalVisible(false);
        Alert.alert(
          t('ui.bizDash1.submittedForReview'),
          editingExperienceId
            ? t('ui.bizDash1.yourChangesAreBeingReviewed2')
            : t('ui.bizDash1.thisExperienceIsBeingReviewed')
        );
      }
    } catch (e) {
      // Real, server-side defense-in-depth: openExperienceModal()'s own
      // pre-check reads a possibly-stale `entitlements` snapshot, so the
      // actual RPC-level cap (still enforced on the LOW-tier direct write,
      // and re-checked again at admin-approval time for a held
      // submission) is what genuinely enforces this -- if it fires
      // anyway, show the same honest upgrade copy instead of the raw
      // ENTITLEMENT_LIMIT: error string.
      const entitlementError = parseEntitlementError(e);
      if (entitlementError?.kind === 'limit') {
        showUpgradePlaceholder(entitlementError.feature);
      } else if (!settingConflicts.report('experience', e, { check: { kind: 'experience', patch: { party_type: expPartyTypeInput, attributes: expAttributesInput } } })) {
        presentRecoverableError(Alert, { what: 'save this experience', error: e, draftKept: true, onRetry: () => handleSaveExperience() });
      }
    }
    setSavingExperience(false);
  }

  // Keep saves the suggestion exactly as derived, real ai_suggested
  // provenance -- no modal, matches the vision's own "the business simply
  // confirms" framing (point 149) for a suggestion the owner doesn't want
  // to change at all.
  async function handleKeepSuggestion(suggestion) {
    if (!selectedPartner) return;
    try {
      await createBusinessExperience(selectedPartner.id, {
        title: suggestion.title,
        description: suggestion.description,
        icon: suggestion.icon,
        attributes: suggestion.attributes,
        priceLevel: suggestion.priceLevel,
        partyType: suggestion.partyType,
        aiSuggested: true,
      });
      await loadExperiences(selectedPartner.id);
      settingConflicts.clear(`experience_suggestion:${suggestion.attribute}`);
    } catch (e) {
      const entitlementError = parseEntitlementError(e);
      if (entitlementError?.kind === 'limit') {
        showUpgradePlaceholder(entitlementError.feature);
      } else if (!settingConflicts.report(`experience_suggestion:${suggestion.attribute}`, e, { check: { kind: 'experience', patch: { party_type: suggestion.partyType ?? null, attributes: suggestion.attributes ?? [] } } })) {
        presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleKeepSuggestion(suggestion) });
      }
    }
  }

  function handleRemoveSuggestion(suggestion) {
    setDismissedSuggestionAttrs((prev) => [...prev, suggestion.attribute]);
  }

  async function handleToggleExperienceActive(experience) {
    try {
      await updateBusinessExperience(experience.id, {
        title: experience.title,
        description: experience.description,
        icon: experience.icon,
        attributes: experience.attributes,
        priceLevel: experience.price_level,
        partyType: experience.party_type,
        active: !experience.active,
        mediaPath: experience.media_path ?? null,
        mediaType: experience.media_type ?? null,
      });
      await loadExperiences(selectedPartner.id);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleToggleExperienceActive(experience) });
    }
  }

  function handleDeleteExperience(experience) {
    Alert.alert(t('ui.bizDash1.removeThisExperience'), t('ui.bizDash1.willBePermanentlyRemoved', { title: experience.title }), [
      { text: t('ui.bizDash1.cancel'), style: 'cancel' },
      {
        text: t('ui.bizDash1.remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteBusinessExperience(experience.id);
            await loadExperiences(selectedPartner.id);
          } catch (e) {
            presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleDeleteExperience(experience) });
          }
        },
      },
    ]);
  }

  // Business Partner acquisition experience, Milestone 3 (see CLAUDE.md): same
  // Share.share + nearby:// deep link pattern GatheringConfirmationScreen.js's
  // "Share Gathering" already established, reused verbatim rather than a second
  // convention — this business's own real id, not a fabricated code.
  async function handleShareBusinessLink() {
    if (!selectedPartner) return;
    const message = t('ui.bizDash1.checkOutOnNearbyNearby', { name: selectedPartner.name, id: selectedPartner.id });
    // Phase 7 (Business Web, CLAUDE.md) -- Share.share has no real native
    // share-sheet equivalent on the web; a clipboard copy is the honest
    // browser-specific adapter for the same underlying action.
    if (Platform.OS === 'web') {
      try {
        await navigator.clipboard.writeText(message);
        window.alert(t('ui.bizDash1.linkCopiedToClipboard'));
      } catch (e) {
        // Clipboard permission denial isn't an error worth surfacing.
      }
      return;
    }
    try {
      await Share.share({
        message,
        url: `nearby://business/${selectedPartner.id}`,
      });
    } catch (e) {
      // Share sheet cancellation isn't an error worth surfacing.
    }
  }

  useFocusEffect(
    useCallback(() => {
      if (selectedPartner) {
        loadStats(selectedPartner.id);
        loadOffers(selectedPartner.id);
        loadGatherings(selectedPartner.id);
        loadInsights(selectedPartner.id);
        loadMissedMatchSummary(selectedPartner.id);
        loadCategoryOutcomes(selectedPartner.id);
        loadDeclinePatterns(selectedPartner.id);
        loadCancellationPatterns(selectedPartner.id);
        loadOfferPerformance(selectedPartner.id);
        loadMatchFit(selectedPartner.id);
        loadCommunities(selectedPartner.id);
        loadGrowth(selectedPartner.id);
        // Fetches conversations once and feeds the same result to both
        // consumers, instead of loadConversations/loadNeedsAttention each
        // separately calling getBusinessConversations() for the same data.
        loadConversations(selectedPartner.id).then((results) => loadNeedsAttention(selectedPartner.id, results));
        loadTopMembers(selectedPartner.id);
        loadVisitFrequency(selectedPartner.id);
        loadDiscoveryStats(selectedPartner.id);
        loadPartnershipRequests(selectedPartner.id);
        loadOpportunities(selectedPartner.id);
        loadOfferSubmissions(selectedPartner.id);
        loadAggregatedDemand(selectedPartner.id);
        loadDemandSignals(selectedPartner.id);
        loadOccasionDemand(selectedPartner.id);
        loadMyAvailability(selectedPartner.id);
        loadFulfillmentPolicy(selectedPartner.id);
        loadMyOccasionPackages();
        loadReturningCustomers(selectedPartner.id);
        loadExperiences(selectedPartner.id);
        loadEntitlements(selectedPartner.id);
      }
    }, [selectedPartner])
  );

  // Business Intelligence Phase 8 (see CLAUDE.md) -- the real, owner-
  // scoped plan read backing every tier-gated preview on this screen.
  // Non-fatal: a failed fetch just means every gated section falls back
  // to its own locked-preview state rather than the dashboard breaking.
  async function loadEntitlements(partnerId) {
    try {
      const result = await getBusinessEntitlements(partnerId);
      setEntitlements(result);
    } catch (e) {
      console.error('loadEntitlements failed', e);
    }
  }

  function showUpgradePlaceholder(feature) {
    const label = ENTITLEMENT_FEATURE_LABELS[feature] ? t(`ui.bizDash1.feature.${feature}`) : feature;
    Alert.alert(
      t('ui.bizDash1.upgradeFor', { label: label }),
      t('ui.bizDash1.realPlanUpgradesArenT')
    );
  }

  // Business Intelligence Phase 8 -- one shared locked-preview treatment
  // reused everywhere a gated feature has real UI on this screen (never a
  // silent absence -- per the locked plan's own "client-side hiding is
  // not security" note, this is purely a UX preview, the real gate is
  // always the server-side check inside the RPC/trigger itself). `tier`
  // is the currently-loaded entitlements.tier when known, so the copy
  // can honestly name what the caller would need to move to next.
  function renderLockedFeature(feature, description) {
    const label = ENTITLEMENT_FEATURE_LABELS[feature] ? t(`ui.bizDash1.feature.${feature}`) : feature;
    return (
      <TouchableOpacity style={styles.lockedFeatureCard} onPress={() => showUpgradePlaceholder(feature)} activeOpacity={0.85}>
        <Text style={styles.lockedFeatureTitle}>🔒 {label}</Text>
        {description ? <Text style={styles.lockedFeatureDescription}>{description}</Text> : null}
        <Text style={styles.lockedFeatureCta}>{t('ui.bizDash1.seeWhatYouGet')}</Text>
      </TouchableOpacity>
    );
  }

  // "Business Story" plan, Phase 6 -- Signature Experiences.
  async function loadExperiences(partnerId) {
    setLoadingExperiences(true);
    try {
      const results = await getBusinessExperiences(partnerId);
      setExperiences(results);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
      console.error('loadExperiences failed', e);
    }
    setLoadingExperiences(false);
  }

  async function loadPartnershipRequests(partnerId) {
    try {
      const results = await getPendingPartnershipRequestsForPartner(partnerId);
      setPartnershipRequests(results);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
      console.error('loadPartnershipRequests failed', e);
    }
  }

  async function loadOpportunities(partnerId) {
    try {
      const results = await getBusinessOpportunities(partnerId);
      setOpportunities(results);
      setOpportunitiesLoaded(true);
      getMyBusinessNoShows().then(setNoShowIds).catch(() => {});
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
      setOpportunitiesLoaded(false);
    }
  }

  // Item 140: opened (or re-opened in place) on one request: show the Opportunities tab and re-read its CURRENT state.
  useEffect(() => {
    if (!focusRequestId) return;
    setSection('opportunities');
    if (selectedPartner) loadOpportunities(selectedPartner.id);
  }, [focusRequestId]);

  // Nearby 2.0 vision layer 1, "Aggregated demand -> business
  // opportunities" (see CLAUDE.md's "Nearby 2.0 Vision" doc): real,
  // quantified nearby demand rolled up by category, not one-request-at-a-
  // time. Honestly empty until real request volume exists nearby -- never
  // padded to look more populated than it is.
  async function loadDemandSignals(partnerId) {
    try {
      setDemandSignals(await getPartnerDemandSignals(partnerId));
    } catch (e) {
      // Non-fatal -- the card just stays hidden if the read fails.
    }
  }

  async function loadAggregatedDemand(partnerId) {
    try {
      const results = await getAggregatedDemandForPartner(partnerId);
      setAggregatedDemand(results);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
    }
  }

  // Item 79 (CLAUDE.md, "businesses get a new demand signal"): real,
  // anonymized, cross-category demand grouped by occasion ("14 birthday
  // groups are looking for dinner this weekend"), not just a footnote
  // inside a category row. Honestly empty until real nearby volume exists.
  async function loadOccasionDemand(partnerId) {
    try {
      const results = await getOccasionDemandForPartner(partnerId);
      setOccasionDemand(results);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
    }
  }

  // Item 82: an unfinished offer (text, prices, times and the picked photo/video) survives a failed send, closing the
  // sheet and an app restart, kept per request. Restored only on "Continue editing"; cleared once sent or sent for review.
  const iso = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString() : null);
  const fromIso = (v) => (v ? new Date(v) : null);
  const offerDraft = useFormDraft(
    offerModalRequestId && selectedPartner?.id ? `offer:${selectedPartner.id}:${offerModalRequestId}` : null,
    {
      offerType: offerTypeInput, description: offerDescriptionInput, price: offerPriceInput, discount: offerDiscountInput,
      perPerson: offerPriceIsPerPerson, title: offerTitleInput, items: offerIncludedItemsInput, redemption: offerRedemptionInput,
      validDay: offerValidDay, validTime: iso(offerValidTime), availFrom: iso(offerAvailFrom), availUntil: iso(offerAvailUntil),
      proposedTime: iso(offerProposedTime), experienceId: selectedExperienceIdInput, creativeId: offerCreativeId,
      media: serializableAsset(offerPickedMediaAsset, Platform.OS),
    },
    {
      enabled: !!offerModalRequestId && !!selectedPartner?.id,
      isEmpty: (d) => !String(d.description ?? '').trim() && !String(d.title ?? '').trim() && !d.media && !d.creativeId,
    }
  );
  async function applyOfferDraft(d) {
    setOfferTypeInput(d.offerType ?? 'standard'); setOfferDescriptionInput(d.description ?? ''); setOfferPriceInput(d.price ?? '');
    setOfferDiscountInput(d.discount ?? ''); setOfferPriceIsPerPerson(!!d.perPerson); setOfferTitleInput(d.title ?? '');
    setOfferIncludedItemsInput(Array.isArray(d.items) ? d.items : []); setOfferRedemptionInput(d.redemption ?? '');
    setOfferValidDay(d.validDay ?? null); setOfferValidTime(fromIso(d.validTime));
    setOfferAvailFrom(fromIso(d.availFrom)); setOfferAvailUntil(fromIso(d.availUntil));
    const proposed = fromIso(d.proposedTime);
    setOfferProposedTime(proposed && proposed.getTime() > Date.now() ? proposed : null);
    setSelectedExperienceIdInput(d.experienceId ?? null); setOfferCreativeId(d.creativeId ?? null);
    if (d.media && (await assetStillExists(d.media))) setOfferPickedMediaAsset(d.media);
    else if (d.media) Alert.alert(t('ui.bizDash1.photoOrVideoNotRestored'), t('ui.bizDash1.theFileYouPickedIs'));
  }

  // Item 83: background screening progress. Polls only while something is actually being reviewed, and reloads the
  // opportunities the moment a submission turns into a sent offer.
  async function loadOfferSubmissions(partnerId) {
    try {
      const rows = await getMyOfferSubmissions(partnerId);
      setOfferSubmissions((prev) => {
        const wasWaiting = (prev ?? []).some((x) => x.status === 'reviewing' || x.status === 'in_review');
        const nowSent = rows.some((x) => x.status === 'published' && (prev ?? []).some((o) => o.id === x.id && o.status !== 'published'));
        if (wasWaiting && nowSent) loadOpportunities(partnerId);
        return rows;
      });
    } catch (e) {
      // Non-fatal -- the list just stays as it was.
    }
  }

  useEffect(() => {
    if (!selectedPartner?.id) return undefined;
    if (!offerSubmissions.some((x) => x.status === 'reviewing' || x.status === 'in_review')) return undefined;
    const timer = setInterval(() => loadOfferSubmissions(selectedPartner.id), 5000);
    return () => clearInterval(timer);
  }, [offerSubmissions, selectedPartner?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmissionAction(sub, action) {
    setBusySubmissionId(sub.id);
    try {
      if (action === 'dismiss') {
        await dismissOfferSubmission(sub.id);
      } else if (action === 'retry') {
        await retryOfferSubmission(selectedPartner.id, sub.id);
      } else if (action === 'edit') {
        const form = payloadToForm(sub.payload);
        openOfferModal(sub.request_id);
        setOfferTypeInput(form.offerType); setOfferDescriptionInput(form.description); setOfferPriceInput(form.price);
        setOfferDiscountInput(form.discount); setOfferPriceIsPerPerson(form.perPerson); setOfferTitleInput(form.title);
        setOfferIncludedItemsInput(form.items); setOfferRedemptionInput(form.redemption); setSelectedExperienceIdInput(form.experienceId);
        setResendingSubmissionId(sub.id);
        // Bring the media back too. It is already uploaded, so it is reused (not uploaded again); it is screened afresh on send.
        const pl = sub.payload ?? {};
        if (pl.creativeId) {
          setOfferCreativeId(pl.creativeId);
        } else if (pl.mediaPath && (pl.mediaType === 'image' || pl.mediaType === 'video')) {
          const url = await getSignedBusinessOfferMediaUrl(pl.mediaPath);
          if (url) {
            const asset = { uri: url, type: pl.mediaType, mimeType: pl.mediaType === 'video' ? 'video/mp4' : 'image/jpeg' };
            setOfferPickedMediaAsset(asset);
            setCreativeUpload({ asset, mediaPath: pl.mediaPath, mediaType: pl.mediaType, framePaths: Array.isArray(pl.framePaths) ? pl.framePaths : [] });
          }
        }
      }
      await loadOfferSubmissions(selectedPartner.id);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSubmissionAction(sub, action) });
    }
    setBusySubmissionId(null);
  }

  function openOfferModal(requestId) {
    setOfferModalRequestId(requestId);
    setOfferPreviewing(false);
    setResendingSubmissionId(null);
    setOfferTypeInput('standard');
    setOfferDescriptionInput('');
    setOfferPriceInput('');
    setOfferDiscountInput('');
    setOfferPriceIsPerPerson(false);
    setOfferProposedTime(null);
    setShowOfferTimePicker(false);
    setSelectedExperienceIdInput(null);
    setOfferPickedMediaAsset(null);
    setCreativeUpload(null);
    setCreativeDetected(null);
    setPlainLanguageSuggestion(null);
    setOfferTitleInput('');
    setOfferIncludedItemsInput([]);
    setOfferRedemptionInput('');
    setOfferCreativeId(null);
    setOfferValidDay(null);
    setOfferValidTime(null);
    setOfferAvailFrom(null);
    setOfferAvailUntil(null);
    setAvailPicker(null);
    setShowValidTimePicker(false);
    if (selectedPartner?.id) getMyCreatives(selectedPartner.id).then(setCreatives).catch(() => setCreatives([]));
    setOfferIncludedItemDraft('');
    // One-tap smart offer: Nearby does the work first. If the owner already published a package that fits this exact
    // request (same occasion, party clears min_guests), start from it -- title, price per person, included items --
    // never a price of Nearby's own. Everything stays editable and nothing is sent until Send.
    const req = opportunities.find((o) => o.request_id === requestId)?.business_requests ?? null;
    const pkg = req ? findMatchingOccasionPackage({ occasion: req.occasion ?? null, partySize: req.party_size ?? null, packages: myOccasionPackages }) : null;
    if (pkg) {
      applyOccasionPackageToOffer(pkg);
      setOfferPrefilledFrom(pkg.name);
    } else {
      setOfferPrefilledFrom(null);
    }
  }

  // Item 92: one explicit tap copies the business's own already-built
  // package's real name/description/price/included_items onto this one
  // response -- still fully editable before Send, never auto-submitted,
  // same "suggest, never silently commit" shape as every other suggestion
  // in this modal.
  function applyOccasionPackageToOffer(pkg) {
    setOfferTitleInput(pkg.name);
    setOfferDescriptionInput(pkg.description || pkg.name);
    if (pkg.price_per_person != null) {
      setOfferPriceInput(String(pkg.price_per_person));
      setOfferPriceIsPerPerson(true);
    }
    setOfferIncludedItemsInput(Array.isArray(pkg.included_items) ? [...pkg.included_items] : []);
    setSelectedExperienceIdInput(null);
  }

  function addOfferIncludedItem() {
    const trimmed = offerIncludedItemDraft.trim();
    if (!trimmed) return;
    setOfferIncludedItemsInput((prev) => [...prev, trimmed]);
    setOfferIncludedItemDraft('');
  }

  function removeOfferIncludedItem(index) {
    setOfferIncludedItemsInput((prev) => prev.filter((_, i) => i !== index));
  }

  // Business Intelligence & Opportunity Engine, Phase 3: tapping a real
  // suggestion (either a ranked Signature Experience, or the best-
  // performing real offer type from this partner's own history) prefills
  // the form -- never auto-sends. Price is deliberately never touched: an
  // experience's own price_level is a real signal, never a fabricated
  // dollar amount, so the owner always types their own real price.
  function applyExperienceSuggestion(suggestion) {
    setOfferDescriptionInput(
      suggestion.description ? `${suggestion.title} -- ${suggestion.description}` : suggestion.title
    );
    // Item 92: this Signature Experience's own real title is a genuine,
    // already-existing candidate for the new dedicated title field --
    // still fully editable, never forced.
    setOfferTitleInput(suggestion.title);
    if (suggestedOfferType) {
      if (suggestedOfferType.offerType !== 'alt_time') setOfferProposedTime(null);
      setOfferTypeInput(suggestedOfferType.offerType);
    }
    // Phase 3: record which real Signature Experience this offer was built
    // from, so it's actually carried through to submit and can feed the
    // per-template performance funnel -- never fabricated, null whenever
    // no suggestion was ever picked.
    setSelectedExperienceIdInput(suggestion.experienceId ?? null);
  }

  function applySuggestedOfferType() {
    if (!suggestedOfferType) return;
    if (suggestedOfferType.offerType !== 'alt_time') setOfferProposedTime(null);
    setOfferTypeInput(suggestedOfferType.offerType);
  }

  // "Intelligent demand inbox" plan, Phase 4(e): a real, honest offer-
  // title scaffold (occasion + category), never a price -- prefills only
  // the title portion of the description field, same "never touch price"
  // discipline as applyExperienceSuggestion above.
  function applyOfferTitleScaffold(title) {
    setOfferDescriptionInput(title);
    // A real, different starting point than any already-applied Signature
    // Experience suggestion -- clears whichever experience id that
    // suggestion may have set, matching the plan's own "typed from
    // scratch, or the offer-title-scaffold fallback" -> null convention.
    setSelectedExperienceIdInput(null);
  }

  // Decision 6, Phase 3 (CLAUDE.md's Aug 27 2026 plan) -- this is the real
  // confirmed gap that phase exists to close: this exact response used to
  // go straight to submit_business_offer() with only the pre-existing
  // generic checkTextModeration() check on the description. Now routes
  // through screen-business-content instead, same three-branch shape
  // handleSaveExperience() already established -- a LOW result still
  // calls the real underlying RPC, MEDIUM/UNCERTAIN holds the response
  // for a real admin decision (nothing sent to the customer yet), HIGH is
  // rejected outright.
  // Shared by the full offer editor and the one-tap paths: what to do with the screening result.
  async function handleOfferResult(result, close, sent = null) {
    if (result.published) {
      close();
      if (sent) showSuccessToast(...replySentConfirmation(sent));
      await loadOpportunities(selectedPartner.id);
    } else if (result.blocked) {
      Alert.alert(
        t('ui.bizDash1.couldntSend'),
        t('ui.bizDash1.thisContentCouldntBeSent')
      );
    } else {
      close();
      Alert.alert(t('ui.bizDash1.submittedForReview'), t('ui.bizDash1.yourResponseIsBeingReviewed'));
    }
  }

  function openAlternativeSheet(requestId) {
    setAltSheetRequestId(requestId);
    setAltTime(null);
    setAltNote('');
    setShowAltPicker(false);
  }

  // One-tap responses. Each is the business's own real response (Accept -> an Offer); never a silent commit of anything else.
  // The optional "Available From / To" control, shared by the full offer editor and the one-tap Standard availability
  // sheet (one model, one validation: utils/offerMedia.js availableWindowFromChoice).
  function renderAvailabilityWindow({ from, until, setFrom, setUntil, picker, setPicker }) {
    return (
      <>
        <View style={styles.chipRow}>
          {[['from', from, t('ui.bizDash1.from'), setFrom], ['until', until, t('ui.bizDash1.to'), setUntil]].map(([key, val, label, setter]) => (
            <TouchableOpacity
              key={key}
              style={[styles.chip, val && styles.chipSelected]}
              onPress={() => {
                if (!val) { const d = new Date(); d.setHours(key === 'from' ? 18 : 20, 0, 0, 0); setter(d); }
                setPicker(key);
              }}
              accessibilityRole="button"
              accessibilityLabel={t(key === 'from' ? 'ui.bizDash1.availableFromA11y' : 'ui.bizDash1.availableUntilA11y')}
            >
              <Text style={[styles.chipText, val && styles.chipTextSelected]}>
                {label}{val ? ` ${val.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
              </Text>
            </TouchableOpacity>
          ))}
          {(from || until) ? (
            <TouchableOpacity style={styles.chip} onPress={() => { setFrom(null); setUntil(null); setPicker(null); }} accessibilityRole="button" accessibilityLabel={t('ui.bizDash1.clearTheAvailableWindowA11y')}>
              <Text style={styles.chipText}>{t('ui.bizDash1.clear')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {picker ? (
          <PlatformDateTimeInput
            value={(picker === 'from' ? from : until) ?? new Date()}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            themeVariant={isDark ? 'dark' : 'light'}
            onChange={(event, selected) => {
              const which = picker;
              setPicker(Platform.OS === 'ios' ? which : null);
              if (selected && event?.type !== 'dismissed') (which === 'from' ? setFrom : setUntil)(selected);
            }}
          />
        ) : null}
      </>
    );
  }

  // Opening the Standard availability sheet: prefill the window the customer asked for (only when the request really has a
  // start AND end), so one tap confirms exactly that; otherwise no window (plain "as requested").
  useEffect(() => {
    if (!acceptSheetRequestId) { setQuickFrom(null); setQuickUntil(null); setQuickPicker(null); return; }
    const w = requestedWindowDefaults(opportunities.find((o) => o.request_id === acceptSheetRequestId)?.business_requests);
    setQuickFrom(w.from); setQuickUntil(w.until); setQuickPicker(null);
  }, [acceptSheetRequestId]);

  async function submitQuickResponse(requestId, { offerType, offerDescription, proposedTime = null, availableFrom = null, availableUntil = null }) {
    setRespondingOpportunityId(requestId);
    try {
      const result = await submitBusinessOfferResponseForScreening(selectedPartner.id, requestId, { offerType, offerDescription, proposedTime, availableFrom, availableUntil });
      await handleOfferResult(result, () => { setAcceptSheetRequestId(null); setAltSheetRequestId(null); }, { offer_type: offerType });
    } catch (e) {
      presentRecoverableError(Alert, { what: 'send your response', error: e, draftKept: true, onRetry: () => submitQuickResponse(requestId, { offerType, offerDescription, proposedTime, availableFrom, availableUntil }) });
    }
    setRespondingOpportunityId(null);
  }

  // Explicit "Read this for me" tap only. Fills EMPTY form fields with suggestions; nothing is saved or sent (Send Offer is the
  // confirmation, and screening + the discount cap still run on whatever the owner leaves in the form).
  async function handleReadCreative() {
    if (!offerPickedMediaAsset || readingCreative) return;
    setReadingCreative(true);
    setCreativeDetected(null);
    try {
      let upload = creativeUpload && creativeUpload.asset === offerPickedMediaAsset ? creativeUpload : null;
      if (!upload) {
        const uploaded = await uploadBusinessOfferMedia(selectedPartner.id, offerPickedMediaAsset, 'offer');
        const frames = uploaded.mediaType === 'video' ? await uploadOfferVideoFrames(selectedPartner.id, offerPickedMediaAsset) : [];
        upload = { asset: offerPickedMediaAsset, mediaPath: uploaded.path, mediaType: uploaded.mediaType, framePaths: frames };
        setCreativeUpload(upload);
      }
      const suggestions = sanitizeCreativeSuggestions(await readOfferCreative(selectedPartner.id, upload));
      if (!hasAnySuggestion(suggestions)) { setCreativeDetected({ none: true }); return; }
      const patch = creativeFormPatch(suggestions, {
        title: offerTitleInput, description: offerDescriptionInput, price: offerPriceInput, discountPct: offerDiscountInput,
        redemption: offerRedemptionInput, validDay: offerValidDay, offerType: offerTypeInput,
      });
      if (patch.title != null) setOfferTitleInput(patch.title);
      if (patch.description != null) setOfferDescriptionInput(patch.description);
      if (patch.price != null) setOfferPriceInput(patch.price);
      if (patch.offerType) setOfferTypeInput(patch.offerType);
      if (patch.discountPct != null) setOfferDiscountInput(patch.discountPct);
      if (patch.redemption != null) setOfferRedemptionInput(patch.redemption);
      // Day only: the end time stays empty until the owner picks it (nothing invents a time).
      if (patch.validDay) { setOfferValidDay(patch.validDay); setOfferValidTime(null); setShowValidTimePicker(false); }
      setCreativeDetected({
        summary: detectedSummary(suggestions, selectedPartner?.name),
        warning: extractedDiscountWarning(suggestions, discountCap),
      });
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleReadCreative() });
    } finally {
      setReadingCreative(false);
    }
  }

  // "See it in plain language" (owner item 59, option 1): an explicit tap only. Shows a SUGGESTION beside the owner's own
  // wording; nothing in the form changes unless the owner taps "Use this wording" (acceptPlainLanguage re-checks the guard).
  async function handlePlainLanguage() {
    if (requestingPlainLanguage || !offerDescriptionInput.trim()) return;
    setRequestingPlainLanguage(true);
    setPlainLanguageSuggestion(null);
    const original = { title: offerTitleInput, description: offerDescriptionInput };
    try {
      const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };
      const { suggestion, message } = await rewriteOfferPlainLanguage(selectedPartner.id, {
        ...original,
        ...plainLanguageContext({
          price: num(offerPriceInput), discountPct: num(offerDiscountInput), offerType: offerTypeInput,
          proposedTime: offerProposedTime, availableFrom: offerAvailFrom, availableUntil: offerAvailUntil, redemption: offerRedemptionInput,
        }),
      });
      if (!suggestion || claimProblem(suggestion, original)) {
        setPlainLanguageSuggestion({ none: true, message: message || t('ui.bizDash1.weCouldntSuggestWordingThat') });
      } else if (!plainLanguageDiffers(suggestion, original)) {
        setPlainLanguageSuggestion({ none: true, message: t('ui.bizDash1.yourWordingIsAlreadyPlain') });
      } else {
        setPlainLanguageSuggestion({ ...sanitizePlainLanguageSuggestion(suggestion), basedOn: original });
      }
    } catch (e) {
      presentRecoverableError(Alert, { what: 'suggest plain wording', error: e, onRetry: () => handlePlainLanguage() });
    } finally {
      setRequestingPlainLanguage(false);
    }
  }

  function applyPlainLanguageSuggestion() {
    // Only if the owner has not edited since asking: the suggestion rewords THAT text, not whatever is there now.
    const s = plainLanguageSuggestion;
    if (!s || s.none || s.basedOn.description !== offerDescriptionInput || s.basedOn.title !== offerTitleInput) {
      setPlainLanguageSuggestion(null);
      return;
    }
    const patch = acceptPlainLanguage(s, s.basedOn);
    if (patch) { setOfferTitleInput(patch.title); setOfferDescriptionInput(patch.description); }
    setPlainLanguageSuggestion(null);
  }

  // One validation for both Preview and Send, so a preview can never show something Send would refuse. null = invalid (already alerted).
  function validateOfferForm() {
    if (!offerDescriptionInput.trim()) {
      Alert.alert(t('ui.bizDash1.addADescription'), t('ui.bizDash1.sayWhatYouCanOffer'));
      return null;
    }
    if (offerTypeInput === 'alt_time' && !offerProposedTime) {
      Alert.alert(t('ui.bizDash1.pickATime'), t('ui.bizDash1.chooseTheTimeYouRe'));
      return null;
    }
    const capProblem = discountCapProblem({ offerType: offerTypeInput, pctInput: offerDiscountInput, cap: discountCap });
    if (capProblem) {
      Alert.alert(t('ui.bizDash1.discountAboveYourLimit'), capProblem);
      return null;
    }
    const validity = validUntilFromChoice(offerValidDay, offerValidTime);
    if (validity.error) {
      Alert.alert(t('ui.bizDash1.endTime'), validity.error);
      return null;
    }
    const availWindow = availableWindowFromChoice(offerAvailFrom, offerAvailUntil);
    if (availWindow.error) {
      Alert.alert(t('ui.bizDash1.availableWindow'), availWindow.error);
      return null;
    }
    return { validity, availWindow };
  }

  // Item 84: check, then show the customer's view before anything is sent.
  function handlePreviewOffer() {
    if (validateOfferForm()) setOfferPreviewing(true);
  }

  async function handleSubmitOffer() {
    const checked = validateOfferForm();
    if (!checked) return;
    const { validity, availWindow } = checked;
    setRespondingOpportunityId(offerModalRequestId);
    try {
      let mediaPath = null;
      let mediaType = null;
      let framePaths = [];
      if (offerPickedMediaAsset && !offerCreativeId) {
        if (creativeUpload && creativeUpload.asset === offerPickedMediaAsset) {
          // Already uploaded for "Read this for me" -- reuse it (screening still runs on it below, unchanged).
          ({ mediaPath, mediaType, framePaths } = creativeUpload);
        } else {
          const uploaded = await uploadBusinessOfferMedia(selectedPartner.id, offerPickedMediaAsset, 'offer');
          mediaPath = uploaded.path;
          mediaType = uploaded.mediaType;
          // A video is screened through preview frames sampled on the device; the first becomes its poster.
          if (mediaType === 'video') framePaths = await uploadOfferVideoFrames(selectedPartner.id, offerPickedMediaAsset);
        }
      }

      const priceNum = offerPriceInput.trim() ? parseFloat(offerPriceInput.trim()) : null;
      const result = await submitBusinessOfferResponseForScreening(selectedPartner.id, offerModalRequestId, {
        offerType: offerTypeInput,
        offerDescription: offerDescriptionInput.trim(),
        offerPrice: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : null,
        proposedTime: offerTypeInput === 'alt_time' && offerProposedTime ? offerProposedTime.toISOString() : null,
        experienceId: selectedExperienceIdInput,
        mediaPath,
        mediaType,
        offerTitle: offerTitleInput.trim() || null,
        includedItems: offerIncludedItemsInput,
        priceIsPerPerson: offerPriceIsPerPerson,
        discountPct: parseDiscountPct(offerDiscountInput),
        framePaths,
        redemptionInstructions: offerRedemptionInput.trim() || null,
        creativeId: offerCreativeId,
        validUntil: validity.iso,
        availableFrom: availWindow.from,
        availableUntil: availWindow.until,
        queue: true,
      });

      if (result.queued) {
        // Saved on the server and screening in the background: the form is done, the draft is no longer needed.
        offerDraft.clear();
        setOfferModalRequestId(null);
        if (resendingSubmissionId) { try { await dismissOfferSubmission(resendingSubmissionId); } catch (_e) { /* the old note just stays listed */ } setResendingSubmissionId(null); }
        await loadOfferSubmissions(selectedPartner.id);
        showSuccessToast(...offerQueuedConfirmation());
      } else {
        await handleOfferResult(result, () => { offerDraft.clear(); setOfferModalRequestId(null); }, {
          // the reply's real fields, so the same classification as Activity/Request Detail names it (item 121/123)
          offer_type: offerTypeInput, offer_title: offerTitleInput.trim() || null, offer_price: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : null,
          discount_pct: parseDiscountPct(offerDiscountInput), included_items: offerIncludedItemsInput,
        });
      }
    } catch (e) {
      presentRecoverableError(Alert, { what: 'send this offer', error: e, draftKept: true, onRetry: () => handleSubmitOffer() });
    }
    setRespondingOpportunityId(null);
  }

  // Phase 1 -- a real reason picker, never a silent one-tap decline. The
  // "Can't accommodate" tap opens this modal instead of calling the RPC
  // directly; the actual decline_business_offer() call now only ever
  // happens from handleSubmitDecline() below, once a real reason is set.
  function openDeclineModal(requestId) {
    setDeclineModalRequestId(requestId);
    setDeclineReasonInput(null);
    setDeclineNoteInput('');
  }

  async function handleSubmitDecline() {
    if (!declineReasonInput) return;
    setRespondingOpportunityId(declineModalRequestId);
    try {
      await declineBusinessOpportunity(
        declineModalRequestId,
        declineReasonInput,
        declineReasonInput === 'other' ? declineNoteInput.trim() || null : null
      );
      setDeclineModalRequestId(null);
      await loadOpportunities(selectedPartner.id);
      loadDeclinePatterns(selectedPartner.id);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSubmitDecline() });
    }
    setRespondingOpportunityId(null);
  }

  // Item 50 (CLAUDE.md) fix 5: the business's own side of "this fell
  // through" -- mirrors BusinessRequestDetailScreen's consumer-side action
  // over the same RPC. The RPC's own "already paid" rejection surfaces
  // here unchanged.
  function handleMarkNoShow(offerId) {
    Alert.alert(t('ui.bizDash1.markAsDidntShowUp'), t('ui.bizDash1.thisIsOnlyForYour'), [
      { text: t('ui.bizDash1.neverMind'), style: 'cancel' },
      {
        text: t('ui.bizDash1.didntShowUp'), onPress: async () => {
          setMarkingNoShowId(offerId);
          try {
            await markBusinessNoShow(offerId);
            setNoShowIds((prev) => new Set([...prev, offerId]));
          } catch (e) {
            presentRecoverableError(Alert, { what: 'mark that visit', error: e, onRetry: () => handleMarkNoShow(offerId) });
          }
          setMarkingNoShowId(null);
        },
      },
    ]);
  }

  function handleCancelReservation(offerId) {
    Alert.alert(t('ui.bizDash1.cancelThisReservation'), t('ui.bizDash1.theCustomerWillBeNotified'), [
      { text: t('ui.bizDash1.neverMind'), style: 'cancel' },
      {
        text: t('ui.bizDash1.cancelReservation'), style: 'destructive', onPress: async () => {
          setCancellingReservationOfferId(offerId);
          try {
            await cancelBusinessReservation(offerId);
            await loadOpportunities(selectedPartner.id);
            loadCancellationPatterns(selectedPartner.id);
            setReasonAsk({ entityType: 'business_reservation', entityId: offerId, role: 'business' });
          } catch (e) {
            presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleCancelReservation(offerId) });
          }
          setCancellingReservationOfferId(null);
        },
      },
    ]);
  }

  async function loadMyAvailability(partnerId) {
    try {
      const results = await getMyBusinessAvailability(partnerId);
      setMyAvailability(results);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
    }
  }

  async function loadFulfillmentPolicy(partnerId) {
    try {
      const result = await getMyBusinessFulfillmentPolicy(partnerId);
      setFulfillmentPolicy(result);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
    }
  }

  // Item 68 (CLAUDE.md): loads every one of the caller's own packages,
  // active or paused -- get_my_occasion_packages() is already scoped to
  // the caller's own managed_partner_id, no partnerId param needed.
  async function loadMyOccasionPackages() {
    try {
      const results = await getMyOccasionPackages();
      setMyOccasionPackages(results);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
    }
  }

  // Item 102 (CLAUDE.md): real, consented returning customers with a
  // genuine next occurrence coming up soon -- see the RPC's own header
  // comment for the full consent/ownership boundary.
  async function loadReturningCustomers(partnerId) {
    try {
      const results = await getBusinessReturningOccasionCustomers(partnerId);
      setReturningCustomers(results);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
    }
  }

  function toggleOutreachExpanded(occasionId) {
    setOutreachPackageChoice(null);
    setOutreachExpandedOccasionId((prev) => (prev === occasionId ? null : occasionId));
  }

  async function handleSendOutreach(occasionId, partnerId) {
    setSendingOutreachOccasionId(occasionId);
    try {
      await sendBusinessRecallOutreach(occasionId, partnerId, outreachPackageChoice);
      setReturningCustomers((prev) => prev.map((c) => (c.occasion_id === occasionId ? { ...c, already_outreached_this_year: true } : c)));
      setOutreachExpandedOccasionId(null);
      setOutreachPackageChoice(null);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSendOutreach(occasionId, partnerId) });
    }
    setSendingOutreachOccasionId(null);
  }

  function openPackageModal(pkg) {
    setEditingPackageId(pkg?.id ?? null);
    setPackageOccasionInput(pkg?.occasion_type ?? null);
    setPackageNameInput(pkg?.name ?? '');
    setPackageDescriptionInput(pkg?.description ?? '');
    setPackageIncludedItemsInput(Array.isArray(pkg?.included_items) ? pkg.included_items : []);
    setPackageIncludedItemDraft('');
    setPackageMinGuestsInput(pkg?.min_guests != null ? String(pkg.min_guests) : '');
    setPackagePriceInput(pkg?.price_per_person != null ? String(pkg.price_per_person) : '');
    setPackageAvailableDaysInput(Array.isArray(pkg?.available_days) ? pkg.available_days : []);
    setPackageModalVisible(true);
  }

  function togglePackageAvailableDay(dayKey) {
    setPackageAvailableDaysInput((prev) =>
      prev.includes(dayKey) ? prev.filter((d) => d !== dayKey) : [...prev, dayKey].sort((a, b) => a - b)
    );
  }

  function addPackageIncludedItem() {
    const trimmed = packageIncludedItemDraft.trim();
    if (!trimmed) return;
    setPackageIncludedItemsInput((prev) => [...prev, trimmed]);
    setPackageIncludedItemDraft('');
  }

  function removePackageIncludedItem(index) {
    setPackageIncludedItemsInput((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSavePackage() {
    if (!packageOccasionInput) {
      Alert.alert(t('ui.bizDash1.pickAnOccasion'), t('ui.bizDash1.sayWhichOccasionThisPackage'));
      return;
    }
    if (!packageNameInput.trim()) {
      Alert.alert(t('ui.bizDash1.addAName'), t('ui.bizDash1.giveThisPackageAReal'));
      return;
    }
    setSavingPackage(true);
    try {
      const minGuestsNum = packageMinGuestsInput.trim() ? parseInt(packageMinGuestsInput.trim(), 10) : null;
      const priceNum = packagePriceInput.trim() ? parseFloat(packagePriceInput.trim()) : null;
      const params = {
        occasionType: packageOccasionInput,
        name: packageNameInput.trim(),
        description: packageDescriptionInput.trim() || null,
        includedItems: packageIncludedItemsInput,
        minGuests: Number.isFinite(minGuestsNum) && minGuestsNum > 0 ? minGuestsNum : null,
        pricePerPerson: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : null,
        availableDays: packageAvailableDaysInput.length > 0 ? packageAvailableDaysInput : null,
      };
      if (editingPackageId) {
        await updateOccasionPackage(editingPackageId, params);
      } else {
        await createOccasionPackage(params);
      }
      settingConflicts.clear('package');
      setPackageModalVisible(false);
      await loadMyOccasionPackages();
    } catch (e) {
      if (!settingConflicts.report('package', e, { check: { kind: 'package', patch: { occasion_type: packageOccasionInput } } })) {
        presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSavePackage() });
      }
    }
    setSavingPackage(false);
  }

  function handleTogglePackageActive(pkg) {
    Alert.alert(
      pkg.active ? t('ui.bizDash1.pauseThisPackage') : t('ui.bizDash1.resumeThisPackage'),
      pkg.active
        ? t('ui.bizDash1.itWillStopShowingUp')
        : t('ui.bizDash1.itWillStartShowingUp'),
      [
        { text: t('ui.bizDash1.neverMind'), style: 'cancel' },
        {
          text: pkg.active ? t('ui.bizDash1.pause') : t('ui.bizDash1.resume'),
          onPress: async () => {
            try {
              await setOccasionPackageActive(pkg.id, !pkg.active);
              await loadMyOccasionPackages();
            } catch (e) {
              presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleTogglePackageActive(pkg) });
            }
          },
        },
      ]
    );
  }

  function handleDeletePackage(pkg) {
    Alert.alert(t('ui.bizDash1.deleteThisPackage'), t('ui.bizDash1.willBePermanentlyRemoved2', { name: pkg.name }), [
      { text: t('ui.bizDash1.neverMind'), style: 'cancel' },
      {
        text: t('ui.bizDash1.delete'), style: 'destructive', onPress: async () => {
          try {
            await deleteOccasionPackage(pkg.id);
            await loadMyOccasionPackages();
          } catch (e) {
            presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleDeletePackage(pkg) });
          }
        },
      },
    ]);
  }

  function openPolicyModal() {
    setPolicyPartySizeMinInput(fulfillmentPolicy?.party_size_min != null ? String(fulfillmentPolicy.party_size_min) : '');
    setPolicyPartySizeMaxInput(fulfillmentPolicy?.party_size_max != null ? String(fulfillmentPolicy.party_size_max) : '');
    setPolicyActiveHoursStartInput(fulfillmentPolicy?.active_hours_start ? fulfillmentPolicy.active_hours_start.slice(0, 5) : '');
    setPolicyActiveHoursEndInput(fulfillmentPolicy?.active_hours_end ? fulfillmentPolicy.active_hours_end.slice(0, 5) : '');
    setPolicyMinSpendInput(fulfillmentPolicy?.min_spend_per_person != null ? String(fulfillmentPolicy.min_spend_per_person) : '');
    setPolicyMaxDiscountInput(fulfillmentPolicy?.max_discount_pct != null ? String(fulfillmentPolicy.max_discount_pct) : '');
    setPolicyAutoAcceptMaxInput(fulfillmentPolicy?.auto_accept_party_size_max != null ? String(fulfillmentPolicy.auto_accept_party_size_max) : '');
    setPolicyDepositInput(fulfillmentPolicy?.deposit_amount != null ? String(fulfillmentPolicy.deposit_amount) : '');
    setPolicyCancellationWindowInput(fulfillmentPolicy?.cancellation_window_hours != null ? String(fulfillmentPolicy.cancellation_window_hours) : '');
    setPolicyActiveInput(fulfillmentPolicy?.active ?? true);
    setPolicyWeatherDependentInput(fulfillmentPolicy?.weather_dependent ?? false);
    setPolicyActiveDaysInput(Array.isArray(fulfillmentPolicy?.active_days) ? fulfillmentPolicy.active_days : []);
    setPolicyModalVisible(true);
  }

  function togglePolicyActiveDay(dayKey) {
    setPolicyActiveDaysInput((prev) =>
      prev.includes(dayKey) ? prev.filter((d) => d !== dayKey) : [...prev, dayKey].sort((a, b) => a - b)
    );
  }

  function parsePolicyInt(text) {
    const n = parseInt(text.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  function parsePolicyNum(text) {
    const n = parseFloat(text.trim());
    return Number.isFinite(n) ? n : null;
  }
  function formatWeatherCheckAge(checkedAtIso) {
    const ago = language === 'en' ? formatAgo(checkedAtIso) : displayAgo(checkedAtIso, language);
    return ago ? t('ui.bizHelp.weatherChecked', { ago }) : t('ui.bizHelp.weatherNotChecked');
  }
  function normalizeTimeInput(text) {
    // Accepts "HH:MM" (24h) only -- kept deliberately simple, matching
    // this pass's "check what's simplest" instruction rather than a
    // full time picker for a single daily window.
    const trimmed = text.trim();
    if (!trimmed) return null;
    return /^\d{1,2}:\d{2}$/.test(trimmed) ? trimmed : null;
  }

  async function handleSavePolicy() {
    setSavingPolicy(true);
    try {
      await upsertBusinessFulfillmentPolicy(selectedPartner.id, {
        partySizeMin: parsePolicyInt(policyPartySizeMinInput),
        partySizeMax: parsePolicyInt(policyPartySizeMaxInput),
        activeHoursStart: normalizeTimeInput(policyActiveHoursStartInput),
        activeHoursEnd: normalizeTimeInput(policyActiveHoursEndInput),
        minSpendPerPerson: parsePolicyNum(policyMinSpendInput),
        maxDiscountPct: parsePolicyNum(policyMaxDiscountInput),
        autoAcceptPartySizeMax: parsePolicyInt(policyAutoAcceptMaxInput),
        depositAmount: parsePolicyNum(policyDepositInput),
        cancellationWindowHours: parsePolicyInt(policyCancellationWindowInput),
        active: policyActiveInput,
        weatherDependent: policyWeatherDependentInput,
        activeDays: policyActiveDaysInput.length > 0 ? policyActiveDaysInput : null,
      });
      setPolicyModalVisible(false);
      await loadFulfillmentPolicy(selectedPartner.id);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSavePolicy() });
    }
    setSavingPolicy(false);
  }

  // "Nearby V3/V4" plan, Phase B: an optional prefill from a "Demand Near
  // You" row -- the real category (and, when Phase A's own dominant_period
  // is present, a real suggested title naming it) instead of requiring the
  // owner to separately open "+ Post Availability" and re-type it by hand.
  // Pure UI wiring -- submitBusinessAvailabilityForScreening() itself is
  // unchanged, and every field stays editable before Post, same as the
  // blank-start path.
  function openPostAvailabilityModal(prefill) {
    // Intent engine vision, layer 2 (subcategory) first increment
    // (2026-09-06): a real Demand Near You prefill (occasion/period-
    // specific) still wins when present; otherwise default to the
    // business's own declared subcategory rather than leaving this blank
    // -- a genuine, real starting point instead of nothing, still fully
    // editable/clearable before Post like every other field here.
    const category = prefill?.category ?? selectedPartner?.subcategory ?? null;
    const period = prefill?.dominantPeriod ?? null;
    setAvailabilityTitleInput(
      category ? (period && ['morning', 'afternoon', 'evening'].includes(period) ? t(`ui.bizDash1.availableThis.${period}`, { category: categoryName(category, language) }) : t('ui.bizDash1.categoryAvailable', { category: categoryName(category, language) })) : ''
    );
    setAvailabilityDescriptionInput('');
    setAvailabilityCategoryInput(category);
    setAvailabilityOfferTypeInput('standard');
    setAvailabilityPriceInput('');
    setAvailabilityDiscountInput('');
    setAvailabilityCapacityInput('');
    setAvailabilityDurationKey('2h');
    setAvailabilityWhenMode('now');
    setAvailabilityStart(null);
    setAvailabilityEnd(null);
    setShowAvailabilityPicker(null);
    setAvailabilityDemandPeople(null);
    setAvailabilityBundleOccasionInput(null);
    setAvailabilityBundleComponentsInput([]);
    setPostAvailabilityModalVisible(true);
  }

  // Business-side Experience Bundles (2026-09-10): picking a different
  // occasion invalidates any already-ticked components (they're keyed to
  // the PREVIOUS occasion's own template, e.g. "food"/"family_fun" only
  // exist under family_gathering) -- always reset, never carry stale keys
  // forward silently.
  function handleSelectBundleOccasion(occasion) {
    setAvailabilityBundleOccasionInput((prev) => (prev === occasion ? null : occasion));
    setAvailabilityBundleComponentsInput([]);
  }

  function toggleBundleComponent(key) {
    setAvailabilityBundleComponentsInput((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  // "Supply first": while the Post Availability sheet is open, ask the server how many people nearby
  // have an open request this window would match. The count is DISTINCT PEOPLE and comes back null
  // below the 5-person privacy floor -- null shows nothing (never "0"). Debounced; failure is silent
  // (the preview is a nicety, posting never depends on it).
  useEffect(() => {
    if (!postAvailabilityModalVisible || !selectedPartner?.id) {
      setAvailabilityDemandPeople(null);
      return undefined;
    }
    const duration = AVAILABILITY_DURATION_OPTIONS.find((d) => d.key === availabilityDurationKey);
    const win = resolveAvailabilityWindow({ mode: availabilityWhenMode, start: availabilityStart, end: availabilityEnd, durationHours: duration?.hours ?? null });
    if (!win || win.endsAt <= win.startsAt) {
      setAvailabilityDemandPeople(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const capacityNum = availabilityCapacityInput.trim() ? parseInt(availabilityCapacityInput.trim(), 10) : null;
        const preview = await getAvailabilityDemandPreview({
          category: availabilityCategoryInput,
          startsAt: win.startsAt.toISOString(),
          endsAt: win.endsAt.toISOString(),
          capacity: Number.isFinite(capacityNum) && capacityNum > 0 ? capacityNum : null,
        });
        if (!cancelled) setAvailabilityDemandPeople(preview.people);
      } catch (e) {
        if (!cancelled) setAvailabilityDemandPeople(null);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [postAvailabilityModalVisible, selectedPartner?.id, availabilityWhenMode, availabilityStart, availabilityEnd, availabilityDurationKey, availabilityCategoryInput, availabilityCapacityInput]);

  // Decision 6, Phase 3 -- same three-branch screening shape as the other
  // three handlers in this file. Deliberately no longer computes
  // startsAt/endsAt client-side -- durationHours (null meaning "rest of
  // today") is sent instead, and the Edge Function computes the real
  // window at the actual moment of publish (this call's own LOW-tier
  // path, or a later admin approval), so a held submission never
  // publishes with a stale, submission-time window.
  async function handlePostAvailability() {
    if (!availabilityTitleInput.trim()) {
      Alert.alert(t('ui.bizDash1.addATitle'), t('ui.bizDash1.sayWhatYouHaveAvailable'));
      return;
    }
    const availCapProblem = discountCapProblem({ offerType: availabilityOfferTypeInput, pctInput: availabilityDiscountInput, cap: discountCap });
    if (availCapProblem) {
      Alert.alert(t('ui.bizDash1.discountAboveYourLimit'), availCapProblem);
      return;
    }
    if (availabilityWhenMode === 'scheduled') {
      const windowProblem = scheduledWindowProblem({ start: availabilityStart, end: availabilityEnd });
      if (windowProblem) {
        Alert.alert(t('ui.bizDash1.pickATime'), windowProblem);
        return;
      }
    }
    setPostingAvailability(true);
    try {
      const duration = AVAILABILITY_DURATION_OPTIONS.find((d) => d.key === availabilityDurationKey);
      const priceNum = availabilityPriceInput.trim() ? parseFloat(availabilityPriceInput.trim()) : null;
      const capacityNum = availabilityCapacityInput.trim() ? parseInt(availabilityCapacityInput.trim(), 10) : null;
      const result = await submitBusinessAvailabilityForScreening(selectedPartner.id, {
        category: availabilityCategoryInput,
        title: availabilityTitleInput.trim(),
        description: availabilityDescriptionInput.trim() || null,
        offerType: availabilityOfferTypeInput,
        price: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : null,
        capacity: Number.isFinite(capacityNum) && capacityNum > 0 ? capacityNum : null,
        durationHours: duration?.hours ?? null,
        bundleOccasion: availabilityBundleOccasionInput,
        bundleComponents: availabilityBundleComponentsInput,
        discountPct: parseDiscountPct(availabilityDiscountInput),
        startsAt: availabilityWhenMode === 'scheduled' ? availabilityStart.toISOString() : null,
        endsAt: availabilityWhenMode === 'scheduled' ? availabilityEnd.toISOString() : null,
      });

      settingConflicts.clear('availability');
      if (result.published) {
        setPostAvailabilityModalVisible(false);
        await loadMyAvailability(selectedPartner.id);
        // Phase 4(c): a real, persistent card (not a one-shot Alert) --
        // stays visible on the dashboard until the owner dismisses it,
        // sourced purely from the real matchedCount post_business_
        // availability() already computes -- no new backend logic.
        setLastPostedAvailability({
          title: availabilityTitleInput.trim(),
          matchedCount: result.matchedCount ?? null, // null = below the privacy floor (or none): never shown as a number
        });
      } else if (result.blocked) {
        Alert.alert(
          t('ui.bizDash1.couldntPost'),
          t('ui.bizDash1.thisContentCouldntBePublished')
        );
      } else {
        setPostAvailabilityModalVisible(false);
        Alert.alert(
          t('ui.bizDash1.submittedForReview'),
          t('ui.bizDash1.thisAvailabilityPostingIsBeing')
        );
      }
    } catch (e) {
      if (!settingConflicts.report('availability', e, { check: { kind: 'availability', patch: { bundle_occasion: availabilityBundleOccasionInput } } })) {
        presentRecoverableError(Alert, { what: 'post your availability', error: e, draftKept: true, onRetry: () => handlePostAvailability() });
      }
    }
    setPostingAvailability(false);
  }

  async function handleCancelAvailability(availabilityId) {
    setCancelingAvailabilityId(availabilityId);
    try {
      await cancelBusinessAvailability(availabilityId);
      await loadMyAvailability(selectedPartner.id);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleCancelAvailability(availabilityId) });
    }
    setCancelingAvailabilityId(null);
  }

  async function handleRespondToPartnershipRequest(requestId, approve) {
    setRespondingToRequestId(requestId);
    try {
      await respondToBusinessPartnershipRequest(requestId, approve);
      setPartnershipRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleRespondToPartnershipRequest(requestId, approve) });
    }
    setRespondingToRequestId(null);
  }

  async function loadStats(partnerId) {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_business_dashboard_stats', { partner_id_param: partnerId });
      if (error) throw error;
      setStats(data?.[0] ?? null);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  async function loadOffers(partnerId) {
    try {
      const results = await getMyBusinessOffers(partnerId);
      setOffers(results);
      const counts = await getRedemptionCounts(results.map((o) => o.id));
      setOfferRedemptionCounts(counts);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
      console.error('loadOffers failed', e);
    }
  }

  async function loadGatherings(partnerId) {
    try {
      const results = await getMyBusinessGatherings(partnerId);
      setGatherings(results);

      const breakdowns = await Promise.all(
        results.map(async (g) => {
          const { data } = await supabase.rpc('get_gathering_attendee_breakdown', { gathering_id_param: g.id });
          return [g.id, data?.[0] ?? null];
        })
      );
      setGatheringBreakdowns(Object.fromEntries(breakdowns));
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
      console.error('loadGatherings failed', e);
    }
  }

  async function loadGrowth(partnerId) {
    try {
      const { data, error } = await supabase.rpc('get_business_growth', { partner_id_param: partnerId });
      if (!error) setGrowth(data?.[0] ?? null);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
      console.error('loadGrowth failed', e);
    }
  }

  async function loadConversations(partnerId) {
    try {
      const results = await getBusinessConversations(partnerId);
      setConversations(results);
      return results;
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
      // Returning [] (rather than letting this reject) also keeps the
      // .then(loadNeedsAttention) chain in useFocusEffect from silently
      // never running at all on a failure.
      console.error('loadConversations failed', e);
      return [];
    }
  }

  async function loadNeedsAttention(partnerId, conversationsList) {
    try {
      // Genuine, real actionable items — not invented busywork. A
      // pending gathering approval and unread messages are the only
      // two things I can compute honestly right now without guessing.
      const tasks = [];

      const { count: pendingCount } = await supabase
        .from('gathering_interest')
        .select('id, gatherings!inner(hosting_partner_id)', { count: 'exact', head: true })
        .eq('gatherings.hosting_partner_id', partnerId)
        .eq('status', 'pending');
      if (pendingCount > 0) {
        tasks.push({ label: `${pendingCount} attendee request${pendingCount === 1 ? '' : 's'} waiting for approval`, onPress: () => setSection('gatherings') });
      }

      // fromBusiness comes straight off get_business_conversations_summary's
      // last_from_business column now (see getBusinessConversations) — the
      // old client-grouped version never actually carried this field, so
      // this filter was silently always true (`!undefined`) before.
      const unreadCount = conversationsList.filter((c) => !c.fromBusiness).length;
      if (unreadCount > 0) {
        tasks.push({ label: `${unreadCount} conversation${unreadCount === 1 ? '' : 's'} waiting for a reply`, onPress: () => setSection('inbox_modal') });
      }

      setNeedsAttention(tasks);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
      console.error('loadNeedsAttention failed', e);
    }
  }

  async function loadTopMembers(partnerId) {
    try {
      const results = await getBusinessTopMembers(partnerId);
      setTopMembers(results);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
      console.error('loadTopMembers failed', e);
    }
  }

  async function handleToggleMemberHistory(member) {
    if (expandedMemberId === member.user_id) {
      setExpandedMemberId(null);
      return;
    }
    setExpandedMemberId(member.user_id);
    if (!memberHistories[member.user_id]) {
      setLoadingMemberHistory(true);
      try {
        const history = await getBusinessMemberGatheringHistory(selectedPartner.id, member.user_id);
        setMemberHistories((prev) => ({ ...prev, [member.user_id]: history }));
      } catch (e) {
        console.error('Failed to load member gathering history', e);
      } finally {
        setLoadingMemberHistory(false);
      }
    }
    try {
      const existingNote = await getBusinessCustomerNote(selectedPartner.id, member.user_id);
      setNoteDraft(existingNote?.note ?? '');
      setTagsDraft((existingNote?.tags ?? []).join(', '));
    } catch (e) {
      console.error('Failed to load business customer note', e);
    }
  }

  async function handleSaveNote(member) {
    setSavingNote(true);
    try {
      const tags = tagsDraft.split(',').map((t) => t.trim()).filter(Boolean);
      await saveBusinessCustomerNote(selectedPartner.id, member.user_id, noteDraft.trim() || null, tags);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSaveNote(member) });
    }
    setSavingNote(false);
  }

  function handleMessageMember(member) {
    setSection('inbox_modal');
    openConversation({ userId: member.user_id, displayName: member.display_name });
  }

  async function loadVisitFrequency(partnerId) {
    try {
      const result = await getBusinessVisitFrequency(partnerId);
      setVisitFrequency(result);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
      console.error('loadVisitFrequency failed', e);
    }
  }

  // Bounded to the most recent 50 rather than the full thread — this view
  // has no infinite-scroll UI (it's a plain owner-side drill-in, not the
  // customer's own chat screen), so a plain cap is the right-sized fix
  // here rather than building full pagination for a lower-traffic surface
  // (see the Aug 10 2026 scalability audit's own "lighter fix" convention).
  // getBusinessMessagesPage returns newest-first; reversed here since this
  // screen renders its thread oldest-to-newest in a plain (non-inverted) list.
  async function loadConversationMessages(userId) {
    try {
      const page = await getBusinessMessagesPage(selectedPartner.id, userId);
      setConversationMessages([...page].reverse());
    } catch (e) {
      // A failed load must not read as an empty conversation.
      Alert.alert(t('ui.bizDash1.couldntLoadThisConversation'), t('ui.bizDash1.pleaseTryAgain'));
    }
  }

  async function openConversation(convo) {
    setActiveConversation(convo);
    await loadConversationMessages(convo.userId);
  }

  async function sendReply() {
    if (!replyText.trim()) return;
    try {
      await replyAsBusinessOwner(selectedPartner.id, activeConversation.userId, replyText.trim());
      setReplyText('');
      await loadConversationMessages(activeConversation.userId);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => sendReply() });
    }
  }

  async function loadInsights(partnerId) {
    try {
      const result = await getBusinessInsights(partnerId);
      setInsights(result);
      // A failed lookup is UNKNOWN (null), never a fabricated 0 redemptions / $0.
      const owed = await getEstimatedAmountOwed(partnerId).catch(() => ({ redemptionCount: null, estimatedAmount: null, billingModel: null }));
      setEstimatedOwed(owed);
      getMyInvoices(partnerId).then(setPastInvoices).catch(() => setPastInvoices([]));
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
      console.error('loadInsights failed', e);
    }
  }

  // Business Intelligence & Opportunity Engine, Phase 4 -- "Learning."
  // Both real, non-fatal secondary loads, matching this screen's own
  // established convention.
  async function loadMissedMatchSummary(partnerId) {
    try {
      const result = await getMissedMatchSummary(partnerId);
      setMissedMatchSummary(result);
      setMissedMatchLocked(false);
    } catch (e) {
      const entitlementError = parseEntitlementError(e);
      if (entitlementError?.kind === 'required') {
        setMissedMatchLocked(true);
      } else {
        console.error('loadMissedMatchSummary failed', e);
      }
    }
  }

  async function loadCategoryOutcomes(partnerId) {
    try {
      const result = await getPartnerCategoryOutcomes(partnerId);
      setCategoryOutcomes(result);
      setCategoryOutcomesLocked(false);
    } catch (e) {
      const entitlementError = parseEntitlementError(e);
      if (entitlementError?.kind === 'required') {
        setCategoryOutcomesLocked(true);
      } else {
        console.error('loadCategoryOutcomes failed', e);
      }
    }
  }

  // Phase 1 -- real, owner-only, aggregated decline reasons. Never
  // entitlement-gated (per the locked plan: "owner-only... never exposed
  // to anyone but the business itself"), so no locked-state branch is
  // needed here the way missed-match/category-outcomes have one.
  async function loadCancellationPatterns(partnerId) {
    try {
      setCancellationPatterns(await getPartnerCancellationPatterns(partnerId));
    } catch (e) {
      console.error('loadCancellationPatterns failed', e);
    }
  }

  // Owner-only "how well your matches land"; the server returns null below 5 distinct people, so nothing renders.
  async function loadMatchFit(partnerId) {
    try {
      setMatchFit(await getPartnerMatchFit(partnerId));
    } catch (e) {
      console.error('loadMatchFit failed', e);
    }
  }

  async function loadDeclinePatterns(partnerId) {
    try {
      const result = await getPartnerDeclinePatterns(partnerId);
      setDeclinePatterns(result);
    } catch (e) {
      console.error('loadDeclinePatterns failed', e);
    }
  }

  // "Business Web as an Operating System" Phase 3 -- the real per-template
  // offer-performance funnel (Offer / Viewed / Accepted / Redeemed), built
  // entirely over already-tracked data via the new experience_id column on
  // business_request_offers. Owner-only, same non-fatal loader shape as
  // every other Insights-tab section on this screen.
  async function loadOfferPerformance(partnerId) {
    try {
      const result = await getPartnerOfferPerformance(partnerId);
      setOfferPerformance(result);
      getPartnerOfferValue(partnerId).then(setOfferValue).catch(() => setOfferValue(null));
      getPartnerOfferFunnel(partnerId).then(setOfferFunnel).catch(() => setOfferFunnel(null));
    } catch (e) {
      console.error('loadOfferPerformance failed', e);
    }
  }

  // Business Partner acquisition experience, Milestone 4 (see CLAUDE.md): the real, honest
  // "how are people discovering you" signal -- deep-link/QR opens vs. everything else, backed
  // by real business_profile_views rows, not a fabricated attribution.
  async function loadDiscoveryStats(partnerId) {
    try {
      const result = await getBusinessDiscoveryStats(partnerId);
      setDiscoveryStats(result);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
      console.error('loadDiscoveryStats failed', e);
    }
  }

  async function loadCommunities(partnerId) {
    try {
      const results = await getBusinessCommunities(partnerId);
      setCommunities(results);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
      console.error('loadCommunities failed', e);
    }
  }

  function formatDate(iso) {
    return displayDateTime(iso, language);
  }

  // Gap 3 of the merged gathering/date <-> business UX (see CLAUDE.md's
  // own plan): names the real, specific thing an accepted offer is
  // actually tied to -- a real gathering (its own real title/date, via
  // getBusinessOpportunities()'s new gatherings() embed), a real date
  // (Offer System Phase 5's match_id-sourced requests, which have no
  // fixed date of their own -- the offer's own proposed_time is the real
  // meeting time), or a plain solo ask -- instead of the generic
  // "accepted offer" label the Business Opportunities list below already
  // shows for the identical row.
  function describeVisit(o) {
    const br = o.business_requests;
    const soloWhen = o.proposed_time
      ? formatDate(o.proposed_time)
      : br?.date
      ? displayDay(`${br.date}T00:00:00`, language)
      : null;
    if (br?.gatherings) {
      // Item 69 (CLAUDE.md): a gathering's own host-chosen title could
      // just as easily carry a real name as any occasion-composed one --
      // get_business_opportunities() no longer returns it at all, only
      // the gathering's real (non-identity) interest_tag.
      const tagLabel = br.gatherings.interest_tag ? t('ui.bizDash1.gathering', { interestTag: categoryName(br.gatherings.interest_tag, language) }) : t('ui.bizDash1.aGathering');
      return { kicker: t('ui.bizDash1.aGathering2'), title: tagLabel, when: br.gatherings.scheduled_at ? formatDate(br.gatherings.scheduled_at) : soloWhen };
    }
    if (br?.is_match_request) {
      return { kicker: t('ui.bizDash1.aDate'), title: t('ui.bizDash1.twoPeoplePlanningToVisit'), when: soloWhen };
    }
    return { kicker: t('ui.bizDash1.aRequest'), title: br?.summary ?? t('ui.bizDash1.aVisit'), when: soloWhen };
  }

  // Business moment — CLAUDE.md items 11/13: the real, honest version of
  // "going live to promote a business," reusing the exact stories
  // infrastructure (real photo/video, real 24h expiry) rather than actual
  // live video streaming, which needs a real paid CDN/ingest vendor this
  // app doesn't have. Surfaces in Discover's "Happening Nearby" row.
  async function handlePostMoment() {
    if (!selectedPartner) return;
    // Business Intelligence Phase 8: check the already-loaded entitlement
    // before ever opening the camera -- a real, honest upgrade prompt
    // instead of letting someone go through the whole capture flow only
    // to have the server's enforce_business_moment_entitlement() trigger
    // reject it at the very end. The trigger stays the real gate either
    // way (a stale/unfetched `entitlements` never bypasses it).
    if (entitlements && !hasEntitlement(entitlements, 'business_moments')) {
      showUpgradePlaceholder('business_moments');
      return;
    }
    try {
      const media = await captureStoryMedia();
      if (!media) return;
      const { data: sessionData } = await supabase.auth.getSession();
      const myUserId = sessionData?.session?.user?.id;
      if (!myUserId) return;
      setPostingMoment(true);
      await uploadBusinessMoment(myUserId, selectedPartner.id, media.uri, media.type);
      showSuccessToast(t('ui.bizDash1.posted'), t('ui.bizDash1.yourMomentIsLiveFor'));
    } catch (e) {
      const entitlementError = parseEntitlementError(e);
      if (entitlementError) {
        showUpgradePlaceholder(entitlementError.feature);
      } else {
        presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handlePostMoment() });
      }
    }
    setPostingMoment(false);
  }

  // Decision 6, Phase 3 -- title AND body both screened, the confirmed
  // gap the locked design names directly (only the title was ever
  // checked before this phase). Same three-branch shape as every other
  // handler in this file.
  async function handlePostUpdate() {
    if (!updateTitle.trim()) {
      return Alert.alert(t('ui.bizDash1.titleRequired'), t('ui.bizDash1.giveYourUpdateAShort'));
    }
    setPostingUpdate(true);
    try {
      const result = await submitBusinessUpdateForScreening(selectedPartner.id, updateTitle.trim(), updateBody.trim() || null);

      if (result.published) {
        setUpdateModalVisible(false);
        setUpdateTitle('');
        setUpdateBody('');
        showSuccessToast(t('ui.bizDash1.sent'), t('ui.bizDash1.yourFollowersHaveBeenNotified'));
      } else if (result.blocked) {
        Alert.alert(
          t('ui.bizDash1.couldntSend'),
          t('ui.bizDash1.thisContentCouldntBeSent')
        );
      } else {
        setUpdateModalVisible(false);
        Alert.alert(
          t('ui.bizDash1.submittedForReview'),
          t('ui.bizDash1.thisUpdateIsBeingReviewed')
        );
      }
    } catch (e) {
      presentRecoverableError(Alert, { what: 'send your update', error: e, draftKept: true, onRetry: () => handlePostUpdate() });
    }
    setPostingUpdate(false);
  }

  async function handleCreateOffer() {
    if (!newTitle.trim()) {
      return Alert.alert(t('ui.bizDash1.titleRequired'), t('ui.bizDash1.giveYourOfferATitle'));
    }
    if (unlockEnabled) {
      const minMembers = parseInt(newUnlockMinMembers.trim(), 10);
      if (!minMembers || minMembers < 1) {
        return Alert.alert(t('ui.bizDash1.minimumRequired'), t('ui.bizDash1.enterHowManyMembersAre'));
      }
      if (!offerGatheringId && !unlockCommunityId) {
        return Alert.alert(t('ui.bizDash1.pickACommunity'), t('ui.bizDash1.chooseWhichOfYourCommunities'));
      }
    }
    setSubmitting(true);
    try {
      const unlockScope = unlockEnabled ? (offerGatheringId ? 'gathering' : 'community') : null;
      // Business Partner acquisition experience, Milestone 6 (see CLAUDE.md):
      // "first" is checked against the already-loaded offers list before this
      // insert, not re-derived from a post-insert count -- a real, honest
      // signal of the business's actual first-ever offer, not every offer.
      const isFirstOffer = offers.length === 0;
      const result = await submitBusinessOfferForScreening(selectedPartner.id, {
        title: newTitle.trim(),
        description: newDescription.trim() || null,
        rewardType: 'discount',
        redemptionInstructions: newInstructions.trim() || null,
        gatheringId: offerGatheringId,
        redemptionLimit: newRedemptionLimit.trim() ? parseInt(newRedemptionLimit.trim(), 10) : null,
        targetInterestTag: newTargetInterestTag.trim() || null,
        unlockScope,
        unlockCommunityId: unlockScope === 'community' ? unlockCommunityId : null,
        unlockMinMembers: unlockScope ? parseInt(newUnlockMinMembers.trim(), 10) : null,
      });

      if (result.published) {
        if (isFirstOffer) {
          logBusinessAcquisitionEvent(sessionId, 'first_offer_created', { partnerId: selectedPartner.id });
        }
        setCreateModalVisible(false);
        setNewTitle('');
        setNewDescription('');
        setNewInstructions('');
        setOfferGatheringId(null);
        setNewRedemptionLimit('');
        setNewTargetInterestTag('');
        setUnlockEnabled(false);
        setUnlockCommunityId(null);
        setNewUnlockMinMembers('');
        loadOffers(selectedPartner.id);
      } else if (result.blocked) {
        Alert.alert(
          t('ui.bizDash1.couldntPublish'),
          t('ui.bizDash1.thisContentCouldntBePublished')
        );
      } else {
        setCreateModalVisible(false);
        Alert.alert(
          t('ui.bizDash1.submittedForReview'),
          t('ui.bizDash1.thisOfferIsBeingReviewed')
        );
      }
    } catch (e) {
      presentRecoverableError(Alert, { what: 'save your offer', error: e, draftKept: true, onRetry: () => handleCreateOffer() });
    }
    setSubmitting(false);
  }

  async function handleToggleActive(offer) {
    try {
      await toggleOfferActive(offer.id, !offer.active);
      loadOffers(selectedPartner.id);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleToggleActive(offer) });
    }
  }

  async function handleConfirmRedemption() {
    if (!redemptionCodeInput.trim()) return;
    setConfirmingCode(true);
    try {
      const result = await confirmOfferRedemption(redemptionCodeInput);
      if (result.success) {
        showSuccessToast(t('ui.bizDash1.confirmed'), (result.redeemedByName ? t('ui.bizDash1.sRedemptionOfIsConfirmed', { name: result.redeemedByName, offerTitle: result.offerTitle }) : t('ui.bizDash1.redemptionOfIsConfirmed', { offerTitle: result.offerTitle })));
        setRedemptionCodeInput('');
        loadOffers(selectedPartner.id);
      } else {
        Alert.alert(t('ui.bizDash1.notConfirmed'), result.error || t('ui.bizDash1.thatCodeDoesntMatchA'));
      }
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleConfirmRedemption() });
    } finally {
      setConfirmingCode(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{t('ui.bizDash1.businessMode')}</Text>
          <TouchableOpacity
            onPress={() => setSection('inbox_modal')}
            accessibilityLabel={t('ui.bizDash1.messagesA11y')}
            accessibilityRole="button"
          >
            <Text style={{ fontSize: 22 }}>💬</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.partnerSelector} accessibilityLabel={selectedPartner?.name ?? t('ui.bizDash1.noBusinessFoundForThisA11y')}>
          <Text style={styles.partnerSelectorText}>{selectedPartner?.name ?? t('ui.bizDash1.noBusinessFoundForThis')}</Text>
        </View>
      </View>
      {selectedPartner && (
        <TouchableOpacity
          style={[styles.addressBanner, businessLocationNotice(selectedPartner) && { borderColor: colors.primary }]}
          onPress={() => {
            setAddressInput(selectedPartner.address ?? '');
            setAddressModalVisible(true);
          }}
          activeOpacity={0.85}
          accessibilityLabel={businessLocationNotice(selectedPartner)?.text ?? t('ui.bizDash1.addressTapToEditA11y', { address: selectedPartner.address })}
          accessibilityRole="button"
        >
          <Text style={[styles.addressBannerText, businessLocationNotice(selectedPartner) && { color: colors.textPrimary }]}>
            {businessLocationNotice(selectedPartner)?.text ?? `📍 ${selectedPartner.address}`}
          </Text>
        </TouchableOpacity>
      )}
      <View style={styles.sectionTabs}>
        {SECTIONS.map((s) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.sectionTab, section === s.key && styles.sectionTabActive]}
            onPress={() => setSection(s.key)}
            accessibilityLabel={t(`ui.bizDash3.sectionA11y.${s.key}`)}
            accessibilityRole="button"
            accessibilityState={{ selected: section === s.key }}
          >
            <Text style={styles.sectionTabIcon}>{s.icon}</Text>
            <Text style={[styles.sectionTabLabel, section === s.key && styles.sectionTabLabelActive]}>{t(`ui.bizDash3.section.${s.key}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView ref={mainScrollRef} contentContainerStyle={{ padding: spacing.lg }}>
        {loading ? (
          <NLoader fullScreen={false} size="compact" kind="content" />
        ) : loadError ? (
          <LoadErrorState message={t('ui.bizDash1.couldntLoadYourBusinessDashboard')} onRetry={loadMyPartner} />
        ) : (
          <>
            {section === 'home' && (
              <>
                {/* P2 remediation item 11 (CLAUDE.md): a real, persistent
                    "still pending" state -- previously the owner only
                    ever saw a one-time "Submitted for Review" alert with
                    nothing telling them a change was still pending once
                    they navigated away. Neutral (colors.surface/border),
                    not colors.primary/primaryMuted -- per the app's own
                    locked coral-usage rule, this is informational, not an
                    action, and nothing here is destructive either. Shown
                    only when at least one real row exists, never a
                    fabricated "all clear" state for a business with
                    nothing pending. */}
                {pendingScreenings.length > 0 && (
                  <View style={styles.pendingReviewCard}>
                    <Text style={styles.pendingReviewTitle}>{t('ui.bizDash1.underReview')}</Text>
                    {pendingScreenings.map((s) => (
                      <Text key={s.id} style={styles.pendingReviewRow}>
                        {t(s.source === 'resweep' ? 'ui.bizDash1.flaggedForARoutineRe' : 'ui.bizDash1.awaitingReviewNotLiveYet', {
                          type: TARGET_TYPE_LABELS[s.target_type] ? t(`ui.bizDash1.target.${s.target_type}`) : s.target_type,
                        })}
                      </Text>
                    ))}
                  </View>
                )}
                {showWelcomeCard && (
                  <View style={styles.welcomeCard}>
                    <View style={styles.welcomeCardHeaderRow}>
                      <Text style={styles.welcomeCardTitle}>{t('ui.bizDash1.welcomeToYourDashboard')}</Text>
                      <TouchableOpacity onPress={dismissWelcomeCard} accessibilityLabel={t('ui.bizDash1.dismissWelcomeCardA11y')} accessibilityRole="button">
                        <Text style={styles.welcomeCardClose}>✕</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.welcomeCardBody}>
                      {t('ui.bizDash1.heresHowToGetThe')}
                    </Text>
                    <TouchableOpacity
                      style={styles.welcomeCardStep}
                      onPress={() => setSection('requests')}
                      accessibilityLabel={t('ui.bizDash1.seeRealDemandNearYouA11y')}
                      accessibilityRole="button"
                    >
                      <Text style={styles.welcomeCardStepText}>{t('ui.bizDash1.seeRealDemandNearYou')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.welcomeCardStep}
                      onPress={() => setCreateModalVisible(true)}
                      accessibilityLabel={offers.length > 0 ? t('ui.bizDash1.postAnOfferA11y') : t('ui.bizDash1.postYourFirstOfferA11y')}
                      accessibilityRole="button"
                    >
                      <Text style={styles.welcomeCardStepText}>🎁 {offers.length > 0 ? t('ui.bizDash1.postAnOffer') : t('ui.bizDash1.postYourFirstOffer')} →</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.welcomeCardStep}
                      onPress={openEditProfileModal}
                      accessibilityLabel={t('ui.bizDash1.completeYourBusinessProfileA11y')}
                      accessibilityRole="button"
                    >
                      <Text style={styles.welcomeCardStepText}>{t('ui.bizDash1.completeYourProfile')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {/* CLAUDE.md item 10: the real discovery-stats signal already
                    existed but sat several taps deep on the Insights tab --
                    a compact teaser here surfaces it where an owner
                    actually lands first, without duplicating the full
                    breakdown (still only on Insights). */}
                {discoveryStats && discoveryStats.views_last_30_days > 0 && (
                  <TouchableOpacity
                    style={styles.discoveryTeaser}
                    onPress={() => setSection('insights')}
                    accessibilityLabel={t('ui.bizDash1.foundYouInTheLastA11y', { count: discoveryStats.views_last_30_days })}
                    accessibilityRole="button"
                  >
                    <Text style={styles.discoveryTeaserText}>{t('ui.bizDash1.peopleFoundYouInThe', { count: discoveryStats.views_last_30_days })}</Text>
                    <Text style={styles.discoveryTeaserChevron}>›</Text>
                  </TouchableOpacity>
                )}
                {/* "Business Story" plan, Phase 5 -- "Nearby Brief": no new
                    queries, purely a reorganization of aggregatedDemand/
                    opportunities/selectedPartner, all already fetched by
                    this point on every dashboard load. Every number here
                    is real; the one suggestion is a fixed, deterministic
                    priority order, never an LLM call. */}
                {selectedPartner && (() => {
                  const pendingCount = opportunities.filter((o) => canRespondToOpportunity(o)).length;
                  const totalDemand = aggregatedDemand.reduce((sum, d) => sum + (Number(d.request_count) || 0), 0);
                  const bestDemand = [...aggregatedDemand].sort((a, b) => (Number(b.request_count) || 0) - (Number(a.request_count) || 0))[0];
                  // Business Intelligence Phase 5 (Intelligence): a real
                  // demand-gap category -- real nearby signal (either a
                  // real open request or real unmet intent) in a category
                  // this partner has never actually served, per
                  // get_aggregated_demand_for_partner()'s own new
                  // is_demand_gap column. Ranked by combined real signal
                  // (request_count + unmet_intent_count), never blended
                  // into totalDemand/bestDemand above -- those still
                  // reflect every category regardless of served status.
                  const demandGaps = aggregatedDemand.filter(
                    (d) => d.is_demand_gap && (Number(d.request_count) > 0 || Number(d.unmet_intent_count) > 0)
                  );
                  const bestGap = [...demandGaps].sort(
                    (a, b) => (Number(b.request_count) + Number(b.unmet_intent_count)) - (Number(a.request_count) + Number(a.unmet_intent_count))
                  )[0];
                  let suggestion = null;
                  if (!selectedPartner.differentiator) {
                    suggestion = { text: t('ui.bizDash1.addWhatMakesYouDifferent'), onPress: () => setEditProfileModalVisible(true) };
                  } else if ((selectedPartner.attributes ?? []).length === 0) {
                    // "Business Profile Phase 1" addendum -- a real, empty
                    // "Why People Choose Us" is genuinely worth flagging
                    // before the softer signals below it.
                    suggestion = { text: t('ui.bizDash1.tellUsWhyPeopleChoose'), onPress: () => setEditProfileModalVisible(true) };
                  } else if ((selectedPartner.accommodates_party_types ?? []).length === 0 && !fulfillmentPolicy) {
                    suggestion = { text: t('ui.bizDash1.tellNearbyWhatYouCan'), onPress: () => setSection('business') };
                  } else if (!isAvailabilityPulseFresh(selectedPartner.availability_pulse_updated_at)) {
                    suggestion = { text: t('ui.bizDash1.setYourAvailabilitySoPeople'), onPress: () => setSection('business') };
                  } else if (pendingCount > 0) {
                    suggestion = { text: t('ui.bizDash1.newOpportunitYourBusinessView', { count: pendingCount }), onPress: () => setSection('requests') };
                  } else if (bestGap) {
                    const realCount = Number(bestGap.request_count);
                    const gapText = realCount > 0
                      ? t('ui.bizDash1.nearbyWantedSomethingYouDont', { count: realCount, category: categoryName(bestGap.category, language) })
                      : t('ui.bizDash1.recentNearbyForSomethingYou', { count: Number(bestGap.unmet_intent_count), category: categoryName(bestGap.category, language) });
                    suggestion = { text: gapText, onPress: () => openPostAvailabilityModal({ category: bestGap.category, dominantPeriod: bestGap.dominant_period }) };
                  }
                  return (
                    <View style={styles.briefCard}>
                      <Text style={styles.sectionHeader}>{t('ui.bizDash1.todayAt', { name: selectedPartner.name })}</Text>
                      {(() => {
                        const glance = dashboardGlance(opportunities, estimatedOwed, new Date(), offerSubmissions);
                        // Item 36: Opportunities / Offers / Performance lead Home, each one tap into its collection. The
                        // glance below keeps only the bookings lines (confirmed today, visits coming up); new requests and
                        // offers awaiting a reply live in the tiles, and the month is the Performance tile.
                        const tiles = businessHomeTiles({ opportunities, submissions: offerSubmissions, loaded: opportunitiesLoaded, funnel: offerFunnel, value: offerValue });
                        const todayBookings = glance.today.filter((item) => item.key !== 'new');
                        const upcomingBookings = glance.upcoming.filter((item) => item.key !== 'awaiting');
                        return (
                          <View style={{ marginBottom: spacing.sm }}>
                            {tiles.length > 0 && (
                              <View style={styles.homeTileRow}>
                                {tiles.map((tile) => (
                                  <TouchableOpacity
                                    key={tile.key}
                                    style={[styles.homeTile, tile.highlight && { borderColor: colors.primary }]}
                                    onPress={() => openHomeTile(tile.target)}
                                    accessibilityLabel={[tile.title, tile.line, tile.valueLine].filter(Boolean).join(', ')}
                                    accessibilityRole="button"
                                  >
                                    <Text style={styles.notesLabel}>{tile.title}</Text>
                                    <Text style={styles.homeTileLine}>{tile.line}</Text>
                                    {!!tile.valueLine && <Text style={styles.breakdownText}>{tile.valueLine}</Text>}
                                  </TouchableOpacity>
                                ))}
                              </View>
                            )}
                            <Text style={styles.notesLabel}>{t('ui.bizDash1.today')}</Text>
                            <View style={[styles.chipRow, { marginTop: spacing.xs }]}>
                              {todayBookings.map((item) => (
                                <TouchableOpacity
                                  key={item.key}
                                  style={[styles.chip, item.key === 'new' && item.count > 0 && { borderColor: colors.primary }]}
                                  onPress={() => setSection(item.section)}
                                  accessibilityLabel={item.text}
                                  accessibilityRole="button"
                                >
                                  <Text style={styles.chipText}>{item.text}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                            {upcomingBookings.length > 0 && (
                              <>
                                <Text style={styles.notesLabel}>{t('ui.bizDash1.upcoming')}</Text>
                                <View style={[styles.chipRow, { marginTop: spacing.xs }]}>
                                  {upcomingBookings.map((item) => (
                                    <TouchableOpacity key={item.key} style={styles.chip} onPress={() => setSection(item.section)} accessibilityLabel={item.text} accessibilityRole="button">
                                      <Text style={styles.chipText}>{item.text}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              </>
                            )}
                          </View>
                        );
                      })()}
                      {(totalDemand > 0 || pendingCount > 0) ? (
                        <>
                          {totalDemand > 0 && (
                            <Text style={styles.offerDescription}>
                              {t('ui.bizDash1.peopleLookingForWhatYouOffer', { count: totalDemand })}
                            </Text>
                          )}
                          {bestDemand && bestDemand.request_count > 0 && (
                            <TouchableOpacity onPress={() => setSection('requests')} accessibilityLabel={t('ui.bizDash1.viewYourBestOpportunityA11y')} accessibilityRole="button">
                              <Text style={styles.briefBestOpportunity}>
                                {t('ui.bizDash1.yourBestOpportunity')}{' '}{bestDemand.category} ({bestDemand.request_count} {Number(bestDemand.request_count) === 1 ? 'request' : 'requests'})
                              </Text>
                            </TouchableOpacity>
                          )}
                        </>
                      ) : (
                        <Text style={styles.offerDescription}>{t('ui.bizDash1.noRealDemandNearbyYet')}</Text>
                      )}
                      {suggestion && (
                        <TouchableOpacity onPress={suggestion.onPress} style={{ marginTop: spacing.sm }} accessibilityLabel={suggestion.text} accessibilityRole="button">
                          <Text style={styles.briefSuggestion}>💡 {suggestion.text}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })()}
                {stats ? (
                <>
                  <Text style={styles.sectionHeader}>{t('ui.bizDash1.communityHealth')}</Text>
                  <View style={styles.statsGrid}>
                    <View style={styles.statCard}>
                      <Text style={styles.statNumber}>{stats.total_followers}</Text>
                      <Text style={styles.statLabel}>{t('ui.bizDash1.followers')}</Text>
                    </View>
                    <View style={styles.statCard}>
                      <Text style={styles.statNumber}>{stats.followers_this_month}</Text>
                      <Text style={styles.statLabel}>{t('ui.bizDash1.newThisMonth')}</Text>
                    </View>
                    <View style={styles.statCard}>
                      <Text style={styles.statNumber}>{stats.total_redemptions}</Text>
                      <Text style={styles.statLabel}>{t('ui.bizDash1.totalRedemptions')}</Text>
                    </View>
                    <View style={styles.statCard}>
                      <Text style={styles.statNumber}>{stats.redemptions_this_month}</Text>
                      <Text style={styles.statLabel}>{t('ui.bizDash1.thisMonth2')}</Text>
                    </View>
                    <View style={styles.statCard}>
                      <Text style={styles.statNumber}>{stats.repeat_redeemers}</Text>
                      <Text style={styles.statLabel}>{t('ui.bizDash1.repeatCustomers')}</Text>
                    </View>
                  </View>
                  <Text style={styles.helperText}>
                    {t('ui.bizDash1.theseReflectPeopleWhoOpted')}
                  </Text>
                  {growth && (growth.redemptions_growth_pct !== null || growth.followers_growth_pct !== null) && (
                    <View style={styles.growthCard}>
                      {growth.redemptions_growth_pct !== null && (
                        <Text style={styles.growthLine}>
                          {t('ui.bizDash1.redemptionsVsLastMonth', { pct: `${growth.redemptions_growth_pct >= 0 ? '+' : ''}${growth.redemptions_growth_pct}` })}
                        </Text>
                      )}
                      {growth.followers_growth_pct !== null && (
                        <Text style={styles.growthLine}>
                          {t('ui.bizDash1.followersVsLastMonth', { pct: `${growth.followers_growth_pct >= 0 ? '+' : ''}${growth.followers_growth_pct}` })}
                        </Text>
                      )}
                    </View>
                  )}

                  {needsAttention.length > 0 && (
                    <>
                      <Text style={styles.sectionHeader}>{t('ui.bizDash1.needsAttention')}</Text>
                      {needsAttention.map((task, i) => (
                        <TouchableOpacity
                          key={i}
                          style={styles.taskRow}
                          onPress={task.onPress}
                          accessibilityLabel={task.label}
                          accessibilityRole="button"
                        >
                          <Text style={styles.taskText}>• {task.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </>
                  )}

                  <TouchableOpacity
                    style={styles.postUpdateButton}
                    onPress={() => setUpdateModalVisible(true)}
                    accessibilityLabel={t('ui.bizDash1.postAnUpdateToYourA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.postUpdateButtonText}>{t('ui.bizDash1.postUpdateToFollowers')}</Text>
                  </TouchableOpacity>

                  {/* Phase 7 (Business Web, CLAUDE.md) -- real device camera
                      capture has no web equivalent worth building for a v1;
                      hidden on web, native behavior untouched. */}
                  {(
                    <TouchableOpacity
                      style={[styles.postUpdateButton, { marginTop: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary }]}
                      onPress={handlePostMoment}
                      disabled={postingMoment}
                      accessibilityLabel={t('ui.bizDash1.postARealTimePhotoA11y')}
                      accessibilityRole="button"
                    >
                      {postingMoment ? (
                        <ActivityIndicator color={colors.primary} />
                      ) : entitlements && !hasEntitlement(entitlements, 'business_moments') ? (
                        <Text style={[styles.postUpdateButtonText, { color: colors.primary }]}>{t('ui.bizDash1.postAMomentGrowthFeature')}</Text>
                      ) : (
                        <Text style={[styles.postUpdateButtonText, { color: colors.primary }]}>{t('ui.bizDash1.postAMomentVisible24h')}</Text>
                      )}
                    </TouchableOpacity>
                  )}

                  {selectedPartner && (
                    <TouchableOpacity
                      onPress={() => navigation.navigate('BusinessProfile', { partnerId: selectedPartner.id })}
                      accessibilityLabel={t('ui.bizDash1.viewYourPublicBusinessProfileA11y')}
                      accessibilityRole="button"
                    >
                      <Text style={styles.viewProfileLink}>{t('ui.bizDash1.viewPublicProfile')}</Text>
                    </TouchableOpacity>
                  )}
                  {selectedPartner && (
                    <TouchableOpacity
                      onPress={() => setQrModalVisible(true)}
                      accessibilityLabel={t('ui.bizDash1.shareYourQrCodeA11y')}
                      accessibilityRole="button"
                      style={{ marginTop: spacing.sm }}
                    >
                      <Text style={styles.viewProfileLink}>{t('ui.bizDash1.shareYourQrCode')}</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <EmptyCopy id="business_stats" />
              )}
              {selectedPartner && (
                <View style={[styles.gatheringRow, { marginTop: spacing.lg }]}>
                  <TouchableOpacity
                    onPress={() => setOpenTool(openTool ? null : 'menu')}
                    accessibilityLabel={t('ui.bizDash1.moreToolsA11y')}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !!openTool }}
                  >
                    <Text style={styles.offerTitle}>{t('ui.bizDash1.moreTools')}{' '}{openTool ? '⌄' : '›'}</Text>
                    {!openTool && <Text style={styles.breakdownText}>{t('ui.bizDash1.aiAssistantAnalyticsWeatherDemand')}</Text>}
                  </TouchableOpacity>
                  {!!openTool && MORE_TOOLS.map((tool) => (
                    <TouchableOpacity
                      key={tool.key}
                      style={{ paddingVertical: spacing.sm }}
                      onPress={() => {
                        if (tool.key === 'ai') {
                          navigation.navigate('BusinessAIAssistant', { partnerId: selectedPartner.id, partnerName: selectedPartner.name });
                        } else {
                          setOpenTool(openTool === tool.key ? 'menu' : tool.key);
                        }
                      }}
                      accessibilityLabel={t(`ui.bizDash3.tool.${tool.key}`)}
                      accessibilityRole="button"
                      accessibilityState={tool.key === 'ai' ? undefined : { expanded: openTool === tool.key }}
                    >
                      <Text style={[styles.breakdownText, { color: colors.textPrimary, fontWeight: openTool === tool.key ? '700' : '400' }]}>
                        {tool.icon} {t(`ui.bizDash3.tool.${tool.key}`)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {tool('weather') && !(businessWeather && (isWeatherIndoorBiased(businessWeather) || isWeatherOutdoorBiased(businessWeather))) && (
                <Text style={styles.emptyText}>{t('ui.bizDash1.nothingAboutTodaysWeatherChanges')}</Text>
              )}
              </>
            )}

            {section === 'bookings' && (
              gatherings.length === 0 ? (
                <View style={{ alignItems: 'center' }}>
                  {/* Thursday plan item 25: the original copy claimed
                      "create one from the Create tab and it'll show up
                      here" -- but this section is scoped to
                      gatherings.hosting_partner_id = this business
                      (getMyBusinessGatherings()), and no create flow
                      anywhere in this codebase ever sets that column
                      (confirmed by search -- CreateGatheringScreen.js has
                      no such param). That claim was already false before
                      this change. Rather than wire a fabricated-looking
                      button that wouldn't actually make a gathering appear
                      here, this softens the copy to not promise that, and
                      still gives a real action to a real destination.
                      Wiring an actual business-hosted-gathering create
                      path is a separate, bigger feature, not an empty-
                      state copy fix -- flagged, not silently built. */}
                  <EmptyCopy id="business_gatherings" />
                  <TouchableOpacity
                    style={[styles.smallActionButton, { backgroundColor: colors.primary, marginTop: spacing.sm }]}
                    onPress={() => {
                      navigation.navigate('CreateGathering');
                    }}
                    accessibilityLabel={t('ui.bizDash1.hostAGatheringA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.smallActionButtonText}>{t('ui.bizDash1.hostAGathering')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                gatherings.map((g) => {
                  const breakdown = gatheringBreakdowns[g.id];
                  const isUpcoming = isGatheringUpcoming(g);
                  const attachedOffer = offers.find((o) => o.gathering_id === g.id);
                  return (
                    <TouchableOpacity
                      key={g.id}
                      style={styles.gatheringRow}
                      onPress={() => {
                        navigation.navigate('GatheringDetail', { gatheringId: g.id });
                      }}
                      activeOpacity={0.85}
                      accessibilityLabel={t('ui.bizDash1.viewAndManageA11y', { title: g.title })}
                      accessibilityRole="button"
                    >
                      <Text style={styles.offerTitle}>{g.title}{g.recurrence_rule ? ` (${t(`ui.gatheringOptions.repeat.${g.recurrence_rule}`)})` : ''}</Text>
                      <Text style={styles.offerDescription}>{t(isUpcoming ? 'ui.bizDash1.nextDate' : 'ui.bizDash1.lastDate', { date: formatDate(g.scheduled_at) })}</Text>
                      {attachedOffer ? (
                        <Text style={styles.breakdownText}>🎁 {attachedOffer.title}</Text>
                      ) : isUpcoming && (
                        <TouchableOpacity
                          onPress={() => {
                            setOfferGatheringId(g.id);
                            setCreateModalVisible(true);
                          }}
                          accessibilityLabel={t('ui.bizDash1.attachARewardToA11y', { title: g.title })}
                          accessibilityRole="button"
                        >
                          <Text style={styles.attachRewardText}>{t('ui.bizDash1.attachReward')}</Text>
                        </TouchableOpacity>
                      )}
                      {breakdown && breakdown.total_attending > 0 && (
                        <Text style={styles.breakdownText}>{t('ui.bizDash1.attendingNewToYouReturning', { totalAttending: breakdown.total_attending, newAttendees: breakdown.new_attendees, returningAttendees: breakdown.returning_attendees })}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })
              )
            )}

            {section === 'bookings' && (
              <>
                {partnershipRequests.length > 0 && (
                  <>
                    <Text style={styles.sectionHeader}>{t('ui.bizDash1.partnershipRequests')}</Text>
                    {partnershipRequests.map((r) => (
                      <View key={r.id} style={styles.gatheringRow}>
                        <Text style={styles.offerTitle}>
                          {t(r.targetType === 'gathering' ? 'ui.bizDash1.wantsToPartnerForGathering' : 'ui.bizDash1.wantsToPartnerWithCommunity', { name: r.requesterName ?? t('ui.bizDash1.someone'), title: r.targetTitle ?? t(r.targetType === 'gathering' ? 'ui.bizDash1.theirGathering' : 'ui.bizDash1.theirCommunity') })}
                        </Text>
                        <Text style={styles.breakdownText}>{r.targetType === 'gathering' ? t('ui.bizDash1.gathering2') : t('ui.bizDash1.community')}</Text>
                        {r.message ? <Text style={styles.offerDescription}>"{r.message}"</Text> : null}
                        <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
                          <TouchableOpacity
                            style={[styles.smallActionButton, { backgroundColor: colors.primary, marginRight: spacing.sm }]}
                            onPress={() => handleRespondToPartnershipRequest(r.id, true)}
                            disabled={respondingToRequestId === r.id}
                            accessibilityLabel={t('ui.bizDash1.approvePartnershipRequestFromA11y', { requesterName: r.requesterName ?? 'requester' })}
                            accessibilityRole="button"
                          >
                            {respondingToRequestId === r.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.smallActionButtonText}>{t('ui.bizDash1.approve')}</Text>}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated }]}
                            onPress={() => handleRespondToPartnershipRequest(r.id, false)}
                            disabled={respondingToRequestId === r.id}
                            accessibilityLabel={t('ui.bizDash1.declinePartnershipRequestFromA11y', { requesterName: r.requesterName ?? 'requester' })}
                            accessibilityRole="button"
                          >
                            <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>{t('ui.bizDash1.decline')}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </>
                )}

                {communities.length === 0 ? (
                  <View style={{ alignItems: 'center' }}>
                    {/* Thursday plan item 25: same finding as the
                        gatherings empty state above -- this section is
                        scoped to communities.hosting_partner_id = this
                        business, and no create flow (CreateCommunityScreen.js
                        included) ever sets that column, so "it'll show up
                        here" was already an unfulfillable promise. Softened
                        copy, real action to a real destination. */}
                    <EmptyCopy id="business_communities" />
                    <TouchableOpacity
                      style={[styles.smallActionButton, { backgroundColor: colors.primary, marginTop: spacing.sm }]}
                      onPress={() => {
                        navigation.navigate('CreateCommunity');
                      }}
                      accessibilityLabel={t('ui.bizDash1.createACommunityA11y')}
                      accessibilityRole="button"
                    >
                      <Text style={styles.smallActionButtonText}>{t('ui.bizDash1.createACommunity')}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  communities.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      style={styles.gatheringRow}
                      onPress={() => {
                        navigation.navigate('CommunityDetail', { communityId: c.id, communityName: c.name });
                      }}
                      activeOpacity={0.85}
                      accessibilityLabel={t('ui.bizDash1.viewAndManageA11y2', { name: c.name })}
                      accessibilityRole="button"
                    >
                      <Text style={styles.offerTitle}>{c.name}</Text>
                      <Text style={styles.breakdownText}>{c.memberCount != null ? t('ui.bizDash1.memberCount', { count: c.memberCount }) : t('ui.bizDash1.membersNotLoaded')}</Text>
                      {c.description ? <Text style={styles.offerDescription}>{c.description}</Text> : null}
                    </TouchableOpacity>
                  ))
                )}

                {topMembers.length > 0 && (
                  <>
                    <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>{t('ui.bizDash1.mostEngaged')}</Text>
                    {topMembers.map((m, i) => (
                      <TouchableOpacity
                        key={m.user_id}
                        style={styles.gatheringRow}
                        onPress={() => handleToggleMemberHistory(m)}
                        accessibilityLabel={t('ui.bizDash1.attendedTapToSeeVisitA11y', { name: m.display_name, count: m.gatherings_attended })}
                        accessibilityRole="button"
                      >
                        <Text style={styles.offerTitle}>{i + 1}. {m.display_name}</Text>
                        <Text style={styles.offerDescription}>{m.gatherings_attended} gathering{m.gatherings_attended === 1 ? '' : 's'} attended</Text>
                        {expandedMemberId === m.user_id && (
                          <View style={styles.memberHistoryPanel}>
                            {loadingMemberHistory && !memberHistories[m.user_id] ? (
                              <ActivityIndicator color={colors.primary} size="small" />
                            ) : (
                              (memberHistories[m.user_id] ?? []).map((g) => (
                                <Text key={g.gathering_id} style={styles.memberHistoryLine}>
                                  • {g.title} — {formatDate(g.scheduled_at)}
                                </Text>
                              ))
                            )}
                            <TouchableOpacity
                              onPress={() => handleMessageMember(m)}
                              accessibilityLabel={t('ui.bizDash1.messageA11y', { name: m.display_name })}
                              accessibilityRole="button"
                            >
                              <Text style={styles.messageMemberLink}>{t('ui.bizDash1.message', { name: m.display_name })}</Text>
                            </TouchableOpacity>
                            <Text style={styles.notesLabel}>{t('ui.bizDash1.notesOnlyYouCanSee')}</Text>
                            <TextInput
                              style={styles.notesInput}
                              placeholder={t('ui.bizDash1.eGRegularPrefersThe')}
                              placeholderTextColor={colors.textTertiary}
                              value={noteDraft}
                              onChangeText={setNoteDraft}
                              multiline
                              accessibilityLabel={t('ui.bizDash1.notesAboutA11y', { name: m.display_name })}
                            />
                            <TextInput
                              style={[styles.notesInput, { marginTop: spacing.xs }]}
                              placeholder={t('ui.bizDash1.tagsCommaSeparatedEG')}
                              placeholderTextColor={colors.textTertiary}
                              value={tagsDraft}
                              onChangeText={setTagsDraft}
                              autoCapitalize="none"
                              accessibilityLabel={t('ui.bizDash1.tagsForA11y', { name: m.display_name })}
                            />
                            <TouchableOpacity
                              onPress={() => handleSaveNote(m)}
                              disabled={savingNote}
                              style={{ marginTop: spacing.xs }}
                              accessibilityLabel={t('ui.bizDash2.saveNoteA11y')}
                              accessibilityRole="button"
                            >
                              <Text style={styles.messageMemberLink}>{savingNote ? t('ui.bizDash2.saving') : t('ui.bizDash2.saveNote')}</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </>
            )}

            {section !== 'inbox_modal' && (
              <>
{on('bookings') && (
<>
                {opportunities.filter((o) => isPipelineWon(o, noShowIds)).length > 0 && (
                  <View style={{ marginBottom: spacing.lg }}>
                    <Text style={styles.sectionHeader}>{t('ui.bizDash2.upcomingNearbyVisits')}</Text>
                    <Text style={styles.helperText}>
                      {t('ui.bizDash2.realConfirmedVisitsHeadedYour')}
                    </Text>
                    {opportunities.filter((o) => isPipelineWon(o, noShowIds)).map((o) => {
                      const visit = describeVisit(o);
                      return (
                        <View key={o.id} style={styles.gatheringRow}>
                          <Text style={styles.breakdownText}>{visit.kicker}</Text>
                          <Text style={styles.offerTitle}>{visit.title}</Text>
                          <Text style={styles.breakdownText}>
                            {[
                              visit.when,
                              o.business_requests?.party_size ? `${o.business_requests.party_size} ${o.business_requests.party_size === 1 ? 'person' : 'people'}` : null,
                              formatOfferSummary(o),
                            ].filter(Boolean).join(' · ')}
                          </Text>
                          {/* Item 69 (CLAUDE.md): the ONE place a real name
                              ever reaches a business -- once this is a
                              genuine confirmed reservation, get_business_
                              opportunities() reveals the primary
                              requester's real display name (never for a
                              dating-sourced request, which stays "Two
                              people planning to visit" above). */}
                          {o.business_requests?.requester_display_name && (
                            <Text style={[styles.breakdownText, { fontWeight: '600' }]}>
                              👤 {o.business_requests.requester_display_name}
                            </Text>
                          )}
                          <BusinessOfferMediaPreview path={o.media_path} type={o.media_type} colors={colors} />
                          <TouchableOpacity
                            style={[styles.smallActionButton, { borderWidth: 1, borderColor: colors.danger, backgroundColor: 'transparent', marginTop: spacing.sm, alignSelf: 'flex-start' }]}
                            onPress={() => handleCancelReservation(o.id)}
                            disabled={cancellingReservationOfferId === o.id}
                            accessibilityLabel={t('ui.bizDash2.cancelThisReservationA11y')}
                            accessibilityRole="button"
                          >
                            {cancellingReservationOfferId === o.id ? (
                              <ActivityIndicator color={colors.danger} size="small" />
                            ) : (
                              <Text style={[styles.smallActionButtonText, { color: colors.danger }]}>{t('ui.bizDash2.cancelReservation')}</Text>
                            )}
                          </TouchableOpacity>
                          {visitHasPassed(o) && (
                            <TouchableOpacity
                              style={[styles.smallActionButton, { borderWidth: 1, borderColor: colors.border, backgroundColor: 'transparent', marginTop: spacing.sm, alignSelf: 'flex-start' }]}
                              onPress={() => handleMarkNoShow(o.id)}
                              disabled={markingNoShowId === o.id}
                              accessibilityLabel={t('ui.bizDash2.markThatTheCustomerDidntA11y')}
                              accessibilityRole="button"
                            >
                              {markingNoShowId === o.id ? (
                                <ActivityIndicator color={colors.textSecondary} size="small" />
                              ) : (
                                <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>{t('ui.bizDash2.didntShowUp')}</Text>
                              )}
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
</>
)}

                {/* Item 79 (CLAUDE.md, "businesses get a new demand
                    signal"): the occasion-primary sibling of Match Radar
                    below -- "consumer intent -> business supply," headlined
                    by occasion rather than category, matching the item's
                    own literal examples ("8 groups are looking for
                    graduation celebrations"). Real, anonymized, geo-scoped;
                    honestly empty until real nearby volume exists.
                    Item 103 (CLAUDE.md, "Don't forget non-celebratory life
                    events"): this groups by ANY real occasion.occasion
                    value, including real non-celebratory ones (a farewell,
                    a move, a new job) -- "What They're Celebrating" read
                    wrong the moment one of those showed up here. */}
{tool('demand') && (
<>
                {/* Business Intelligence & Opportunity Engine, Phase 2 --
                    "Match Radar" (spec item 13) reframe: get_aggregated_
                    demand_for_partner() already IS Match Radar (locked
                    plan's own audit finding) -- this is a real naming
                    alignment only, no new data, no new query. */}
                <Text style={[styles.sectionHeader, { marginTop: spacing.lg }]}>{t('ui.bizDash2.matchRadar')}</Text>
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.realOpenRequestsWithinReach')}
                </Text>
                {entitlements && !hasEntitlement(entitlements, 'advanced_match_radar') && (
                  renderLockedFeature('advanced_match_radar', t('ui.bizDash2.unlockTheUnmetIntentSignal'))
                )}
                {aggregatedDemand.length === 0 ? (
                  <EmptyCopy id="business_demand" />
                ) : (
                  aggregatedDemand.map((d) => (
                    <View key={d.category} style={styles.gatheringRow}>
                      {d.request_count > 0 ? (
                        <Text style={styles.offerTitle}>
                          {t('ui.bizDash2.peopleLookingForCategory', { count: d.request_count, category: categoryName(d.category, language) })}
                        </Text>
                      ) : (
                        // Gap 1 (see CLAUDE.md's "Aug 18 2026" connectivity-audit
                        // ledger): a real, honestly-softer row for a category with
                        // zero currently-open requests but real recent unmet
                        // intent nearby -- was previously invisible here entirely.
                        // Deliberately never phrased like a confirmed count.
                        <Text style={styles.offerTitle}>
                          {t('ui.bizDash2.recentSearchesFoundNothing', { count: d.unmet_intent_count, category: categoryName(d.category, language) })}
                        </Text>
                      )}
                      {d.is_demand_gap && (
                        // Business Intelligence Phase 5 (Intelligence): a
                        // genuinely different concept from the 🟡 marker
                        // above -- that one is about confidence of the
                        // signal itself, this one is about whether the
                        // partner has ever actually served this category
                        // at all. Kept as its own line so the two never
                        // conflate.
                        <Text style={styles.helperText}>{t('ui.bizDash2.youDontCurrentlyOfferThis')}</Text>
                      )}
                      {d.request_count > 0 && (
                        <Text style={styles.breakdownText}>
                          {[
                            d.total_party_size ? t('ui.bizDash2.totalGuests', { count: Number(d.total_party_size) }) : null,
                            d.soonest_date ? t('ui.bizDash2.soonest', { date: displayDay(`${d.soonest_date}T00:00:00`, language) }) : null,
                            // "Nearby V3/V4" plan, Phase A: a real time-window
                            // breakdown of already-collected data (business_requests.
                            // time_window_start), not a new signal -- only shown when
                            // at least one real open request actually specified a time.
                            d.dominant_period ? t(`ui.bizDash2.mostlyPeriod.${d.dominant_period}`, { n: d.dominant_period_count, total: d.request_count }) : null,
                          ].filter(Boolean).join(' · ')}
                        </Text>
                      )}
                      {d.request_count > 0 && d.dominant_occasion && (
                        // "Intelligent demand inbox" plan, Phase 4(d): a real
                        // occasion-based bucket alongside category/party-size/
                        // time-window -- same "no new signal, just surface
                        // what's already there" convention as dominant_period
                        // above, just rolled up by occasion instead.
                        <Text style={styles.breakdownText}>
                          {OCCASION_OPTIONS.find((o) => o.key === d.dominant_occasion)?.icon ?? ''}{' '}
                          {t('ui.bizDash2.mostlyOccasion', { occasion: language === 'en' ? occasionLabel(d.dominant_occasion).toLowerCase() : categoryName(occasionLabel(d.dominant_occasion), language), n: d.dominant_occasion_count, total: d.request_count })}
                        </Text>
                      )}
                      {d.request_count > 0 && d.unmet_intent_count > 0 && (
                        // Gap 1's own "never blended" requirement -- a real,
                        // separate softer signal on top of the real request
                        // count above, never summed into it.
                        <Text style={styles.helperText}>
                          {t('ui.bizDash2.alsoMoreSearchesFoundNothing', { count: d.unmet_intent_count })}
                        </Text>
                      )}
                      {/* "Nearby V3/V4" plan, Phase B: no new backend mechanism --
                          this pre-fills the already-real, already-verified Phase 4
                          availability-posting modal instead of making the owner
                          re-open "+ Post Availability" and re-type the category. */}
                      <TouchableOpacity
                        style={[styles.smallActionButton, { backgroundColor: colors.primary, marginTop: spacing.sm, alignSelf: 'flex-start' }]}
                        onPress={() => openPostAvailabilityModal({ category: d.category, dominantPeriod: d.dominant_period })}
                        accessibilityLabel={t('ui.bizDash2.turnDemandIntoAnOfferA11y', { category: d.category })}
                        accessibilityRole="button"
                      >
                        <Text style={styles.smallActionButtonText}>{t('ui.bizDash2.turnIntoAnOffer')}</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}

</>
)}
{on('opportunities') && (
<>
                {/* Item 147: the request pipeline, one definition per stage (utils/businessPipeline.js). Shown only once the
                    requests have loaded, so a zero is a real zero. */}
                {opportunitiesLoaded === true && (() => {
                  const pipeline = businessPipeline(opportunities, offerSubmissions, { noShowIds });
                  return (
                    <View style={{ marginTop: spacing.lg }}>
                      <Text style={styles.sectionHeader}>{t('ui.bizDash2.pipeline.title')}</Text>
                      <View style={styles.pipelineRow}>
                        {PIPELINE_STAGES.map((stage) => (
                          <View
                            key={stage}
                            style={styles.pipelineStage}
                            accessible
                            accessibilityLabel={`${t(`ui.bizDash2.pipeline.${stage}`)}: ${t(`ui.bizDash2.pipeline.${stage}Sub`, { count: pipeline[stage] })}`}
                          >
                            <Text style={styles.statNumber}>{pipeline[stage]}</Text>
                            <Text style={styles.statLabel}>{t(`ui.bizDash2.pipeline.${stage}`)}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  );
                })()}
                {offerSubmissions.length > 0 && (
                  <View style={{ marginTop: spacing.lg }}>
                    <Text style={styles.sectionHeader}>{t('ui.bizDash2.yourOffers')}</Text>
                    {offerSubmissions.map((sub) => {
                      const v = submissionView(sub);
                      if (!v) return null;
                      const toneColor = v.tone === 'success' ? colors.success : v.tone === 'danger' ? colors.danger : v.tone === 'warning' ? colors.warning : colors.textPrimary;
                      return (
                        <View key={sub.id} style={styles.gatheringRow}>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {v.tone === 'progress' && <ActivityIndicator size="small" color={colors.textSecondary} style={{ marginRight: spacing.sm }} />}
                            <Text style={[styles.offerTitle, { color: toneColor }]} accessibilityRole="header">{v.headline}</Text>
                          </View>
                          {!!sub.payload?.offerTitle && <Text style={styles.breakdownText}>{sub.payload.offerTitle}</Text>}
                          <Text style={styles.breakdownText}>{v.detail}</Text>
                          {v.actions.length > 0 && (
                            <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs }}>
                              {v.actions.map((a) => (
                                <TouchableOpacity key={a} disabled={busySubmissionId === sub.id} onPress={() => handleSubmissionAction(sub, a)} accessibilityRole="button"
                                  accessibilityLabel={a === 'retry' ? t('ui.bizDash2.tryAgainA11y') : a === 'edit' ? t('ui.bizDash2.editAndResendA11y') : t('ui.bizDash2.dismissA11y')}>
                                  <Text style={{ color: a === 'dismiss' ? colors.textSecondary : colors.primary, fontWeight: '700' }}>
                                    {a === 'retry' ? t('ui.bizDash2.tryAgain') : a === 'edit' ? t('ui.bizDash2.editAndResend') : t('ui.bizDash2.dismiss')}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
                {(() => {
                  // Nearby does the matching: the business never browses customers, it gets the ones that fit.
                  const newCount = scoredOpportunities.filter((o) => canRespondToOpportunity(o)).length;
                  return (
                    <Text style={[styles.sectionHeader, { marginTop: spacing.lg }]}>
                      {newCount > 0 ? t('ui.bizDash2.newOpportunitiesFit', { count: newCount }) : t('ui.bizDash2.opportunities')}
                    </Text>
                  );
                })()}
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.nearbyMatchedTheseToYour')}
                </Text>
                {!!focusRequestId && opportunitiesLoaded !== null && (() => {
                  // Item 140: what is true about the request the notification named, as just loaded (never the push's wording).
                  const fv = focusedOpportunityView(opportunities, focusRequestId, { loadFailed: opportunitiesLoaded === false, inFlight: offerInFlight.has(focusRequestId) });
                  const line = fv.kind === 'unavailable' ? t('ui.bizDash2.focus.unavailable')
                    : fv.kind === 'respondable' ? (fv.expiresAt ? t('ui.bizDash2.focus.respondBy', { when: deadlineLabel(fv.expiresAt, language) }) : t('ui.bizDash2.focus.respondOpen'))
                    : t(`ui.bizDash2.focus.${fv.key}`);
                  return (
                    <View style={[styles.gatheringRow, { borderColor: colors.primary, borderWidth: 1 }]} accessibilityLiveRegion="polite">
                      <Text style={styles.notesLabel}>{t('ui.bizDash2.focus.title')}</Text>
                      <Text style={[styles.breakdownText, { fontWeight: '700', color: fv.kind === 'respondable' ? colors.textPrimary : colors.textSecondary }]}>{line}</Text>
                    </View>
                  );
                })()}
                {scoredOpportunities.length === 0 ? (
                  <View style={{ alignItems: 'center', paddingVertical: spacing.md }}>
                    <EmptyCopy id="business_opportunities" />
                    <TouchableOpacity onPress={() => openPostAvailabilityModal()} accessibilityRole="button" accessibilityLabel={t('ui.bizDash2.postAvailabilitySoNearbyCanA11y')} style={{ marginTop: spacing.sm }}>
                      <Text style={{ color: colors.primary, fontWeight: '700' }}>{t('ui.bizDash2.postAvailability')}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  focusFirst(scoredOpportunities, focusRequestId).map((o) => {
                    // "Business Story" plan, Phase 4: closes the real,
                    // already-flagged gap (see CLAUDE.md) -- this row's
                    // own request.attributes/cuisine are now selected (see
                    // getBusinessOpportunities) and shown here.
                    // Business Intelligence & Opportunity Engine, Phase 2:
                    // o.opportunityReasons is the real, itemized "why this
                    // matches" list (computed in scoredOpportunities
                    // above), replacing the old single binary badge --
                    // still-open opportunities are already sorted by this
                    // same real score, highest first.
                    const reqAttrs = o.business_requests?.attributes ?? [];
                    // Phase 4(a): a real "What they're looking for" tag row,
                    // deliberately separate from the itemized "why you're a
                    // match" reasons list right above it -- both pull from
                    // fields already selected by getBusinessOpportunities
                    // (category/occasion/party-size/budget/attributes/
                    // cuisine), no new query. Replaces the old plain text
                    // line + a second, separate cuisine/attribute-only chip
                    // row with one consolidated, scannable tag summary.
                    const reqOccasion = OCCASION_OPTIONS.find((opt) => opt.key === o.business_requests?.occasion);
                    // Item 70 (CLAUDE.md): "Add 'What are you celebrating?'
                    // to business requests" -- occasion/party size/budget/
                    // cuisine/attributes were already shown here; date was
                    // already collected (business_requests.date/
                    // time_window_start) and already used for scoring, but
                    // never actually shown to the business deciding
                    // whether to respond. Real gap, now closed.
                    // Item 80 ("Make it special," CLAUDE.md): a real,
                    // independent add-on to a bigger occasion plan --
                    // shown first so it reads as a distinct request type,
                    // never conflated with the "category" tag right after
                    // it (which is already the closest matching leaf tag
                    // for 5 of 6 add-on types, but Transportation has no
                    // leaf tag at all, so this is its only visible cue).
                    // Item 81 ("One Plan can contain multiple businesses,"
                    // CLAUDE.md): plan_time is when, within the WHOLE
                    // plan's own timeline, this specific engagement
                    // happens -- distinct from (and often different from)
                    // the request's own time_window shown just above via
                    // requestWhen. A business deciding on a Transportation
                    // add-on genuinely needs to know WHICH ride this is.
                    const planTimeLabel = formatPlanTimeLabel(o.business_requests?.plan_time ?? null);
                    // Item 95 (CLAUDE.md, "Ask 'How important is the
                    // occasion?'"): real context for a business deciding
                    // how to respond -- e.g. whether to reach for a
                    // Special/Go-All-Out structured offer (Item 92) or
                    // keep it simple. 'special' is the common default, so
                    // it's shown like every other real answer here rather
                    // than singled out as noise.
                    const expLevelOpt = EXPERIENCE_LEVEL_OPTIONS.find((o2) => o2.key === o.business_requests?.experience_level);
                    // Item 96 (CLAUDE.md, "Add surprise mode"): "business
                    // knows it's a surprise if relevant" -- a plain
                    // boolean, shown first alongside the add-on tag since
                    // it reframes how the whole request should be read
                    // (e.g. keep any confirmation calls discreet). Never
                    // reveals who the surprise is for -- Item 69's privacy
                    // boundary stays intact.
                    const surpriseTag = o.business_requests?.surprise_mode ? t('ui.bizDash2.surprise') : null;
                    const card = buildOpportunityCard(o.business_requests, {
                      occasionLabel: reqOccasion?.label ? (language === 'en' ? reqOccasion.label : categoryName(reqOccasion.label, language)) : null,
                      experienceLabel: expLevelOpt ? experienceOptionLabel(expLevelOpt, language) : null,
                      addonLabel: o.business_requests?.addon_type ? planAddonLabel(o.business_requests.addon_type) : null,
                      attributeLabels: reqAttrs.map((key) => attributeLabel(key, businessAttributeLabel(key), language)),
                      cuisineLabel: o.business_requests?.cuisine ? (language === 'en' ? cuisineLabel(o.business_requests.cuisine) : cuisineName(o.business_requests.cuisine, language)) : null,
                      itemLabels: (o.business_requests?.requested_items ?? []).map((k) => (language === 'en' ? requestedItemLabel(k) : t(`ui.bizHelp.item.${k}`))),
                      categoryLabel: o.business_requests?.category ? categoryName(o.business_requests.category, language) : null,
                    });
                    // Context that changes how the request should be read stays, but as one quiet line, not chips.
                    const matchReasons = buildMatchReasons(o.opportunityReasons, {
                      occasion: reqOccasion?.label ? (language === 'en' ? reqOccasion.label.toLowerCase() : categoryName(reqOccasion.label, language)) : null,
                      directed: o.is_directed === true,
                      hasAvailability: availabilityCoversRequest(o.business_requests, myAvailability),
                      priceFits: fulfillmentPolicy?.active === true && budgetMeetsMinSpend(o.business_requests?.budget_max, fulfillmentPolicy?.min_spend_per_person),
                    });
                    const contextLine = [surpriseTag, planTimeLabel ? `🕐 ${planTimeLabel}` : null].filter(Boolean).join(' · ');
                    const oppAction = opportunityPrimaryAction(o, { inFlight: offerInFlight.has(o.request_id) });
                    return (
                    <View key={o.id} style={[styles.gatheringRow, o.request_id === focusRequestId && { borderColor: colors.primary, borderWidth: 2 }]}>
                      {/* Item 73: the card's action comes from the opportunity's state (utils/primaryAction.js). */}
                      {oppAction.kind === 'send_offer' ? (
                        <Text style={[styles.breakdownText, { color: colors.info, fontWeight: '700' }]}>
                          {matchReasons.length > 0 ? t('ui.bizDash2.goodMatchForYourBusiness') : t('ui.bizDash2.newOpportunity')}
                        </Text>
                      ) : oppAction.kind === 'status' ? (
                        <Text style={[styles.breakdownText, { fontWeight: '700' }]}>{oppAction.status}</Text>
                      ) : null}
                      <Text style={styles.offerTitle}>{card.title}</Text>
                      {!!o.business_requests?.gatherings?.title && o.is_directed === true && (
                        <Text style={styles.breakdownText}>“{o.business_requests.gatherings.title}”</Text>
                      )}
                      {!!o.business_requests?.note && o.is_directed === true && (
                        <Text style={styles.breakdownText}>{t('ui.bizDash2.theirNote', { note: o.business_requests.note })}</Text>
                      )}
                      {/* Item 164: the customer's stated timing, only while the business can still answer. */}
                      {oppAction.kind === 'send_offer' && !!card.needsLine && <Text style={styles.opportunityWhen}>{card.needsLine}</Text>}
                      {card.whenLine !== '' && <Text style={styles.opportunityWhen}>{card.whenLine}</Text>}
                      {/* Item 149: potential value, only while the business can still answer; never called earnings. */}
                      {oppAction.kind === 'send_offer' && card.potential && (
                        <View style={{ marginTop: spacing.xs }}>
                          <Text style={styles.opportunityWhen}>{card.potential.line}</Text>
                          <Text style={styles.breakdownText}>{card.potential.basis}. {card.potential.note}</Text>
                        </View>
                      )}
                      {card.feelLine !== '' && <Text style={styles.breakdownText}>{card.feelLine}</Text>}
                      {card.requestedLine !== '' && <Text style={styles.opportunityWhen}>{t('ui.bizDash2.requested', { requestedLine: card.requestedLine })}</Text>}
                      {contextLine !== '' && <Text style={styles.breakdownText}>{contextLine}</Text>}
                      {(card.lookingFor.length > 0 || (o.business_requests?.dietary ?? []).length > 0) && (
                        <View style={{ marginTop: spacing.xs }}>
                          <Text style={styles.notesLabel}>{t('ui.bizDash2.lookingFor')}</Text>
                          <View style={[styles.chipRow, { marginTop: spacing.xs }]}>
                            {[...card.lookingFor, ...(o.business_requests?.dietary ?? []).map((k) => dietaryLabel(k))].map((tag) => (
                              <View key={tag} style={styles.chip}>
                                <Text style={styles.chipText}>{tag}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      )}
                      {o.status === 'pending' && matchReasons.length > 0 && (
                        <View style={{ marginTop: spacing.xs }}>
                          <Text style={styles.notesLabel}>{t('ui.bizDash2.whyThisFits')}</Text>
                          {matchReasons.map((line) => (
                            <Text key={line} style={styles.breakdownText}>• {line}</Text>
                          ))}
                        </View>
                      )}
                      {oppAction.kind === 'send_offer' && (
                        <>
                          <Text style={[styles.offerTitle, { marginTop: spacing.sm }]}>{t('ui.bizDash2.canYouAccommodateThis')}</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs }}>
                            <TouchableOpacity
                              style={[styles.smallActionButton, { backgroundColor: colors.primary, marginRight: spacing.sm, marginBottom: spacing.xs }]}
                              onPress={() => setAcceptSheetRequestId(o.request_id)}
                              disabled={respondingOpportunityId === o.request_id}
                              accessibilityLabel={t('ui.bizDash2.acceptThisRequestA11y')}
                              accessibilityRole="button"
                            >
                              <Text style={styles.smallActionButtonText}>{oppAction.label}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated, marginRight: spacing.sm, marginBottom: spacing.xs }]}
                              onPress={() => openAlternativeSheet(o.request_id)}
                              disabled={respondingOpportunityId === o.request_id}
                              accessibilityLabel={t('ui.bizDash2.offerAnAlternativeTimeA11y')}
                              accessibilityRole="button"
                            >
                              <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>{oppAction.alternatives[0].label}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated, marginBottom: spacing.xs }]}
                              onPress={() => openDeclineModal(o.request_id)}
                              disabled={respondingOpportunityId === o.request_id}
                              accessibilityLabel={t('ui.bizDash2.declineThisRequestA11y')}
                              accessibilityRole="button"
                            >
                              {/* Opens a real reason picker (Phase 1), never a silent one-tap decline. */}
                              <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>{oppAction.alternatives[1].label}</Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      )}
                      {o.status !== 'pending' && (
                        <>
                          <Text style={styles.breakdownText}>
                            {{ offered: t('ui.bizDash2.youMadeAnOffer'), accepted: t('ui.bizDash2.theyAcceptedYourOffer'), declined: t('ui.bizDash2.youDeclined'), expired: t('ui.bizDash2.noLongerOpen'), cancelled: t('ui.bizDash2.theyCancelled'), completed: t('ui.bizDash2.completed') }[o.status] ?? o.status}
                          </Text>
                          <BusinessOfferMediaPreview path={o.media_path} type={o.media_type} colors={colors} />
                        </>
                      )}
                    </View>
                    );
                  })
                )}

</>
)}
{on('opportunities') && (
<>
                {selectedPartner && (
                  <DemandNearYouCard
                    loaded={demandSignals !== null}
                    windowDays={demandSignals?.window_days ?? 14}
                    signals={describeDemandSignals(demandSignals, {
                      // The owner's own open opportunities per category (first-party data, never floored).
                      openByCategory: opportunities
                        .filter((o) => canRespondToOpportunity(o) && o.business_requests?.category)
                        .reduce((acc, o) => ({ ...acc, [o.business_requests.category]: (acc[o.business_requests.category] ?? 0) + 1 }), {}),
                    })}
                    onAction={(action) => {
                      if (action.type === 'package') openPackageModal({ occasion_type: action.occasion });
                      else if (action.type === 'opportunities') setSection('opportunities');
                      else openPostAvailabilityModal({ category: action.category ?? undefined });
                    }}
                  />
                )}
</>
)}
{on('opportunities') && (
<>
                <Text style={styles.sectionHeader}>{t('ui.bizDash2.whatTheyrePlanning')}</Text>
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.realOpenRequestsNearbyGrouped')}
                </Text>
                {occasionDemand.length === 0 ? (
                  <EmptyCopy id="business_occasion_demand" />
                ) : (
                  occasionDemand.map((d) => {
                    const emoji = OCCASION_OPTIONS.find((o) => o.key === d.occasion_type)?.icon ?? '🎉';
                    const noun = language === 'en' ? occasionLabel(d.occasion_type) : categoryName(occasionLabel(d.occasion_type), language);
                    return (
                      <View key={d.occasion_type} style={styles.gatheringRow}>
                        <Text style={styles.offerTitle}>
                          {emoji} {t('ui.bizDash2.customersPlanning', { count: Number(d.request_count), occasion: language === 'en' ? occasionPhrase(d.occasion_type) : categoryName(occasionLabel(d.occasion_type), language) })}
                        </Text>
                        <Text style={styles.breakdownText}>
                          {[
                            Number(d.weekend_request_count) > 0 ? t('ui.bizDash2.ofThemThisWeekend', { n: d.weekend_request_count }) : null,
                            (selectedPartner?.offered_occasions ?? []).includes(d.occasion_type) ? t('ui.bizDash2.youOfferThis') : null,
                            d.dominant_category ? t('ui.bizDash2.mostlyLookingFor', { category: categoryName(d.dominant_category, language), n: d.dominant_category_count, total: d.request_count }) : null,
                            d.total_party_size ? t('ui.bizDash2.totalGuests', { count: Number(d.total_party_size) }) : null,
                            d.soonest_date ? t('ui.bizDash2.soonest', { date: displayDay(`${d.soonest_date}T00:00:00`, language) }) : null,
                          ].filter(Boolean).join(' · ')}
                        </Text>
                        <TouchableOpacity
                          style={[styles.smallActionButton, { backgroundColor: colors.primary, marginTop: spacing.sm, alignSelf: 'flex-start' }]}
                          onPress={() => openPackageModal({ occasion_type: d.occasion_type })}
                          accessibilityLabel={t('ui.bizDash2.createAPackageA11y', { noun: noun })}
                          accessibilityRole="button"
                        >
                          <Text style={styles.smallActionButtonText}>{t('ui.bizDash2.createAPackage', { noun: noun })}</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })
                )}

</>
)}
{on('offers') && (
<>
                {lastPostedAvailability && (
                  // Phase 4(c): a real, persistent card -- reuses the same
                  // neutral pendingReviewCard treatment (colors.surface/
                  // border, not coral -- informational, not an action).
                  // Sourced purely from post_business_availability()'s own
                  // already-real matchedCount, no new backend logic.
                  <View style={[styles.pendingReviewCard, { marginTop: spacing.lg }]}>
                    <View style={styles.welcomeCardHeaderRow}>
                      <Text style={styles.pendingReviewTitle}>{t('ui.bizDash2.posted', { title: lastPostedAvailability.title })}</Text>
                      <TouchableOpacity onPress={() => setLastPostedAvailability(null)} accessibilityLabel={t('ui.bizDash2.dismissA11y')} accessibilityRole="button">
                        <Text style={{ color: colors.textTertiary, fontSize: 18 }}>×</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.pendingReviewRow}>
                      {lastPostedAvailability.matchedCount != null
                        ? t('ui.bizDash2.nearbyFoundMatchingRequests', { count: lastPostedAvailability.matchedCount })
                        : t('ui.bizDash2.itsLiveNearbySendsIt')}
                    </Text>
                    {lastPostedAvailability.matchedCount != null && (
                      <TouchableOpacity
                        onPress={() => { setLastPostedAvailability(null); setSection('opportunities'); }}
                        style={{ alignSelf: 'flex-start', marginTop: spacing.sm }}
                        accessibilityLabel={t('ui.bizDash2.viewOpportunitiesA11y')}
                        accessibilityRole="button"
                      >
                        <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 14 }}>{t('ui.bizDash2.viewOpportunities')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg }}>
                  <Text style={styles.sectionHeader}>{t('ui.bizDash2.yourAvailability')}</Text>
                  <TouchableOpacity
                    style={[styles.smallActionButton, { backgroundColor: colors.primary }]}
                    onPress={() => openPostAvailabilityModal()}
                    accessibilityLabel={t('ui.bizDash2.postAvailabilityA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.smallActionButtonText}>{t('ui.bizDash2.postAvailability2')}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.helperText}>{t('ui.bizDash2.tellUsWhenYouHave')}</Text>
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.haveOpenSeatsOrA')}
                </Text>
                {myAvailability.length === 0 ? (
                  <EmptyCopy id="business_postings" />
                ) : (
                  myAvailability.map((a) => (
                    <View key={a.id} style={styles.gatheringRow}>
                      <Text style={styles.offerTitle}>{a.title}</Text>
                      <Text style={styles.breakdownText}>
                        {[
                          a.category,
                          a.capacity ? `${a.remaining_capacity ?? 0}/${a.capacity} left` : null,
                          a.price != null ? `$${Number(a.price).toFixed(2)}` : null,
                        ].filter(Boolean).join(' · ') || t('ui.bizDash2.noFurtherDetailsGiven')}
                      </Text>
                      <Text style={styles.breakdownText}>{AVAILABILITY_STATUSES.has(a.status) ? t(`ui.bizDash3.availabilityStatus.${a.status}`) : a.status}</Text>
                      {a.status === 'active' && bizWindowPhrase(a.starts_at, a.ends_at, 'availability') ? (
                        <Text style={styles.breakdownText}>🕒 {bizWindowPhrase(a.starts_at, a.ends_at, 'availability')}</Text>
                      ) : null}
                      {a.status === 'active' && (
                        <TouchableOpacity
                          style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated, marginTop: spacing.sm, alignSelf: 'flex-start' }]}
                          onPress={() => handleCancelAvailability(a.id)}
                          disabled={cancelingAvailabilityId === a.id}
                          accessibilityLabel={t('ui.bizDash2.cancelThisAvailabilityA11y')}
                          accessibilityRole="button"
                        >
                          {cancelingAvailabilityId === a.id ? <ActivityIndicator color={colors.textPrimary} size="small" /> : <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>{t('ui.bizDash2.cancel')}</Text>}
                        </TouchableOpacity>
                      )}
                    </View>
                  ))
                )}

                <TouchableOpacity onPress={() => setMoreOffersOpen((v) => !v)} style={[styles.gatheringRow, { marginTop: spacing.lg }]} accessibilityRole="button" accessibilityLabel={t('ui.bizDash2.moreWaysToOfferA11y')} accessibilityState={{ expanded: moreOffersOpen }}>
                  <Text style={styles.offerTitle}>{t('ui.bizDash2.moreWaysToOffer')}{' '}{moreOffersOpen ? '⌄' : '›'}</Text>
                  {!moreOffersOpen && <Text style={styles.breakdownText}>{t('ui.bizDash2.packagesRewardsSignatureExperiences')}</Text>}
                </TouchableOpacity>
                {moreOffersOpen && (
                <>
                <SponsoredPromotionsPanel offers={offers} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg }}>
                  <Text style={styles.sectionHeader}>{t('ui.bizDash2.occasionPackages')}</Text>
                  <TouchableOpacity
                    style={[styles.smallActionButton, { backgroundColor: colors.primary }]}
                    onPress={() => openPackageModal()}
                    accessibilityLabel={t('ui.bizDash2.addAnOccasionPackageA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.smallActionButtonText}>{t('ui.bizDash2.addPackage')}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.aStandingOfferForA')}
                </Text>
                {myOccasionPackages.length === 0 ? (
                  <EmptyCopy id="business_packages" />
                ) : (
                  myOccasionPackages.map((pkg) => (
                    <TouchableOpacity
                      key={pkg.id}
                      style={styles.gatheringRow}
                      onPress={() => openPackageModal(pkg)}
                      accessibilityLabel={t('ui.bizDash2.editA11y', { name: pkg.name })}
                      accessibilityRole="button"
                    >
                      <Text style={styles.offerTitle}>
                        {pkg.active ? '' : '⚪️ '}{occasionLabel(pkg.occasion_type)}: {pkg.name}
                      </Text>
                      <Text style={styles.breakdownText}>
                        {formatOccasionPackageDetail({
                          pricePerPerson: pkg.price_per_person, minGuests: pkg.min_guests, availableDays: pkg.available_days,
                        }) || t('ui.bizDash2.noFurtherDetailsGiven')}
                      </Text>
                      {formatIncludedItemsLabel(pkg.included_items) && (
                        <Text style={styles.breakdownText}>{t('ui.bizDash2.includes')}{' '}{formatIncludedItemsLabel(pkg.included_items)}</Text>
                      )}
                      <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
                        <TouchableOpacity
                          style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated, marginRight: spacing.sm }]}
                          onPress={() => handleTogglePackageActive(pkg)}
                          accessibilityLabel={pkg.active ? t('ui.bizDash2.pauseThisPackageA11y') : t('ui.bizDash2.resumeThisPackageA11y')}
                          accessibilityRole="button"
                        >
                          <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>{pkg.active ? t('ui.bizDash2.pause') : t('ui.bizDash2.resume')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated }]}
                          onPress={() => handleDeletePackage(pkg)}
                          accessibilityLabel={t('ui.bizDash2.deleteThisPackageA11y')}
                          accessibilityRole="button"
                        >
                          <Text style={[styles.smallActionButtonText, { color: colors.danger }]}>{t('ui.bizDash2.delete')}</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  ))
                )}

                </>
                )}
</>
)}
{on('bookings') && (
<>
                {/* Item 102 (CLAUDE.md, "Businesses can participate in
                    recurring occasions"): real, consented returning
                    customers with a genuine next occurrence coming up soon
                    -- see get_business_returning_occasion_customers's own
                    migration comment for the full consent/privacy
                    boundary. Empty whenever no real customer has both
                    opted in and has real history with this business --
                    never padded or guessed. */}
                <Text style={[styles.sectionHeader, { marginTop: spacing.lg }]}>{t('ui.bizDash2.returningCustomers')}</Text>
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.customersWhoCelebratedARecurring')}
                </Text>
                {returningCustomers.length === 0 ? (
                  <EmptyCopy id="business_returning" />
                ) : (
                  returningCustomers.map((c) => {
                    const daysUntil = Math.round((new Date(c.next_occasion_date + 'T00:00:00') - new Date()) / (24 * 60 * 60 * 1000));
                    const matchingPackages = myOccasionPackages.filter((pkg) => pkg.occasion_type === c.occasion_type && pkg.active);
                    return (
                      <View key={c.occasion_id} style={styles.gatheringRow}>
                        <Text style={styles.offerTitle}>
                          {categoryName(occasionLabel(c.occasion_type), language)} · {c.requester_display_name}
                        </Text>
                        <Text style={styles.breakdownText}>
                          {c.last_offer_price == null
                            ? t('ui.bizDash2.celebratedHereLastYear')
                            : c.last_offer_price_is_per_person
                              ? t('ui.bizDash2.celebratedHereLastYearPricePerPerson', { price: Number(c.last_offer_price).toFixed(2) })
                              : t('ui.bizDash2.celebratedHereLastYearPrice', { price: Number(c.last_offer_price).toFixed(2) })}
                        </Text>
                        <Text style={styles.breakdownText}>
                          {(() => {
                            const vars = { occasion: language === 'en' ? occasionLabel(c.occasion_type).toLowerCase() : categoryName(occasionLabel(c.occasion_type), language), date: displayDay(`${c.next_occasion_date}T00:00:00`, language), count: daysUntil };
                            if (daysUntil < 0) return t('ui.bizDash2.nextOccasion', vars);
                            return daysUntil === 0 ? t('ui.bizDash2.nextOccasionToday', vars) : t('ui.bizDash2.nextOccasionInDays', vars);
                          })()}
                        </Text>
                        {c.already_outreached_this_year ? (
                          <Text style={[styles.breakdownText, { color: colors.textTertiary, marginTop: spacing.sm }]}>{t('ui.bizDash2.alreadyReachedOut')}</Text>
                        ) : outreachExpandedOccasionId === c.occasion_id ? (
                          <View style={{ marginTop: spacing.sm }}>
                            {matchingPackages.length > 0 && (
                              <>
                                <Text style={styles.breakdownText}>{t('ui.bizDash2.mentionAPackageOptional')}</Text>
                                <View style={styles.chipRow}>
                                  <TouchableOpacity
                                    style={[styles.chip, outreachPackageChoice === null && styles.chipSelected]}
                                    onPress={() => setOutreachPackageChoice(null)}
                                    accessibilityLabel={t('ui.bizDash2.noPackageA11y')}
                                    accessibilityRole="button"
                                  >
                                    <Text style={[styles.chipText, outreachPackageChoice === null && styles.chipTextSelected]}>{t('ui.bizDash2.none')}</Text>
                                  </TouchableOpacity>
                                  {matchingPackages.map((pkg) => (
                                    <TouchableOpacity
                                      key={pkg.id}
                                      style={[styles.chip, outreachPackageChoice === pkg.id && styles.chipSelected]}
                                      onPress={() => setOutreachPackageChoice(pkg.id)}
                                      accessibilityLabel={pkg.name}
                                      accessibilityRole="button"
                                    >
                                      <Text style={[styles.chipText, outreachPackageChoice === pkg.id && styles.chipTextSelected]}>{pkg.name}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              </>
                            )}
                            <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
                              <TouchableOpacity
                                style={[styles.smallActionButton, { backgroundColor: colors.primary, marginRight: spacing.sm }]}
                                onPress={() => handleSendOutreach(c.occasion_id, selectedPartner.id)}
                                disabled={sendingOutreachOccasionId === c.occasion_id}
                                accessibilityLabel={t('ui.bizDash2.sendWelcomeBackToA11y', { requesterDisplayName: c.requester_display_name })}
                                accessibilityRole="button"
                              >
                                {sendingOutreachOccasionId === c.occasion_id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.smallActionButtonText}>{t('ui.bizDash2.send')}</Text>}
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated }]}
                                onPress={() => toggleOutreachExpanded(c.occasion_id)}
                                accessibilityLabel={t('ui.bizDash2.cancelA11y')}
                                accessibilityRole="button"
                              >
                                <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>{t('ui.bizDash2.cancel')}</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={[styles.smallActionButton, { backgroundColor: colors.primary, marginTop: spacing.sm, alignSelf: 'flex-start' }]}
                            onPress={() => toggleOutreachExpanded(c.occasion_id)}
                            accessibilityLabel={t('ui.bizDash2.welcomeBackA11y', { requesterDisplayName: c.requester_display_name })}
                            accessibilityRole="button"
                          >
                            <Text style={styles.smallActionButtonText}>{t('ui.bizDash2.welcomeThemBack')}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })
                )}

</>
)}
              </>
            )}

            {(section === 'home' || section === 'profile') && (
              <>
{tool('analytics') && (
<>
              <Text style={styles.sectionHeader}>{t('ui.bizDash2.howPeopleFindYou')}</Text>
              {discoveryStats && discoveryStats.total_views > 0 ? (
                <View style={[styles.insightsCard, { marginBottom: spacing.lg }]}>
                  <Text style={styles.insightLine}>
                    {discoveryStats.views_last_30_days > 0
                      ? t('ui.bizDash2.profileViewsTotalRecent', { count: discoveryStats.total_views, recent: discoveryStats.views_last_30_days })
                      : t('ui.bizDash2.profileViewsTotal', { count: discoveryStats.total_views })}
                  </Text>
                  <Text style={styles.insightLine}>
                    {t('ui.bizDash2.viaSharedLink', { n: discoveryStats.deep_link_views, pct: discoveryStats.pct_via_deep_link ?? 0 })}
                  </Text>
                  <Text style={styles.insightLine}>{t('ui.bizDash1.browsingOrSearchingInsideNearby', { inAppViews: discoveryStats.in_app_views })}</Text>
                  {discoveryStats.intent_match_views > 0 && (
                    <Text style={styles.insightLine}>{t('ui.bizDash1.foundYouBecauseOfWhat', { intentMatchViews: discoveryStats.intent_match_views })}</Text>
                  )}
                </View>
              ) : (
                <Text style={[styles.emptyText, { marginBottom: spacing.lg }]}>
                  {t('ui.bizDash2.noProfileViewsYetShare')}
                </Text>
              )}
              {(insights && (insights.top_interests?.length > 0 || bestTimeLine(insights))) || visitFrequency !== null ? (
                <View style={styles.insightsCard}>
                  {estimatedOwed.billingModel && estimatedOwed.billingModel !== 'custom' && (
                    <View style={styles.estimatedOwedBanner}>
                      <Text style={styles.estimatedOwedLabel}>{t('ui.bizDash2.estimatedThisMonth')}</Text>
                      <Text style={styles.estimatedOwedValue}>{offerPriceLabel(estimatedOwed.estimatedAmount) ?? '—'}</Text>
                      {billingBreakdownLines(estimatedOwed).map((line) => (
                        <Text key={line} style={styles.estimatedOwedDetail}>{line}</Text>
                      ))}
                      {pastInvoices.length > 0 && (
                        <View style={{ marginTop: spacing.sm }}>
                          <Text style={styles.estimatedOwedLabel}>{t('ui.bizDash2.pastInvoices')}</Text>
                          {pastInvoices.map((inv) => {
                            const row = invoiceRow(inv);
                            return (
                              <Text key={row.id} style={styles.estimatedOwedDetail}>{row.text} · {row.status}</Text>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  )}
                  {insights?.top_interests?.length > 0 && (
                    <Text style={styles.insightLine}>{t('ui.bizDash2.yourCommunitysTopInterests')}{' '}{insights.top_interests.join(', ')}</Text>
                  )}
                  {bestTimeLine(insights) && (
                    <Text style={styles.insightLine}>{bestTimeLine(insights)}</Text>
                  )}
                  {visitFrequency !== null && (
                    <Text style={styles.insightLine}>{t('ui.bizDash2.attendeesAverage', { count: visitFrequency })}</Text>
                  )}
                </View>
              ) : (
                <EmptyCopy id="business_insights" />
              )}

</>
)}
{tool('weather') && (
<>
              {/* Phase 5 (CLAUDE.md) -- a pure presentational digest over
                  an already-real, already-live signal (Business
                  Intelligence Phase 7's weather bonus inside
                  scoreBusinessOpportunity()). Never a new signal, never a
                  fabricated forecast claim beyond what the weather RPC
                  already honestly returns -- honestly absent whenever
                  today's conditions aren't genuinely biased either way. */}
              {businessWeather && (isWeatherIndoorBiased(businessWeather) || isWeatherOutdoorBiased(businessWeather)) && (
                <>
                  <Text style={styles.sectionHeader}>{t('ui.bizDash2.todaysConditions')}</Text>
                  <View style={[styles.insightsCard, { marginBottom: spacing.lg }]}>
                    <Text style={styles.insightLine}>
                      {isWeatherIndoorBiased(businessWeather)
                        ? t('ui.bizDash2.weatherFavorsIndoorPlansRight')
                        : t('ui.bizDash2.greatWeatherForOutdoorPlans')}
                    </Text>
                    {weatherBoostedOpenCount !== null && (
                      <Text style={styles.insightLine}>
                        {weatherBoostedOpenCount > 0
                          ? t('ui.bizDash2.openOpportunitiesBoosted', { count: weatherBoostedOpenCount })
                          : t('ui.bizDash2.noOpenOpportunitiesBoosted')}
                      </Text>
                    )}
                  </View>
                </>
              )}

</>
)}
{tool('analytics') && (
<>
              {/* Business Intelligence & Opportunity Engine, Phase 4 --
                  "Learning" (see CLAUDE.md's own plan). A real,
                  aggregated-only view -- never a raw per-request dump --
                  of why a real active fulfillment policy/availability
                  posting didn't auto-match a nearby request. Honestly
                  absent when there's genuinely nothing to report. */}
              <Text style={[styles.sectionHeader, { marginTop: spacing.lg }]}>{t('ui.bizDash2.whyYouMightBeMissing')}</Text>
              {missedMatchLocked ? (
                renderLockedFeature('missed_match_reporting', t('ui.bizDash2.seeExactlyWhyNearbyRequests'))
              ) : missedMatchSummary.length === 0 ? (
                <EmptyCopy id="business_missed" />
              ) : (
                missedMatchSummary.map((m) => {
                  const info = MISSED_MATCH_REASON_LABELS[m.reason] ?? { label: m.reason, hint: null };
                  return (
                    <View key={`${m.source}-${m.reason}`} style={styles.offerCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.offerTitle}>
                          {info.label} · {m.exclusion_count}x
                        </Text>
                        {info.hint && <Text style={styles.offerDescription}>{info.hint}</Text>}
                      </View>
                    </View>
                  );
                })
              )}

              {/* The other real half of Phase 4 -- a business x category
                  breakdown of the same funnel/satisfaction numbers
                  get_partner_offer_reputation already computes across
                  every category at once, gated at the same real 5+
                  minimum sample per category. */}
              {categoryOutcomesLocked && (
                <>
                  <Text style={[styles.sectionHeader, { marginTop: spacing.lg }]}>{t('ui.bizDash2.performanceByCategory')}</Text>
                  {renderLockedFeature('category_outcomes', t('ui.bizDash2.aRealBreakdownOfYour'))}
                </>
              )}
              {categoryOutcomes.length > 0 && (
                <>
                  <Text style={[styles.sectionHeader, { marginTop: spacing.lg }]}>{t('ui.bizDash2.performanceByCategory')}</Text>
                  {categoryOutcomes.map((c) => (
                    <View key={c.category} style={styles.offerCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.offerTitle}>{c.category}</Text>
                        <Text style={styles.offerDescription}>
                          {categoryOutcomeLine(c)}
                        </Text>
                        {c.rated_count >= 3 && categoryRatingLine(c) && (
                          <Text style={styles.offerDescription}>
                            {categoryRatingLine(c)}
                          </Text>
                        )}
                      </View>
                    </View>
                  ))}
                </>
              )}

              {/* Phase 1 -- a real, owner-visible insight into the business's own
                  declined opportunities. A genuine sibling to "Why You Might Be
                  Missing Requests" above: that one is the system's own reasons a
                  request never became visible at all; this is the owner's own
                  stated reasons for a real opportunity they were shown and turned
                  down. Deliberately aggregated only, no per-request dump, and
                  never used to silently re-weight matching -- the owner decides
                  what to do with their own pattern (see CLAUDE.md's Decision 2). */}
              <Text style={[styles.sectionHeader, { marginTop: spacing.lg }]}>{t('ui.bizDash2.whatYouveDeclined')}</Text>
              {declinePatterns.length === 0 ? (
                <EmptyCopy id="business_declined" />
              ) : (
                declinePatterns.map((d) => {
                  const info = DECLINE_REASON_LABELS[d.decline_reason] ?? { label: d.decline_reason, hint: null };
                  return (
                    <View key={d.decline_reason} style={styles.offerCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.offerTitle}>
                          {info.label} · {d.decline_count}x
                        </Text>
                        {info.hint && <Text style={styles.offerDescription}>{info.hint}</Text>}
                      </View>
                    </View>
                  );
                })
              )}

              {/* Cancellation reason analytics: the owner's own view of reservation cancellations (theirs and their customers'),
                  aggregated only, reasons are optional so "no reason given" is shown honestly. Never auto-reweights matching. */}
              <Text style={[styles.sectionHeader, { marginTop: spacing.lg }]}>{t('ui.bizDash2.cancelledReservations')}</Text>
              {cancellationPatterns.length === 0 ? (
                <EmptyCopy id="business_cancelled" />
              ) : (
                cancellationPatterns.map((c) => (
                  <View key={`${c.actor_role}-${c.reason_code}`} style={styles.offerCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.offerTitle}>
                        {CANCELLATION_ACTOR_LABELS[c.actor_role] ?? c.actor_role} · {CANCELLATION_REASONS[c.reason_code] ?? t('ui.bizDash2.noReasonGiven')} · {c.cancel_count}x
                      </Text>
                    </View>
                  </View>
                ))
              )}

              {/* "Business Web as an Operating System" Phase 3 -- a real
                  per-template offer-performance funnel: viewed/accepted/
                  completed counts grouped by which real Signature
                  Experience actually generated the offer (or by offer
                  type, for an offer with no linked template) -- built
                  entirely over already-tracked data, no new signal
                  invented. */}
              <Text
                style={[styles.sectionHeader, { marginTop: spacing.lg }]}
                onLayout={(e) => {
                  performanceYRef.current = Math.max(0, e.nativeEvent.layout.y - spacing.lg);
                  if (!scrollToPerformanceRef.current) return;
                  scrollToPerformanceRef.current = false;
                  mainScrollRef.current?.scrollTo({ y: performanceYRef.current, animated: true });
                }}
              >{t('ui.bizDash2.offerPerformance')}</Text>
              {/* Item 150: one row per funnel stage this month, then the value of the offers redeemed (never "revenue"). */}
              {(() => {
                const f = offerFunnelView(offerFunnel, offerValue);
                return f ? (
                  <View style={{ marginBottom: spacing.sm }} accessibilityRole="summary">
                    <Text style={styles.offerTitle}>{f.title}</Text>
                    {[...f.stages, ...(f.valueRow ? [f.valueRow] : [])].map((row) => (
                      <View key={row.key} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                        <Text style={styles.breakdownText}>{row.label}</Text>
                        <Text style={[styles.breakdownText, { fontWeight: '700' }]}>{row.amount ?? row.count}</Text>
                      </View>
                    ))}
                    {!!f.note && <Text style={styles.breakdownText}>{f.note}</Text>}
                  </View>
                ) : null;
              })()}
              {matchFitLine(matchFit) && <Text style={styles.offerDescription}>{matchFitLine(matchFit)}</Text>}
              {offerPerformance.length === 0 ? (
                <EmptyCopy id="business_offers_sent" />
              ) : (
                offerPerformance.map((row) => (
                  <View key={row.group_key} style={styles.offerCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.offerTitle}>{row.group_label}</Text>
                      <Text style={styles.offerDescription}>{t('ui.bizDash1.offeredViewedAcceptedRedeemed', { offerCount: row.offer_count, viewedCount: row.viewed_count, acceptedCount: row.accepted_count, completedCount: row.completed_count })}</Text>
                    </View>
                  </View>
                ))
              )}

</>
)}

              </>
            )}

            {section !== 'inbox_modal' && (
              <>
{on('offers') && moreOffersOpen && (
<>
                <Text style={styles.sectionHeader}>{t('ui.bizDash2.rewardsOffers')}</Text>
                <TouchableOpacity
                  style={styles.createOfferButton}
                  onPress={() => setCreateModalVisible(true)}
                  accessibilityLabel={t('ui.bizDash2.createANewOfferA11y')}
                  accessibilityRole="button"
                >
                  <Text style={styles.createOfferButtonText}>{t('ui.bizDash2.createOffer')}</Text>
                </TouchableOpacity>
                {offers.length === 0 ? (
                  <EmptyCopy id="business_offers" />
                ) : (
                  offers.map((offer) => (
                    <View key={offer.id} style={styles.offerCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.offerTitle}>{offer.title}</Text>
                        {offer.description ? <Text style={styles.offerDescription}>{offer.description}</Text> : null}
                        <Text style={styles.offerRedemptionCount}>
                          {offer.redemption_limit != null
                            ? t('ui.bizDash2.redeemedOfLimit', { n: offerRedemptionCounts[offer.id] ?? 0, limit: offer.redemption_limit })
                            : t('ui.bizDash2.redeemed', { n: offerRedemptionCounts[offer.id] ?? 0 })}
                        </Text>
                        {offer.unlock_scope != null && (
                          <Text style={styles.breakdownText}>
                            {offer.unlock_scope === 'community'
                              ? t('ui.bizDash2.unlocksAtCommunityMembers', { n: offer.unlock_min_members })
                              : t('ui.bizDash2.unlocksAtApprovedAttendees', { n: offer.unlock_min_members })}
                          </Text>
                        )}
                      </View>
                      <Switch
                        value={offer.active}
                        onValueChange={() => handleToggleActive(offer)}
                        accessibilityLabel={offer.active ? t('ui.bizDash2.offerActiveToggleA11y', { title: offer.title }) : t('ui.bizDash2.offerInactiveToggleA11y', { title: offer.title })}
                      />
                    </View>
                  ))
                )}

</>
)}
{on('bookings') && (
<>
                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>{t('ui.bizDash2.confirmARedemption')}</Text>
                <Text style={styles.offerDescription}>
                  {t('ui.bizDash2.askTheCustomerForThe')}
                </Text>
                <View style={[styles.gatheringRow, { marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center' }]}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder={t('ui.bizDash2.n6DigitCode')}
                    placeholderTextColor={colors.textTertiary}
                    value={redemptionCodeInput}
                    onChangeText={(t) => setRedemptionCodeInput(t.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    maxLength={6}
                    accessibilityLabel={t('ui.bizDash2.redemptionConfirmationCodeA11y')}
                  />
                  <TouchableOpacity
                    style={[styles.createOfferButton, { marginBottom: 0, marginLeft: spacing.sm, opacity: confirmingCode || !redemptionCodeInput.trim() ? 0.6 : 1 }]}
                    onPress={handleConfirmRedemption}
                    disabled={confirmingCode || !redemptionCodeInput.trim()}
                    accessibilityLabel={t('ui.bizDash2.confirmRedemptionCodeA11y')}
                    accessibilityRole="button"
                  >
                    {confirmingCode ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.createOfferButtonText}>{t('ui.bizDash2.confirm')}</Text>
                    )}
                  </TouchableOpacity>
                </View>

</>
)}
{on('profile') && (
<>
                <Text style={[styles.helperText, { marginTop: spacing.md }]}>{t('ui.bizDash2.tellUsWhatYouOffer')}</Text>
                {selectedPartner && (
                  <View style={{ marginTop: spacing.md }}>
                    <TellNearbyBusinessCard
                      partner={selectedPartner}
                      onApplied={(applied) => setSelectedPartner((prev) => ({ ...prev, ...applied }))}
                      onOpenProfileEditor={openEditProfileModal}
                    />
                  </View>
                )}
                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>{t('ui.bizDash2.businessProfile')}</Text>
                <View style={styles.gatheringRow}>
                  <Text style={styles.offerTitle}>{selectedPartner?.name}</Text>
                  <Text style={styles.breakdownText}>
                    {selectedPartner?.category
                      ? (BUSINESS_CATEGORIES.find((c) => c.key === selectedPartner.category)?.label ?? selectedPartner.category) +
                        (selectedPartner?.subcategory ? ` · ${selectedPartner.subcategory}` : '')
                      : t('ui.bizDash2.noCategorySetPickOne')}
                  </Text>
                  {(selectedPartner?.categories ?? []).length > 0 && (
                    <Text style={[styles.breakdownText, { marginTop: spacing.xs }]}>
                      {t('ui.bizDash2.also')}{' '}{selectedPartner.categories.join(', ')}
                    </Text>
                  )}
                  {selectedPartner?.description ? (
                    <Text style={styles.offerDescription}>{selectedPartner.description}</Text>
                  ) : (
                    <Text style={styles.offerDescription}>{t('ui.bizDash2.noDescriptionYet')}</Text>
                  )}
                  {selectedPartner?.differentiator ? (
                    <Text style={[styles.offerDescription, { fontStyle: 'italic', marginTop: spacing.xs }]}>
                      "{selectedPartner.differentiator}"
                    </Text>
                  ) : null}
                  {(selectedPartner?.attributes ?? []).length > 0 || selectedPartner?.cuisine ? (
                    <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
                      {selectedPartner?.cuisine && (
                        <View style={styles.chip}>
                          <Text style={styles.chipText}>{cuisineLabel(selectedPartner.cuisine)}</Text>
                        </View>
                      )}
                      {(selectedPartner?.attributes ?? []).map((key) => (
                        <View key={key} style={styles.chip}>
                          <Text style={styles.chipText}>{businessAttributeLabel(key)}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  <TouchableOpacity
                    onPress={openEditProfileModal}
                    style={{ marginTop: spacing.sm }}
                    accessibilityLabel={t('ui.bizDash2.editBusinessProfileA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.messageMemberLink}>{t('ui.bizDash2.editProfile')}</Text>
                  </TouchableOpacity>
                  {(() => {
                    const hint = selectedPartner ? activityHints(selectedPartner)[0] : null;
                    if (!hint) return null;
                    return (
                      <TouchableOpacity onPress={openEditProfileModal} style={{ marginTop: spacing.sm }} accessibilityRole="button" accessibilityLabel={t('ui.bizDash2.addToYourProfileA11y', { label: hint.add.label })}>
                        <Text style={styles.breakdownText}>{t('ui.bizDash2.addToYourProfileTo', { icon: hint.icon, display: hint.display, label: hint.add.label })}</Text>
                      </TouchableOpacity>
                    );
                  })()}
                </View>

                {/* "Business Profile Phase 1" addendum -- AI Category
                    Classification. A real, deterministic keyword match
                    against the business's own real name/description, never
                    an LLM call -- only shown when it genuinely differs from
                    what's already stored, since there's nothing to confirm
                    when it already matches. */}
                {categorySuggestion && (
                  <View style={[styles.gatheringRow, { marginTop: spacing.md }]}>
                    <Text style={styles.breakdownText}>
                      {t('ui.bizDash2.weThinkMightBe', { name: selectedPartner?.name })}
                    </Text>
                    <Text style={styles.offerTitle}>
                      {BUSINESS_CATEGORIES.find((c) => c.key === categorySuggestion.category)?.label ?? categorySuggestion.category}
                    </Text>
                    <View style={{ flexDirection: 'row', marginTop: spacing.sm, gap: spacing.sm }}>
                      <TouchableOpacity
                        style={[styles.smallActionButton, { backgroundColor: colors.primary }]}
                        onPress={handleConfirmCategorySuggestion}
                        disabled={savingCategorySuggestion}
                        accessibilityLabel={t('ui.bizDash2.looksRightUpdateMyCategoryA11y')}
                        accessibilityRole="button"
                      >
                        <Text style={styles.smallActionButtonText}>{savingCategorySuggestion ? t('ui.bizDash2.saving') : t('ui.bizDash2.looksRight')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated }]}
                        onPress={handleDismissCategorySuggestion}
                        accessibilityLabel={selectedPartner?.category ? t('ui.bizDash2.keepAs', { label: BUSINESS_CATEGORIES.find((c) => c.key === selectedPartner.category)?.label ?? selectedPartner.category }) : t('ui.bizDash2.keepAsCurrent')}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>
                          {selectedPartner?.category ? t('ui.bizDash2.keepAs', { label: BUSINESS_CATEGORIES.find((c) => c.key === selectedPartner.category)?.label ?? selectedPartner.category }) : t('ui.bizDash2.keepAsUnset')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* "Business Profile Phase 1" addendum -- "What You Can
                    Accommodate." Group size is read-only here (reflecting
                    the real business_fulfillment_policies row already
                    loaded above -- no second capacity system), Experiences
                    & Uses is a real, saved chip picker over the same
                    party_type vocabulary gatherings/business_experiences
                    already use, and Space reflects the one real amenity
                    signal this schema actually has (outdoor_seating) --
                    Wi-Fi/pet-friendly/private-room have no real taxonomy
                    anywhere in this app and are deliberately not fabricated
                    here. */}
                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>{t('ui.bizDash2.whatYouCanAccommodate')}</Text>
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.helpNearbySendYouRequests')}
                </Text>
                <View style={styles.gatheringRow}>
                  <Text style={[styles.breakdownText, { fontWeight: '700' }]}>{t('ui.bizDash2.groupSize')}</Text>
                  <Text style={styles.breakdownText}>
                    {fulfillmentPolicy?.party_size_min != null || fulfillmentPolicy?.party_size_max != null
                      ? t('ui.bizDash2.groupsOf', { partySizeMin: fulfillmentPolicy.party_size_min ?? '1', partySizeMax: fulfillmentPolicy.party_size_max ?? '∞' })
                      : t('ui.bizDash2.notSetYet')}
                  </Text>
                  <TouchableOpacity onPress={openPolicyModal} accessibilityLabel={t('ui.bizDash2.editGroupSizeA11y')} accessibilityRole="button">
                    <Text style={styles.messageMemberLink}>✏️ {fulfillmentPolicy ? t('ui.bizDash2.edit') : t('ui.bizDash2.setYourGroupSize')}</Text>
                  </TouchableOpacity>
                </View>
                <View style={[styles.gatheringRow, { marginTop: spacing.sm }]}>
                  <Text style={[styles.breakdownText, { fontWeight: '700', marginBottom: spacing.xs }]}>{t('ui.bizDash2.experiencesUses')}</Text>
                  <View style={styles.chipRow}>
                    {ACCOMMODATE_PARTY_TYPE_OPTIONS.map((p) => {
                      const selected = accommodatePartyTypesInput.includes(p.key);
                      return (
                        <TouchableOpacity
                          key={p.key}
                          style={[styles.chip, selected && styles.chipSelected]}
                          onPress={() => setAccommodatePartyTypesInput((prev) => (selected ? prev.filter((k) => k !== p.key) : [...prev, p.key]))}
                          accessibilityRole="button"
                          accessibilityLabel={p.label}
                          accessibilityState={{ selected }}
                        >
                          <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{p.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TouchableOpacity
                    style={[styles.postUpdateButton, { marginTop: spacing.sm }]}
                    onPress={handleSaveAccommodations}
                    disabled={savingAccommodations}
                    accessibilityLabel={t('ui.bizDash2.saveWhatYouCanAccommodateA11y')}
                    accessibilityRole="button"
                  >
                    {savingAccommodations ? <ActivityIndicator color="#fff" /> : <Text style={styles.postUpdateButtonText}>{t('ui.bizDash2.save')}</Text>}
                  </TouchableOpacity>
                  <SettingConflictNotice messages={conflictMessages(settingConflicts.entries, 'accommodations')} />
                </View>
                <View style={[styles.gatheringRow, { marginTop: spacing.sm }]}>
                  <Text style={[styles.breakdownText, { fontWeight: '700' }]}>{t('ui.bizDash2.space')}</Text>
                  <Text style={styles.breakdownText}>
                    {(selectedPartner?.attributes ?? []).includes('outdoor_seating')
                      ? t('ui.bizDash2.outdoorSeating')
                      : t('ui.bizDash2.notCurrentlyListed')}
                  </Text>
                  <TouchableOpacity
                    onPress={openEditProfileModal}
                    accessibilityLabel={t('ui.bizDash2.editSpaceAndAmenitiesA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.messageMemberLink}>{t('ui.bizDash2.editUnderWhyPeopleChoose')}</Text>
                  </TouchableOpacity>
                </View>

                {/* "Business Story" plan, Phase 2 -- Business Goals. A real,
                    small, dedicated save distinct from the full profile
                    edit above -- meant to be revisited often. */}
                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>{t('ui.bizDash2.whatDoYouWantMore')}</Text>
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.tellNearbyOnceAndIt')}
                </Text>
                <View style={styles.chipRow}>
                  {BUSINESS_ATTRIBUTE_OPTIONS.filter((a) => a.key !== LEGACY_RESERVATION_ATTRIBUTE).map((a) => {
                    const selected = priorityAttributesInput.includes(a.key);
                    return (
                      <TouchableOpacity
                        key={a.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setPriorityAttributesInput((prev) => (selected ? prev.filter((k) => k !== a.key) : [...prev, a.key]))}
                        accessibilityRole="button"
                        accessibilityLabel={a.label}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{a.icon} {a.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {/* "Business Profile Phase 1" addendum -- the Timing half
                    of Want More Of. Real, separate vocabulary from the
                    customer/intent chips above (see CLAUDE.md), saved
                    together via the same Save button below. */}
                <Text style={[styles.breakdownText, { fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs }]}>{t('ui.bizDash2.when')}</Text>
                <View style={styles.chipRow}>
                  {PRIORITY_TIME_WINDOW_OPTIONS.map((w) => {
                    const selected = priorityTimeWindowsInput.includes(w.key);
                    return (
                      <TouchableOpacity
                        key={w.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setPriorityTimeWindowsInput((prev) => (selected ? prev.filter((k) => k !== w.key) : [...prev, w.key]))}
                        accessibilityRole="button"
                        accessibilityLabel={w.label}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{w.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {/* Owner item 56 follow-up: an optional exact time-of-day preference ("4-7 PM"), additive to the
                    coarse buckets above -- a preference for the kind of opportunity to see ranked higher, never
                    an availability promise. Same From/To/Clear picker the offer editor already uses. */}
                <Text style={styles.helperText}>
                  {(() => {
                    const win = priorityTimeRangeFromChoice(priorityTimeStartInput, priorityTimeEndInput);
                    const label = win.error ? null : priorityTimeRangeLabel(win.start, win.end);
                    return label ? t('ui.bizDash2.orSetAnExactWindow', { label: label }) : t('ui.bizDash2.orSetAnExactWindow2');
                  })()}
                </Text>
                {renderAvailabilityWindow({
                  from: priorityTimeStartInput, until: priorityTimeEndInput,
                  setFrom: setPriorityTimeStartInput, setUntil: setPriorityTimeEndInput,
                  picker: priorityTimeRangePicker, setPicker: setPriorityTimeRangePicker,
                })}
                {/* "Intelligent demand inbox" Phase 2 (CLAUDE.md, Sep 3
                    2026) -- the real WHY half of "What You're Looking
                    For." Reuses the exact same OCCASION_OPTIONS
                    vocabulary Phase 1's consumer-side occasion picker
                    (AskBusinessScreen.js) already established -- one real
                    taxonomy on both sides. Saved via the same Save button
                    below, alongside the customer/time chips above. */}
                <Text style={[styles.breakdownText, { fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs }]}>{t('ui.bizDash2.why')}</Text>
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.whatOccasionsWouldYouLike')}
                </Text>
                <View style={[styles.chipRow, { marginTop: spacing.xs }]}>
                  {OCCASION_OPTIONS.map((o) => {
                    const selected = priorityOccasionsInput.includes(o.key);
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setPriorityOccasionsInput((prev) => (selected ? prev.filter((k) => k !== o.key) : [...prev, o.key]))}
                        accessibilityRole="button"
                        accessibilityLabel={o.label}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TouchableOpacity
                  style={[styles.postUpdateButton, { marginTop: spacing.sm }]}
                  onPress={handleSavePriorityAttributes}
                  disabled={savingPriorityAttributes}
                  accessibilityLabel={t('ui.bizDash2.saveWhatYoureLookingForA11y')}
                  accessibilityRole="button"
                >
                  {savingPriorityAttributes ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.postUpdateButtonText}>{t('ui.bizDash2.save')}</Text>
                  )}
                </TouchableOpacity>
                <SettingConflictNotice messages={conflictMessages(settingConflicts.entries, 'priority')} />

                {/* Business Intelligence & Opportunity Engine, Phase 1 --
                    the Business Priority Engine: a real, time-bounded
                    "want more of X right now" signal, additive to the
                    permanent chips above -- never edits them, expires on
                    its own real deadline (swept hourly by the same cron
                    job that already expires business_requests/
                    business_availability). */}
                <Text style={[styles.breakdownText, { fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs }]}>
                  {t('ui.bizDash2.temporaryBoostOptional')}
                </Text>
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.wantMoreOfOneSpecific')}
                </Text>
                {activePrioritySignals.length > 0 && (
                  <View style={{ marginTop: spacing.xs, marginBottom: spacing.xs }}>
                    {activePrioritySignals.map((s) => (
                      <View key={s.id} style={[styles.gatheringRow, { marginTop: spacing.xs }]}>
                        <Text style={styles.breakdownText}>
                          🎯 {categoryName(s.category, language)} — {(language === 'en' ? windowPhrase(null, s.expires_at, 'availability')?.replace('Available until', 'until') : bizWindowPhrase(null, s.expires_at, 'event')) ?? t('ui.bizHelp.boostEnded')}
                        </Text>
                        <TouchableOpacity
                          onPress={() => handleClearBoost(s.id)}
                          accessibilityLabel={t('ui.bizDash2.clearBoostForA11y', { category: s.category })}
                          accessibilityRole="button"
                        >
                          <Text style={styles.messageMemberLink}>{t('ui.bizDash2.clear')}</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
                <View style={[styles.chipRow, { marginTop: spacing.xs }]}>
                  {INTEREST_OPTIONS.map((c) => {
                    const selected = boostCategoryInput === c;
                    return (
                      <TouchableOpacity
                        key={c}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setBoostCategoryInput(selected ? null : c)}
                        accessibilityRole="button"
                        accessibilityLabel={c}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{c}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {boostCategoryInput && (
                  <>
                    <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
                      {[
                        { key: 'today', label: t('ui.bizDash2.today') },
                        { key: 'weekend', label: t('ui.bizDash2.thisWeekend') },
                        { key: '1week', label: t('ui.bizDash2.n1Week') },
                      ].map((d) => {
                        const selected = boostDurationInput === d.key;
                        return (
                          <TouchableOpacity
                            key={d.key}
                            style={[styles.chip, selected && styles.chipSelected]}
                            onPress={() => setBoostDurationInput(d.key)}
                            accessibilityRole="button"
                            accessibilityLabel={d.label}
                            accessibilityState={{ selected }}
                          >
                            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{d.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <TouchableOpacity
                      style={[styles.postUpdateButton, { marginTop: spacing.sm }]}
                      onPress={handleSetBoost}
                      disabled={savingBoost}
                      accessibilityLabel={t('ui.bizDash2.saveTemporaryBoostA11y')}
                      accessibilityRole="button"
                    >
                      {savingBoost ? <ActivityIndicator color="#fff" /> : <Text style={styles.postUpdateButtonText}>{t('ui.bizDash2.boostThisCategory')}</Text>}
                    </TouchableOpacity>
                  </>
                )}

                {/* Phase 3 -- Availability Pulse: one tap sets and saves. */}
                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>{t('ui.bizDash2.howsBusinessRightNow')}</Text>
                <View style={styles.chipRow}>
                  {AVAILABILITY_PULSE_OPTIONS.map((p) => {
                    const selected = selectedPartner?.availability_pulse === p.key;
                    return (
                      <TouchableOpacity
                        key={p.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => handleSavePulse(p.key)}
                        disabled={savingPulse}
                        accessibilityRole="button"
                        accessibilityLabel={p.label}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{p.icon} {p.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput
                  style={[styles.input, { marginTop: spacing.sm }]}
                  placeholder={t('ui.bizDash2.optionalNoteEGPatio')}
                  placeholderTextColor={colors.textTertiary}
                  value={pulseNoteInput}
                  onChangeText={setPulseNoteInput}
                  maxLength={140}
                  accessibilityLabel={t('ui.bizDash2.availabilityNoteA11y')}
                />
                {selectedPartner?.availability_pulse && (
                  <Text style={styles.helperText}>
                    {isAvailabilityPulseFresh(selectedPartner.availability_pulse_updated_at)
                      ? t('ui.bizDash2.setToCustomersSeeThis', { availabilityPulseLabel: availabilityPulseLabel(selectedPartner.availability_pulse) })
                      : t('ui.bizDash2.thisIsMoreThanA')}
                  </Text>
                )}

                {/* "Business Story" plan, Phase 6 -- Signature Experiences.
                    Suggestions are derived purely from attributes the
                    owner has already confirmed (Phase 1) -- never an LLM
                    call, never fabricated. A suggestion drops out of this
                    review list the moment it's addressed (kept, edited +
                    saved, or explicitly removed) -- see
                    dismissedSuggestionAttrs. */}
                {(() => {
                  const suggestions = deriveSignatureExperienceSuggestions({
                    category: selectedPartner?.category,
                    attributes: selectedPartner?.attributes ?? [],
                    cuisine: selectedPartner?.cuisine,
                    cuisineLabel: selectedPartner?.cuisine ? cuisineLabel(selectedPartner.cuisine) : null,
                  });
                  const covered = new Set([
                    ...experiences.flatMap((e) => e.attributes ?? []),
                    ...dismissedSuggestionAttrs,
                  ]);
                  const pending = suggestions.filter((s) => !covered.has(s.attribute));
                  if (pending.length === 0) return null;
                  return (
                    <>
                      <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>{t('ui.bizDash2.weCreatedExperiences', { count: pending.length })}</Text>
                      <Text style={styles.helperText}>
                        {t('ui.bizDash2.basedOnWhatYouTold')}
                      </Text>
                      {pending.map((s) => (
                        <View key={s.attribute} style={styles.gatheringRow}>
                          <Text style={styles.offerTitle}>{s.icon} {s.title}</Text>
                          <Text style={styles.breakdownText}>{s.description}</Text>
                          <Text style={[styles.breakdownText, { color: colors.textTertiary, fontStyle: 'italic' }]}>
                            {t('ui.bizDash2.basedOn')}{' '}{businessAttributeLabel(s.attribute)}
                          </Text>
                          <View style={{ flexDirection: 'row', marginTop: spacing.sm, flexWrap: 'wrap', gap: spacing.sm }}>
                            <TouchableOpacity
                              style={[styles.smallActionButton, { backgroundColor: colors.primary }]}
                              onPress={() => handleKeepSuggestion(s)}
                              accessibilityLabel={t('ui.bizDash2.keepA11y', { title: s.title })}
                              accessibilityRole="button"
                            >
                              <Text style={styles.smallActionButtonText}>{t('ui.bizDash2.keep')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated }]}
                              onPress={() => openExperienceModal(s, { fromSuggestionId: s.attribute })}
                              accessibilityLabel={t('ui.bizDash2.editA11y2', { title: s.title })}
                              accessibilityRole="button"
                            >
                              <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>{t('ui.bizDash2.edit')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated }]}
                              onPress={() => handleRemoveSuggestion(s)}
                              accessibilityLabel={t('ui.bizDash2.removeA11y', { title: s.title })}
                              accessibilityRole="button"
                            >
                              <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>{t('ui.bizDash2.remove')}</Text>
                            </TouchableOpacity>
                          </View>
                          <SettingConflictNotice messages={conflictMessages(settingConflicts.entries, `experience_suggestion:${s.attribute}`)} />
                        </View>
                      ))}
                    </>
                  );
                })()}

</>
)}
{on('profile') && (
<>
                {/* "Occasions we offer": an explicit capability, separate from "want more" above. Saves on
                    tap (no Save button); Nearby then routes matching occasion requests here first, and a
                    package (if any) is still what gets offered -- nothing is invented for this list alone. */}
                <Text style={styles.sectionHeader}>{t('ui.bizDash2.occasionsWeOffer')}</Text>
                <View style={[styles.chipRow, { marginTop: spacing.xs }]}>
                  {OFFERED_OCCASION_OPTIONS.map((o) => {
                    const selected = shownValue(settingConflicts.entries, 'offered_occasions', selectedPartner?.offered_occasions ?? []).includes(o.key);
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => handleToggleOfferedOccasion(o.key)}
                        accessibilityRole="button"
                        accessibilityLabel={`${o.label}${selected ? t('ui.bizDash2.offeredA11y') : ''}`}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <SettingConflictNotice
                  messages={conflictMessages(settingConflicts.entries, 'offered_occasions')}
                  onSave={pendingSaveFor('offered_occasions', (v) => saveOfferedOccasions(v))}
                  saving={savingPendingSetting === 'offered_occasions'}
                />
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.requestsForTheseOccasionsReach')}
                </Text>
                {/* Hours (item 71): one optional row, expands in place. Feeds the consumer "Open now" filter; never inferred. */}
                {selectedPartner ? (
                  <BusinessHoursEditor
                    partner={selectedPartner}
                    onSaved={(hours) => setSelectedPartner((prev) => ({ ...prev, operating_hours: hours }))}
                  />
                ) : null}
                {/* Weather sensitivity (item 63): say it once; Nearby ranks your offers with the weather (never hides them). */}
                <Text style={styles.sectionHeader}>{t('ui.bizDash2.isYourExperienceAffectedBy')}</Text>
                <View style={[styles.chipRow, { marginTop: spacing.xs }]}>
                  {WEATHER_SETTING_OPTIONS.map((o) => {
                    const selected = shownValue(settingConflicts.entries, 'weather_setting', selectedPartner?.weather_setting ?? null) === o.key;
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => handlePickWeatherSetting(o.key)}
                        accessibilityRole="button"
                        accessibilityLabel={`${o.label}${selected ? t('ui.bizDash2.selectedA11y') : ''}`}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <SettingConflictNotice
                  messages={conflictMessages(settingConflicts.entries, 'weather_setting')}
                  onSave={pendingSaveFor('weather_setting', (v) => saveWeatherSetting(v))}
                  saving={savingPendingSetting === 'weather_setting'}
                />
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.outdoorOnlyShownLessWhen')}
                </Text>
                {/* Booking mode (item 72): one owner-declared answer that sets the customer's button. */}
                <Text style={styles.sectionHeader}>{t('ui.bizDash2.howDoCustomersComeIn')}</Text>
                <View style={[styles.chipRow, { marginTop: spacing.xs }]}>
                  {BOOKING_MODE_OPTIONS.map((o) => {
                    const selected = bookingModeOf(selectedPartner) === o.key;
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => handlePickBookingMode(o.key)}
                        accessibilityRole="button"
                        accessibilityLabel={`${o.label}${selected ? t('ui.bizDash2.selectedA11y') : ''}`}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.setsTheButtonCustomersSee')}
                </Text>
                {/* Price (items 40 + 82): one coarse tier, $ to $$$$, plus an optional typical spend per person. Owner-declared, never inferred. */}
                <Text style={styles.sectionHeader}>{t('ui.bizDash2.whatDoesItUsuallyCost')}</Text>
                <View style={[styles.chipRow, { marginTop: spacing.xs }]}>
                  {BUSINESS_PRICE_LEVELS.map((key) => {
                    const selected = (selectedPartner?.price_level ?? null) === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => handlePickPriceLevel(key)}
                        accessibilityRole="button"
                        accessibilityLabel={`${key}${selected ? t('ui.bizDash2.selectedA11y') : ''}`}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{key}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm }}>
                  <TextInput
                    style={[styles.notesInput, { flex: 1, minHeight: 0 }]}
                    placeholder={t('ui.bizDash2.typicalSpendPerPersonOptional')}
                    placeholderTextColor={colors.textTertiary}
                    value={spendDraft ?? (selectedPartner?.typical_spend_per_person != null ? String(selectedPartner.typical_spend_per_person) : '')}
                    onChangeText={(t) => setSpendDraft(t.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    maxLength={4}
                    accessibilityLabel={t('ui.bizDash2.typicalSpendPerPersonInA11y')}
                  />
                  {spendDraft !== null && (
                    <TouchableOpacity
                      style={[styles.chip, styles.chipSelected, { marginLeft: spacing.sm }]}
                      onPress={handleSaveTypicalSpend}
                      disabled={savingSpend}
                      accessibilityRole="button"
                      accessibilityLabel={t('ui.bizDash2.saveTypicalSpendA11y')}
                    >
                      <Text style={[styles.chipText, styles.chipTextSelected]}>{savingSpend ? t('ui.bizDash2.saving2') : t('ui.bizDash2.save')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.aRoughIdeaIsEnough')}
                </Text>
                {/* Item 80: largest group (total people), owner-declared; used only to decide which requests reach you. */}
                <Text style={styles.sectionHeader}>{t('ui.bizDash2.largestGroupYouCanHost')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs }}>
                  <TextInput
                    style={[styles.notesInput, { flex: 1, minHeight: 0 }]}
                    placeholder={t('ui.bizDash2.notSet')}
                    placeholderTextColor={colors.textTertiary}
                    value={maxGroupDraft ?? (selectedPartner?.max_group_size != null ? String(selectedPartner.max_group_size) : '')}
                    onChangeText={(t) => setMaxGroupDraft(t.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    maxLength={4}
                    accessibilityLabel={t('ui.bizDash2.largestGroupYouCanHostA11y')}
                  />
                  {maxGroupDraft !== null && (
                    <TouchableOpacity
                      style={[styles.chip, styles.chipSelected, { marginLeft: spacing.sm }]}
                      onPress={handleSaveMaxGroupSize}
                      disabled={savingMaxGroup}
                      accessibilityRole="button"
                      accessibilityLabel={t('ui.bizDash2.saveGroupSizeA11y')}
                    >
                      <Text style={[styles.chipText, styles.chipTextSelected]}>{savingMaxGroup ? t('ui.bizDash2.saving2') : t('ui.bizDash2.save')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.totalPeopleCountingEveryoneRequests')}
                </Text>
                {SPACES.filter((sp) => (selectedPartner?.attributes ?? []).includes(sp.attribute)).map((sp) => (
                  <View key={sp.key} style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm }}>
                    <Text style={[styles.helperText, { width: 110, marginTop: 0 }]}>{sp.label}</Text>
                    <TextInput
                      style={[styles.notesInput, { flex: 1, minHeight: 0 }]}
                      placeholder={t('ui.bizDash2.notSet')}
                      placeholderTextColor={colors.textTertiary}
                      value={spaceDrafts[sp.key] ?? (selectedPartner?.[sp.column] != null ? String(selectedPartner[sp.column]) : '')}
                      onChangeText={(t) => setSpaceDrafts((prev) => ({ ...prev, [sp.key]: t.replace(/[^0-9]/g, '') }))}
                      keyboardType="number-pad"
                      maxLength={4}
                      accessibilityLabel={t('ui.bizDash2.largestGroupTotalPeopleA11y', { label: sp.label })}
                    />
                    {spaceDrafts[sp.key] !== undefined && (
                      <TouchableOpacity
                        style={[styles.chip, styles.chipSelected, { marginLeft: spacing.sm }]}
                        onPress={() => handleSaveSpaceCapacity(sp)}
                        disabled={savingSpace === sp.key}
                        accessibilityRole="button"
                        accessibilityLabel={t('ui.bizDash2.saveSizeA11y', { label: sp.label })}
                      >
                        <Text style={[styles.chipText, styles.chipTextSelected]}>{savingSpace === sp.key ? t('ui.bizDash2.saving2') : t('ui.bizDash2.save')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                {SPACES.some((sp) => (selectedPartner?.attributes ?? []).includes(sp.attribute)) && (
                  <Text style={styles.helperText}>
                    {t('ui.bizDash2.theMostPeopleEachSpace')}
                  </Text>
                )}
                {/* Suited ages (item 50): descriptive only, never a restriction; owner-declared. */}
                <Text style={styles.sectionHeader}>{t('ui.bizDash2.whatAgesIsItSuited')}</Text>
                <AgeRangePicker
                  label={t('ui.bizDash2.ages')}
                  min={shownValue(settingConflicts.entries, 'suited_ages', { min: selectedPartner?.suited_age_min ?? null }).min ?? null}
                  max={shownValue(settingConflicts.entries, 'suited_ages', { max: selectedPartner?.suited_age_max ?? null }).max ?? null}
                  onChange={handlePickSuitedAges}
                />
                <SettingConflictNotice
                  messages={conflictMessages(settingConflicts.entries, 'suited_ages')}
                  onSave={pendingSaveFor('suited_ages', (v) => saveSuitedAges(v))}
                  saving={savingPendingSetting === 'suited_ages'}
                />
                {/* Item 86: what you don't accommodate. Requests that conflict are never sent to you or shown with your business. */}
                <Text style={styles.sectionHeader}>{t('ui.bizDash2.whatDontYouAccommodate')}</Text>
                {[NOT_ACCOMMODATED_OPTIONS.filter((o) => !ADULT_AGE_RULES.includes(o.key)), NOT_ACCOMMODATED_OPTIONS.filter((o) => ADULT_AGE_RULES.includes(o.key))].map((group, gi) => (
                <View key={gi}>
                {gi === 1 && <Text style={[styles.helperText, { marginTop: spacing.sm }]}>{t('ui.bizDash2.ageRestrictionPickOne')}</Text>}
                <View style={[styles.chipRow, { marginTop: spacing.xs }]}>
                  {group.map((o) => {
                    const selected = shownValue(settingConflicts.entries, 'not_accommodated', notAccommodatedOf(selectedPartner)).includes(o.key);
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => handleToggleNotAccommodated(o.key)}
                        accessibilityRole="button"
                        accessibilityLabel={`${o.label}${selected ? t('ui.bizDash2.selectedA11y') : ''}`}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                </View>
                ))}
                <SettingConflictNotice
                  messages={conflictMessages(settingConflicts.entries, 'not_accommodated')}
                  onSave={pendingSaveFor('not_accommodated', (v) => saveNotAccommodated(v))}
                  saving={savingPendingSetting === 'not_accommodated'}
                />
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.requestsThatConflictArentSent')}
                </Text>
                {/* Item 88: dietary options, asked only of a food business (or one that already declared some). */}
                {dietaryRelevantFor(selectedPartner) && (
                  <>
                    <Text style={styles.sectionHeader}>{t('ui.bizDash2.whatDietaryOptionsDoYou')}</Text>
                    <View style={[styles.chipRow, { marginTop: spacing.xs }]}>
                      {BUSINESS_DIETARY_OPTIONS.map((o) => {
                        const selected = shownValue(settingConflicts.entries, 'dietary_options', dietaryOptionsOf(selectedPartner)).includes(o.key);
                        return (
                          <TouchableOpacity
                            key={o.key}
                            style={[styles.chip, selected && styles.chipSelected]}
                            onPress={() => handleToggleDietaryOption(o.key)}
                            accessibilityRole="button"
                            accessibilityLabel={`${o.label}${selected ? t('ui.bizDash2.selectedA11y') : ''}`}
                            accessibilityState={{ selected }}
                          >
                            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <Text style={styles.helperText}>
                      {t('ui.bizDash2.customersWhoAskForThese')}
                    </Text>
                  </>
                )}
</>
)}
{on('offers') && moreOffersOpen && (
<>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl }}>
                  <Text style={styles.sectionHeader}>{t('ui.bizDash2.yourSignatureExperiences')}</Text>
                  <TouchableOpacity
                    style={[styles.smallActionButton, { backgroundColor: colors.primary }]}
                    onPress={() => openExperienceModal(null)}
                    accessibilityLabel={t('ui.bizDash2.addASignatureExperienceA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.smallActionButtonText}>{t('ui.bizDash2.add')}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.helperText}>
                  {t('ui.bizDash2.realCuratedThingsPeopleCan')}
                </Text>
                {entitlements && entitlementLimit(entitlements, 'signature_experiences') !== null && (
                  <Text style={[styles.helperText, checkLimit(entitlements, 'signature_experiences', experiences.length).atLimit && { color: colors.warning, fontWeight: '700' }]}>
                    {checkLimit(entitlements, 'signature_experiences', experiences.length).atLimit
                      ? t('ui.bizDash2.usedUpgrade', { n: experiences.length, limit: entitlementLimit(entitlements, 'signature_experiences') })
                      : t('ui.bizDash2.used', { n: experiences.length, limit: entitlementLimit(entitlements, 'signature_experiences') })}
                  </Text>
                )}
                {loadingExperiences ? (
                  <NLoader fullScreen={false} size="inline" caption={t('ui.bizDash2.loadingExperiences')} />
                ) : experiences.length === 0 ? (
                  <EmptyCopy id="business_signature" />
                ) : (
                  experiences.map((exp) => (
                    <View key={exp.id} style={[styles.gatheringRow, !exp.active && { opacity: 0.5 }]}>
                      <Text style={styles.offerTitle}>
                        {exp.icon ? `${exp.icon} ` : ''}{exp.title}{exp.ai_suggested ? ' ✨' : ''}
                      </Text>
                      {exp.description ? <Text style={styles.breakdownText}>{exp.description}</Text> : null}
                      <Text style={styles.breakdownText}>
                        {[
                          exp.price_level ? experiencePriceLabel(exp.price_level) : null,
                          exp.party_type ? experiencePartyTypeLabel(exp.party_type) : null,
                          !exp.active ? t('ui.bizDash2.hiddenFromYourPublicProfile') : null,
                        ].filter(Boolean).join(' · ') || t('ui.bizDash2.noPriceOrPartyDetails')}
                      </Text>
                      <BusinessOfferMediaPreview path={exp.media_path} type={exp.media_type} colors={colors} />
                      <View style={{ flexDirection: 'row', marginTop: spacing.sm, flexWrap: 'wrap', gap: spacing.sm }}>
                        <TouchableOpacity onPress={() => openExperienceModal(exp)} accessibilityLabel={t('ui.bizDash2.editA11y2', { title: exp.title })} accessibilityRole="button">
                          <Text style={styles.messageMemberLink}>{t('ui.bizDash2.edit2')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleToggleExperienceActive(exp)} accessibilityLabel={exp.active ? t('ui.bizDash2.hideA11y', { title: exp.title }) : t('ui.bizDash2.showA11y', { title: exp.title })} accessibilityRole="button">
                          <Text style={styles.messageMemberLink}>{exp.active ? t('ui.bizDash2.hide') : t('ui.bizDash2.show')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleDeleteExperience(exp)} accessibilityLabel={t('ui.bizDash2.removeA11y', { title: exp.title })} accessibilityRole="button">
                          <Text style={[styles.messageMemberLink, { color: colors.danger }]}>{t('ui.bizDash2.remove2')}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}

</>
)}
{on('profile') && (
<>
                {/* "Business Profile Phase 1" addendum -- "Teach Nearby."
                    A real, deterministic keyword extraction against the
                    existing attributes vocabulary, never an LLM call and
                    never auto-applied -- the extracted chips are always
                    shown for an explicit confirm/edit/discard first. */}
                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>{t('ui.bizDash2.teachNearby')}</Text>
                <Text style={styles.helperText}>{t('ui.bizDash2.anythingElseWeShouldKnow')}</Text>
                {!teachNearbyExtracted ? (
                  <>
                    <TextInput
                      style={[styles.input, { marginTop: spacing.sm, minHeight: 60 }]}
                      placeholder={t('ui.bizDash2.ourRooftopPatioIsOur')}
                      placeholderTextColor={colors.textTertiary}
                      value={teachNearbyInput}
                      onChangeText={setTeachNearbyInput}
                      multiline
                      maxLength={300}
                      accessibilityLabel={t('ui.bizDash2.tellNearbyAboutYourBusinessA11y')}
                    />
                    <TouchableOpacity
                      style={[styles.postUpdateButton, { marginTop: spacing.sm }]}
                      onPress={handleInterpretTeachNearby}
                      disabled={!teachNearbyInput.trim()}
                      accessibilityLabel={t('ui.bizDash2.submitA11y')}
                      accessibilityRole="button"
                    >
                      <Text style={styles.postUpdateButtonText}>{t('ui.bizDash2.submit')}</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View style={styles.gatheringRow}>
                    {teachNearbyExtracted.length === 0 ? (
                      <Text style={styles.emptyText}>
                        {t('ui.bizDash2.nearbyDidntRecognizeAnythingSpecific')}
                      </Text>
                    ) : (
                      <>
                        <Text style={[styles.breakdownText, { fontWeight: '700', marginBottom: spacing.xs }]}>{t('ui.bizDash2.nearbyUnderstood')}</Text>
                        <View style={styles.chipRow}>
                          {teachNearbyExtracted.map((attribute) => (
                            <TouchableOpacity
                              key={attribute}
                              style={styles.chip}
                              onPress={() => handleRemoveTeachNearbyChip(attribute)}
                              accessibilityLabel={t('ui.bizDash2.removeA11y2', { businessAttributeLabel: businessAttributeLabel(attribute) })}
                              accessibilityRole="button"
                            >
                              <Text style={styles.chipText}>{businessAttributeLabel(attribute)} ✕</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </>
                    )}
                    <View style={{ flexDirection: 'row', marginTop: spacing.sm, gap: spacing.sm }}>
                      {teachNearbyExtracted.length > 0 && (
                        <TouchableOpacity
                          style={[styles.smallActionButton, { backgroundColor: colors.primary }]}
                          onPress={handleConfirmTeachNearby}
                          disabled={savingTeachNearby}
                          accessibilityLabel={t('ui.bizDash2.addToProfileA11y')}
                          accessibilityRole="button"
                        >
                          <Text style={styles.smallActionButtonText}>{savingTeachNearby ? t('ui.bizDash2.adding') : t('ui.bizDash2.addToProfile')}</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated }]}
                        onPress={handleDiscardTeachNearby}
                        accessibilityLabel={t('ui.bizDash2.discardA11y')}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>{t('ui.bizDash2.discard')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* Business Intelligence & Opportunity Engine, Phase 1 --
                    the real AI Suggestion / Audit log: every category-
                    classification and Teach Nearby suggestion this
                    business has ever seen, whatever it was resolved to.
                    Read-only -- act on a real suggestion via the category
                    banner or Teach Nearby above, not from here. */}
                {recentSuggestions.length > 0 && (
                  <>
                    <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>{t('ui.bizDash2.recentAiSuggestions')}</Text>
                    <Text style={styles.helperText}>
                      {t('ui.bizDash2.everyRealDeterministicSuggestionNearby')}
                    </Text>
                    {recentSuggestions.map((s) => (
                      <View key={s.id} style={[styles.gatheringRow, { marginTop: spacing.xs }]}>
                        <Text style={styles.breakdownText}>
                          {s.attribute_key === 'category'
                            ? t('ui.bizDash2.category', { label: BUSINESS_CATEGORIES.find((c) => c.key === s.attribute_value)?.label ?? s.attribute_value })
                            : t('ui.bizDash2.attribute', { businessAttributeLabel: businessAttributeLabel(s.attribute_value) ?? s.attribute_value })}
                        </Text>
                        <Text style={[styles.helperText, { marginTop: 2 }]}>
                          {s.status === 'confirmed' ? t('ui.bizDash2.added') : s.status === 'rejected' ? t('ui.bizDash2.keptAsIs') : t('ui.bizDash2.awaitingYourReview')}
                          {s.reason ? ` — ${s.reason}` : ''}
                        </Text>
                      </View>
                    ))}
                  </>
                )}

                <TouchableOpacity onPress={() => setProfileSettingsOpen((v) => !v)} style={[styles.gatheringRow, { marginTop: spacing.xl }]} accessibilityRole="button" accessibilityLabel={t('ui.bizDash2.settingsA11y')} accessibilityState={{ expanded: profileSettingsOpen }}>
                  <Text style={styles.offerTitle}>{t('ui.bizDash2.settings')}{' '}{profileSettingsOpen ? '⌄' : '›'}</Text>
                  {!profileSettingsOpen && <Text style={styles.breakdownText}>{t('ui.bizDash2.termsNotificationsPaymentsAiAutomation')}</Text>}
                </TouchableOpacity>
                {profileSettingsOpen && (
                <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg }}>
                  <Text style={styles.sectionHeader}>{t('ui.bizDash2.fulfillmentPolicy')}</Text>
                  <TouchableOpacity
                    style={[styles.smallActionButton, { backgroundColor: colors.primary }]}
                    onPress={openPolicyModal}
                    accessibilityLabel={fulfillmentPolicy ? t('ui.bizDash2.editFulfillmentPolicyA11y') : t('ui.bizDash2.setAFulfillmentPolicyA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.smallActionButtonText}>{fulfillmentPolicy ? t('ui.bizDash2.edit') : t('ui.bizDash2.setAPolicy')}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.helperText}>
                  {t('ui.bizDash3.aStandingRuleThatGoverns')}
                </Text>
                {!fulfillmentPolicy ? (
                  <EmptyCopy id="business_policy" />
                ) : (
                  <View style={styles.gatheringRow}>
                    <Text style={styles.breakdownText}>
                      {fulfillmentPolicy.active ? t('ui.bizDash3.policyActive') : t('ui.bizDash3.policyPaused')}
                      {fulfillmentPolicy.party_size_min != null || fulfillmentPolicy.party_size_max != null
                        ? ` · ${t('ui.bizDash3.partySizeRangeShort', { min: fulfillmentPolicy.party_size_min ?? '1', max: fulfillmentPolicy.party_size_max ?? '∞' })}`
                        : ''}
                      {fulfillmentPolicy.active_hours_start && fulfillmentPolicy.active_hours_end
                        ? ` · ${fulfillmentPolicy.active_hours_start.slice(0, 5)}-${fulfillmentPolicy.active_hours_end.slice(0, 5)}`
                        : ''}
                    </Text>
                    <Text style={styles.breakdownText}>
                      {fulfillmentPolicy.auto_accept_party_size_max != null
                        ? t('ui.bizDash3.autoAcceptsPartiesOf', { n: fulfillmentPolicy.auto_accept_party_size_max })
                        : t('ui.bizDash3.autoAcceptOff')}
                    </Text>
                    {fulfillmentPolicy.weather_dependent && (
                      <Text style={styles.breakdownText}>
                        {fulfillmentPolicy.last_rain_risk === 'high'
                          ? t('ui.bizDash3.weatherPausedForRain', { checked: formatWeatherCheckAge(fulfillmentPolicy.last_weather_checked_at) })
                          : t('ui.bizDash3.weatherLooksFine', { checked: formatWeatherCheckAge(fulfillmentPolicy.last_weather_checked_at) })}
                      </Text>
                    )}
                    {(fulfillmentPolicy.min_spend_per_person != null || fulfillmentPolicy.max_discount_pct != null || fulfillmentPolicy.deposit_amount != null || fulfillmentPolicy.cancellation_window_hours != null) && (
                      <Text style={styles.breakdownText}>
                        {[
                          fulfillmentPolicy.min_spend_per_person != null ? t('ui.bizDash3.minSpendPerPerson', { amount: Number(fulfillmentPolicy.min_spend_per_person).toFixed(2) }) : null,
                          fulfillmentPolicy.max_discount_pct != null ? t('ui.bizDash3.upToPctOff', { pct: Number(fulfillmentPolicy.max_discount_pct) }) : null,
                          fulfillmentPolicy.deposit_amount != null ? t('ui.bizDash3.depositAmount', { amount: Number(fulfillmentPolicy.deposit_amount).toFixed(2) }) : null,
                          fulfillmentPolicy.cancellation_window_hours != null ? t('ui.bizDash3.cancellationWindowHours', { hours: fulfillmentPolicy.cancellation_window_hours }) : null,
                        ].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                  </View>
                )}
              {/* Business Intelligence Phase 6 -- the AI Trust Engine settings (level selector, named policies, the
                  Activity Log). Opens in place here, beside the other settings (screen-reduction audit B10). */}
              <TouchableOpacity
                style={[styles.createOfferButton, { marginTop: spacing.md, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border }]}
                onPress={() => setShowAiAutomation((v) => !v)}
                accessibilityLabel={t('ui.bizDash3.manageAiAutomationForYourA11y')}
                accessibilityRole="button"
                accessibilityState={{ expanded: showAiAutomation }}
              >
                <Text style={[styles.createOfferButtonText, { color: colors.textPrimary }]}>{t('ui.bizDash3.aiAutomationSettings')} {showAiAutomation ? '▾' : '›'}</Text>
              </TouchableOpacity>
              {showAiAutomation && <BusinessAIAutomationPanel partnerId={selectedPartner.id} partnerName={selectedPartner.name} />}
                <BusinessNotificationPreferences />
                {Platform.OS === 'web' && <BusinessEmailNotifications />}

                {/* Phase 7 (Business Web, CLAUDE.md) -- Stripe Connect
                    onboarding's native-scheme OAuth return has no web
                    equivalent built yet (moot today anyway, since Stripe
                    isn't configured live anywhere in this app); hidden on
                    web as a defense-in-depth guard, native untouched. The
                    background getMyStripeConnectStatus() read that feeds
                    stripeStatus above keeps running unconditionally --
                    only this action UI is hidden. */}
                {(
                <>
                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>{stripeMode() === 'test' ? t('ui.bizDash3.getPaidViaStripeTest') : t('ui.bizDash3.getPaidViaStripe')}</Text>
                <View style={styles.gatheringRow}>
                  {!isStripeConfigured() ? (
                    <Text style={styles.offerDescription}>
                      {t('ui.bizDash3.paymentCollectionIsntSetUp')}
                    </Text>
                  ) : stripeStatus?.chargesEnabled ? (
                    <>
                      <Text style={styles.offerTitle}>{t('ui.bizDash3.readyToAcceptPayments')}</Text>
                      <Text style={styles.offerDescription}>
                        {t('ui.bizDash3.offersWithARealPrice')}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.offerTitle}>
                        {stripeStatus?.hasAccount ? t('ui.bizDash3.finishSettingUpPayments') : t('ui.bizDash3.connectStripeToGetPaid')}
                      </Text>
                      {stripeMode() === 'test' && (
                        <Text style={styles.breakdownText}>{t('ui.bizDash3.testModeNoRealMoney')}</Text>
                      )}
                      <Text style={styles.breakdownText}>
                        {t('ui.bizDash3.youllFinishOnStripesOwn')}
                      </Text>
                      <Text style={styles.offerDescription}>
                        {stripeStatus?.hasAccount
                          ? t('ui.bizDash3.youStartedStripeOnboardingBut')
                          : t('ui.bizDash3.connectARealStripeAccount')}
                      </Text>
                      {stripeStatus?.requirementsDue?.length > 0 && (
                        <Text style={styles.breakdownText}>
                          {t('ui.bizDash3.stripeStillNeeds')}{' '}{stripeStatus.requirementsDue.join(', ')}
                        </Text>
                      )}
                      <TouchableOpacity
                        style={[styles.createOfferButton, { marginTop: spacing.sm }]}
                        onPress={handleConnectStripe}
                        disabled={connectingStripe}
                        accessibilityLabel={stripeStatus?.hasAccount ? t('ui.bizDash3.continueStripeSetupA11y') : t('ui.bizDash3.connectStripeA11y')}
                        accessibilityRole="button"
                      >
                        {connectingStripe ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.createOfferButtonText}>
                            {stripeStatus?.hasAccount ? t('ui.bizDash3.continueSetup') : t('ui.bizDash3.connectStripe')}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </>
                  )}
                </View>
                </>
                )}

                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>{t('ui.bizDash3.reservationProvider')}</Text>
                <View style={styles.gatheringRow}>
                  {editingReservationProvider ? (
                    <>
                      <Text style={styles.offerDescription}>
                        {t('ui.bizDash3.whichSystemDoYouTake')}
                      </Text>
                      <View style={styles.chipRow}>
                        {RESERVATION_PROVIDER_OPTIONS.map((p) => (
                          <TouchableOpacity
                            key={p.key}
                            style={[styles.chip, reservationProviderInput === p.key && styles.chipSelected]}
                            onPress={() => setReservationProviderInput(p.key)}
                            accessibilityRole="button"
                            accessibilityLabel={p.label}
                            accessibilityState={{ selected: reservationProviderInput === p.key }}
                          >
                            <Text style={[styles.chipText, reservationProviderInput === p.key && styles.chipTextSelected]}>
                              {p.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TextInput
                        style={[styles.input, { marginTop: spacing.sm }]}
                        placeholder={t('ui.bizDash3.yourVenueIdOnThat')}
                        placeholderTextColor={colors.textTertiary}
                        value={reservationVenueIdInput}
                        onChangeText={setReservationVenueIdInput}
                        autoCapitalize="none"
                        accessibilityLabel={t('ui.bizDash3.reservationProviderVenueIdA11y')}
                      />
                      <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
                        <TouchableOpacity
                          style={[styles.createOfferButton, { opacity: savingReservationProvider || !reservationProviderInput ? 0.6 : 1 }]}
                          onPress={handleSaveReservationProvider}
                          disabled={savingReservationProvider || !reservationProviderInput}
                          accessibilityLabel={t('ui.bizDash3.saveReservationProviderA11y')}
                          accessibilityRole="button"
                        >
                          {savingReservationProvider ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text style={styles.createOfferButtonText}>{t('ui.bizDash3.save')}</Text>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ marginLeft: spacing.md, justifyContent: 'center' }}
                          onPress={() => setEditingReservationProvider(false)}
                          accessibilityLabel={t('ui.bizDash3.cancelA11y')}
                          accessibilityRole="button"
                        >
                          <Text style={styles.messageMemberLink}>{t('ui.bizDash3.cancel')}</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : reservationProviderStatus?.provider ? (
                    <>
                      <Text style={styles.offerTitle}>
                        {t('ui.bizDash3.connectedTo', { provider: RESERVATION_PROVIDER_OPTIONS.find((p) => p.key === reservationProviderStatus.provider)?.label ?? reservationProviderStatus.provider })}
                      </Text>
                      <Text style={styles.offerDescription}>
                        {reservationProviderStatus.venueId
                          ? t('ui.bizDash3.venueId', { id: reservationProviderStatus.venueId })
                          : t('ui.bizDash3.noVenueIdOnFile')}{' '}
                        {t('ui.bizDash3.realBookingsArentWiredUp')}
                      </Text>
                      <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
                        <TouchableOpacity onPress={openEditReservationProvider} accessibilityLabel={t('ui.bizDash3.editReservationProviderA11y')} accessibilityRole="button">
                          <Text style={styles.messageMemberLink}>{t('ui.bizDash3.edit')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleDisconnectReservationProvider} style={{ marginLeft: spacing.lg }} accessibilityLabel={t('ui.bizDash3.removeReservationProviderA11y')} accessibilityRole="button">
                          <Text style={[styles.messageMemberLink, { color: colors.danger }]}>{t('ui.bizDash3.remove')}</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={styles.offerDescription}>
                        {t('ui.bizDash3.ifYouAlreadyTakeReservations')}
                      </Text>
                      <TouchableOpacity onPress={openEditReservationProvider} style={{ marginTop: spacing.sm }} accessibilityLabel={t('ui.bizDash3.addReservationProviderA11y')} accessibilityRole="button">
                        <Text style={styles.messageMemberLink}>{t('ui.bizDash3.addReservationProvider')}</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
                </>
                )}
</>
)}
              </>
            )}

            {section === 'inbox_modal' && (
              activeConversation ? (
                <View>
                  <TouchableOpacity onPress={() => setActiveConversation(null)} accessibilityLabel={t('ui.bizDash3.backToConversationsA11y')} accessibilityRole="button">
                    <Text style={styles.backLink}>{t('ui.bizDash3.backToConversations')}</Text>
                  </TouchableOpacity>
                  <Text style={styles.sectionHeader}>{activeConversation.displayName}</Text>
                  {conversationMessages.map((m) => (
                    <View key={m.id} style={[styles.messageBubble, m.from_business && styles.messageBubbleFromBusiness]}>
                      <Text style={m.from_business ? styles.messageTextFromBusiness : styles.messageText}>{m.body}</Text>
                    </View>
                  ))}
                  <View style={styles.replyRow}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder={t('ui.bizDash3.reply')}
                      placeholderTextColor={colors.textTertiary}
                      value={replyText}
                      onChangeText={setReplyText}
                      accessibilityLabel={t('ui.bizDash3.replyMessageA11y')}
                    />
                    <TouchableOpacity style={styles.sendReplyButton} onPress={sendReply} accessibilityLabel={t('ui.bizDash3.sendReplyA11y')} accessibilityRole="button">
                      <Text style={styles.sendReplyButtonText}>{t('ui.bizDash3.send')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : conversations.length === 0 ? (
                <EmptyCopy id="business_messages" />
              ) : (
                conversations.map((c) => (
                  <TouchableOpacity key={c.userId} style={styles.gatheringRow} onPress={() => openConversation(c)} accessibilityLabel={t('ui.bizDash3.conversationWithA11y', { name: c.displayName })} accessibilityRole="button">
                    <Text style={styles.offerTitle}>{c.displayName}</Text>
                    <Text style={styles.offerDescription} numberOfLines={1}>{c.lastMessage}</Text>
                  </TouchableOpacity>
                ))
              )
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={createModalVisible} animationType={modalAnimation('slide')} transparent onRequestClose={() => setCreateModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>{t('ui.bizDash3.newOffer')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('ui.bizDash3.freePastryWithAnyCoffee')}
                placeholderTextColor={colors.textTertiary}
                value={newTitle}
                onChangeText={setNewTitle}
                accessibilityLabel={t('ui.bizDash3.offerTitleA11y')}
              />
              <TextInput
                style={[styles.input, { height: 70, textAlignVertical: 'top', marginTop: spacing.sm }]}
                placeholder={t('ui.bizDash3.descriptionOptional')}
                placeholderTextColor={colors.textTertiary}
                value={newDescription}
                onChangeText={setNewDescription}
                multiline
                accessibilityLabel={t('ui.bizDash3.offerDescriptionOptionalA11y')}
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder={t('ui.bizDash3.redemptionInstructionsOptional')}
                placeholderTextColor={colors.textTertiary}
                value={newInstructions}
                onChangeText={setNewInstructions}
                accessibilityLabel={t('ui.bizDash3.redemptionInstructionsOptionalA11y')}
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder={t('ui.bizDash3.limitToFirstNPeople')}
                placeholderTextColor={colors.textTertiary}
                value={newRedemptionLimit}
                onChangeText={(t) => setNewRedemptionLimit(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                accessibilityLabel={t('ui.bizDash3.redemptionLimitOptionalA11y')}
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder={t('ui.bizDash3.targetInterestEGCoffee')}
                placeholderTextColor={colors.textTertiary}
                value={newTargetInterestTag}
                onChangeText={setNewTargetInterestTag}
                accessibilityLabel={t('ui.bizDash3.targetInterestTagOptionalA11y')}
              />

              <View style={[styles.toggleRow, { marginTop: spacing.md }]}>
                <Text style={styles.toggleRowLabel}>
                  {offerGatheringId ? t('ui.bizDash3.requireAMinimumNumberOf') : t('ui.bizDash3.requireACommunityToHit')}
                </Text>
                <Switch
                  value={unlockEnabled}
                  onValueChange={setUnlockEnabled}
                  accessibilityLabel={unlockEnabled ? t('ui.bizDash3.groupUnlockOnA11y') : t('ui.bizDash3.groupUnlockOffA11y')}
                />
              </View>

              {unlockEnabled && (
                <>
                  {!offerGatheringId && (
                    communities.length === 0 ? (
                      <Text style={styles.offerDescription}>{t('ui.bizDash3.youNeedACommunityTo')}</Text>
                    ) : (
                      <View style={styles.chipRow}>
                        {communities.map((c) => (
                          <TouchableOpacity
                            key={c.id}
                            style={[styles.chip, unlockCommunityId === c.id && styles.chipSelected]}
                            onPress={() => setUnlockCommunityId(c.id)}
                            accessibilityLabel={`${[c.name, countLabel(c.memberCount, 'member')].filter(Boolean).join(', ')}${unlockCommunityId === c.id ? t('ui.bizDash3.selectedA11y') : ''}`}
                            accessibilityRole="button"
                          >
                            <Text style={[styles.chipText, unlockCommunityId === c.id && styles.chipTextSelected]}>{c.name}{c.memberCount != null ? ` (${c.memberCount})` : ''}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )
                  )}
                  <TextInput
                    style={[styles.input, { marginTop: spacing.sm }]}
                    placeholder={offerGatheringId ? t('ui.bizDash3.attendeesNeededToUnlockE') : t('ui.bizDash3.membersNeededToUnlockE')}
                    placeholderTextColor={colors.textTertiary}
                    value={newUnlockMinMembers}
                    onChangeText={(t) => setNewUnlockMinMembers(t.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    accessibilityLabel={t('ui.bizDash3.minimumMembersOrAttendeesToA11y')}
                  />
                </>
              )}

              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleCreateOffer}
                disabled={submitting}
                accessibilityLabel={submitting ? t('ui.bizDash3.creatingA11y') : t('ui.bizDash3.createOfferA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{submitting ? t('ui.bizDash3.creating') : t('ui.bizDash3.createOffer')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setCreateModalVisible(false)} style={{ marginTop: spacing.md }} accessibilityLabel={t('ui.bizDash3.cancelA11y')} accessibilityRole="button">
                <Text style={styles.modalCloseText}>{t('ui.bizDash3.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={addressModalVisible} animationType={modalAnimation('slide')} transparent onRequestClose={() => setAddressModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>{t('ui.bizDash3.businessAddress')}</Text>
              <Text style={[styles.modalCloseText, { marginBottom: spacing.md }]}>
                {t('ui.bizDash3.thisDeterminesWhoSeesYour')}
              </Text>
              <TextInput
                style={styles.input}
                placeholder={t('ui.bizDash3.eG123MainSt')}
                placeholderTextColor={colors.textTertiary}
                value={addressInput}
                onChangeText={setAddressInput}
                accessibilityLabel={t('ui.bizDash3.businessAddressA11y')}
              />
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleUpdateAddress}
                disabled={savingAddress || !addressInput.trim()}
                accessibilityLabel={savingAddress ? t('ui.bizDash3.savingA11y') : t('ui.bizDash3.saveAddressA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{savingAddress ? t('ui.bizDash3.saving') : t('ui.bizDash3.saveAddress')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setAddressModalVisible(false)} style={{ marginTop: spacing.md }} accessibilityLabel={t('ui.bizDash3.cancelA11y')} accessibilityRole="button">
                <Text style={styles.modalCloseText}>{t('ui.bizDash3.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={editProfileModalVisible} animationType={modalAnimation('slide')} transparent onRequestClose={() => setEditProfileModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>{t('ui.bizDash3.editBusinessProfile')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('ui.bizDash3.businessName')}
                placeholderTextColor={colors.textTertiary}
                value={editNameInput}
                onChangeText={setEditNameInput}
                accessibilityLabel={t('ui.bizDash3.businessNameA11y')}
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm, minHeight: 80 }]}
                placeholder={t('ui.bizDash3.description')}
                placeholderTextColor={colors.textTertiary}
                value={editDescriptionInput}
                onChangeText={setEditDescriptionInput}
                multiline
                accessibilityLabel={t('ui.bizDash3.businessDescriptionA11y')}
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder={t('ui.bizDash3.logoImageUrlOptional')}
                placeholderTextColor={colors.textTertiary}
                value={editLogoUrlInput}
                onChangeText={setEditLogoUrlInput}
                autoCapitalize="none"
                accessibilityLabel={t('ui.bizDash3.logoUrlA11y')}
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.category')}</Text>
              <View style={styles.chipRow}>
                {BUSINESS_CATEGORIES.map((c) => (
                  <TouchableOpacity
                    key={c.key}
                    style={[styles.chip, editCategoryInput === c.key && styles.chipSelected]}
                    onPress={() => {
                      setEditCategoryInput(editCategoryInput === c.key ? null : c.key);
                      setEditSubcategoryInput(null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={c.label}
                    accessibilityState={{ selected: editCategoryInput === c.key }}
                  >
                    <Text style={[styles.chipText, editCategoryInput === c.key && styles.chipTextSelected]}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {subcategoryOptionsFor(editCategoryInput).length > 0 && (
                <>
                  <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.moreSpecifically')}</Text>
                  <View style={styles.chipRow}>
                    {subcategoryOptionsFor(editCategoryInput).map((s) => (
                      <TouchableOpacity
                        key={s}
                        style={[styles.chip, editSubcategoryInput === s && styles.chipSelected]}
                        onPress={() => setEditSubcategoryInput(editSubcategoryInput === s ? null : s)}
                        accessibilityRole="button"
                        accessibilityLabel={s}
                        accessibilityState={{ selected: editSubcategoryInput === s }}
                      >
                        <Text style={[styles.chipText, editSubcategoryInput === s && styles.chipTextSelected]}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              {/* Intent engine vision, multi-classification businesses
                  (resumed 2026-09-10) -- a secondary, cross-major
                  self-classification, distinct from the single primary
                  subcategory above (e.g. a food_drink bar that's also an
                  entertainment_nightlife live-music venue). Reuses the
                  same flat 75-tag vocabulary as INTEREST_OPTIONS-as-flat-
                  chip-list pattern the Temporary Boost picker above
                  already uses, but as a real multi-select toggle. */}
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.alsoClassifyAsOptional')}</Text>
              <Text style={styles.helperText}>
                {t('ui.bizDash3.alsoShowUpUnderAny')}
              </Text>
              <View style={styles.chipRow}>
                {businessTagOptions().map((c) => {
                  const selected = editCategoriesInput.includes(c);
                  return (
                    <TouchableOpacity
                      key={c}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => {
                        setEditCategoriesInput((prev) =>
                          prev.includes(c) ? prev.filter((v) => v !== c) : [...prev, c]
                        );
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={c}
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{c}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {/* "Business Story" plan: reframed from a plain "Attributes"
                  checkbox list to "Why People Choose Us" -- same real
                  vocabulary/RPC, just named for what it actually is. */}
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.whyPeopleChooseUs')}</Text>
              <View style={styles.chipRow}>
                {BUSINESS_ATTRIBUTE_OPTIONS.filter((a) => a.key !== LEGACY_RESERVATION_ATTRIBUTE).map((a) => {
                  const selected = editAttributesInput.includes(a.key);
                  return (
                    <TouchableOpacity
                      key={a.key}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => setEditAttributesInput((prev) => (selected ? prev.filter((k) => k !== a.key) : [...prev, a.key]))}
                      accessibilityRole="button"
                      accessibilityLabel={a.label}
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{a.icon} {a.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.whatMakesYouDifferent')}</Text>
              <Text style={styles.helperText}>
                {t('ui.bizDash3.oneRealSentenceInYour')}
              </Text>
              <TextInput
                style={[styles.input, { marginTop: spacing.sm, minHeight: 60 }]}
                placeholder={t('ui.bizDash3.whatMakesYouDifferentOptional')}
                placeholderTextColor={colors.textTertiary}
                value={editDifferentiatorInput}
                onChangeText={setEditDifferentiatorInput}
                multiline
                maxLength={280}
                accessibilityLabel={t('ui.bizDash3.whatMakesYouDifferentA11y')}
              />
              {editCategoryInput === 'food_drink' && (
                <>
                  <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.cuisine')}</Text>
                  <View style={styles.chipRow}>
                    {CUISINE_OPTIONS.map((c) => (
                      <TouchableOpacity
                        key={c.key}
                        style={[styles.chip, editCuisineInput === c.key && styles.chipSelected]}
                        onPress={() => setEditCuisineInput(editCuisineInput === c.key ? null : c.key)}
                        accessibilityRole="button"
                        accessibilityLabel={c.label}
                        accessibilityState={{ selected: editCuisineInput === c.key }}
                      >
                        <Text style={[styles.chipText, editCuisineInput === c.key && styles.chipTextSelected]}>{c.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleSaveProfile}
                disabled={savingProfile || !editNameInput.trim()}
                accessibilityLabel={savingProfile ? t('ui.bizDash3.savingA11y') : t('ui.bizDash3.saveProfileA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{savingProfile ? t('ui.bizDash3.saving') : t('ui.bizDash3.saveProfile')}</Text>
              </TouchableOpacity>
              <SettingConflictNotice messages={conflictMessages(settingConflicts.entries, 'profile_edit')} />
              <TouchableOpacity onPress={() => setEditProfileModalVisible(false)} style={{ marginTop: spacing.md }} accessibilityLabel={t('ui.bizDash3.cancelA11y')} accessibilityRole="button">
                <Text style={styles.modalCloseText}>{t('ui.bizDash3.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* "Business Story" plan, Phase 6 -- create/edit a Signature
          Experience. Same modal shape as Edit Profile above (KeyboardAvoidingView
          + TouchableWithoutFeedback-to-dismiss, chip-row pickers). */}
      <Modal visible={experienceModalVisible} animationType={modalAnimation('slide')} transparent onRequestClose={() => setExperienceModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>{editingExperienceId ? t('ui.bizDash3.editExperience') : t('ui.bizDash3.newSignatureExperience')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('ui.bizDash3.titleEGSunsetCoffee')}
                placeholderTextColor={colors.textTertiary}
                value={expTitleInput}
                onChangeText={setExpTitleInput}
                maxLength={80}
                accessibilityLabel={t('ui.bizDash3.experienceTitleA11y')}
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm, minHeight: 60 }]}
                placeholder={t('ui.bizDash3.descriptionOptional')}
                placeholderTextColor={colors.textTertiary}
                value={expDescriptionInput}
                onChangeText={setExpDescriptionInput}
                multiline
                maxLength={200}
                accessibilityLabel={t('ui.bizDash3.experienceDescriptionA11y')}
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder={t('ui.bizDash3.emojiIconOptionalEG')}
                placeholderTextColor={colors.textTertiary}
                value={expIconInput}
                onChangeText={setExpIconInput}
                maxLength={4}
                accessibilityLabel={t('ui.bizDash3.experienceIconA11y')}
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.tags')}</Text>
              <View style={styles.chipRow}>
                {BUSINESS_ATTRIBUTE_OPTIONS.filter((a) => a.key !== LEGACY_RESERVATION_ATTRIBUTE).map((a) => {
                  const selected = expAttributesInput.includes(a.key);
                  return (
                    <TouchableOpacity
                      key={a.key}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => setExpAttributesInput((prev) => (selected ? prev.filter((k) => k !== a.key) : [...prev, a.key]))}
                      accessibilityRole="button"
                      accessibilityLabel={a.label}
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{a.icon} {a.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.price')}</Text>
              <View style={styles.chipRow}>
                {EXPERIENCE_PRICE_OPTIONS.map((p) => (
                  <TouchableOpacity
                    key={p.key ?? 'none'}
                    style={[styles.chip, expPriceLevelInput === p.key && styles.chipSelected]}
                    onPress={() => setExpPriceLevelInput(p.key)}
                    accessibilityRole="button"
                    accessibilityLabel={p.label}
                    accessibilityState={{ selected: expPriceLevelInput === p.key }}
                  >
                    <Text style={[styles.chipText, expPriceLevelInput === p.key && styles.chipTextSelected]}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.whosThisFor')}</Text>
              <View style={styles.chipRow}>
                {EXPERIENCE_PARTY_TYPE_OPTIONS.map((p) => (
                  <TouchableOpacity
                    key={p.key ?? 'none'}
                    style={[styles.chip, expPartyTypeInput === p.key && styles.chipSelected]}
                    onPress={() => setExpPartyTypeInput(p.key)}
                    accessibilityRole="button"
                    accessibilityLabel={p.label}
                    accessibilityState={{ selected: expPartyTypeInput === p.key }}
                  >
                    <Text style={[styles.chipText, expPartyTypeInput === p.key && styles.chipTextSelected]}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.photoOrVideoOptional')}</Text>
              <BusinessMediaPicker
                colors={colors}
                pickedAsset={expPickedMediaAsset}
                existingPath={expExistingMediaPath}
                existingType={expExistingMediaType}
                onPick={async () => {
                  try {
                    const asset = await pickBusinessOfferMedia();
                    if (asset) setExpPickedMediaAsset(asset);
                  } catch (e) {
                    presentRecoverableError(Alert, { what: 'complete that', error: e });
                  }
                }}
                onRemove={() => {
                  setExpPickedMediaAsset(null);
                  setExpExistingMediaPath(null);
                  setExpExistingMediaType(null);
                }}
              />
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleSaveExperience}
                disabled={savingExperience || !expTitleInput.trim()}
                accessibilityLabel={savingExperience ? t('ui.bizDash3.savingA11y') : t('ui.bizDash3.saveExperienceA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{savingExperience ? t('ui.bizDash3.saving') : t('ui.bizDash3.save')}</Text>
              </TouchableOpacity>
              <SettingConflictNotice messages={conflictMessages(settingConflicts.entries, 'experience')} />
              <TouchableOpacity onPress={() => setExperienceModalVisible(false)} style={{ marginTop: spacing.md }} accessibilityLabel={t('ui.bizDash3.cancelA11y')} accessibilityRole="button">
                <Text style={styles.modalCloseText}>{t('ui.bizDash3.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={qrModalVisible} animationType={modalAnimation('slide')} transparent onRequestClose={() => setQrModalVisible(false)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { alignItems: 'center' }]}>
            <Text style={styles.sheetTitle}>{t('ui.bizDash3.shareYourQrCode')}</Text>
            <Text style={[styles.emptyText, { marginBottom: spacing.md }]}>
              {selectedPartner
                ? t('ui.bizDash3.qrExplainNamed', { name: selectedPartner.name })
                : t('ui.bizDash3.qrExplain')}
            </Text>
            {selectedPartner && (
              <View style={{ backgroundColor: '#fff', padding: spacing.md, borderRadius: radius.md }}>
                <QRCode value={`nearby://business/${selectedPartner.id}`} size={200} />
              </View>
            )}
            <TouchableOpacity
              style={[styles.submitButton, { marginTop: spacing.lg, width: '100%' }]}
              onPress={handleShareBusinessLink}
              accessibilityLabel={t('ui.bizDash3.shareBusinessLinkA11y')}
              accessibilityRole="button"
            >
              <Text style={styles.submitButtonText}>{t('ui.bizDash3.shareLink')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setQrModalVisible(false)} style={{ marginTop: spacing.md }} accessibilityLabel={t('ui.bizDash3.closeA11y')} accessibilityRole="button">
              <Text style={styles.modalCloseText}>{t('ui.bizDash3.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={updateModalVisible} animationType={modalAnimation('slide')} transparent onRequestClose={() => setUpdateModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>{t('ui.bizDash3.postUpdate')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('ui.bizDash3.whatsNew')}
                placeholderTextColor={colors.textTertiary}
                value={updateTitle}
                onChangeText={setUpdateTitle}
                accessibilityLabel={t('ui.bizDash3.updateTitleA11y')}
              />
              <TextInput
                style={[styles.input, { height: 90, textAlignVertical: 'top', marginTop: spacing.sm }]}
                placeholder={t('ui.bizDash3.detailsOptional')}
                placeholderTextColor={colors.textTertiary}
                value={updateBody}
                onChangeText={setUpdateBody}
                multiline
                accessibilityLabel={t('ui.bizDash3.updateDetailsOptionalA11y')}
              />
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handlePostUpdate}
                disabled={postingUpdate}
                accessibilityLabel={postingUpdate ? t('ui.bizDash3.sendingA11y') : t('ui.bizDash3.sendUpdateA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{postingUpdate ? t('ui.bizDash3.sending') : t('ui.bizDash3.sendToFollowers')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setUpdateModalVisible(false)} style={{ marginTop: spacing.md }} accessibilityLabel={t('ui.bizDash3.cancelA11y')} accessibilityRole="button">
                <Text style={styles.modalCloseText}>{t('ui.bizDash3.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={!!offerModalRequestId} animationType={modalAnimation('slide')} transparent onRequestClose={() => setOfferModalRequestId(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <ScrollView style={styles.sheet} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>{t('ui.bizDash3.makeAnOffer')}</Text>
              {offerDraft.draft && (
                <DraftBanner
                  what="offer"
                  savedAt={offerDraft.draft.savedAt}
                  onContinue={() => offerDraft.restore(applyOfferDraft)}
                  onDiscard={offerDraft.discard}
                />
              )}
              {offerPreviewing && (() => {
                const priceNum = offerPriceInput.trim() ? parseFloat(offerPriceInput.trim()) : null;
                const checked = { validity: validUntilFromChoice(offerValidDay, offerValidTime), win: availableWindowFromChoice(offerAvailFrom, offerAvailUntil) };
                const creative = offerCreativeId ? creatives.find((c) => c.id === offerCreativeId) : null;
                const previewOffer = {
                  offer_description: offerDescriptionInput.trim(),
                  included_items: offerIncludedItemsInput,
                  proposed_time: offerTypeInput === 'alt_time' && offerProposedTime ? offerProposedTime.toISOString() : null,
                  offer_price: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : null,
                  price_is_per_person: offerPriceIsPerPerson,
                  available_from: checked.win.from ?? null,
                  available_until: checked.win.until ?? null,
                  valid_until: checked.validity.iso ?? null,
                  media_path: creative?.media_path ?? null,
                  media_type: creative?.media_type ?? null,
                  media_poster_path: creative?.poster_path ?? null,
                };
                const localMedia = !creative && offerPickedMediaAsset?.uri ? { uri: offerPickedMediaAsset.uri, type: offerPickedMediaAsset.type === 'video' ? 'video' : 'image' } : null;
                return (
                  <View>
                    <Text style={styles.notesLabel}>{t('ui.bizDash3.customerPreview')}</Text>
                    <Text style={styles.helperText}>{t('ui.bizDash3.thisIsWhatTheCustomer')}</Text>
                    <View style={styles.gatheringRow}>
                      <Text style={styles.offerTitle}>{selectedPartner?.name}</Text>
                      {/* Same lines, same order as the customer's card (components/OfferAssembly.js): heard, then what this reply is. */}
                      <Text style={styles.breakdownText}>{heardYourRequest()}</Text>
                      <Text style={styles.breakdownText}>{businessReplyStatus({ ...previewOffer, offer_type: offerTypeInput, offer_title: offerTitleInput.trim() || null, discount_pct: offerTypeInput === 'discount' ? parseDiscountPct(offerDiscountInput) : null })}</Text>
                      {!!offerTitleInput.trim() && <Text style={[styles.offerTitle, { marginTop: spacing.xs }]}>{offerTitleInput.trim()}</Text>}
                      <OfferCustomerBody offer={previewOffer} localMedia={localMedia} />
                      <View style={[styles.submitButton, { opacity: 0.45, marginTop: spacing.sm }]} accessible accessibilityRole="button" accessibilityState={{ disabled: true }} accessibilityLabel={t('ui.bizDash3.previewOfTheCustomersAcceptA11y')}>
                        <Text style={styles.submitButtonText}>{consumerOfferAction({ status: 'offered' }, { request: { status: 'open' } }).label}</Text>
                      </View>
                    </View>
                    {!!offerRedemptionInput.trim() && <Text style={styles.helperText}>{t('ui.bizDash3.howToRedeemIsShown')}</Text>}
                    <Text style={styles.helperText}>{t('ui.bizDash3.textPhotosAndVideosAre')}</Text>
                    <TouchableOpacity
                      style={styles.submitButton}
                      onPress={handleSubmitOffer}
                      disabled={respondingOpportunityId === offerModalRequestId}
                      accessibilityRole="button"
                      accessibilityLabel={respondingOpportunityId === offerModalRequestId ? t('ui.bizDash3.sendingA11y') : t('ui.bizDash3.sendOfferA11y')}
                    >
                      <Text style={styles.submitButtonText}>{respondingOpportunityId === offerModalRequestId ? t('ui.bizDash3.sending') : t('ui.bizDash3.sendOffer')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setOfferPreviewing(false)} style={{ marginTop: spacing.md }} accessibilityRole="button" accessibilityLabel={t('ui.bizDash3.backToEditA11y')}>
                      <Text style={styles.modalCloseText}>{t('ui.bizDash3.backToEdit')}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })()}
              <View style={offerPreviewing ? { display: 'none' } : undefined}>
              {offerModalRequest && (() => {
                const ctx = buildOpportunityCard(offerModalRequest, {
                  occasionLabel: offerModalRequest.occasion ? (language === 'en' ? occasionLabel(offerModalRequest.occasion) : categoryName(occasionLabel(offerModalRequest.occasion), language)) : null,
                  categoryLabel: offerModalRequest.category ? categoryName(offerModalRequest.category, language) : null,
                });
                return (
                  <View style={{ marginBottom: spacing.md }}>
                    <Text style={styles.notesLabel}>{t('ui.bizDash3.forThisRequest')}</Text>
                    <Text style={styles.offerTitle}>{ctx.title}</Text>
                    {ctx.whenLine !== '' && <Text style={styles.breakdownText}>{ctx.whenLine}</Text>}
                    {ctx.potential && <Text style={[styles.breakdownText, { fontWeight: '600' }]}>{ctx.potential.line}</Text>}
                    {ctx.feelLine !== '' && <Text style={styles.breakdownText}>{ctx.feelLine}</Text>}
                  </View>
                );
              })()}
              {offerPrefilledFrom && (
                <Text style={[styles.breakdownText, { color: colors.info, fontWeight: '600', marginBottom: spacing.md }]}>{t('ui.bizDash1.startedFromYourPackageEdit', { offerPrefilledFrom: offerPrefilledFrom })}</Text>
              )}
              <Text style={[styles.modalCloseText, { marginBottom: spacing.md }]}>
                {t('ui.bizDash3.neverJustADiscountOffer')}
              </Text>
              {/* Item 92: this is the business's own already-built, already-active
                  Occasion Package -- real owned data, not an AI recommendation, so it's
                  shown unconditionally rather than behind the ai_offer_recommendations
                  entitlement gate below. The strongest real starting point available,
                  since the business already explicitly published these exact terms. */}
              {matchingOccasionPackage && (
                <TouchableOpacity
                  style={[styles.offerCard, { marginBottom: spacing.md }]}
                  onPress={() => applyOccasionPackageToOffer(matchingOccasionPackage)}
                  accessibilityRole="button"
                  accessibilityLabel={t('ui.bizDash3.useYourOwnPackageA11y', { name: matchingOccasionPackage.name })}
                >
                  <Text style={styles.offerDescription}>{t('ui.bizDash1.useYourOwnPackageTitle', { name: matchingOccasionPackage.name })}</Text>
                </TouchableOpacity>
              )}
              {/* Business Intelligence Phase 8: unlike missed-match/category-outcomes,
                  this suggestion is computed entirely client-side over data the business
                  already owns (its own experiences/opportunities) -- no server RPC boundary
                  exists to enforce this at, so the entitlement gate is purely a rendering
                  decision here, matching the feature's own real "convenience, not access to
                  someone else's data" shape. */}
              {entitlements && !hasEntitlement(entitlements, 'ai_offer_recommendations') ? (
                <View style={{ marginBottom: spacing.md }}>
                  {renderLockedFeature('ai_offer_recommendations', t('ui.bizDash3.getASuggestedOfferStraight'))}
                </View>
              ) : (
              <>
              {offerSuggestions.length > 0 && (
                <View style={{ marginBottom: spacing.md }}>
                  <Text style={styles.notesLabel}>{t('ui.bizDash3.suggestedFromYourSignatureExperiences')}</Text>
                  {offerSuggestions.map((s) => (
                    <TouchableOpacity
                      key={s.experienceId}
                      style={styles.offerCard}
                      onPress={() => applyExperienceSuggestion(s)}
                      accessibilityRole="button"
                      accessibilityLabel={t('ui.bizDash3.useSuggestionA11y', { title: s.title })}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.offerTitle}>{s.title}</Text>
                        {s.reasons.map((r) => (
                          <Text key={r.label} style={[styles.breakdownText, { color: colors.info, fontWeight: '600' }]}>
                            🎯 {r.label}
                          </Text>
                        ))}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {offerSuggestions.length === 0 && offerTitleScaffold && (
                // Phase 4(e): no Signature Experience matched well -- offer a
                // real, honest title scaffold (occasion + category) instead
                // of a blank field. Price is never touched here either.
                <TouchableOpacity
                  style={[styles.offerCard, { marginBottom: spacing.md }]}
                  onPress={() => applyOfferTitleScaffold(offerTitleScaffold)}
                  accessibilityRole="button"
                  accessibilityLabel={t('ui.bizDash3.startFromAScaffoldTitledA11y', { offerTitleScaffold: offerTitleScaffold })}
                >
                  <Text style={styles.offerDescription}>{t('ui.bizDash3.noSignatureExperienceMatchesThis', { offerTitleScaffold: offerTitleScaffold })}</Text>
                </TouchableOpacity>
              )}
              {offerSuggestions.length === 0 && suggestedOfferType && (
                <TouchableOpacity
                  style={[styles.offerCard, { marginBottom: spacing.md }]}
                  onPress={applySuggestedOfferType}
                  accessibilityRole="button"
                  accessibilityLabel={t('ui.bizDash3.useBestOfferTypeA11y', { type: offerTypeLabel(suggestedOfferType.offerType) })}
                >
                  <Text style={styles.offerDescription}>
                    {t('ui.bizDash3.bestOfferTypeHistory', { type: offerTypeLabel(suggestedOfferType.offerType), rate: suggestedOfferType.rate })}
                  </Text>
                </TouchableOpacity>
              )}
              </>
              )}
              <View style={styles.chipRow}>
                {OFFER_TYPE_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.key}
                    style={[styles.chip, offerTypeInput === o.key && styles.chipSelected]}
                    onPress={() => {
                      // PRODUCT_AUDIT/CONNECTIVITY_AUDIT_2026-08-15.md top-10 item 6: a
                      // previously-picked alt-time value used to survive switching to a
                      // different offer type and back, silently resurfacing a stale time
                      // instead of prompting a fresh pick. Reset it the moment the type
                      // stops being 'alt_time' -- the submit path already nulled it out of
                      // what got sent, this just keeps the modal's own local state honest.
                      if (o.key !== 'alt_time') setOfferProposedTime(null);
                      setOfferTypeInput(o.key);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={offerTypeLabel(o.key)}
                    accessibilityState={{ selected: offerTypeInput === o.key }}
                  >
                    <Text style={[styles.chipText, offerTypeInput === o.key && styles.chipTextSelected]}>{offerTypeLabel(o.key)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {offerTypeInput === 'alt_time' && (
                <>
                  <TouchableOpacity
                    style={[styles.input, { marginTop: spacing.sm, justifyContent: 'center' }]}
                    onPress={() => setShowOfferTimePicker(true)}
                    accessibilityLabel={t('ui.bizDash3.pickTheTimeYoureProposingA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={{ color: offerProposedTime ? colors.textPrimary : colors.textTertiary }}>
                      {offerProposedTime
                        ? offerProposedTime.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                        : t('ui.bizDash3.pickATime')}
                    </Text>
                  </TouchableOpacity>
                  {showOfferTimePicker && (
                    <PlatformDateTimeInput
                      value={offerProposedTime ?? new Date()}
                      mode="datetime"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      themeVariant={isDark ? 'dark' : 'light'}
                      minimumDate={new Date()}
                      onChange={(event, selectedDate) => {
                        setShowOfferTimePicker(Platform.OS === 'ios');
                        if (selectedDate) setOfferProposedTime(selectedDate);
                      }}
                    />
                  )}
                </>
              )}
              {/* Item 92 ("Businesses should be able to respond specifically to the
                  occasion", CLAUDE.md): a real, optional, named offer title --
                  "Special Birthday Offer" instead of a generic listing. Never
                  required -- a plain offer with just a description still works
                  exactly as it always has. */}
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder={t('ui.bizDash3.offerTitleOptionalEG')}
                placeholderTextColor={colors.textTertiary}
                value={offerTitleInput}
                onChangeText={setOfferTitleInput}
                accessibilityLabel={t('ui.bizDash3.offerTitleOptionalA11y')}
              />
              {!offerTitleInput && occasionOfferTitleSuggestion && (
                <TouchableOpacity
                  onPress={() => setOfferTitleInput(occasionOfferTitleSuggestion)}
                  style={{ marginTop: spacing.xs }}
                  accessibilityRole="button"
                  accessibilityLabel={t('ui.bizDash3.useSuggestedTitleA11y', { occasionOfferTitleSuggestion: occasionOfferTitleSuggestion })}
                >
                  <Text style={[styles.offerDescription, { color: colors.primary, marginBottom: 0 }]}>{t('ui.bizDash3.use', { occasionOfferTitleSuggestion: occasionOfferTitleSuggestion })}</Text>
                </TouchableOpacity>
              )}
              <TextInput
                style={[styles.input, { marginTop: spacing.sm, minHeight: 80 }]}
                placeholder={t('ui.bizDash3.whatAreYouOfferingE')}
                placeholderTextColor={colors.textTertiary}
                value={offerDescriptionInput}
                onChangeText={setOfferDescriptionInput}
                multiline
                accessibilityLabel={t('ui.bizDash3.offerDescriptionA11y')}
              />
              {offerDescriptionInput.trim() ? (
                <TouchableOpacity
                  onPress={handlePlainLanguage}
                  disabled={requestingPlainLanguage}
                  style={{ marginTop: spacing.xs, alignSelf: 'flex-start', opacity: requestingPlainLanguage ? 0.6 : 1 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('ui.bizDash3.seeItInPlainLanguageA11y')}
                >
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>{requestingPlainLanguage ? t('ui.bizDash3.rewording') : t('ui.bizDash3.seeItInPlainLanguage')}</Text>
                </TouchableOpacity>
              ) : null}
              {plainLanguageSuggestion?.none ? (
                <Text style={[styles.offerDescription, { marginTop: spacing.xs }]}>{plainLanguageSuggestion.message}</Text>
              ) : plainLanguageSuggestion ? (
                (plainLanguageSuggestion.basedOn.description !== offerDescriptionInput || plainLanguageSuggestion.basedOn.title !== offerTitleInput) ? (
                  <Text style={[styles.offerDescription, { marginTop: spacing.xs }]}>{t('ui.bizDash3.youveEditedYourWordingSince')}</Text>
                ) : (
                  <View style={{ marginTop: spacing.xs, padding: spacing.sm, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={[styles.offerDescription, { marginBottom: 0, fontWeight: '600' }]}>{t('ui.bizDash3.suggestedWording')}</Text>
                    {plainLanguageSuggestion.title ? <Text style={[styles.offerDescription, { marginBottom: 0 }]}>{plainLanguageSuggestion.title}</Text> : null}
                    <Text style={[styles.offerDescription, { marginBottom: 0 }]}>{plainLanguageSuggestion.description}</Text>
                    <Text style={[styles.offerDescription, { marginBottom: 0, color: colors.textSecondary }]}>{t('ui.bizDash3.yourPriceDiscountTimesAnd')}</Text>
                    <View style={{ flexDirection: 'row', marginTop: spacing.xs }}>
                      <TouchableOpacity onPress={applyPlainLanguageSuggestion} style={{ marginRight: spacing.md }} accessibilityRole="button" accessibilityLabel={t('ui.bizDash3.useThisWordingA11y')}>
                        <Text style={{ color: colors.primary, fontWeight: '600' }}>{t('ui.bizDash3.useThisWording')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setPlainLanguageSuggestion(null)} accessibilityRole="button" accessibilityLabel={t('ui.bizDash3.keepMyWordingA11y')}>
                        <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>{t('ui.bizDash3.keepMine')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )
              ) : null}
              {offerTypeInput === 'discount' && (
                <>
                  <TextInput
                    style={[styles.input, { marginTop: spacing.sm }]}
                    placeholder={discountCap != null ? t('ui.bizDash3.discountMax', { discountCap: discountCap }) : t('ui.bizDash3.discountOptional')}
                    placeholderTextColor={colors.textTertiary}
                    value={offerDiscountInput}
                    onChangeText={(t) => setOfferDiscountInput(t.replace(/[^0-9.]/g, ''))}
                    keyboardType="decimal-pad"
                    accessibilityLabel={t('ui.bizDash3.discountPercentA11y')}
                  />
                  {discountCap != null && (
                    <Text style={[styles.offerDescription, { marginTop: spacing.xs }]}>{t('ui.bizDash1.yourPolicyCapsDiscountsAt', { discountCap: discountCap })}</Text>
                  )}
                </>
              )}
              {/* Item 92: a real included-items checklist -- "✓ Private table,
                  ✓ Birthday dessert, ✓ Complimentary champagne alternative" --
                  same add-one-at-a-time editor shape the Occasion Package
                  section's own included_items editor already established. */}
              <Text style={[styles.sectionHeader, { marginTop: spacing.sm }]}>{t('ui.bizDash3.whatsIncludedOptional')}</Text>
              <View style={{ flexDirection: 'row' }}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder={t('ui.bizDash3.eGPrivateTable')}
                  placeholderTextColor={colors.textTertiary}
                  value={offerIncludedItemDraft}
                  onChangeText={setOfferIncludedItemDraft}
                  onSubmitEditing={addOfferIncludedItem}
                  accessibilityLabel={t('ui.bizDash3.addAnIncludedItemA11y')}
                />
                <TouchableOpacity
                  style={[styles.smallActionButton, { backgroundColor: colors.primary, marginLeft: spacing.sm, alignSelf: 'center' }]}
                  onPress={addOfferIncludedItem}
                  accessibilityLabel={t('ui.bizDash3.addItemA11y')}
                  accessibilityRole="button"
                >
                  <Text style={styles.smallActionButtonText}>{t('ui.bizDash3.add')}</Text>
                </TouchableOpacity>
              </View>
              {offerIncludedItemsInput.length > 0 && (
                <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
                  {offerIncludedItemsInput.map((item, index) => (
                    <TouchableOpacity
                      key={`${item}-${index}`}
                      style={[styles.chip, styles.chipSelected]}
                      onPress={() => removeOfferIncludedItem(index)}
                      accessibilityRole="button"
                      accessibilityLabel={t('ui.bizDash3.removeA11y', { item: item })}
                    >
                      <Text style={[styles.chipText, styles.chipTextSelected]}>✓ {item} ×</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder={t('ui.bizDash3.priceOptional')}
                placeholderTextColor={colors.textTertiary}
                value={offerPriceInput}
                onChangeText={setOfferPriceInput}
                keyboardType="decimal-pad"
                accessibilityLabel={t('ui.bizDash3.offerPriceOptionalA11y')}
              />
              {/* Item 93 follow-up (CLAUDE.md): an explicit per-person vs.
                  flat/total choice -- never guessed -- so the consumer's
                  comparison card can render an honest "$70/person" instead
                  of an ambiguous bare number. Only shown once a price is
                  actually entered. */}
              {offerPriceInput.trim() ? (
                <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
                  <TouchableOpacity
                    style={[styles.chip, !offerPriceIsPerPerson && styles.chipSelected]}
                    onPress={() => setOfferPriceIsPerPerson(false)}
                    accessibilityRole="button"
                    accessibilityLabel={t('ui.bizDash3.flatOrTotalPriceA11y')}
                  >
                    <Text style={[styles.chipText, !offerPriceIsPerPerson && styles.chipTextSelected]}>{t('ui.bizDash3.total')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.chip, offerPriceIsPerPerson && styles.chipSelected]}
                    onPress={() => setOfferPriceIsPerPerson(true)}
                    accessibilityRole="button"
                    accessibilityLabel={t('ui.bizDash3.priceIsPerPersonA11y')}
                  >
                    <Text style={[styles.chipText, offerPriceIsPerPerson && styles.chipTextSelected]}>{t('ui.bizDash3.perPerson')}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {creatives.length > 0 && !offerPickedMediaAsset ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={styles.notesLabel}>{t('ui.bizDash3.useYourSavedCreative')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {creatives.map((c) => (
                      <CreativeThumb
                        key={c.id}
                        creative={c}
                        selected={offerCreativeId === c.id}
                        colors={colors}
                        onPress={() => setOfferCreativeId(offerCreativeId === c.id ? null : c.id)}
                      />
                    ))}
                  </ScrollView>
                  {offerCreativeId ? (
                    <TouchableOpacity
                      onPress={async () => {
                        try { await archiveBusinessCreative(offerCreativeId); setCreatives((list) => list.filter((c) => c.id !== offerCreativeId)); setOfferCreativeId(null); }
                        catch (e) { presentRecoverableError(Alert, { what: 'complete that', error: e }); }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t('ui.bizDash3.removeThisCreativeFromYourA11y')}
                    >
                      <Text style={{ color: colors.danger, fontWeight: '600', marginTop: spacing.xs }}>{t('ui.bizDash3.removeFromSavedCreative')}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
              <BusinessMediaPicker
                colors={colors}
                pickedAsset={offerPickedMediaAsset}
                existingPath={null}
                existingType={null}
                onPick={async () => {
                  try {
                    // The website sends photos only (video frames are sampled on the device); videos are capped at 30s / 25MB.
                    const asset = await pickBusinessOfferMedia({ imagesOnly: Platform.OS === 'web' });
                    const problem = videoLimitProblem(asset);
                    if (problem) { Alert.alert(t('ui.bizDash3.videoTooBig'), problem); return; }
                    if (asset) { setOfferPickedMediaAsset(asset); setCreativeDetected(null); }
                  } catch (e) {
                    presentRecoverableError(Alert, { what: 'complete that', error: e });
                  }
                }}
                onRemove={() => { setOfferPickedMediaAsset(null); setCreativeUpload(null); setCreativeDetected(null); }}
              />
              {offerPickedMediaAsset && canReadCreative(offerPickedMediaAsset, Platform.OS) ? (
                <TouchableOpacity
                  onPress={handleReadCreative}
                  disabled={readingCreative}
                  style={{ marginTop: spacing.sm, alignSelf: 'flex-start', opacity: readingCreative ? 0.6 : 1 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('ui.bizDash3.readThisForMeFillsA11y')}
                >
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>{readingCreative ? t('ui.bizDash3.reading') : t('ui.bizDash3.readThisForMe')}</Text>
                </TouchableOpacity>
              ) : null}
              {creativeDetected?.none ? (
                <Text style={[styles.offerDescription, { marginTop: spacing.xs }]}>{t('ui.bizDash3.weCouldntFindOfferDetails')}</Text>
              ) : creativeDetected?.summary ? (
                <View style={{ marginTop: spacing.xs }}>
                  <Text style={[styles.offerDescription, { marginBottom: 0 }]}>{creativeDetected.summary}</Text>
                  <Text style={[styles.offerDescription, { marginBottom: 0 }]}>{t('ui.bizDash3.checkAndEditAnythingBelow')}</Text>
                  {creativeDetected.warning ? <Text style={{ color: colors.danger, marginTop: spacing.xs }}>{creativeDetected.warning}</Text> : null}
                </View>
              ) : null}
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder={t('ui.bizDash3.howToRedeemOptionalE')}
                placeholderTextColor={colors.textTertiary}
                value={offerRedemptionInput}
                onChangeText={(t) => setOfferRedemptionInput(t.slice(0, MAX_REDEMPTION_LENGTH))}
                multiline
                accessibilityLabel={t('ui.bizDash3.howToRedeemOptionalShownA11y')}
              />
              <Text style={[styles.notesLabel, { marginTop: spacing.sm }]}>{t('ui.bizDash3.availableOptional')}</Text>
              {renderAvailabilityWindow({ from: offerAvailFrom, until: offerAvailUntil, setFrom: setOfferAvailFrom, setUntil: setOfferAvailUntil, picker: availPicker, setPicker: setAvailPicker })}
              <Text style={[styles.notesLabel, { marginTop: spacing.sm }]}>{t('ui.bizDash3.validUntilOptional')}</Text>
              <View style={styles.chipRow}>
                {[['none', t('ui.bizDash3.noEndTime')], ['today', t('ui.bizDash3.today')], ['tomorrow', t('ui.bizDash3.tomorrow')]].map(([key, label]) => {
                  const selected = (offerValidDay ?? 'none') === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => {
                        if (key === 'none') { setOfferValidDay(null); setOfferValidTime(null); setShowValidTimePicker(false); return; }
                        setOfferValidDay(key);
                        if (!offerValidTime) { const d = new Date(); d.setHours(19, 0, 0, 0); setOfferValidTime(d); }
                        setShowValidTimePicker(true);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t('ui.bizDash3.validUntilA11y', { label: label })}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {offerValidDay && offerValidTime ? (
                <TouchableOpacity onPress={() => setShowValidTimePicker(true)} accessibilityRole="button" accessibilityLabel={t('ui.bizDash3.changeTheEndTimeA11y')}>
                  <Text style={{ color: colors.textPrimary, marginTop: spacing.xs }}>
                    {offerValidDay === 'tomorrow'
                      ? t('ui.bizDash3.untilTomorrowTapToChange', { time: displayClock(offerValidTime, language) })
                      : t('ui.bizDash3.untilTodayTapToChange', { time: displayClock(offerValidTime, language) })}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {offerValidDay && !offerValidTime ? (
                <TouchableOpacity onPress={() => setShowValidTimePicker(true)} accessibilityRole="button" accessibilityLabel={t('ui.bizDash3.pickTheEndTimeA11y')}>
                  <Text style={{ color: colors.warning, marginTop: spacing.xs }}>{offerValidDay === 'tomorrow' ? t('ui.bizDash3.pickEndTimeTomorrow') : t('ui.bizDash3.pickEndTimeToday')}</Text>
                </TouchableOpacity>
              ) : null}
              {showValidTimePicker && offerValidDay ? (
                <PlatformDateTimeInput
                  value={offerValidTime ?? new Date()}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  themeVariant={isDark ? 'dark' : 'light'}
                  onChange={(event, selected) => {
                    setShowValidTimePicker(Platform.OS === 'ios');
                    if (selected && event?.type !== 'dismissed') setOfferValidTime(selected);
                  }}
                />
              ) : null}
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handlePreviewOffer}
                disabled={respondingOpportunityId === offerModalRequestId || !offerDescriptionInput.trim() || (offerTypeInput === 'alt_time' && !offerProposedTime)}
                accessibilityLabel={t('ui.bizDash3.previewWhatTheCustomerWillA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{t('ui.bizDash3.previewOffer')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setOfferModalRequestId(null)} style={{ marginTop: spacing.md }} accessibilityLabel={t('ui.bizDash3.cancelA11y')} accessibilityRole="button">
                <Text style={styles.modalCloseText}>{t('ui.bizDash3.cancel')}</Text>
              </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={!!acceptSheetRequestId} animationType={modalAnimation('slide')} transparent onRequestClose={() => setAcceptSheetRequestId(null)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('ui.bizDash3.whatsYourOffer')}</Text>
            <View style={styles.offerCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.offerTitle}>{t('ui.bizDash3.standardAvailability')}</Text>
                <Text style={styles.breakdownText}>{t('ui.bizDash3.yesYouCanHostThem')}</Text>
                <Text style={[styles.notesLabel, { marginTop: spacing.xs }]}>{t('ui.bizDash3.availableOptional')}</Text>
                {renderAvailabilityWindow({ from: quickFrom, until: quickUntil, setFrom: setQuickFrom, setUntil: setQuickUntil, picker: quickPicker, setPicker: setQuickPicker })}
                {usualTermsLine(fulfillmentPolicy) ? (
                  <Text style={[styles.breakdownText, { marginTop: spacing.xs }]}>{usualTermsLine(fulfillmentPolicy)}</Text>
                ) : (
                  <TouchableOpacity
                    onPress={() => { setAcceptSheetRequestId(null); openPolicyModal(); }}
                    accessibilityLabel={t('ui.bizDash3.setYourUsualTermsA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.messageMemberLink, { marginTop: spacing.xs }]}>{t('ui.bizDash3.setYourUsualTermsSo')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                style={[styles.smallActionButton, { backgroundColor: colors.primary }]}
                onPress={() => {
                  const win = availableWindowFromChoice(quickFrom, quickUntil);
                  if (win.error) { Alert.alert(t('ui.bizDash3.availableWindow'), win.error); return; }
                  submitQuickResponse(acceptSheetRequestId, { offerType: 'standard', offerDescription: standardAvailabilityText(fulfillmentPolicy), availableFrom: win.from, availableUntil: win.until });
                }}
                disabled={respondingOpportunityId === acceptSheetRequestId}
                accessibilityLabel={t('ui.bizDash3.sendStandardAvailabilityA11y')}
                accessibilityRole="button"
              >
                {respondingOpportunityId === acceptSheetRequestId ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.smallActionButtonText}>{t('ui.bizDash3.send')}</Text>}
              </TouchableOpacity>
            </View>
            <View style={[styles.offerCard, { marginTop: spacing.sm }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.offerTitle}>{t('ui.bizDash3.specialOffer')}</Text>
                <Text style={styles.breakdownText}>{t('ui.bizDash3.addAPricePerkDiscount')}</Text>
              </View>
              <TouchableOpacity
                style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated }]}
                onPress={() => { const id = acceptSheetRequestId; setAcceptSheetRequestId(null); openOfferModal(id); }}
                accessibilityLabel={t('ui.bizDash3.createASpecialOfferA11y')}
                accessibilityRole="button"
              >
                <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>{t('ui.bizDash3.customize')}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => setAcceptSheetRequestId(null)} style={{ marginTop: spacing.md }} accessibilityLabel={t('ui.bizDash3.cancelA11y')} accessibilityRole="button">
              <Text style={styles.modalCloseText}>{t('ui.bizDash3.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={!!altSheetRequestId} animationType={modalAnimation('slide')} transparent onRequestClose={() => setAltSheetRequestId(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>{t('ui.bizDash3.offerAnotherTime')}</Text>
              <Text style={[styles.modalCloseText, { marginBottom: spacing.md }]}>
                {t('ui.bizDash3.pickTheTimeThatWorks')}
              </Text>
              <TouchableOpacity
                style={[styles.input, { justifyContent: 'center' }]}
                onPress={() => setShowAltPicker(true)}
                accessibilityLabel={t('ui.bizDash3.pickTheTimeYoureProposingA11y')}
                accessibilityRole="button"
              >
                <Text style={{ color: altTime ? colors.textPrimary : colors.textTertiary }}>
                  {altTime
                    ? altTime.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                    : t('ui.bizDash3.pickATime')}
                </Text>
              </TouchableOpacity>
              {showAltPicker && (
                <PlatformDateTimeInput
                  value={altTime ?? alternativePickerStart(opportunities.find((x) => x.request_id === altSheetRequestId)?.business_requests)}
                  mode="datetime"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  themeVariant={isDark ? 'dark' : 'light'}
                  minimumDate={new Date()}
                  onChange={(event, selectedDate) => {
                    setShowAltPicker(Platform.OS === 'ios');
                    if (selectedDate) setAltTime(selectedDate);
                  }}
                />
              )}
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder={t('ui.bizDash3.addANoteOptional')}
                placeholderTextColor={colors.textTertiary}
                value={altNote}
                onChangeText={setAltNote}
                accessibilityLabel={t('ui.bizDash3.noteAboutTheAlternativeTimeA11y')}
              />
              <TouchableOpacity
                style={styles.submitButton}
                onPress={() => submitQuickResponse(altSheetRequestId, { offerType: 'alt_time', offerDescription: buildAlternativeText(altNote), proposedTime: altTime.toISOString() })}
                disabled={!altTime || respondingOpportunityId === altSheetRequestId}
                accessibilityLabel={t('ui.bizDash3.sendAlternativeTimeA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{respondingOpportunityId === altSheetRequestId ? t('ui.bizDash3.sending') : t('ui.bizDash3.send')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setAltSheetRequestId(null)} style={{ marginTop: spacing.md }} accessibilityLabel={t('ui.bizDash3.cancelA11y')} accessibilityRole="button">
                <Text style={styles.modalCloseText}>{t('ui.bizDash3.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={!!declineModalRequestId} animationType={modalAnimation('slide')} transparent onRequestClose={() => setDeclineModalRequestId(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>{t('ui.bizDash3.cantAccommodateThisOne')}</Text>
              <Text style={[styles.modalCloseText, { marginBottom: spacing.md }]}>
                {t('ui.bizDash3.noPenaltyThisJustHelps')}
              </Text>
              <View style={styles.chipRow}>
                {DECLINE_REASON_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.key}
                    style={[styles.chip, declineReasonInput === o.key && styles.chipSelected]}
                    onPress={() => setDeclineReasonInput(o.key)}
                    accessibilityRole="button"
                    accessibilityLabel={o.label}
                    accessibilityState={{ selected: declineReasonInput === o.key }}
                  >
                    <Text style={[styles.chipText, declineReasonInput === o.key && styles.chipTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {declineReasonInput === 'other' && (
                <TextInput
                  style={[styles.input, { marginTop: spacing.sm, minHeight: 60 }]}
                  placeholder={t('ui.bizDash3.whatsTheRealReasonOptional')}
                  placeholderTextColor={colors.textTertiary}
                  value={declineNoteInput}
                  onChangeText={setDeclineNoteInput}
                  multiline
                  accessibilityLabel={t('ui.bizDash3.optionalNoteForWhyYoureA11y')}
                />
              )}
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleSubmitDecline}
                disabled={!declineReasonInput || respondingOpportunityId === declineModalRequestId}
                accessibilityLabel={respondingOpportunityId === declineModalRequestId ? t('ui.bizDash3.decliningA11y') : t('ui.bizDash3.confirmDeclineA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{respondingOpportunityId === declineModalRequestId ? t('ui.bizDash3.declining') : t('ui.bizDash3.confirm')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setDeclineModalRequestId(null)} style={{ marginTop: spacing.md }} accessibilityLabel={t('ui.bizDash3.cancelA11y')} accessibilityRole="button">
                <Text style={styles.modalCloseText}>{t('ui.bizDash3.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={postAvailabilityModalVisible} animationType={modalAnimation('slide')} transparent onRequestClose={() => setPostAvailabilityModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>{t('ui.bizDash3.postAvailability')}</Text>
              <Text style={[styles.modalCloseText, { marginBottom: spacing.md }]}>
                {t('ui.bizDash3.wellMatchThisAgainstOpen')}
              </Text>
              <TextInput
                style={styles.input}
                placeholder={t('ui.bizDash3.n4EmptyTablesTonight')}
                placeholderTextColor={colors.textTertiary}
                value={availabilityTitleInput}
                onChangeText={setAvailabilityTitleInput}
                accessibilityLabel={t('ui.bizDash3.availabilityTitleA11y')}
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm, minHeight: 70 }]}
                placeholder={t('ui.bizDash3.descriptionOptional')}
                placeholderTextColor={colors.textTertiary}
                value={availabilityDescriptionInput}
                onChangeText={setAvailabilityDescriptionInput}
                multiline
                accessibilityLabel={t('ui.bizDash3.availabilityDescriptionOptionalA11y')}
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.categoryOptional')}</Text>
              <View style={styles.chipRow}>
                {AVAILABILITY_CATEGORY_OPTIONS.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.chip, availabilityCategoryInput === c && styles.chipSelected]}
                    onPress={() => setAvailabilityCategoryInput(availabilityCategoryInput === c ? null : c)}
                    accessibilityRole="button"
                    accessibilityLabel={c}
                    accessibilityState={{ selected: availabilityCategoryInput === c }}
                  >
                    <Text style={[styles.chipText, availabilityCategoryInput === c && styles.chipTextSelected]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.whatAreYouOffering')}</Text>
              <View style={styles.chipRow}>
                {OFFER_TYPE_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.key}
                    style={[styles.chip, availabilityOfferTypeInput === o.key && styles.chipSelected]}
                    onPress={() => setAvailabilityOfferTypeInput(o.key)}
                    accessibilityRole="button"
                    accessibilityLabel={offerTypeLabel(o.key)}
                    accessibilityState={{ selected: availabilityOfferTypeInput === o.key }}
                  >
                    <Text style={[styles.chipText, availabilityOfferTypeInput === o.key && styles.chipTextSelected]}>{offerTypeLabel(o.key)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder={t('ui.bizDash3.priceOptional')}
                placeholderTextColor={colors.textTertiary}
                value={availabilityPriceInput}
                onChangeText={setAvailabilityPriceInput}
                keyboardType="decimal-pad"
                accessibilityLabel={t('ui.bizDash3.priceOptionalA11y')}
              />
              {availabilityOfferTypeInput === 'discount' && (
                <>
                  <TextInput
                    style={[styles.input, { marginTop: spacing.sm }]}
                    placeholder={discountCap != null ? t('ui.bizDash3.discountMax', { discountCap: discountCap }) : t('ui.bizDash3.discountOptional')}
                    placeholderTextColor={colors.textTertiary}
                    value={availabilityDiscountInput}
                    onChangeText={(t) => setAvailabilityDiscountInput(t.replace(/[^0-9.]/g, ''))}
                    keyboardType="decimal-pad"
                    accessibilityLabel={t('ui.bizDash3.discountPercentA11y')}
                  />
                  {discountCap != null && (
                    <Text style={[styles.offerDescription, { marginTop: spacing.xs }]}>{t('ui.bizDash1.yourPolicyCapsDiscountsAt', { discountCap: discountCap })}</Text>
                  )}
                </>
              )}
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder={t('ui.bizDash3.howManySpotsOptionalE')}
                placeholderTextColor={colors.textTertiary}
                value={availabilityCapacityInput}
                onChangeText={(t) => setAvailabilityCapacityInput(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                accessibilityLabel={t('ui.bizDash3.capacityOptionalA11y')}
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.whenDoYouHaveSpace')}</Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, availabilityWhenMode === 'now' && styles.chipSelected]}
                  onPress={() => setAvailabilityWhenMode('now')}
                  accessibilityRole="button"
                  accessibilityLabel={t('ui.bizDash3.availableNowA11y')}
                  accessibilityState={{ selected: availabilityWhenMode === 'now' }}
                >
                  <Text style={[styles.chipText, availabilityWhenMode === 'now' && styles.chipTextSelected]}>{t('ui.bizDash3.now')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, availabilityWhenMode === 'scheduled' && styles.chipSelected]}
                  onPress={() => {
                    setAvailabilityWhenMode('scheduled');
                    if (!availabilityStart) {
                      const w = defaultScheduledWindow();
                      setAvailabilityStart(w.start);
                      setAvailabilityEnd(w.end);
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('ui.bizDash3.pickADayAndTimeA11y')}
                  accessibilityState={{ selected: availabilityWhenMode === 'scheduled' }}
                >
                  <Text style={[styles.chipText, availabilityWhenMode === 'scheduled' && styles.chipTextSelected]}>{t('ui.bizDash3.pickADayTime')}</Text>
                </TouchableOpacity>
              </View>
              {availabilityWhenMode === 'scheduled' && (
                <>
                  {[['start', t('ui.bizDash3.starts'), availabilityStart], ['end', t('ui.bizDash3.ends'), availabilityEnd]].map(([which, label, value]) => (
                    <TouchableOpacity
                      key={which}
                      style={[styles.input, { marginTop: spacing.sm, justifyContent: 'center' }]}
                      onPress={() => setShowAvailabilityPicker(showAvailabilityPicker === which ? null : which)}
                      accessibilityRole="button"
                      accessibilityLabel={t('ui.bizDash3.pickADayAndTimeA11y2', { label: label })}
                    >
                      <Text style={{ color: value ? colors.textPrimary : colors.textTertiary }}>
                        {label}: {value ? value.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : t('ui.bizDash3.pickATime')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {showAvailabilityPicker && (
                    <PlatformDateTimeInput
                      value={(showAvailabilityPicker === 'start' ? availabilityStart : availabilityEnd) ?? new Date()}
                      mode="datetime"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      themeVariant={isDark ? 'dark' : 'light'}
                      minimumDate={new Date()}
                      onChange={(event, selectedDate) => {
                        const which = showAvailabilityPicker;
                        setShowAvailabilityPicker(Platform.OS === 'ios' ? which : null);
                        if (!selectedDate) return;
                        if (which === 'start') {
                          setAvailabilityStart(selectedDate);
                          setAvailabilityEnd((prev) => shiftEndAfterStart(selectedDate, prev));
                        } else {
                          setAvailabilityEnd(selectedDate);
                        }
                      }}
                    />
                  )}
                </>
              )}
              {availabilityWhenMode === 'now' && (
                <>
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.howLongShouldThisStay')}</Text>
              <View style={styles.chipRow}>
                {AVAILABILITY_DURATION_OPTIONS.map((d) => (
                  <TouchableOpacity
                    key={d.key}
                    style={[styles.chip, availabilityDurationKey === d.key && styles.chipSelected]}
                    onPress={() => setAvailabilityDurationKey(d.key)}
                    accessibilityRole="button"
                    accessibilityLabel={t(`ui.bizDash3.duration.${d.key}`)}
                    accessibilityState={{ selected: availabilityDurationKey === d.key }}
                  >
                    <Text style={[styles.chipText, availabilityDurationKey === d.key && styles.chipTextSelected]}>{t(`ui.bizDash3.duration.${d.key}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              </>
              )}
              {(() => {
                const line = demandPreviewLine({
                  people: availabilityDemandPeople,
                  category: availabilityCategoryInput,
                  startsAt: (availabilityWhenMode === 'scheduled' ? availabilityStart : new Date()) ?? new Date(),
                });
                return line ? (
                  <Text style={[styles.offerDescription, { marginTop: spacing.sm, color: colors.textPrimary }]} accessibilityLiveRegion="polite">
                    {line}
                  </Text>
                ) : null;
              })()}
              {/* Business-side Experience Bundles (2026-09-10, direct user
                  request): entirely optional -- posting a normal single-
                  category availability (the existing flow above) is
                  unaffected either way. Only shown for occasions the
                  intent-engine's own Experiences section actually has a
                  template for (bundleableOccasions() -- casual_hangout/
                  business_meal/other have no components to bundle). */}
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>
                {t('ui.bizDash3.packageThisAsAnExperience')}
              </Text>
              <Text style={[styles.modalCloseText, { marginBottom: spacing.sm }]}>
                {t('ui.bizDash3.ifThisOnePostingCovers')}
              </Text>
              <View style={styles.chipRow}>
                {bundleableOccasions().map((occasion) => (
                  <TouchableOpacity
                    key={occasion}
                    style={[styles.chip, availabilityBundleOccasionInput === occasion && styles.chipSelected]}
                    onPress={() => handleSelectBundleOccasion(occasion)}
                    accessibilityRole="button"
                    accessibilityLabel={occasionLabel(occasion)}
                    accessibilityState={{ selected: availabilityBundleOccasionInput === occasion }}
                  >
                    <Text style={[styles.chipText, availabilityBundleOccasionInput === occasion && styles.chipTextSelected]}>
                      {occasionLabel(occasion)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {availabilityBundleOccasionInput && (
                <>
                  <Text style={[styles.sectionHeader, { marginTop: spacing.sm }]}>
                    {t('ui.bizDash3.whichPartsDoesThisOne')}
                  </Text>
                  <View style={styles.chipRow}>
                    {experienceComponentOptionsForOccasion(availabilityBundleOccasionInput).map((component) => (
                      <TouchableOpacity
                        key={component.key}
                        style={[styles.chip, availabilityBundleComponentsInput.includes(component.key) && styles.chipSelected]}
                        onPress={() => toggleBundleComponent(component.key)}
                        accessibilityRole="button"
                        accessibilityLabel={component.label}
                        accessibilityState={{ selected: availabilityBundleComponentsInput.includes(component.key) }}
                      >
                        <Text style={[styles.chipText, availabilityBundleComponentsInput.includes(component.key) && styles.chipTextSelected]}>
                          {component.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              <TouchableOpacity
                style={[styles.submitButton, { marginTop: spacing.md }]}
                onPress={handlePostAvailability}
                disabled={postingAvailability || !availabilityTitleInput.trim()}
                accessibilityLabel={postingAvailability ? t('ui.bizDash3.postingA11y') : t('ui.bizDash3.postAvailabilityA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{postingAvailability ? t('ui.bizDash3.posting') : availabilityDemandPeople != null ? t('ui.bizDash3.sendOffer') : t('ui.bizDash3.postAvailability')}</Text>
              </TouchableOpacity>
              <SettingConflictNotice messages={conflictMessages(settingConflicts.entries, 'availability')} />
              <TouchableOpacity onPress={() => setPostAvailabilityModalVisible(false)} style={{ marginTop: spacing.md }} accessibilityLabel={t('ui.bizDash3.cancelA11y')} accessibilityRole="button">
                <Text style={styles.modalCloseText}>{t('ui.bizDash3.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Item 68 (CLAUDE.md): create/edit a durable, named occasion
          package -- e.g. "Birthday Package": dessert + a group table,
          minimum 6 guests, available Fri/Sat, $X/person. */}
      <Modal visible={packageModalVisible} animationType={modalAnimation('slide')} transparent onRequestClose={() => setPackageModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <ScrollView style={styles.sheet} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>{editingPackageId ? t('ui.bizDash3.editPackage') : t('ui.bizDash3.addAnOccasionPackage')}</Text>
              <Text style={[styles.modalCloseText, { marginBottom: spacing.md }]}>
                {t('ui.bizDash3.aStandingOfferForOne')}
              </Text>
              <Text style={styles.sectionHeader}>{t('ui.bizDash3.whichOccasion')}</Text>
              <View style={styles.chipRow}>
                {OCCASION_OPTIONS.map((o) => {
                  const selected = packageOccasionInput === o.key;
                  return (
                    <TouchableOpacity
                      key={o.key}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => setPackageOccasionInput(o.key)}
                      accessibilityRole="button"
                      accessibilityLabel={o.label}
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.packageName')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('ui.bizDash3.birthdayPackage')}
                placeholderTextColor={colors.textTertiary}
                value={packageNameInput}
                onChangeText={setPackageNameInput}
                accessibilityLabel={t('ui.bizDash3.packageNameA11y')}
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.descriptionOptional')}</Text>
              <TextInput
                style={[styles.input, { minHeight: 60 }]}
                placeholder={t('ui.bizDash3.whatMakesThisPackageSpecial')}
                placeholderTextColor={colors.textTertiary}
                value={packageDescriptionInput}
                onChangeText={setPackageDescriptionInput}
                multiline
                accessibilityLabel={t('ui.bizDash3.packageDescriptionOptionalA11y')}
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.whatsIncluded')}</Text>
              <View style={{ flexDirection: 'row' }}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder={t('ui.bizDash3.eGBirthdayDessert')}
                  placeholderTextColor={colors.textTertiary}
                  value={packageIncludedItemDraft}
                  onChangeText={setPackageIncludedItemDraft}
                  onSubmitEditing={addPackageIncludedItem}
                  accessibilityLabel={t('ui.bizDash3.addAnIncludedItemA11y')}
                />
                <TouchableOpacity
                  style={[styles.smallActionButton, { backgroundColor: colors.primary, marginLeft: spacing.sm, alignSelf: 'center' }]}
                  onPress={addPackageIncludedItem}
                  accessibilityLabel={t('ui.bizDash3.addItemA11y')}
                  accessibilityRole="button"
                >
                  <Text style={styles.smallActionButtonText}>{t('ui.bizDash3.add')}</Text>
                </TouchableOpacity>
              </View>
              {packageIncludedItemsInput.length > 0 && (
                <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
                  {packageIncludedItemsInput.map((item, index) => (
                    <TouchableOpacity
                      key={`${item}-${index}`}
                      style={[styles.chip, styles.chipSelected]}
                      onPress={() => removePackageIncludedItem(index)}
                      accessibilityRole="button"
                      accessibilityLabel={t('ui.bizDash3.removeA11y', { item: item })}
                    >
                      <Text style={[styles.chipText, styles.chipTextSelected]}>{item} ×</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.minimumGuestsOptional')}</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 6"
                placeholderTextColor={colors.textTertiary}
                value={packageMinGuestsInput}
                onChangeText={(t) => setPackageMinGuestsInput(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                accessibilityLabel={t('ui.bizDash3.minimumGuestsA11y')}
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.pricePerPersonOptional')}</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 45"
                placeholderTextColor={colors.textTertiary}
                value={packagePriceInput}
                onChangeText={(t) => setPackagePriceInput(t.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad"
                accessibilityLabel={t('ui.bizDash3.pricePerPersonA11y')}
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.availableDaysOptional')}</Text>
              <Text style={styles.helperText}>{t('ui.bizDash3.leaveEveryDayUnselectedTo')}</Text>
              <View style={styles.chipRow}>
                {DAY_OF_WEEK_OPTIONS.map((day) => {
                  const selected = packageAvailableDaysInput.includes(day.key);
                  return (
                    <TouchableOpacity
                      key={day.key}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => togglePackageAvailableDay(day.key)}
                      accessibilityRole="button"
                      accessibilityLabel={day.label}
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{day.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                style={[styles.submitButton, { marginTop: spacing.md }]}
                onPress={handleSavePackage}
                disabled={savingPackage || !packageNameInput.trim() || !packageOccasionInput}
                accessibilityLabel={savingPackage ? t('ui.bizDash3.savingA11y') : t('ui.bizDash3.savePackageA11y')}
                accessibilityRole="button"
              >
                {savingPackage ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>{editingPackageId ? t('ui.bizDash3.saveChanges') : t('ui.bizDash3.addPackage')}</Text>}
              </TouchableOpacity>
              <SettingConflictNotice messages={conflictMessages(settingConflicts.entries, 'package')} />
              <TouchableOpacity onPress={() => setPackageModalVisible(false)} style={{ marginTop: spacing.md, marginBottom: spacing.lg }} accessibilityLabel={t('ui.bizDash3.cancelA11y')} accessibilityRole="button">
                <Text style={styles.modalCloseText}>{t('ui.bizDash3.cancel')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={policyModalVisible} animationType={modalAnimation('slide')} transparent onRequestClose={() => setPolicyModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <ScrollView style={styles.sheet} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>{t('ui.bizDash3.fulfillmentPolicy')}</Text>
              <Text style={[styles.modalCloseText, { marginBottom: spacing.md }]}>
                {t('ui.bizDash3.aStandingRuleForEvery')}
              </Text>
              <Text style={styles.sectionHeader}>{t('ui.bizDash3.partySizeRange')}</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder={t('ui.bizDash3.minOptional')}
                  placeholderTextColor={colors.textTertiary}
                  value={policyPartySizeMinInput}
                  onChangeText={(t) => setPolicyPartySizeMinInput(t.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  accessibilityLabel={t('ui.bizDash3.minimumPartySizeA11y')}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder={t('ui.bizDash3.maxOptional')}
                  placeholderTextColor={colors.textTertiary}
                  value={policyPartySizeMaxInput}
                  onChangeText={(t) => setPolicyPartySizeMaxInput(t.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  accessibilityLabel={t('ui.bizDash3.maximumPartySizeA11y')}
                />
              </View>
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.activeHours24hOptional')}</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="17:00"
                  placeholderTextColor={colors.textTertiary}
                  value={policyActiveHoursStartInput}
                  onChangeText={setPolicyActiveHoursStartInput}
                  accessibilityLabel={t('ui.bizDash3.activeHoursStart24HourA11y')}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="22:00"
                  placeholderTextColor={colors.textTertiary}
                  value={policyActiveHoursEndInput}
                  onChangeText={setPolicyActiveHoursEndInput}
                  accessibilityLabel={t('ui.bizDash3.activeHoursEnd24HourA11y')}
                />
              </View>
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.activeDaysOptional')}</Text>
              <Text style={styles.helperText}>
                {t('ui.bizDash3.leaveEveryDayUnselectedOr')}
              </Text>
              <View style={styles.chipRow}>
                {DAY_OF_WEEK_OPTIONS.map((day) => {
                  const selected = policyActiveDaysInput.includes(day.key);
                  return (
                    <TouchableOpacity
                      key={day.key}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => togglePolicyActiveDay(day.key)}
                      accessibilityRole="button"
                      accessibilityLabel={day.label}
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{day.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.autoAcceptPartySizeUp')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('ui.bizDash3.eG4LeaveBlank')}
                placeholderTextColor={colors.textTertiary}
                value={policyAutoAcceptMaxInput}
                onChangeText={(t) => setPolicyAutoAcceptMaxInput(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                accessibilityLabel={t('ui.bizDash3.autoAcceptPartySizeMaximumA11y')}
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.minimumSpendPerPersonOptional')}</Text>
              <TextInput
                style={styles.input}
                placeholder="$"
                placeholderTextColor={colors.textTertiary}
                value={policyMinSpendInput}
                onChangeText={setPolicyMinSpendInput}
                keyboardType="decimal-pad"
                accessibilityLabel={t('ui.bizDash3.minimumSpendPerPersonA11y')}
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.maxDiscountOptional')}</Text>
              <TextInput
                style={styles.input}
                placeholder="0-100"
                placeholderTextColor={colors.textTertiary}
                value={policyMaxDiscountInput}
                onChangeText={setPolicyMaxDiscountInput}
                keyboardType="decimal-pad"
                accessibilityLabel={t('ui.bizDash3.maximumDiscountPercentA11y')}
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.depositOptionalIncludedInYour')}</Text>
              <TextInput
                style={styles.input}
                placeholder="$"
                placeholderTextColor={colors.textTertiary}
                value={policyDepositInput}
                onChangeText={setPolicyDepositInput}
                keyboardType="decimal-pad"
                accessibilityLabel={t('ui.bizDash3.depositAmountStoredOnlyNotA11y')}
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.cancellationWindowHoursOptional')}</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 2"
                placeholderTextColor={colors.textTertiary}
                value={policyCancellationWindowInput}
                onChangeText={(t) => setPolicyCancellationWindowInput(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                accessibilityLabel={t('ui.bizDash3.cancellationWindowInHoursA11y')}
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.weatherDependent')}</Text>
              <Text style={styles.helperText}>
                {t('ui.bizDash3.forOutdoorPatioOnlyCapacity')}
              </Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, policyWeatherDependentInput && styles.chipSelected]}
                  onPress={() => setPolicyWeatherDependentInput(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t('ui.bizDash3.weatherDependentOnA11y')}
                  accessibilityState={{ selected: policyWeatherDependentInput }}
                >
                  <Text style={[styles.chipText, policyWeatherDependentInput && styles.chipTextSelected]}>{t('ui.bizDash3.on')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, !policyWeatherDependentInput && styles.chipSelected]}
                  onPress={() => setPolicyWeatherDependentInput(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('ui.bizDash3.weatherDependentOffA11y')}
                  accessibilityState={{ selected: !policyWeatherDependentInput }}
                >
                  <Text style={[styles.chipText, !policyWeatherDependentInput && styles.chipTextSelected]}>{t('ui.bizDash3.off')}</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>{t('ui.bizDash3.status')}</Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, policyActiveInput && styles.chipSelected]}
                  onPress={() => setPolicyActiveInput(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t('ui.bizDash3.activeA11y')}
                  accessibilityState={{ selected: policyActiveInput }}
                >
                  <Text style={[styles.chipText, policyActiveInput && styles.chipTextSelected]}>{t('ui.bizDash3.active')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, !policyActiveInput && styles.chipSelected]}
                  onPress={() => setPolicyActiveInput(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('ui.bizDash3.pausedA11y')}
                  accessibilityState={{ selected: !policyActiveInput }}
                >
                  <Text style={[styles.chipText, !policyActiveInput && styles.chipTextSelected]}>{t('ui.bizDash3.paused')}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.submitButton, { marginTop: spacing.md }]}
                onPress={handleSavePolicy}
                disabled={savingPolicy}
                accessibilityLabel={savingPolicy ? t('ui.bizDash3.savingA11y') : t('ui.bizDash3.savePolicyA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{savingPolicy ? t('ui.bizDash3.saving') : t('ui.bizDash3.savePolicy')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPolicyModalVisible(false)} style={{ marginTop: spacing.md, marginBottom: spacing.lg }} accessibilityLabel={t('ui.bizDash3.cancelA11y')} accessibilityRole="button">
                <Text style={styles.modalCloseText}>{t('ui.bizDash3.cancel')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
      <CancellationReasonSheet ask={reasonAsk} onClose={() => setReasonAsk(null)} />
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.md },
  addressBanner: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm,
  },
  addressBannerText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  partnerSelector: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  partnerSelectorText: { ...typography.bodyBold, color: colors.textPrimary },
  sectionTabs: {
    flexDirection: 'row', paddingHorizontal: spacing.lg, gap: spacing.xs,
    borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm,
  },
  sectionTab: { flex: 1, alignItems: 'center', paddingVertical: spacing.xs, borderRadius: radius.md },
  sectionTabActive: { backgroundColor: colors.primaryMuted },
  sectionTabIcon: { fontSize: 16 },
  sectionTabLabel: { color: colors.textTertiary, fontSize: 10, fontWeight: '700', marginTop: 2 },
  sectionTabLabelActive: { color: colors.primary },
  welcomeCard: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  // P2 remediation item 11 -- neutral (colors.surface/border), matching
  // this same file's own briefCard/discoveryTeaser informational-card
  // treatment, not the coral welcomeCard above (that one's a real set of
  // tappable onboarding actions; this one is status-only).
  pendingReviewCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  pendingReviewTitle: { ...typography.headline, color: colors.textPrimary },
  pendingReviewRow: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.xs },
  discoveryTeaser: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  discoveryTeaserText: { color: colors.textPrimary, fontWeight: '700', fontSize: 13, flex: 1 },
  discoveryTeaserChevron: { color: colors.textTertiary, fontSize: 20 },
  briefCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  briefBestOpportunity: { color: colors.primary, fontWeight: '700', fontSize: 14, marginTop: spacing.sm },
  briefSuggestion: { color: colors.textSecondary, fontSize: 13, fontStyle: 'italic' },
  welcomeCardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  welcomeCardTitle: { ...typography.headline, color: colors.textPrimary },
  welcomeCardClose: { color: colors.textTertiary, fontSize: 16, fontWeight: '700', paddingLeft: spacing.sm },
  welcomeCardBody: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.xs, marginBottom: spacing.md },
  welcomeCardStep: { paddingVertical: spacing.xs },
  welcomeCardStepText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statCard: {
    width: '31%', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, alignItems: 'center', ...shadow.card,
  },
  statNumber: { ...typography.title, color: colors.textPrimary },
  statLabel: { color: colors.textTertiary, fontSize: 11, textAlign: 'center', marginTop: 2 },
  homeTileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  homeTile: { flexGrow: 1, flexBasis: '30%', minWidth: 140, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  homeTileLine: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', marginTop: 2 },
  pipelineRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  pipelineStage: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  helperText: { color: colors.textTertiary, fontSize: 12, lineHeight: 18, marginTop: spacing.lg, fontStyle: 'italic' },
  emptyText: { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.md },
  postUpdateButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14,
    alignItems: 'center', marginTop: spacing.xl,
  },
  postUpdateButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  viewProfileLink: { color: colors.primary, fontWeight: '600', fontSize: 14, textAlign: 'center', marginTop: spacing.md },
  createOfferButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, alignSelf: 'flex-start', marginBottom: spacing.md },
  createOfferButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  offerCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  // Business Intelligence Phase 8 -- shared locked-preview treatment,
  // reusing the same primaryMuted/primary-border "hero" language this
  // app's own Home intent box and Best Pick card already established for
  // "this matters, pay attention" -- not a new color language.
  lockedFeatureCard: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.primary,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  lockedFeatureTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 14 },
  lockedFeatureDescription: { color: colors.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 17 },
  lockedFeatureCta: { color: colors.primary, fontSize: 13, fontWeight: '700', marginTop: spacing.sm },
  offerTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 14 },
  offerDescription: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  offerRedemptionCount: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', marginTop: 4 },
  estimatedOwedBanner: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  estimatedOwedLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  estimatedOwedValue: { color: colors.textPrimary, fontSize: 28, fontWeight: '800', marginTop: 2 },
  estimatedOwedDetail: { color: colors.textTertiary, fontSize: 11, marginTop: 4 },
  insightsCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  insightLine: { color: colors.textPrimary, fontSize: 13, marginBottom: 4, lineHeight: 18 },
  opportunityWhen: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 13, marginTop: 4 },
  breakdownText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', marginTop: 4 },
  taskRow: { backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs },
  taskText: { color: colors.textPrimary, fontSize: 13 },
  attachRewardText: { color: colors.primary, fontSize: 11, fontWeight: '700', marginTop: 4 },
  memberHistoryPanel: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  memberHistoryLine: { color: colors.textSecondary, fontSize: 12, marginBottom: 2 },
  messageMemberLink: { color: colors.primary, fontSize: 12, fontWeight: '700', marginTop: spacing.sm },
  notesLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', marginTop: spacing.md, textTransform: 'uppercase' },
  notesInput: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.sm, fontSize: 13, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs, minHeight: 40 },
  smallActionButton: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', minWidth: 80 },
  smallActionButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  growthCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.md,
  },
  growthLine: { color: colors.textPrimary, fontSize: 13, marginBottom: 2 },
  backLink: { color: colors.primary, fontWeight: '700', marginBottom: spacing.md },
  messageBubble: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.sm, marginBottom: spacing.sm, alignSelf: 'flex-start', maxWidth: '80%', borderWidth: 1, borderColor: colors.border },
  messageBubbleFromBusiness: { backgroundColor: colors.primary, alignSelf: 'flex-end', borderColor: colors.primary },
  messageText: { color: colors.textPrimary, fontSize: 14 },
  messageTextFromBusiness: { color: '#fff', fontSize: 14 },
  replyRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  sendReplyButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, justifyContent: 'center' },
  sendReplyButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  gatheringRow: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  modalCloseText: { color: colors.primary, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.md },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  submitButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  submitButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleRowLabel: { ...typography.body, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
});