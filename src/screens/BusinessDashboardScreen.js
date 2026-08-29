import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, Modal, TextInput, Alert, Switch, Keyboard, TouchableWithoutFeedback, KeyboardAvoidingView, Platform, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import QRCode from 'react-native-qrcode-svg';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { getMyBusinessOffers, toggleOfferActive, getMyBusinessGatherings, getBusinessInsights, updateBusinessAddress, updateBusinessProfile, submitBusinessProfileForScreening, submitBusinessOfferForScreening, submitBusinessUpdateForScreening, getRedemptionCounts, getEstimatedAmountOwed, getMyManagedPartner, confirmOfferRedemption, getBusinessDiscoveryStats, setBusinessPriorityAttributes, setBusinessAvailabilityPulse, getBusinessExperiences, createBusinessExperience, updateBusinessExperience, submitBusinessExperienceForScreening, deleteBusinessExperience, setBusinessAccommodations, setBusinessPriorityTimeWindows } from '../services/brandOffers';
import { getBusinessCommunities } from '../services/communities';
import { getBusinessConversations, replyAsBusinessOwner, getBusinessMessagesPage, getBusinessTopMembers, getBusinessVisitFrequency, getBusinessMemberGatheringHistory, getBusinessCustomerNote, saveBusinessCustomerNote } from '../services/brandOffers';
import { getPendingPartnershipRequestsForPartner, respondToBusinessPartnershipRequest } from '../services/businessPartnerships';
import { getBusinessOpportunities, submitBusinessOfferResponseForScreening, declineBusinessOpportunity, submitBusinessAvailabilityForScreening, cancelBusinessAvailability, getMyBusinessAvailability, getAggregatedDemandForPartner, getMyBusinessFulfillmentPolicy, upsertBusinessFulfillmentPolicy, formatOfferSummary, getMissedMatchSummary, getPartnerCategoryOutcomes, MISSED_MATCH_REASON_LABELS } from '../services/businessFulfillment';
import { logBusinessAcquisitionEvent } from '../services/businessAcquisitionEvents';
import { getMyStripeConnectStatus, startStripeOnboarding, isStripeConfigured } from '../services/stripeConnect';
import { getMyReservationProviderStatus, updateReservationProvider } from '../services/reservationProvider';
import { getBusinessEntitlements, hasEntitlement, entitlementLimit, checkLimit, parseEntitlementError, tierDisplayLabel, ENTITLEMENT_FEATURE_LABELS } from '../services/entitlements';
import { captureStoryMedia, uploadBusinessMoment } from '../services/stories';
import { recordBusinessAttributeSuggestion, respondToBusinessAttributeSuggestion, getBusinessAttributeSuggestions, setBusinessPrioritySignal, clearBusinessPrioritySignal, getActiveBusinessPrioritySignals } from '../services/businessIntelligence';
import { scoreBusinessOpportunity } from '../services/businessOpportunityScoring';
// P1 item 7 (CLAUDE.md, Aug 28 Full Coherence Audit): the same real,
// already-deployed async submit-then-poll weather RPC every other
// weather-aware surface already calls -- never a new one.
import { getSocialForecast } from '../services/homeDashboard';
import { computeOfferTypeAcceptanceRates, bestAcceptedOfferType, rankExperiencesForOpportunity } from '../services/businessOfferRecommendation';
import { BUSINESS_CATEGORIES } from './BusinessPartnerApplyScreen';
import { BUSINESS_ATTRIBUTE_OPTIONS, CUISINE_OPTIONS, businessAttributeLabel, cuisineLabel, AVAILABILITY_PULSE_OPTIONS, availabilityPulseLabel, availabilityPulseIcon, isAvailabilityPulseFresh, EXPERIENCE_PRICE_OPTIONS, EXPERIENCE_PARTY_TYPE_OPTIONS, experiencePriceLabel, experiencePartyTypeLabel, ACCOMMODATE_PARTY_TYPE_OPTIONS, PRIORITY_TIME_WINDOW_OPTIONS, priorityTimeWindowLabel } from '../constants/businessAttributes';
import { deriveSignatureExperienceSuggestions } from '../constants/businessExperienceSuggestions';
import { classifyBusinessCategory } from '../constants/businessCategoryClassifier';
import { extractAttributesFromText } from '../constants/businessAttributeExtraction';
import { INTEREST_OPTIONS } from '../constants/gatheringCategories';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

const SECTIONS = [
  { key: 'home', icon: '🏠', label: 'Dashboard' },
  { key: 'gatherings', icon: '🎉', label: 'Gatherings' },
  { key: 'community', icon: '🏘️', label: 'Community' },
  { key: 'requests', icon: '🎯', label: 'Requests' },
  { key: 'insights', icon: '📊', label: 'Insights' },
  { key: 'business', icon: '⚙️', label: 'Business' },
];

const OFFER_TYPE_OPTIONS = [
  { key: 'standard', label: 'Standard' },
  { key: 'discount', label: 'Discount' },
  { key: 'perk', label: 'Perk' },
  { key: 'upgrade', label: 'Upgrade' },
  { key: 'alt_time', label: 'Alt. time' },
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
  { key: '1h', label: '1 hour', hours: 1 },
  { key: '2h', label: '2 hours', hours: 2 },
  { key: '4h', label: '4 hours', hours: 4 },
  { key: 'restOfDay', label: 'Rest of today', hours: null },
];

const AVAILABILITY_STATUS_COPY = {
  active: 'Live — matching open requests',
  filled: 'Filled up',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

export default function BusinessDashboardScreen({ navigation, route }) {
  const { colors, shadow, isDark } = useTheme();
  const styles = getStyles(colors, shadow);
  const [section, setSection] = useState(route?.params?.initialSection ?? 'home');
  const [selectedPartner, setSelectedPartner] = useState(null);
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [addressModalVisible, setAddressModalVisible] = useState(false);
  const [offerRedemptionCounts, setOfferRedemptionCounts] = useState({});
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
  const [editDifferentiatorInput, setEditDifferentiatorInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  // "Business Story" plan, Phase 2 -- Business Goals ("what we want more
  // of"), a lightweight signal distinct from the full Edit Profile form.
  const [priorityAttributesInput, setPriorityAttributesInput] = useState([]);
  // "Business Profile Phase 1" addendum -- the Timing half of "What You
  // Want More Of," saved together with priorityAttributesInput via the
  // same Save button (one card, one action, two RPCs underneath).
  const [priorityTimeWindowsInput, setPriorityTimeWindowsInput] = useState([]);
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
  const [opportunities, setOpportunities] = useState([]);
  const [aggregatedDemand, setAggregatedDemand] = useState([]);
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
        businessAttributes: selectedPartner?.attributes ?? [],
        businessCuisine: selectedPartner?.cuisine ?? null,
        businessPriorityAttributes: selectedPartner?.priority_attributes ?? [],
        businessPriorityTimeWindows: selectedPartner?.priority_time_windows ?? [],
        activePrioritySignals,
        fulfillmentPolicy,
        weather: businessWeather,
      });
      return { ...o, opportunityScore: score, opportunityReasons: reasons };
    });
    const isAwaitingDecision = (o) => o.status === 'pending' && o.business_requests?.status === 'open';
    const awaiting = withScores.filter(isAwaitingDecision).sort((a, b) => b.opportunityScore - a.opportunityScore);
    const resolved = withScores.filter((o) => !isAwaitingDecision(o));
    return [...awaiting, ...resolved];
  }, [opportunities, selectedPartner, activePrioritySignals, fulfillmentPolicy, businessWeather]);
  // Business Intelligence & Opportunity Engine, Phase 3 -- a real,
  // deterministic offer-recommendation ranking, entirely client-side over
  // data this screen already has loaded (this partner's own full
  // opportunity history in `opportunities`, its own active Signature
  // Experiences in `experiences`, its own fulfillment policy) -- no new
  // query, matching Phase 2's own "computed at read time" precedent.
  const offerTypeAcceptance = useMemo(() => computeOfferTypeAcceptanceRates(opportunities), [opportunities]);
  const suggestedOfferType = useMemo(() => bestAcceptedOfferType(offerTypeAcceptance), [offerTypeAcceptance]);
  const [respondingOpportunityId, setRespondingOpportunityId] = useState(null);
  const [offerModalRequestId, setOfferModalRequestId] = useState(null);
  const [myAvailability, setMyAvailability] = useState([]);
  const [postAvailabilityModalVisible, setPostAvailabilityModalVisible] = useState(false);
  const [availabilityTitleInput, setAvailabilityTitleInput] = useState('');
  const [availabilityDescriptionInput, setAvailabilityDescriptionInput] = useState('');
  const [availabilityCategoryInput, setAvailabilityCategoryInput] = useState(null);
  const [availabilityOfferTypeInput, setAvailabilityOfferTypeInput] = useState('standard');
  const [availabilityPriceInput, setAvailabilityPriceInput] = useState('');
  const [availabilityCapacityInput, setAvailabilityCapacityInput] = useState('');
  const [availabilityDurationKey, setAvailabilityDurationKey] = useState('2h');
  const [postingAvailability, setPostingAvailability] = useState(false);
  const [cancelingAvailabilityId, setCancelingAvailabilityId] = useState(null);
  // "The Offer System" Phase 2 (see CLAUDE.md's own plan, Gap 2): a real,
  // standing fulfillment policy the owner sets once, instead of a
  // one-time availability posting.
  const [fulfillmentPolicy, setFulfillmentPolicy] = useState(null);
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
      requestPartyType: offerModalRequest.gatherings?.party_type ?? null,
      requestPriceLevel: offerModalRequest.gatherings?.price_level ?? null,
      requestPartySize: offerModalRequest.party_size ?? null,
      experiences,
      fulfillmentPolicy,
    });
  }, [offerModalRequest, experiences, fulfillmentPolicy]);
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
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [offerTypeInput, setOfferTypeInput] = useState('standard');
  const [offerDescriptionInput, setOfferDescriptionInput] = useState('');
  const [offerPriceInput, setOfferPriceInput] = useState('');
  // Only meaningful when offerTypeInput === 'alt_time' -- proposedTime
  // stays null for every other offer type, matching submit_business_
  // offer's own default. Previously the "Alt. time" chip changed the
  // stored offer_type with no attached time input anywhere (PRODUCT_AUDIT/
  // INTENT_LAYER_UX_WALKTHROUGH_2026-08-14.md, finding 3).
  const [offerProposedTime, setOfferProposedTime] = useState(null);
  const [showOfferTimePicker, setShowOfferTimePicker] = useState(false);
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
  // P1 item 7 (CLAUDE.md, Aug 28 Full Coherence Audit): supplementary,
  // non-blocking -- null until the business's own real coordinates are
  // known AND the async weather request resolves. scoreBusinessOpportunity()
  // already treats a null weather as "no bonus, ever," so a business with
  // no address set (or before this resolves) sees the ranking exactly as
  // it always has, never a stuck/loading state.
  const [businessWeather, setBusinessWeather] = useState(null);

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
      Alert.alert('Error', e.message);
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
      Alert.alert('Error', e.message);
    }
    setSavingReservationProvider(false);
  }

  function handleDisconnectReservationProvider() {
    if (!selectedPartner) return;
    Alert.alert('Remove reservation provider?', 'This just clears what you told us -- nothing about your real bookings changes.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await updateReservationProvider(selectedPartner.id, null, null);
            setReservationProviderStatus({ ...reservationProviderStatus, provider: null, venueId: null, connectedAt: null });
          } catch (e) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  }

  async function handleUpdateAddress() {
    if (!addressInput.trim()) return;
    setSavingAddress(true);
    try {
      await updateBusinessAddress(selectedPartner.id, addressInput.trim());
      setSelectedPartner((prev) => ({ ...prev, address: addressInput.trim() }));
      setAddressModalVisible(false);
      Alert.alert('Saved', 'Your business address is now set — offers will show to people nearby, and your business will now appear on the map.');
    } catch (e) {
      Alert.alert('Error', e.message);
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
        }));
        setEditProfileModalVisible(false);
        Alert.alert('Saved', 'Your business profile has been updated.');
        logBusinessAcquisitionEvent(sessionId, 'profile_completed', { partnerId: selectedPartner.id });
      } else if (result.blocked) {
        Alert.alert(
          "Couldn't Publish",
          "This content couldn't be published — it was flagged during a routine content check. If you think this is a mistake, please reach out to support."
        );
      } else {
        setEditProfileModalVisible(false);
        Alert.alert(
          'Submitted for Review',
          "Your changes are being reviewed before they go live — this is usually quick. Your current profile stays visible in the meantime."
        );
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSavingProfile(false);
  }

  // "Business Story" plan, Phase 2 -- a real, small, dedicated save,
  // distinct from the full Edit Profile form since this is meant to be
  // revisited often, not part of an identity edit. "Business Profile
  // Phase 1" addendum: also saves priorityTimeWindowsInput in the same
  // tap -- one card, one Save button, two RPCs underneath (the two
  // fields live in separate columns/RPCs since "customers you want" and
  // "when you want them" are genuinely different vocabularies).
  async function handleSavePriorityAttributes() {
    if (!selectedPartner) return;
    setSavingPriorityAttributes(true);
    try {
      await Promise.all([
        setBusinessPriorityAttributes(selectedPartner.id, priorityAttributesInput),
        setBusinessPriorityTimeWindows(selectedPartner.id, priorityTimeWindowsInput),
      ]);
      setSelectedPartner((prev) => ({
        ...prev,
        priority_attributes: priorityAttributesInput,
        priority_time_windows: priorityTimeWindowsInput,
      }));
      Alert.alert('Saved', "We'll flag opportunities that match what you're looking for.");
    } catch (e) {
      Alert.alert('Error', e.message);
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
      Alert.alert('Error', e.message);
    }
    setSavingBoost(false);
  }

  async function handleClearBoost(signalId) {
    try {
      await clearBusinessPrioritySignal(signalId);
      setActivePrioritySignals((prev) => prev.filter((s) => s.id !== signalId));
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  // "Business Profile Phase 1" addendum -- "What You Can Accommodate."
  async function handleSaveAccommodations() {
    if (!selectedPartner) return;
    setSavingAccommodations(true);
    try {
      await setBusinessAccommodations(selectedPartner.id, accommodatePartyTypesInput);
      setSelectedPartner((prev) => ({ ...prev, accommodates_party_types: accommodatePartyTypesInput }));
    } catch (e) {
      Alert.alert('Error', e.message);
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
      Alert.alert('Error', e.message);
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
          'Extracted from what you typed via Teach Nearby.'
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
      Alert.alert('Added to your profile', 'These now show up under "Why People Choose Us."');
    } catch (e) {
      Alert.alert('Error', e.message);
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
      Alert.alert('Error', e.message);
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
          `Upgrade for More Signature Experiences`,
          `Your current plan is capped at ${limit} Signature Experience${limit === 1 ? '' : 's'}. Real plan upgrades aren’t available yet -- we’ll let you know the moment pricing is live.`
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
      const result = await submitBusinessExperienceForScreening(selectedPartner.id, {
        experienceId: editingExperienceId ?? null,
        title: expTitleInput.trim(),
        description: expDescriptionInput.trim() || null,
        icon: expIconInput.trim() || null,
        attributes: expAttributesInput,
        priceLevel: expPriceLevelInput,
        partyType: expPartyTypeInput,
      });

      if (result.published) {
        await loadExperiences(selectedPartner.id);
        setExperienceModalVisible(false);
      } else if (result.blocked) {
        Alert.alert(
          "Couldn't Publish",
          "This content couldn't be published — it was flagged during a routine content check. If you think this is a mistake, please reach out to support."
        );
      } else {
        setExperienceModalVisible(false);
        Alert.alert(
          'Submitted for Review',
          editingExperienceId
            ? "Your changes are being reviewed before they go live — this is usually quick. The current version stays visible in the meantime."
            : "This experience is being reviewed before it goes live — this is usually quick."
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
      } else {
        Alert.alert('Error', e.message);
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
    } catch (e) {
      const entitlementError = parseEntitlementError(e);
      if (entitlementError?.kind === 'limit') {
        showUpgradePlaceholder(entitlementError.feature);
      } else {
        Alert.alert('Error', e.message);
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
      });
      await loadExperiences(selectedPartner.id);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  function handleDeleteExperience(experience) {
    Alert.alert('Remove this experience?', `"${experience.title}" will be permanently removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteBusinessExperience(experience.id);
            await loadExperiences(selectedPartner.id);
          } catch (e) {
            Alert.alert('Error', e.message);
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
    try {
      await Share.share({
        message: `Check out ${selectedPartner.name} on Nearby — nearby://business/${selectedPartner.id}`,
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
        loadAggregatedDemand(selectedPartner.id);
        loadMyAvailability(selectedPartner.id);
        loadFulfillmentPolicy(selectedPartner.id);
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
    const label = ENTITLEMENT_FEATURE_LABELS[feature] ?? feature;
    Alert.alert(
      `Upgrade for ${label}`,
      'Real plan upgrades aren’t available yet -- we’ll let you know the moment pricing is live.'
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
    const label = ENTITLEMENT_FEATURE_LABELS[feature] ?? feature;
    return (
      <TouchableOpacity style={styles.lockedFeatureCard} onPress={() => showUpgradePlaceholder(feature)} activeOpacity={0.8}>
        <Text style={styles.lockedFeatureTitle}>🔒 {label}</Text>
        {description ? <Text style={styles.lockedFeatureDescription}>{description}</Text> : null}
        <Text style={styles.lockedFeatureCta}>See what you get →</Text>
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
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
    }
  }

  // Nearby 2.0 vision layer 1, "Aggregated demand -> business
  // opportunities" (see CLAUDE.md's "Nearby 2.0 Vision" doc): real,
  // quantified nearby demand rolled up by category, not one-request-at-a-
  // time. Honestly empty until real request volume exists nearby -- never
  // padded to look more populated than it is.
  async function loadAggregatedDemand(partnerId) {
    try {
      const results = await getAggregatedDemandForPartner(partnerId);
      setAggregatedDemand(results);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
    }
  }

  function openOfferModal(requestId) {
    setOfferModalRequestId(requestId);
    setOfferTypeInput('standard');
    setOfferDescriptionInput('');
    setOfferPriceInput('');
    setOfferProposedTime(null);
    setShowOfferTimePicker(false);
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
    if (suggestedOfferType) {
      if (suggestedOfferType.offerType !== 'alt_time') setOfferProposedTime(null);
      setOfferTypeInput(suggestedOfferType.offerType);
    }
  }

  function applySuggestedOfferType() {
    if (!suggestedOfferType) return;
    if (suggestedOfferType.offerType !== 'alt_time') setOfferProposedTime(null);
    setOfferTypeInput(suggestedOfferType.offerType);
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
  async function handleSubmitOffer() {
    if (!offerDescriptionInput.trim()) {
      Alert.alert('Add a description', 'Say what you can offer.');
      return;
    }
    if (offerTypeInput === 'alt_time' && !offerProposedTime) {
      Alert.alert('Pick a time', 'Choose the time you’re proposing instead.');
      return;
    }
    setRespondingOpportunityId(offerModalRequestId);
    try {
      const priceNum = offerPriceInput.trim() ? parseFloat(offerPriceInput.trim()) : null;
      const result = await submitBusinessOfferResponseForScreening(selectedPartner.id, offerModalRequestId, {
        offerType: offerTypeInput,
        offerDescription: offerDescriptionInput.trim(),
        offerPrice: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : null,
        proposedTime: offerTypeInput === 'alt_time' && offerProposedTime ? offerProposedTime.toISOString() : null,
      });

      if (result.published) {
        setOfferModalRequestId(null);
        await loadOpportunities(selectedPartner.id);
      } else if (result.blocked) {
        Alert.alert(
          "Couldn't Send",
          "This content couldn't be sent — it was flagged during a routine content check. If you think this is a mistake, please reach out to support."
        );
      } else {
        setOfferModalRequestId(null);
        Alert.alert(
          'Submitted for Review',
          'Your response is being reviewed before it’s sent — this is usually quick.'
        );
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setRespondingOpportunityId(null);
  }

  async function handleDeclineOpportunity(requestId) {
    setRespondingOpportunityId(requestId);
    try {
      await declineBusinessOpportunity(requestId);
      await loadOpportunities(selectedPartner.id);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setRespondingOpportunityId(null);
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
    setPolicyModalVisible(true);
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
    if (!checkedAtIso) return 'not checked yet';
    const minutes = Math.max(0, Math.round((Date.now() - new Date(checkedAtIso).getTime()) / 60000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    return `${hours}h ago`;
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
      });
      setPolicyModalVisible(false);
      await loadFulfillmentPolicy(selectedPartner.id);
    } catch (e) {
      Alert.alert('Error', e.message);
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
    const category = prefill?.category ?? null;
    const period = prefill?.dominantPeriod ?? null;
    setAvailabilityTitleInput(
      category ? (period ? `${category} available this ${period}` : `${category} available`) : ''
    );
    setAvailabilityDescriptionInput('');
    setAvailabilityCategoryInput(category);
    setAvailabilityOfferTypeInput('standard');
    setAvailabilityPriceInput('');
    setAvailabilityCapacityInput('');
    setAvailabilityDurationKey('2h');
    setPostAvailabilityModalVisible(true);
  }

  // Decision 6, Phase 3 -- same three-branch screening shape as the other
  // three handlers in this file. Deliberately no longer computes
  // startsAt/endsAt client-side -- durationHours (null meaning "rest of
  // today") is sent instead, and the Edge Function computes the real
  // window at the actual moment of publish (this call's own LOW-tier
  // path, or a later admin approval), so a held submission never
  // publishes with a stale, submission-time window.
  async function handlePostAvailability() {
    if (!availabilityTitleInput.trim()) {
      Alert.alert('Add a title', 'Say what you have available, e.g. "4 empty tables tonight".');
      return;
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
      });

      if (result.published) {
        setPostAvailabilityModalVisible(false);
        await loadMyAvailability(selectedPartner.id);
        const matchedCount = result.matchedCount ?? 0;
        Alert.alert(
          'Posted!',
          matchedCount > 0
            ? `We matched this against ${matchedCount} open request${matchedCount === 1 ? '' : 's'} nearby -- they'll see your offer right away.`
            : 'No open requests match this right now, but it stays live for anyone who asks while it\'s active.'
        );
      } else if (result.blocked) {
        Alert.alert(
          "Couldn't Post",
          "This content couldn't be published — it was flagged during a routine content check. If you think this is a mistake, please reach out to support."
        );
      } else {
        setPostAvailabilityModalVisible(false);
        Alert.alert(
          'Submitted for Review',
          'This availability posting is being reviewed before it goes live — this is usually quick.'
        );
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setPostingAvailability(false);
  }

  async function handleCancelAvailability(availabilityId) {
    setCancelingAvailabilityId(availabilityId);
    try {
      await cancelBusinessAvailability(availabilityId);
      await loadMyAvailability(selectedPartner.id);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setCancelingAvailabilityId(null);
  }

  async function handleRespondToPartnershipRequest(requestId, approve) {
    setRespondingToRequestId(requestId);
    try {
      await respondToBusinessPartnershipRequest(requestId, approve);
      setPartnershipRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (e) {
      Alert.alert('Error', e.message);
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
      Alert.alert('Error', e.message);
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
    const page = await getBusinessMessagesPage(selectedPartner.id, userId).catch(() => []);
    setConversationMessages([...page].reverse());
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
      Alert.alert('Error', e.message);
    }
  }

  async function loadInsights(partnerId) {
    try {
      const result = await getBusinessInsights(partnerId);
      setInsights(result);
      const owed = await getEstimatedAmountOwed(partnerId).catch(() => ({ redemptionCount: 0, estimatedAmount: 0 }));
      setEstimatedOwed(owed);
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
    return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
      ? new Date(`${br.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : null;
    if (br?.gathering_id && br?.gatherings) {
      return { kicker: '🎉 A Gathering', title: br.gatherings.title, when: br.gatherings.scheduled_at ? formatDate(br.gatherings.scheduled_at) : soloWhen };
    }
    if (br?.match_id) {
      return { kicker: '❤️ A Date', title: 'Two people planning to visit', when: soloWhen };
    }
    return { kicker: '🙋 A Request', title: br?.raw_text ?? 'A visit', when: soloWhen };
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
      Alert.alert('Posted', 'Your moment is live for the next 24 hours — people nearby will see it under "Happening Nearby" on Discover.');
    } catch (e) {
      const entitlementError = parseEntitlementError(e);
      if (entitlementError) {
        showUpgradePlaceholder(entitlementError.feature);
      } else {
        Alert.alert('Error', e.message);
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
      return Alert.alert('Title required', 'Give your update a short title.');
    }
    setPostingUpdate(true);
    try {
      const result = await submitBusinessUpdateForScreening(selectedPartner.id, updateTitle.trim(), updateBody.trim() || null);

      if (result.published) {
        setUpdateModalVisible(false);
        setUpdateTitle('');
        setUpdateBody('');
        Alert.alert('Sent', 'Your followers have been notified.');
      } else if (result.blocked) {
        Alert.alert(
          "Couldn't Send",
          "This content couldn't be sent — it was flagged during a routine content check. If you think this is a mistake, please reach out to support."
        );
      } else {
        setUpdateModalVisible(false);
        Alert.alert(
          'Submitted for Review',
          'This update is being reviewed before it’s sent to your followers — this is usually quick.'
        );
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setPostingUpdate(false);
  }

  async function handleCreateOffer() {
    if (!newTitle.trim()) {
      return Alert.alert('Title required', 'Give your offer a title.');
    }
    if (unlockEnabled) {
      const minMembers = parseInt(newUnlockMinMembers.trim(), 10);
      if (!minMembers || minMembers < 1) {
        return Alert.alert('Minimum required', 'Enter how many members are needed to unlock this offer.');
      }
      if (!offerGatheringId && !unlockCommunityId) {
        return Alert.alert('Pick a community', 'Choose which of your communities this offer unlocks with.');
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
          "Couldn't Publish",
          "This content couldn't be published — it was flagged during a routine content check. If you think this is a mistake, please reach out to support."
        );
      } else {
        setCreateModalVisible(false);
        Alert.alert(
          'Submitted for Review',
          'This offer is being reviewed before it goes live — this is usually quick.'
        );
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSubmitting(false);
  }

  async function handleToggleActive(offer) {
    try {
      await toggleOfferActive(offer.id, !offer.active);
      loadOffers(selectedPartner.id);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleConfirmRedemption() {
    if (!redemptionCodeInput.trim()) return;
    setConfirmingCode(true);
    try {
      const result = await confirmOfferRedemption(redemptionCodeInput);
      if (result.success) {
        Alert.alert('Confirmed', `${result.redeemedByName ?? 'This customer'}'s redemption of "${result.offerTitle}" is confirmed.`);
        setRedemptionCodeInput('');
        loadOffers(selectedPartner.id);
      } else {
        Alert.alert('Not confirmed', result.error || "That code doesn't match a pending redemption.");
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setConfirmingCode(false);
    }
  }

  function formatHour(hour) {
    if (hour === null || hour === undefined) return null;
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    return `${displayHour}:00 ${period}`;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Business Mode</Text>
          <TouchableOpacity
            onPress={() => setSection('inbox_modal')}
            accessibilityLabel="Messages"
            accessibilityRole="button"
          >
            <Text style={{ fontSize: 22 }}>💬</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.partnerSelector} accessibilityLabel={selectedPartner?.name ?? 'No business found for this account'}>
          <Text style={styles.partnerSelectorText}>{selectedPartner?.name ?? 'No business found for this account'}</Text>
        </View>
      </View>
      {selectedPartner && (
        <TouchableOpacity
          style={styles.addressBanner}
          onPress={() => {
            setAddressInput(selectedPartner.address ?? '');
            setAddressModalVisible(true);
          }}
          activeOpacity={0.85}
          accessibilityLabel={selectedPartner.address ? `Address: ${selectedPartner.address}, tap to edit` : 'Set your business address so offers show to people nearby'}
          accessibilityRole="button"
        >
          <Text style={styles.addressBannerText}>
            {selectedPartner.address ? `📍 ${selectedPartner.address}` : '📍 Set your address so offers reach people nearby'}
          </Text>
        </TouchableOpacity>
      )}
      <View style={styles.sectionTabs}>
        {SECTIONS.map((s) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.sectionTab, section === s.key && styles.sectionTabActive]}
            onPress={() => setSection(s.key)}
            accessibilityLabel={s.label}
            accessibilityRole="button"
            accessibilityState={{ selected: section === s.key }}
          >
            <Text style={styles.sectionTabIcon}>{s.icon}</Text>
            <Text style={[styles.sectionTabLabel, section === s.key && styles.sectionTabLabelActive]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : loadError ? (
          <LoadErrorState message="Couldn't load your business dashboard." onRetry={loadMyPartner} />
        ) : (
          <>
            {section === 'home' && (
              <>
                {showWelcomeCard && (
                  <View style={styles.welcomeCard}>
                    <View style={styles.welcomeCardHeaderRow}>
                      <Text style={styles.welcomeCardTitle}>👋 Welcome to your dashboard</Text>
                      <TouchableOpacity onPress={dismissWelcomeCard} accessibilityLabel="Dismiss welcome card" accessibilityRole="button">
                        <Text style={styles.welcomeCardClose}>✕</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.welcomeCardBody}>
                      Here's how to get the most out of Nearby, in order:
                    </Text>
                    <TouchableOpacity
                      style={styles.welcomeCardStep}
                      onPress={() => setSection('requests')}
                      accessibilityLabel="See real demand near you"
                      accessibilityRole="button"
                    >
                      <Text style={styles.welcomeCardStepText}>📊 See real demand near you →</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.welcomeCardStep}
                      onPress={() => setCreateModalVisible(true)}
                      accessibilityLabel="Post your first offer"
                      accessibilityRole="button"
                    >
                      <Text style={styles.welcomeCardStepText}>🎁 Post your first offer →</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.welcomeCardStep}
                      onPress={() => {
                        setEditNameInput(selectedPartner?.name ?? '');
                        setEditDescriptionInput(selectedPartner?.description ?? '');
                        setEditLogoUrlInput(selectedPartner?.logo_url ?? '');
                        setEditCategoryInput(selectedPartner?.category ?? null);
                        setEditAttributesInput(selectedPartner?.attributes ?? []);
                        setEditCuisineInput(selectedPartner?.cuisine ?? null);
                        setEditDifferentiatorInput(selectedPartner?.differentiator ?? '');
                        setEditProfileModalVisible(true);
                      }}
                      accessibilityLabel="Complete your business profile"
                      accessibilityRole="button"
                    >
                      <Text style={styles.welcomeCardStepText}>✏️ Complete your profile →</Text>
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
                    accessibilityLabel={`${discoveryStats.views_last_30_days} people found you in the last 30 days — tap for the full breakdown`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.discoveryTeaserText}>
                      👀 {discoveryStats.views_last_30_days} people found you in the last 30 days
                    </Text>
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
                  const pendingCount = opportunities.filter((o) => o.status === 'pending' && o.business_requests?.status === 'open').length;
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
                    suggestion = { text: "Add what makes you different — it's one of the strongest signals people use to pick you.", onPress: () => setEditProfileModalVisible(true) };
                  } else if ((selectedPartner.attributes ?? []).length === 0) {
                    // "Business Profile Phase 1" addendum -- a real, empty
                    // "Why People Choose Us" is genuinely worth flagging
                    // before the softer signals below it.
                    suggestion = { text: "Tell us why people choose you — it shows up on your public profile.", onPress: () => setEditProfileModalVisible(true) };
                  } else if ((selectedPartner.accommodates_party_types ?? []).length === 0 && !fulfillmentPolicy) {
                    suggestion = { text: "Tell Nearby what you can accommodate so we send you requests that actually fit.", onPress: () => setSection('business') };
                  } else if (!isAvailabilityPulseFresh(selectedPartner.availability_pulse_updated_at)) {
                    suggestion = { text: "Set your availability so people know you're open right now.", onPress: () => setSection('business') };
                  } else if (pendingCount > 0) {
                    suggestion = { text: `${pendingCount} request${pendingCount === 1 ? ' is' : 's are'} waiting for a reply.`, onPress: () => setSection('requests') };
                  } else if (bestGap) {
                    const realCount = Number(bestGap.request_count);
                    const gapText = realCount > 0
                      ? `${realCount} ${realCount === 1 ? 'person' : 'people'} nearby wanted ${bestGap.category} — something you don't currently offer.`
                      : `${bestGap.unmet_intent_count} recent ${Number(bestGap.unmet_intent_count) === 1 ? 'search' : 'searches'} nearby for ${bestGap.category} — something you don't currently offer.`;
                    suggestion = { text: gapText, onPress: () => openPostAvailabilityModal({ category: bestGap.category, dominantPeriod: bestGap.dominant_period }) };
                  }
                  return (
                    <View style={styles.briefCard}>
                      <Text style={styles.sectionHeader}>Today at {selectedPartner.name}</Text>
                      {(totalDemand > 0 || pendingCount > 0) ? (
                        <>
                          {totalDemand > 0 && (
                            <Text style={styles.offerDescription}>
                              {totalDemand} {totalDemand === 1 ? 'person is' : 'people are'} looking for something nearby that you offer.
                            </Text>
                          )}
                          {bestDemand && bestDemand.request_count > 0 && (
                            <TouchableOpacity onPress={() => setSection('requests')} accessibilityLabel="View your best opportunity" accessibilityRole="button">
                              <Text style={styles.briefBestOpportunity}>
                                🎯 Your best opportunity: {bestDemand.category} ({bestDemand.request_count} {Number(bestDemand.request_count) === 1 ? 'request' : 'requests'})
                              </Text>
                            </TouchableOpacity>
                          )}
                        </>
                      ) : (
                        <Text style={styles.offerDescription}>No real demand nearby yet — this fills in as people ask for things you offer.</Text>
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
                  <Text style={styles.sectionHeader}>Community Health</Text>
                  <View style={styles.statsGrid}>
                    <View style={styles.statCard}>
                      <Text style={styles.statNumber}>{stats.total_followers}</Text>
                      <Text style={styles.statLabel}>Followers</Text>
                    </View>
                    <View style={styles.statCard}>
                      <Text style={styles.statNumber}>{stats.followers_this_month}</Text>
                      <Text style={styles.statLabel}>New This Month</Text>
                    </View>
                    <View style={styles.statCard}>
                      <Text style={styles.statNumber}>{stats.total_redemptions}</Text>
                      <Text style={styles.statLabel}>Total Redemptions</Text>
                    </View>
                    <View style={styles.statCard}>
                      <Text style={styles.statNumber}>{stats.redemptions_this_month}</Text>
                      <Text style={styles.statLabel}>This Month</Text>
                    </View>
                    <View style={styles.statCard}>
                      <Text style={styles.statNumber}>{stats.repeat_redeemers}</Text>
                      <Text style={styles.statLabel}>Repeat Customers</Text>
                    </View>
                  </View>
                  <Text style={styles.helperText}>
                    These reflect people who opted in and genuinely engaged with your offers — not raw traffic or impressions.
                  </Text>
                  {growth && (growth.redemptions_growth_pct !== null || growth.followers_growth_pct !== null) && (
                    <View style={styles.growthCard}>
                      {growth.redemptions_growth_pct !== null && (
                        <Text style={styles.growthLine}>
                          Redemptions {growth.redemptions_growth_pct >= 0 ? '+' : ''}{growth.redemptions_growth_pct}% vs. last month
                        </Text>
                      )}
                      {growth.followers_growth_pct !== null && (
                        <Text style={styles.growthLine}>
                          Followers {growth.followers_growth_pct >= 0 ? '+' : ''}{growth.followers_growth_pct}% vs. last month
                        </Text>
                      )}
                    </View>
                  )}

                  {needsAttention.length > 0 && (
                    <>
                      <Text style={styles.sectionHeader}>Needs Attention</Text>
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
                    accessibilityLabel="Post an update to your followers"
                    accessibilityRole="button"
                  >
                    <Text style={styles.postUpdateButtonText}>📣 Post Update to Followers</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.postUpdateButton, { marginTop: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary }]}
                    onPress={handlePostMoment}
                    disabled={postingMoment}
                    accessibilityLabel="Post a real-time photo or video moment, visible to people nearby for 24 hours"
                    accessibilityRole="button"
                  >
                    {postingMoment ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : entitlements && !hasEntitlement(entitlements, 'business_moments') ? (
                      <Text style={[styles.postUpdateButtonText, { color: colors.primary }]}>🔒 Post a Moment — Growth feature</Text>
                    ) : (
                      <Text style={[styles.postUpdateButtonText, { color: colors.primary }]}>🔴 Post a Moment (visible 24h)</Text>
                    )}
                  </TouchableOpacity>

                  {selectedPartner && (
                    <TouchableOpacity
                      onPress={() => navigation.navigate('BusinessProfile', { partnerId: selectedPartner.id })}
                      accessibilityLabel="View your public business profile"
                      accessibilityRole="button"
                    >
                      <Text style={styles.viewProfileLink}>👀 View Public Profile →</Text>
                    </TouchableOpacity>
                  )}
                  {selectedPartner && (
                    <TouchableOpacity
                      onPress={() => setQrModalVisible(true)}
                      accessibilityLabel="Share your QR code"
                      accessibilityRole="button"
                      style={{ marginTop: spacing.sm }}
                    >
                      <Text style={styles.viewProfileLink}>📱 Share Your QR Code →</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <Text style={styles.emptyText}>No data yet for this business.</Text>
              )}
              </>
            )}

            {section === 'gatherings' && (
              gatherings.length === 0 ? (
                <Text style={styles.emptyText}>No gatherings hosted yet — create one from the Create tab and it'll show up here.</Text>
              ) : (
                gatherings.map((g) => {
                  const breakdown = gatheringBreakdowns[g.id];
                  const isUpcoming = new Date(g.scheduled_at) >= new Date();
                  const attachedOffer = offers.find((o) => o.gathering_id === g.id);
                  return (
                    <TouchableOpacity
                      key={g.id}
                      style={styles.gatheringRow}
                      onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                      activeOpacity={0.85}
                      accessibilityLabel={`View and manage ${g.title}`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.offerTitle}>{g.title}{g.recurrence_rule ? ` (${g.recurrence_rule})` : ''}</Text>
                      <Text style={styles.offerDescription}>{isUpcoming ? 'Next: ' : 'Last: '}{formatDate(g.scheduled_at)}</Text>
                      {attachedOffer ? (
                        <Text style={styles.breakdownText}>🎁 {attachedOffer.title}</Text>
                      ) : isUpcoming && (
                        <TouchableOpacity
                          onPress={() => {
                            setOfferGatheringId(g.id);
                            setCreateModalVisible(true);
                          }}
                          accessibilityLabel={`Attach a reward to ${g.title}`}
                          accessibilityRole="button"
                        >
                          <Text style={styles.attachRewardText}>+ Attach Reward</Text>
                        </TouchableOpacity>
                      )}
                      {breakdown && breakdown.total_attending > 0 && (
                        <Text style={styles.breakdownText}>
                          {breakdown.total_attending} attending · {breakdown.new_attendees} new to you · {breakdown.returning_attendees} returning
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })
              )
            )}

            {section === 'community' && (
              <>
                {partnershipRequests.length > 0 && (
                  <>
                    <Text style={styles.sectionHeader}>Partnership Requests</Text>
                    {partnershipRequests.map((r) => (
                      <View key={r.id} style={styles.gatheringRow}>
                        <Text style={styles.offerTitle}>
                          {r.requesterName ?? 'Someone'} wants to partner {r.targetType === 'gathering' ? 'for' : 'with'} {r.targetTitle ?? `their ${r.targetType}`}
                        </Text>
                        <Text style={styles.breakdownText}>{r.targetType === 'gathering' ? '🎉 Gathering' : '👥 Community'}</Text>
                        {r.message ? <Text style={styles.offerDescription}>"{r.message}"</Text> : null}
                        <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
                          <TouchableOpacity
                            style={[styles.smallActionButton, { backgroundColor: colors.primary, marginRight: spacing.sm }]}
                            onPress={() => handleRespondToPartnershipRequest(r.id, true)}
                            disabled={respondingToRequestId === r.id}
                            accessibilityLabel={`Approve partnership request from ${r.requesterName ?? 'requester'}`}
                            accessibilityRole="button"
                          >
                            {respondingToRequestId === r.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.smallActionButtonText}>Approve</Text>}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated }]}
                            onPress={() => handleRespondToPartnershipRequest(r.id, false)}
                            disabled={respondingToRequestId === r.id}
                            accessibilityLabel={`Decline partnership request from ${r.requesterName ?? 'requester'}`}
                            accessibilityRole="button"
                          >
                            <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>Decline</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </>
                )}

                {communities.length === 0 ? (
                  <Text style={styles.emptyText}>No communities yet — create one from the Create tab and it'll show up here.</Text>
                ) : (
                  communities.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      style={styles.gatheringRow}
                      onPress={() => navigation.navigate('CommunityDetail', { communityId: c.id, communityName: c.name })}
                      activeOpacity={0.85}
                      accessibilityLabel={`View and manage ${c.name}`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.offerTitle}>{c.name}</Text>
                      <Text style={styles.breakdownText}>{c.memberCount} member{c.memberCount === 1 ? '' : 's'}</Text>
                      {c.description ? <Text style={styles.offerDescription}>{c.description}</Text> : null}
                    </TouchableOpacity>
                  ))
                )}

                {topMembers.length > 0 && (
                  <>
                    <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>Most Engaged</Text>
                    {topMembers.map((m, i) => (
                      <TouchableOpacity
                        key={m.user_id}
                        style={styles.gatheringRow}
                        onPress={() => handleToggleMemberHistory(m)}
                        accessibilityLabel={`${m.display_name}, ${m.gatherings_attended} gatherings attended, tap to see visit history`}
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
                              accessibilityLabel={`Message ${m.display_name}`}
                              accessibilityRole="button"
                            >
                              <Text style={styles.messageMemberLink}>💬 Message {m.display_name}</Text>
                            </TouchableOpacity>
                            <Text style={styles.notesLabel}>Notes (only you can see this)</Text>
                            <TextInput
                              style={styles.notesInput}
                              placeholder="e.g. Regular, prefers the window table..."
                              placeholderTextColor={colors.textTertiary}
                              value={noteDraft}
                              onChangeText={setNoteDraft}
                              multiline
                              accessibilityLabel={`Notes about ${m.display_name}`}
                            />
                            <TextInput
                              style={[styles.notesInput, { marginTop: spacing.xs }]}
                              placeholder="Tags, comma separated (e.g. vip, regular)"
                              placeholderTextColor={colors.textTertiary}
                              value={tagsDraft}
                              onChangeText={setTagsDraft}
                              autoCapitalize="none"
                              accessibilityLabel={`Tags for ${m.display_name}`}
                            />
                            <TouchableOpacity
                              onPress={() => handleSaveNote(m)}
                              disabled={savingNote}
                              style={{ marginTop: spacing.xs }}
                              accessibilityLabel="Save note"
                              accessibilityRole="button"
                            >
                              <Text style={styles.messageMemberLink}>{savingNote ? 'Saving...' : '💾 Save Note'}</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </>
            )}

            {section === 'requests' && (
              <>
                {opportunities.filter((o) => o.status === 'accepted').length > 0 && (
                  <View style={{ marginBottom: spacing.lg }}>
                    <Text style={styles.sectionHeader}>📅 Upcoming Nearby Visits</Text>
                    <Text style={styles.helperText}>
                      Real, confirmed visits headed your way -- accepted, not yet marked
                      complete.
                    </Text>
                    {opportunities.filter((o) => o.status === 'accepted').map((o) => {
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
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Business Intelligence & Opportunity Engine, Phase 2 --
                    "Match Radar" (spec item 13) reframe: get_aggregated_
                    demand_for_partner() already IS Match Radar (locked
                    plan's own audit finding) -- this is a real naming
                    alignment only, no new data, no new query. */}
                <Text style={styles.sectionHeader}>📊 Match Radar</Text>
                <Text style={styles.helperText}>
                  Real open requests within reach of your business right now, grouped by
                  category -- a quantified early signal, not a review score. Categories marked
                  🟡 are a softer signal: real recent searches nearby that found nothing, not a
                  confirmed request. A 🆕 marker means real demand exists in a category you've
                  never actually offered (no availability posted, no offer ever accepted there).
                  Reads near-zero until there's real volume nearby, which is expected this early
                  on.
                </Text>
                {entitlements && !hasEntitlement(entitlements, 'advanced_match_radar') && (
                  renderLockedFeature('advanced_match_radar', "Unlock the 🟡 unmet-intent signal and 🆕 demand-gap detection above -- see real searches nearby that found nothing, and categories you don't currently offer but people are asking for.")
                )}
                {aggregatedDemand.length === 0 ? (
                  <Text style={styles.emptyText}>No aggregated demand nearby yet.</Text>
                ) : (
                  aggregatedDemand.map((d) => (
                    <View key={d.category} style={styles.gatheringRow}>
                      {d.request_count > 0 ? (
                        <Text style={styles.offerTitle}>
                          {d.request_count} {d.request_count === 1 ? 'person is' : 'people are'} looking for {d.category}
                        </Text>
                      ) : (
                        // Gap 1 (see CLAUDE.md's "Aug 18 2026" connectivity-audit
                        // ledger): a real, honestly-softer row for a category with
                        // zero currently-open requests but real recent unmet
                        // intent nearby -- was previously invisible here entirely.
                        // Deliberately never phrased like a confirmed count.
                        <Text style={styles.offerTitle}>
                          🟡 {d.unmet_intent_count} recent {d.unmet_intent_count === 1 ? 'search' : 'searches'} near you for {d.category} found nothing
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
                        <Text style={styles.helperText}>🆕 You don't currently offer this</Text>
                      )}
                      {d.request_count > 0 && (
                        <Text style={styles.breakdownText}>
                          {[
                            d.total_party_size ? `${d.total_party_size} total ${Number(d.total_party_size) === 1 ? 'guest' : 'guests'}` : null,
                            d.soonest_date ? `soonest ${new Date(d.soonest_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : null,
                            // "Nearby V3/V4" plan, Phase A: a real time-window
                            // breakdown of already-collected data (business_requests.
                            // time_window_start), not a new signal -- only shown when
                            // at least one real open request actually specified a time.
                            d.dominant_period ? `mostly ${d.dominant_period} (${d.dominant_period_count} of ${d.request_count})` : null,
                          ].filter(Boolean).join(' · ')}
                        </Text>
                      )}
                      {d.request_count > 0 && d.unmet_intent_count > 0 && (
                        // Gap 1's own "never blended" requirement -- a real,
                        // separate softer signal on top of the real request
                        // count above, never summed into it.
                        <Text style={styles.helperText}>
                          🟡 Also: {d.unmet_intent_count} more recent {d.unmet_intent_count === 1 ? 'search' : 'searches'} nearby found nothing -- a softer, unconfirmed signal, never counted toward the number above.
                        </Text>
                      )}
                      {/* "Nearby V3/V4" plan, Phase B: no new backend mechanism --
                          this pre-fills the already-real, already-verified Phase 4
                          availability-posting modal instead of making the owner
                          re-open "+ Post Availability" and re-type the category. */}
                      <TouchableOpacity
                        style={[styles.smallActionButton, { backgroundColor: colors.primary, marginTop: spacing.sm, alignSelf: 'flex-start' }]}
                        onPress={() => openPostAvailabilityModal({ category: d.category, dominantPeriod: d.dominant_period })}
                        accessibilityLabel={`Turn ${d.category} demand into an offer`}
                        accessibilityRole="button"
                      >
                        <Text style={styles.smallActionButtonText}>→ Turn into an offer</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}

                <Text style={[styles.sectionHeader, { marginTop: spacing.lg }]}>Business Opportunities</Text>
                <Text style={styles.helperText}>
                  Real customers asking for something nearby -- respond with a real offer, or let
                  a low-fit one pass.
                </Text>
                {scoredOpportunities.length === 0 ? (
                  <Text style={styles.emptyText}>No requests yet.</Text>
                ) : (
                  scoredOpportunities.map((o) => {
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
                    return (
                    <View key={o.id} style={styles.gatheringRow}>
                      {o.opportunityReasons.length > 0 && (
                        <View style={{ marginBottom: spacing.xs }}>
                          {o.opportunityReasons.map((r) => (
                            <Text key={r.label} style={[styles.breakdownText, { color: colors.primary, fontWeight: '600' }]}>
                              🎯 {r.label}
                            </Text>
                          ))}
                        </View>
                      )}
                      <Text style={styles.offerTitle}>{o.business_requests?.raw_text}</Text>
                      <Text style={styles.breakdownText}>
                        {[
                          o.business_requests?.category,
                          o.business_requests?.party_size ? `${o.business_requests.party_size} people` : null,
                          o.business_requests?.budget_max ? `up to $${o.business_requests.budget_max}` : null,
                        ].filter(Boolean).join(' · ') || 'No further details given'}
                      </Text>
                      {(reqAttrs.length > 0 || o.business_requests?.cuisine) && (
                        <View style={[styles.chipRow, { marginTop: spacing.xs }]}>
                          {o.business_requests?.cuisine && (
                            <View style={styles.chip}>
                              <Text style={styles.chipText}>{cuisineLabel(o.business_requests.cuisine)}</Text>
                            </View>
                          )}
                          {reqAttrs.map((key) => (
                            <View key={key} style={styles.chip}>
                              <Text style={styles.chipText}>{businessAttributeLabel(key)}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                      {o.status === 'pending' && o.business_requests?.status === 'open' && (
                        <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
                          <TouchableOpacity
                            style={[styles.smallActionButton, { backgroundColor: colors.primary, marginRight: spacing.sm }]}
                            onPress={() => openOfferModal(o.request_id)}
                            disabled={respondingOpportunityId === o.request_id}
                            accessibilityLabel="Make an offer"
                            accessibilityRole="button"
                          >
                            <Text style={styles.smallActionButtonText}>Make an Offer</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated }]}
                            onPress={() => handleDeclineOpportunity(o.request_id)}
                            disabled={respondingOpportunityId === o.request_id}
                            accessibilityLabel="Decline this request"
                            accessibilityRole="button"
                          >
                            {respondingOpportunityId === o.request_id ? <ActivityIndicator color={colors.textPrimary} size="small" /> : <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>Not for me</Text>}
                          </TouchableOpacity>
                        </View>
                      )}
                      {o.status !== 'pending' && (
                        <Text style={styles.breakdownText}>
                          {{ offered: 'You made an offer', accepted: 'They accepted your offer!', declined: 'You declined', expired: 'No longer open', cancelled: 'They cancelled', completed: 'Completed' }[o.status] ?? o.status}
                        </Text>
                      )}
                    </View>
                    );
                  })
                )}

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg }}>
                  <Text style={styles.sectionHeader}>Your Availability</Text>
                  <TouchableOpacity
                    style={[styles.smallActionButton, { backgroundColor: colors.primary }]}
                    onPress={() => openPostAvailabilityModal()}
                    accessibilityLabel="Post availability"
                    accessibilityRole="button"
                  >
                    <Text style={styles.smallActionButtonText}>+ Post Availability</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.helperText}>
                  Have open seats or a quiet night? Post it and we'll match it against open
                  requests nearby automatically -- no need to wait for someone to ask.
                </Text>
                {myAvailability.length === 0 ? (
                  <Text style={styles.emptyText}>Nothing posted yet.</Text>
                ) : (
                  myAvailability.map((a) => (
                    <View key={a.id} style={styles.gatheringRow}>
                      <Text style={styles.offerTitle}>{a.title}</Text>
                      <Text style={styles.breakdownText}>
                        {[
                          a.category,
                          a.capacity ? `${a.remaining_capacity ?? 0}/${a.capacity} left` : null,
                          a.price != null ? `$${Number(a.price).toFixed(2)}` : null,
                        ].filter(Boolean).join(' · ') || 'No further details given'}
                      </Text>
                      <Text style={styles.breakdownText}>{AVAILABILITY_STATUS_COPY[a.status] ?? a.status}</Text>
                      {a.status === 'active' && (
                        <TouchableOpacity
                          style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated, marginTop: spacing.sm, alignSelf: 'flex-start' }]}
                          onPress={() => handleCancelAvailability(a.id)}
                          disabled={cancelingAvailabilityId === a.id}
                          accessibilityLabel="Cancel this availability"
                          accessibilityRole="button"
                        >
                          {cancelingAvailabilityId === a.id ? <ActivityIndicator color={colors.textPrimary} size="small" /> : <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>Cancel</Text>}
                        </TouchableOpacity>
                      )}
                    </View>
                  ))
                )}

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg }}>
                  <Text style={styles.sectionHeader}>Fulfillment Policy</Text>
                  <TouchableOpacity
                    style={[styles.smallActionButton, { backgroundColor: colors.primary }]}
                    onPress={openPolicyModal}
                    accessibilityLabel={fulfillmentPolicy ? 'Edit fulfillment policy' : 'Set a fulfillment policy'}
                    accessibilityRole="button"
                  >
                    <Text style={styles.smallActionButtonText}>{fulfillmentPolicy ? 'Edit' : '+ Set a Policy'}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.helperText}>
                  A standing rule that governs EVERY future request, not just one posting -- set
                  it once and requests within your own bounds get auto-accepted automatically.
                </Text>
                {!fulfillmentPolicy ? (
                  <Text style={styles.emptyText}>No standing policy set yet.</Text>
                ) : (
                  <View style={styles.gatheringRow}>
                    <Text style={styles.breakdownText}>
                      {fulfillmentPolicy.active ? '🟢 Active' : '⚪️ Paused'}
                      {fulfillmentPolicy.party_size_min != null || fulfillmentPolicy.party_size_max != null
                        ? ` · Party size ${fulfillmentPolicy.party_size_min ?? '1'}-${fulfillmentPolicy.party_size_max ?? '∞'}`
                        : ''}
                      {fulfillmentPolicy.active_hours_start && fulfillmentPolicy.active_hours_end
                        ? ` · ${fulfillmentPolicy.active_hours_start.slice(0, 5)}-${fulfillmentPolicy.active_hours_end.slice(0, 5)}`
                        : ''}
                    </Text>
                    <Text style={styles.breakdownText}>
                      {fulfillmentPolicy.auto_accept_party_size_max != null
                        ? `Auto-accepts parties of ${fulfillmentPolicy.auto_accept_party_size_max} or fewer`
                        : 'Auto-accept off -- every request needs your own manual review'}
                    </Text>
                    {fulfillmentPolicy.weather_dependent && (
                      <Text style={styles.breakdownText}>
                        {fulfillmentPolicy.last_rain_risk === 'high'
                          ? `🌧️ Weather-dependent -- paused right now for real rain/storms (checked ${formatWeatherCheckAge(fulfillmentPolicy.last_weather_checked_at)})`
                          : `☀️ Weather-dependent -- conditions look fine (checked ${formatWeatherCheckAge(fulfillmentPolicy.last_weather_checked_at)})`}
                      </Text>
                    )}
                    {(fulfillmentPolicy.min_spend_per_person != null || fulfillmentPolicy.max_discount_pct != null || fulfillmentPolicy.deposit_amount != null || fulfillmentPolicy.cancellation_window_hours != null) && (
                      <Text style={styles.breakdownText}>
                        {[
                          fulfillmentPolicy.min_spend_per_person != null ? `$${Number(fulfillmentPolicy.min_spend_per_person).toFixed(2)}/person min` : null,
                          fulfillmentPolicy.max_discount_pct != null ? `up to ${Number(fulfillmentPolicy.max_discount_pct)}% off` : null,
                          fulfillmentPolicy.deposit_amount != null ? `$${Number(fulfillmentPolicy.deposit_amount).toFixed(2)} deposit` : null,
                          fulfillmentPolicy.cancellation_window_hours != null ? `${fulfillmentPolicy.cancellation_window_hours}h cancellation window` : null,
                        ].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                  </View>
                )}
              </>
            )}

            {section === 'insights' && (
              <>
              <Text style={styles.sectionHeader}>How People Find You</Text>
              {discoveryStats && discoveryStats.total_views > 0 ? (
                <View style={[styles.insightsCard, { marginBottom: spacing.lg }]}>
                  <Text style={styles.insightLine}>
                    {discoveryStats.total_views} profile view{discoveryStats.total_views === 1 ? '' : 's'} total
                    {discoveryStats.views_last_30_days > 0 ? ` (${discoveryStats.views_last_30_days} in the last 30 days)` : ''}
                  </Text>
                  <Text style={styles.insightLine}>
                    🔗 {discoveryStats.deep_link_views} via your shared link or QR code ({discoveryStats.pct_via_deep_link ?? 0}%)
                  </Text>
                  <Text style={styles.insightLine}>
                    🔎 {discoveryStats.in_app_views} browsing or searching inside Nearby
                  </Text>
                  {discoveryStats.intent_match_views > 0 && (
                    <Text style={styles.insightLine}>
                      💡 {discoveryStats.intent_match_views} found you because of what they asked Nearby for
                    </Text>
                  )}
                </View>
              ) : (
                <Text style={[styles.emptyText, { marginBottom: spacing.lg }]}>
                  No profile views yet — share your QR code or link (Dashboard tab) to start seeing how people find you.
                </Text>
              )}
              {(insights && (insights.top_interests?.length > 0 || insights.best_hour_of_day !== null)) || visitFrequency !== null ? (
                <View style={styles.insightsCard}>
                  {estimatedOwed.billingModel && estimatedOwed.billingModel !== 'custom' && (
                    <View style={styles.estimatedOwedBanner}>
                      <Text style={styles.estimatedOwedLabel}>Estimated this month</Text>
                      <Text style={styles.estimatedOwedValue}>${Number(estimatedOwed.estimatedAmount ?? 0).toFixed(2)}</Text>
                      <Text style={styles.estimatedOwedDetail}>
                        {estimatedOwed.billingModel === 'flat_monthly'
                          ? 'Flat monthly rate — final invoice may differ slightly'
                          : estimatedOwed.includedUnits > 0
                          ? `${estimatedOwed.redemptionCount} redemption${estimatedOwed.redemptionCount === 1 ? '' : 's'} this month (${Math.min(estimatedOwed.redemptionCount, estimatedOwed.includedUnits)} of ${estimatedOwed.includedUnits} included free) — final invoice may differ slightly`
                          : `${estimatedOwed.redemptionCount} redemption${estimatedOwed.redemptionCount === 1 ? '' : 's'} this month so far — final invoice may differ slightly`}
                      </Text>
                    </View>
                  )}
                  {insights?.top_interests?.length > 0 && (
                    <Text style={styles.insightLine}>Your community's top interests: {insights.top_interests.join(', ')}</Text>
                  )}
                  {insights?.best_hour_of_day !== null && insights?.best_hour_of_day !== undefined && (
                    <Text style={styles.insightLine}>Best-performing time: {formatHour(insights.best_hour_of_day)}</Text>
                  )}
                  {visitFrequency !== null && (
                    <Text style={styles.insightLine}>Attendees average {visitFrequency} gathering{visitFrequency === 1 ? '' : 's'} with you</Text>
                  )}
                </View>
              ) : (
                <Text style={styles.emptyText}>Not enough activity yet to show real insights.</Text>
              )}

              {/* Business Intelligence & Opportunity Engine, Phase 4 --
                  "Learning" (see CLAUDE.md's own plan). A real,
                  aggregated-only view -- never a raw per-request dump --
                  of why a real active fulfillment policy/availability
                  posting didn't auto-match a nearby request. Honestly
                  absent when there's genuinely nothing to report. */}
              <Text style={[styles.sectionHeader, { marginTop: spacing.lg }]}>Why You Might Be Missing Requests</Text>
              {missedMatchLocked ? (
                renderLockedFeature('missed_match_reporting', "See exactly why nearby requests slipped past your fulfillment policy or availability postings -- party size out of range, hours mismatch, category mismatch, and more.")
              ) : missedMatchSummary.length === 0 ? (
                <Text style={styles.emptyText}>Nothing missed in the last 30 days.</Text>
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
                  <Text style={[styles.sectionHeader, { marginTop: spacing.lg }]}>Performance by Category</Text>
                  {renderLockedFeature('category_outcomes', 'A real breakdown of your own acceptance/completion rate and satisfaction, per category, once you have enough history in each.')}
                </>
              )}
              {categoryOutcomes.length > 0 && (
                <>
                  <Text style={[styles.sectionHeader, { marginTop: spacing.lg }]}>Performance by Category</Text>
                  {categoryOutcomes.map((c) => (
                    <View key={c.category} style={styles.offerCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.offerTitle}>{c.category}</Text>
                        <Text style={styles.offerDescription}>
                          {c.total_opportunities} opportunit{c.total_opportunities === 1 ? 'y' : 'ies'} · {c.acceptance_rate ?? 0}% accepted · {c.completion_rate ?? 0}% completed
                        </Text>
                        {c.rated_count >= 3 && (
                          <Text style={styles.offerDescription}>
                            ⭐ {c.pct_satisfied ?? 0}% satisfied · {c.pct_would_repeat ?? 0}% would repeat
                          </Text>
                        )}
                      </View>
                    </View>
                  ))}
                </>
              )}

              <TouchableOpacity
                style={[styles.createOfferButton, { marginTop: spacing.lg }]}
                onPress={() => navigation.navigate('BusinessAIAssistant', { partnerId: selectedPartner.id, partnerName: selectedPartner.name })}
                accessibilityLabel="Ask the AI Assistant about your business"
                accessibilityRole="button"
              >
                <Text style={styles.createOfferButtonText}>✨ Ask the AI Assistant</Text>
              </TouchableOpacity>

              {/* Business Intelligence Phase 6 -- the real AI Trust Engine
                  settings surface (level selector, named policies, the
                  real Activity Log). A dedicated screen, not more inline
                  UI here, matching this exact "AI Assistant" button's own
                  precedent. */}
              <TouchableOpacity
                style={[styles.createOfferButton, { marginTop: spacing.md, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border }]}
                onPress={() => navigation.navigate('BusinessAIAutomation', { partnerId: selectedPartner.id, partnerName: selectedPartner.name })}
                accessibilityLabel="Manage AI automation for your business"
                accessibilityRole="button"
              >
                <Text style={[styles.createOfferButtonText, { color: colors.textPrimary }]}>🤖 AI Automation Settings</Text>
              </TouchableOpacity>
              </>
            )}

            {section === 'business' && (
              <>
                <Text style={styles.sectionHeader}>Rewards & Offers</Text>
                <TouchableOpacity
                  style={styles.createOfferButton}
                  onPress={() => setCreateModalVisible(true)}
                  accessibilityLabel="Create a new offer"
                  accessibilityRole="button"
                >
                  <Text style={styles.createOfferButtonText}>+ Create Offer</Text>
                </TouchableOpacity>
                {offers.length === 0 ? (
                  <Text style={styles.emptyText}>No offers yet — create one to give your community a reason to visit.</Text>
                ) : (
                  offers.map((offer) => (
                    <View key={offer.id} style={styles.offerCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.offerTitle}>{offer.title}</Text>
                        {offer.description ? <Text style={styles.offerDescription}>{offer.description}</Text> : null}
                        <Text style={styles.offerRedemptionCount}>
                          {offerRedemptionCounts[offer.id] ?? 0} redeemed{offer.redemption_limit != null ? ` of ${offer.redemption_limit}` : ''}
                        </Text>
                        {offer.unlock_scope != null && (
                          <Text style={styles.breakdownText}>
                            🔒 Unlocks at {offer.unlock_min_members} {offer.unlock_scope === 'community' ? 'community members' : 'approved attendees'}
                          </Text>
                        )}
                      </View>
                      <Switch
                        value={offer.active}
                        onValueChange={() => handleToggleActive(offer)}
                        accessibilityLabel={`${offer.title}, ${offer.active ? 'active' : 'inactive'}, tap to toggle`}
                      />
                    </View>
                  ))
                )}

                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>Confirm a Redemption</Text>
                <Text style={styles.offerDescription}>
                  Ask the customer for the 6-digit code they were shown when they redeemed, and enter it here to confirm the visit really happened. Only confirmed redemptions count toward billing.
                </Text>
                <View style={[styles.gatheringRow, { marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center' }]}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="6-digit code"
                    placeholderTextColor={colors.textTertiary}
                    value={redemptionCodeInput}
                    onChangeText={(t) => setRedemptionCodeInput(t.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    maxLength={6}
                    accessibilityLabel="Redemption confirmation code"
                  />
                  <TouchableOpacity
                    style={[styles.createOfferButton, { marginBottom: 0, marginLeft: spacing.sm, opacity: confirmingCode || !redemptionCodeInput.trim() ? 0.6 : 1 }]}
                    onPress={handleConfirmRedemption}
                    disabled={confirmingCode || !redemptionCodeInput.trim()}
                    accessibilityLabel="Confirm redemption code"
                    accessibilityRole="button"
                  >
                    {confirmingCode ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.createOfferButtonText}>Confirm</Text>
                    )}
                  </TouchableOpacity>
                </View>

                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>Business Profile</Text>
                <View style={styles.gatheringRow}>
                  <Text style={styles.offerTitle}>{selectedPartner?.name}</Text>
                  <Text style={styles.breakdownText}>
                    {selectedPartner?.category
                      ? BUSINESS_CATEGORIES.find((c) => c.key === selectedPartner.category)?.label ?? selectedPartner.category
                      : 'No category set — pick one so customers can find you by category.'}
                  </Text>
                  {selectedPartner?.description ? (
                    <Text style={styles.offerDescription}>{selectedPartner.description}</Text>
                  ) : (
                    <Text style={styles.offerDescription}>No description yet.</Text>
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
                    onPress={() => {
                      setEditNameInput(selectedPartner?.name ?? '');
                      setEditDescriptionInput(selectedPartner?.description ?? '');
                      setEditLogoUrlInput(selectedPartner?.logo_url ?? '');
                      setEditCategoryInput(selectedPartner?.category ?? null);
                      setEditAttributesInput(selectedPartner?.attributes ?? []);
                      setEditCuisineInput(selectedPartner?.cuisine ?? null);
                      setEditDifferentiatorInput(selectedPartner?.differentiator ?? '');
                      setEditProfileModalVisible(true);
                    }}
                    style={{ marginTop: spacing.sm }}
                    accessibilityLabel="Edit business profile"
                    accessibilityRole="button"
                  >
                    <Text style={styles.messageMemberLink}>✏️ Edit Profile</Text>
                  </TouchableOpacity>
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
                      We think {selectedPartner?.name} might be:
                    </Text>
                    <Text style={styles.offerTitle}>
                      {BUSINESS_CATEGORIES.find((c) => c.key === categorySuggestion.category)?.label ?? categorySuggestion.category}
                    </Text>
                    <View style={{ flexDirection: 'row', marginTop: spacing.sm, gap: spacing.sm }}>
                      <TouchableOpacity
                        style={[styles.smallActionButton, { backgroundColor: colors.primary }]}
                        onPress={handleConfirmCategorySuggestion}
                        disabled={savingCategorySuggestion}
                        accessibilityLabel="Looks right, update my category"
                        accessibilityRole="button"
                      >
                        <Text style={styles.smallActionButtonText}>{savingCategorySuggestion ? 'Saving...' : 'Looks right'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated }]}
                        onPress={handleDismissCategorySuggestion}
                        accessibilityLabel={`Keep as ${selectedPartner?.category ? BUSINESS_CATEGORIES.find((c) => c.key === selectedPartner.category)?.label : 'current'}`}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>
                          Keep as {selectedPartner?.category ? BUSINESS_CATEGORIES.find((c) => c.key === selectedPartner.category)?.label ?? selectedPartner.category : 'unset'}
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
                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>👥 What You Can Accommodate</Text>
                <Text style={styles.helperText}>
                  Help Nearby send you requests that actually fit your business.
                </Text>
                <View style={styles.gatheringRow}>
                  <Text style={[styles.breakdownText, { fontWeight: '700' }]}>Group size</Text>
                  <Text style={styles.breakdownText}>
                    {fulfillmentPolicy?.party_size_min != null || fulfillmentPolicy?.party_size_max != null
                      ? `Groups of ${fulfillmentPolicy.party_size_min ?? '1'}-${fulfillmentPolicy.party_size_max ?? '∞'}`
                      : 'Not set yet.'}
                  </Text>
                  <TouchableOpacity onPress={openPolicyModal} accessibilityLabel="Edit group size" accessibilityRole="button">
                    <Text style={styles.messageMemberLink}>✏️ {fulfillmentPolicy ? 'Edit' : 'Set your group size'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={[styles.gatheringRow, { marginTop: spacing.sm }]}>
                  <Text style={[styles.breakdownText, { fontWeight: '700', marginBottom: spacing.xs }]}>Experiences & uses</Text>
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
                    accessibilityLabel="Save what you can accommodate"
                    accessibilityRole="button"
                  >
                    {savingAccommodations ? <ActivityIndicator color="#fff" /> : <Text style={styles.postUpdateButtonText}>Save</Text>}
                  </TouchableOpacity>
                </View>
                <View style={[styles.gatheringRow, { marginTop: spacing.sm }]}>
                  <Text style={[styles.breakdownText, { fontWeight: '700' }]}>Space</Text>
                  <Text style={styles.breakdownText}>
                    {(selectedPartner?.attributes ?? []).includes('outdoor_seating')
                      ? '🌤️ Outdoor seating'
                      : 'Not currently listed.'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setEditNameInput(selectedPartner?.name ?? '');
                      setEditDescriptionInput(selectedPartner?.description ?? '');
                      setEditLogoUrlInput(selectedPartner?.logo_url ?? '');
                      setEditCategoryInput(selectedPartner?.category ?? null);
                      setEditAttributesInput(selectedPartner?.attributes ?? []);
                      setEditCuisineInput(selectedPartner?.cuisine ?? null);
                      setEditDifferentiatorInput(selectedPartner?.differentiator ?? '');
                      setEditProfileModalVisible(true);
                    }}
                    accessibilityLabel="Edit space and amenities"
                    accessibilityRole="button"
                  >
                    <Text style={styles.messageMemberLink}>✏️ Edit under "Why People Choose Us"</Text>
                  </TouchableOpacity>
                </View>

                {/* "Business Story" plan, Phase 2 -- Business Goals. A real,
                    small, dedicated save distinct from the full profile
                    edit above -- meant to be revisited often. */}
                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>What You're Looking For</Text>
                <Text style={styles.helperText}>
                  What would you most like Nearby to send you more of right now? We'll flag
                  matching opportunities in your inbox.
                </Text>
                <View style={styles.chipRow}>
                  {BUSINESS_ATTRIBUTE_OPTIONS.map((a) => {
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
                <Text style={[styles.breakdownText, { fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs }]}>When</Text>
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
                <TouchableOpacity
                  style={[styles.postUpdateButton, { marginTop: spacing.sm }]}
                  onPress={handleSavePriorityAttributes}
                  disabled={savingPriorityAttributes}
                  accessibilityLabel="Save what you're looking for"
                  accessibilityRole="button"
                >
                  {savingPriorityAttributes ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.postUpdateButtonText}>Save</Text>
                  )}
                </TouchableOpacity>

                {/* Business Intelligence & Opportunity Engine, Phase 1 --
                    the Business Priority Engine: a real, time-bounded
                    "want more of X right now" signal, additive to the
                    permanent chips above -- never edits them, expires on
                    its own real deadline (swept hourly by the same cron
                    job that already expires business_requests/
                    business_availability). */}
                <Text style={[styles.breakdownText, { fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs }]}>
                  ⏳ Temporary boost (optional)
                </Text>
                <Text style={styles.helperText}>
                  Want more of one specific category this week, without changing what you're
                  generally looking for above? Set a real deadline and it clears itself.
                </Text>
                {activePrioritySignals.length > 0 && (
                  <View style={{ marginTop: spacing.xs, marginBottom: spacing.xs }}>
                    {activePrioritySignals.map((s) => (
                      <View key={s.id} style={[styles.gatheringRow, { marginTop: spacing.xs }]}>
                        <Text style={styles.breakdownText}>
                          🎯 {s.category} — until {new Date(s.expires_at).toLocaleDateString()}
                        </Text>
                        <TouchableOpacity
                          onPress={() => handleClearBoost(s.id)}
                          accessibilityLabel={`Clear boost for ${s.category}`}
                          accessibilityRole="button"
                        >
                          <Text style={styles.messageMemberLink}>Clear</Text>
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
                        { key: 'today', label: 'Today' },
                        { key: 'weekend', label: 'This Weekend' },
                        { key: '1week', label: '1 Week' },
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
                      accessibilityLabel="Save temporary boost"
                      accessibilityRole="button"
                    >
                      {savingBoost ? <ActivityIndicator color="#fff" /> : <Text style={styles.postUpdateButtonText}>Boost This Category</Text>}
                    </TouchableOpacity>
                  </>
                )}

                {/* Phase 3 -- Availability Pulse: one tap sets and saves. */}
                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>How's Business Right Now?</Text>
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
                  placeholder={'Optional note — e.g. "Patio’s full, indoor seats open"'}
                  placeholderTextColor={colors.textTertiary}
                  value={pulseNoteInput}
                  onChangeText={setPulseNoteInput}
                  maxLength={140}
                  accessibilityLabel="Availability note"
                />
                {selectedPartner?.availability_pulse && (
                  <Text style={styles.helperText}>
                    {isAvailabilityPulseFresh(selectedPartner.availability_pulse_updated_at)
                      ? `Set to "${availabilityPulseLabel(selectedPartner.availability_pulse)}" -- customers see this on your public profile.`
                      : 'This is more than a day old -- customers no longer see it. Tap a status above to refresh it.'}
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
                      <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>We Created {pending.length} Experience{pending.length === 1 ? '' : 's'} For You</Text>
                      <Text style={styles.helperText}>
                        Based on what you told us makes people choose you. Keep the ones you like,
                        edit any of them, or remove what doesn't fit.
                      </Text>
                      {pending.map((s) => (
                        <View key={s.attribute} style={styles.gatheringRow}>
                          <Text style={styles.offerTitle}>{s.icon} {s.title}</Text>
                          <Text style={styles.breakdownText}>{s.description}</Text>
                          <Text style={[styles.breakdownText, { color: colors.textTertiary, fontStyle: 'italic' }]}>
                            Based on: {businessAttributeLabel(s.attribute)}
                          </Text>
                          <View style={{ flexDirection: 'row', marginTop: spacing.sm, flexWrap: 'wrap', gap: spacing.sm }}>
                            <TouchableOpacity
                              style={[styles.smallActionButton, { backgroundColor: colors.primary }]}
                              onPress={() => handleKeepSuggestion(s)}
                              accessibilityLabel={`Keep ${s.title}`}
                              accessibilityRole="button"
                            >
                              <Text style={styles.smallActionButtonText}>Keep</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated }]}
                              onPress={() => openExperienceModal(s, { fromSuggestionId: s.attribute })}
                              accessibilityLabel={`Edit ${s.title}`}
                              accessibilityRole="button"
                            >
                              <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>Edit</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated }]}
                              onPress={() => handleRemoveSuggestion(s)}
                              accessibilityLabel={`Remove ${s.title}`}
                              accessibilityRole="button"
                            >
                              <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>Remove</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                    </>
                  );
                })()}

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl }}>
                  <Text style={styles.sectionHeader}>Your Signature Experiences</Text>
                  <TouchableOpacity
                    style={[styles.smallActionButton, { backgroundColor: colors.primary }]}
                    onPress={() => openExperienceModal(null)}
                    accessibilityLabel="Add a signature experience"
                    accessibilityRole="button"
                  >
                    <Text style={styles.smallActionButtonText}>+ Add</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.helperText}>
                  Real, curated things people can come to you for -- shown on your public profile.
                </Text>
                {entitlements && entitlementLimit(entitlements, 'signature_experiences') !== null && (
                  <Text style={[styles.helperText, checkLimit(entitlements, 'signature_experiences', experiences.length).atLimit && { color: colors.primary, fontWeight: '700' }]}>
                    {experiences.length} of {entitlementLimit(entitlements, 'signature_experiences')} used
                    {checkLimit(entitlements, 'signature_experiences', experiences.length).atLimit ? ' -- upgrade for unlimited' : ''}
                  </Text>
                )}
                {loadingExperiences ? (
                  <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.sm }} />
                ) : experiences.length === 0 ? (
                  <Text style={styles.emptyText}>No signature experiences yet.</Text>
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
                          !exp.active ? 'Hidden from your public profile' : null,
                        ].filter(Boolean).join(' · ') || 'No price or party details set'}
                      </Text>
                      <View style={{ flexDirection: 'row', marginTop: spacing.sm, flexWrap: 'wrap', gap: spacing.sm }}>
                        <TouchableOpacity onPress={() => openExperienceModal(exp)} accessibilityLabel={`Edit ${exp.title}`} accessibilityRole="button">
                          <Text style={styles.messageMemberLink}>✏️ Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleToggleExperienceActive(exp)} accessibilityLabel={exp.active ? `Hide ${exp.title}` : `Show ${exp.title}`} accessibilityRole="button">
                          <Text style={styles.messageMemberLink}>{exp.active ? '🙈 Hide' : '👀 Show'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleDeleteExperience(exp)} accessibilityLabel={`Remove ${exp.title}`} accessibilityRole="button">
                          <Text style={[styles.messageMemberLink, { color: colors.danger }]}>🗑️ Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}

                {/* "Business Profile Phase 1" addendum -- "Teach Nearby."
                    A real, deterministic keyword extraction against the
                    existing attributes vocabulary, never an LLM call and
                    never auto-applied -- the extracted chips are always
                    shown for an explicit confirm/edit/discard first. */}
                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>✨ Teach Nearby</Text>
                <Text style={styles.helperText}>Anything else we should know about your business?</Text>
                {!teachNearbyExtracted ? (
                  <>
                    <TextInput
                      style={[styles.input, { marginTop: spacing.sm, minHeight: 60 }]}
                      placeholder={'"Our rooftop patio is our most popular feature and we\'re especially good for first dates."'}
                      placeholderTextColor={colors.textTertiary}
                      value={teachNearbyInput}
                      onChangeText={setTeachNearbyInput}
                      multiline
                      maxLength={300}
                      accessibilityLabel="Tell Nearby about your business"
                    />
                    <TouchableOpacity
                      style={[styles.postUpdateButton, { marginTop: spacing.sm }]}
                      onPress={handleInterpretTeachNearby}
                      disabled={!teachNearbyInput.trim()}
                      accessibilityLabel="Submit"
                      accessibilityRole="button"
                    >
                      <Text style={styles.postUpdateButtonText}>Submit</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View style={styles.gatheringRow}>
                    {teachNearbyExtracted.length === 0 ? (
                      <Text style={styles.emptyText}>
                        Nearby didn't recognize anything specific in that -- try mentioning something
                        concrete, like your patio, your atmosphere, or who you're great for.
                      </Text>
                    ) : (
                      <>
                        <Text style={[styles.breakdownText, { fontWeight: '700', marginBottom: spacing.xs }]}>Nearby understood:</Text>
                        <View style={styles.chipRow}>
                          {teachNearbyExtracted.map((attribute) => (
                            <TouchableOpacity
                              key={attribute}
                              style={styles.chip}
                              onPress={() => handleRemoveTeachNearbyChip(attribute)}
                              accessibilityLabel={`Remove ${businessAttributeLabel(attribute)}`}
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
                          accessibilityLabel="Add to profile"
                          accessibilityRole="button"
                        >
                          <Text style={styles.smallActionButtonText}>{savingTeachNearby ? 'Adding...' : 'Add to Profile'}</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={[styles.smallActionButton, { backgroundColor: colors.surfaceElevated }]}
                        onPress={handleDiscardTeachNearby}
                        accessibilityLabel="Discard"
                        accessibilityRole="button"
                      >
                        <Text style={[styles.smallActionButtonText, { color: colors.textPrimary }]}>Discard</Text>
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
                    <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>🕓 Recent AI Suggestions</Text>
                    <Text style={styles.helperText}>
                      Every real, deterministic suggestion Nearby has made for this business, and
                      what happened to it.
                    </Text>
                    {recentSuggestions.map((s) => (
                      <View key={s.id} style={[styles.gatheringRow, { marginTop: spacing.xs }]}>
                        <Text style={styles.breakdownText}>
                          {s.attribute_key === 'category'
                            ? `Category: ${BUSINESS_CATEGORIES.find((c) => c.key === s.attribute_value)?.label ?? s.attribute_value}`
                            : `Attribute: ${businessAttributeLabel(s.attribute_value) ?? s.attribute_value}`}
                        </Text>
                        <Text style={[styles.helperText, { marginTop: 2 }]}>
                          {s.status === 'confirmed' ? '✅ Added' : s.status === 'rejected' ? '✕ Kept as-is' : '⏳ Awaiting your review'}
                          {s.reason ? ` — ${s.reason}` : ''}
                        </Text>
                      </View>
                    ))}
                  </>
                )}

                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>Get Paid via Stripe</Text>
                <View style={styles.gatheringRow}>
                  {!isStripeConfigured() ? (
                    <Text style={styles.offerDescription}>
                      Payment collection isn't set up yet — check back soon.
                    </Text>
                  ) : stripeStatus?.chargesEnabled ? (
                    <>
                      <Text style={styles.offerTitle}>✅ Ready to accept payments</Text>
                      <Text style={styles.offerDescription}>
                        Offers with a real price now collect payment directly through your own
                        Stripe account when a customer accepts them.
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.offerTitle}>
                        {stripeStatus?.hasAccount ? 'Finish setting up payments' : 'Connect Stripe to get paid'}
                      </Text>
                      <Text style={styles.offerDescription}>
                        {stripeStatus?.hasAccount
                          ? "You started Stripe onboarding but haven't finished it yet — until you do, offers you accept won't collect a real payment."
                          : 'Connect a real Stripe account so accepted offers with a price can actually collect payment, directly to you.'}
                      </Text>
                      {stripeStatus?.requirementsDue?.length > 0 && (
                        <Text style={styles.breakdownText}>
                          Stripe still needs: {stripeStatus.requirementsDue.join(', ')}
                        </Text>
                      )}
                      <TouchableOpacity
                        style={[styles.createOfferButton, { marginTop: spacing.sm }]}
                        onPress={handleConnectStripe}
                        disabled={connectingStripe}
                        accessibilityLabel={stripeStatus?.hasAccount ? 'Continue Stripe setup' : 'Connect Stripe'}
                        accessibilityRole="button"
                      >
                        {connectingStripe ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.createOfferButtonText}>
                            {stripeStatus?.hasAccount ? 'Continue Setup' : 'Connect Stripe'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </>
                  )}
                </View>

                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>Reservation Provider</Text>
                <View style={styles.gatheringRow}>
                  {editingReservationProvider ? (
                    <>
                      <Text style={styles.offerDescription}>
                        Which system do you take reservations through? This doesn't connect real
                        bookings yet -- Resy and OpenTable both require applying for real partner
                        API access before Nearby can actually create a reservation there. Telling
                        us now means it's ready the moment that's built.
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
                        placeholder="Your venue ID on that system (optional)"
                        placeholderTextColor={colors.textTertiary}
                        value={reservationVenueIdInput}
                        onChangeText={setReservationVenueIdInput}
                        autoCapitalize="none"
                        accessibilityLabel="Reservation provider venue ID"
                      />
                      <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
                        <TouchableOpacity
                          style={[styles.createOfferButton, { opacity: savingReservationProvider || !reservationProviderInput ? 0.6 : 1 }]}
                          onPress={handleSaveReservationProvider}
                          disabled={savingReservationProvider || !reservationProviderInput}
                          accessibilityLabel="Save reservation provider"
                          accessibilityRole="button"
                        >
                          {savingReservationProvider ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text style={styles.createOfferButtonText}>Save</Text>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ marginLeft: spacing.md, justifyContent: 'center' }}
                          onPress={() => setEditingReservationProvider(false)}
                          accessibilityLabel="Cancel"
                          accessibilityRole="button"
                        >
                          <Text style={styles.messageMemberLink}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : reservationProviderStatus?.provider ? (
                    <>
                      <Text style={styles.offerTitle}>
                        ✅ Connected to {RESERVATION_PROVIDER_OPTIONS.find((p) => p.key === reservationProviderStatus.provider)?.label ?? reservationProviderStatus.provider}
                      </Text>
                      <Text style={styles.offerDescription}>
                        {reservationProviderStatus.venueId
                          ? `Venue ID: ${reservationProviderStatus.venueId}`
                          : 'No venue ID on file yet.'}{' '}
                        Real bookings aren't wired up yet -- this is just recorded so it's ready
                        once Nearby has real Resy/OpenTable API access.
                      </Text>
                      <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
                        <TouchableOpacity onPress={openEditReservationProvider} accessibilityLabel="Edit reservation provider" accessibilityRole="button">
                          <Text style={styles.messageMemberLink}>✏️ Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleDisconnectReservationProvider} style={{ marginLeft: spacing.lg }} accessibilityLabel="Remove reservation provider" accessibilityRole="button">
                          <Text style={[styles.messageMemberLink, { color: colors.danger }]}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={styles.offerDescription}>
                        If you already take reservations through Resy or OpenTable, tell us which
                        one. This is groundwork only -- it doesn't connect real bookings yet.
                      </Text>
                      <TouchableOpacity onPress={openEditReservationProvider} style={{ marginTop: spacing.sm }} accessibilityLabel="Add reservation provider" accessibilityRole="button">
                        <Text style={styles.messageMemberLink}>+ Add Reservation Provider</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </>
            )}

            {section === 'inbox_modal' && (
              activeConversation ? (
                <View>
                  <TouchableOpacity onPress={() => setActiveConversation(null)} accessibilityLabel="Back to conversations" accessibilityRole="button">
                    <Text style={styles.backLink}>← Back to conversations</Text>
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
                      placeholder="Reply..."
                      placeholderTextColor={colors.textTertiary}
                      value={replyText}
                      onChangeText={setReplyText}
                      accessibilityLabel="Reply message"
                    />
                    <TouchableOpacity style={styles.sendReplyButton} onPress={sendReply} accessibilityLabel="Send reply" accessibilityRole="button">
                      <Text style={styles.sendReplyButtonText}>Send</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : conversations.length === 0 ? (
                <Text style={styles.emptyText}>No messages yet from your community.</Text>
              ) : (
                conversations.map((c) => (
                  <TouchableOpacity key={c.userId} style={styles.gatheringRow} onPress={() => openConversation(c)} accessibilityLabel={`Conversation with ${c.displayName}`} accessibilityRole="button">
                    <Text style={styles.offerTitle}>{c.displayName}</Text>
                    <Text style={styles.offerDescription} numberOfLines={1}>{c.lastMessage}</Text>
                  </TouchableOpacity>
                ))
              )
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={createModalVisible} animationType="slide" transparent onRequestClose={() => setCreateModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>New Offer</Text>
              <TextInput
                style={styles.input}
                placeholder="Free pastry with any coffee"
                placeholderTextColor={colors.textTertiary}
                value={newTitle}
                onChangeText={setNewTitle}
                accessibilityLabel="Offer title"
              />
              <TextInput
                style={[styles.input, { height: 70, textAlignVertical: 'top', marginTop: spacing.sm }]}
                placeholder="Description (optional)"
                placeholderTextColor={colors.textTertiary}
                value={newDescription}
                onChangeText={setNewDescription}
                multiline
                accessibilityLabel="Offer description, optional"
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder="Redemption instructions (optional)"
                placeholderTextColor={colors.textTertiary}
                value={newInstructions}
                onChangeText={setNewInstructions}
                accessibilityLabel="Redemption instructions, optional"
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder="Limit to first N people (optional, e.g. 20)"
                placeholderTextColor={colors.textTertiary}
                value={newRedemptionLimit}
                onChangeText={(t) => setNewRedemptionLimit(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                accessibilityLabel="Redemption limit, optional"
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder="Target interest, e.g. Coffee (optional)"
                placeholderTextColor={colors.textTertiary}
                value={newTargetInterestTag}
                onChangeText={setNewTargetInterestTag}
                accessibilityLabel="Target interest tag, optional"
              />

              <View style={[styles.toggleRow, { marginTop: spacing.md }]}>
                <Text style={styles.toggleRowLabel}>
                  {offerGatheringId ? 'Require a minimum number of attendees' : 'Require a community to hit a member goal'}
                </Text>
                <Switch
                  value={unlockEnabled}
                  onValueChange={setUnlockEnabled}
                  accessibilityLabel={`Group unlock, ${unlockEnabled ? 'on' : 'off'}, tap to toggle`}
                />
              </View>

              {unlockEnabled && (
                <>
                  {!offerGatheringId && (
                    communities.length === 0 ? (
                      <Text style={styles.offerDescription}>You need a community to gate this offer on — create one from the Create tab first.</Text>
                    ) : (
                      <View style={styles.chipRow}>
                        {communities.map((c) => (
                          <TouchableOpacity
                            key={c.id}
                            style={[styles.chip, unlockCommunityId === c.id && styles.chipSelected]}
                            onPress={() => setUnlockCommunityId(c.id)}
                            accessibilityLabel={`${c.name}, ${c.memberCount} members${unlockCommunityId === c.id ? ', selected' : ''}`}
                            accessibilityRole="button"
                          >
                            <Text style={[styles.chipText, unlockCommunityId === c.id && styles.chipTextSelected]}>{c.name} ({c.memberCount})</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )
                  )}
                  <TextInput
                    style={[styles.input, { marginTop: spacing.sm }]}
                    placeholder={offerGatheringId ? 'Attendees needed to unlock, e.g. 10' : 'Members needed to unlock, e.g. 10'}
                    placeholderTextColor={colors.textTertiary}
                    value={newUnlockMinMembers}
                    onChangeText={(t) => setNewUnlockMinMembers(t.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    accessibilityLabel="Minimum members or attendees to unlock this offer"
                  />
                </>
              )}

              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleCreateOffer}
                disabled={submitting}
                accessibilityLabel={submitting ? 'Creating' : 'Create offer'}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{submitting ? 'Creating...' : 'Create Offer'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setCreateModalVisible(false)} style={{ marginTop: spacing.md }} accessibilityLabel="Cancel" accessibilityRole="button">
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={addressModalVisible} animationType="slide" transparent onRequestClose={() => setAddressModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>Business Address</Text>
              <Text style={[styles.modalCloseText, { marginBottom: spacing.md }]}>
                This determines who sees your offers nearby.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 123 Main St, Boca Raton, FL"
                placeholderTextColor={colors.textTertiary}
                value={addressInput}
                onChangeText={setAddressInput}
                accessibilityLabel="Business address"
              />
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleUpdateAddress}
                disabled={savingAddress || !addressInput.trim()}
                accessibilityLabel={savingAddress ? 'Saving' : 'Save address'}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{savingAddress ? 'Saving...' : 'Save Address'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setAddressModalVisible(false)} style={{ marginTop: spacing.md }} accessibilityLabel="Cancel" accessibilityRole="button">
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={editProfileModalVisible} animationType="slide" transparent onRequestClose={() => setEditProfileModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>Edit Business Profile</Text>
              <TextInput
                style={styles.input}
                placeholder="Business name"
                placeholderTextColor={colors.textTertiary}
                value={editNameInput}
                onChangeText={setEditNameInput}
                accessibilityLabel="Business name"
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm, minHeight: 80 }]}
                placeholder="Description"
                placeholderTextColor={colors.textTertiary}
                value={editDescriptionInput}
                onChangeText={setEditDescriptionInput}
                multiline
                accessibilityLabel="Business description"
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder="Logo image URL (optional)"
                placeholderTextColor={colors.textTertiary}
                value={editLogoUrlInput}
                onChangeText={setEditLogoUrlInput}
                autoCapitalize="none"
                accessibilityLabel="Logo URL"
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>Category</Text>
              <View style={styles.chipRow}>
                {BUSINESS_CATEGORIES.map((c) => (
                  <TouchableOpacity
                    key={c.key}
                    style={[styles.chip, editCategoryInput === c.key && styles.chipSelected]}
                    onPress={() => setEditCategoryInput(editCategoryInput === c.key ? null : c.key)}
                    accessibilityRole="button"
                    accessibilityLabel={c.label}
                    accessibilityState={{ selected: editCategoryInput === c.key }}
                  >
                    <Text style={[styles.chipText, editCategoryInput === c.key && styles.chipTextSelected]}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* "Business Story" plan: reframed from a plain "Attributes"
                  checkbox list to "Why People Choose Us" -- same real
                  vocabulary/RPC, just named for what it actually is. */}
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>Why People Choose Us</Text>
              <View style={styles.chipRow}>
                {BUSINESS_ATTRIBUTE_OPTIONS.map((a) => {
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
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>What Makes You Different?</Text>
              <Text style={styles.helperText}>
                One real sentence, in your own words -- e.g. "We're the only coffee shop in the
                area with a rooftop patio."
              </Text>
              <TextInput
                style={[styles.input, { marginTop: spacing.sm, minHeight: 60 }]}
                placeholder="What makes you different? (optional)"
                placeholderTextColor={colors.textTertiary}
                value={editDifferentiatorInput}
                onChangeText={setEditDifferentiatorInput}
                multiline
                maxLength={280}
                accessibilityLabel="What makes you different"
              />
              {editCategoryInput === 'food_drink' && (
                <>
                  <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>Cuisine</Text>
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
                accessibilityLabel={savingProfile ? 'Saving' : 'Save profile'}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{savingProfile ? 'Saving...' : 'Save Profile'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setEditProfileModalVisible(false)} style={{ marginTop: spacing.md }} accessibilityLabel="Cancel" accessibilityRole="button">
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* "Business Story" plan, Phase 6 -- create/edit a Signature
          Experience. Same modal shape as Edit Profile above (KeyboardAvoidingView
          + TouchableWithoutFeedback-to-dismiss, chip-row pickers). */}
      <Modal visible={experienceModalVisible} animationType="slide" transparent onRequestClose={() => setExperienceModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>{editingExperienceId ? 'Edit Experience' : 'New Signature Experience'}</Text>
              <TextInput
                style={styles.input}
                placeholder="Title (e.g. Sunset Coffee Date)"
                placeholderTextColor={colors.textTertiary}
                value={expTitleInput}
                onChangeText={setExpTitleInput}
                maxLength={80}
                accessibilityLabel="Experience title"
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm, minHeight: 60 }]}
                placeholder="Description (optional)"
                placeholderTextColor={colors.textTertiary}
                value={expDescriptionInput}
                onChangeText={setExpDescriptionInput}
                multiline
                maxLength={200}
                accessibilityLabel="Experience description"
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder="Emoji icon (optional, e.g. ❤️)"
                placeholderTextColor={colors.textTertiary}
                value={expIconInput}
                onChangeText={setExpIconInput}
                maxLength={4}
                accessibilityLabel="Experience icon"
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>Tags</Text>
              <View style={styles.chipRow}>
                {BUSINESS_ATTRIBUTE_OPTIONS.map((a) => {
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
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>Price</Text>
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
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>Who's this for?</Text>
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
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleSaveExperience}
                disabled={savingExperience || !expTitleInput.trim()}
                accessibilityLabel={savingExperience ? 'Saving' : 'Save experience'}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{savingExperience ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setExperienceModalVisible(false)} style={{ marginTop: spacing.md }} accessibilityLabel="Cancel" accessibilityRole="button">
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={qrModalVisible} animationType="slide" transparent onRequestClose={() => setQrModalVisible(false)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { alignItems: 'center' }]}>
            <Text style={styles.sheetTitle}>Share Your QR Code</Text>
            <Text style={[styles.emptyText, { marginBottom: spacing.md }]}>
              Print it, post it at your counter, or share the link directly — either one opens
              {selectedPartner ? ` ${selectedPartner.name}'s` : ' your'} page on Nearby.
            </Text>
            {selectedPartner && (
              <View style={{ backgroundColor: '#fff', padding: spacing.md, borderRadius: radius.md }}>
                <QRCode value={`nearby://business/${selectedPartner.id}`} size={200} />
              </View>
            )}
            <TouchableOpacity
              style={[styles.submitButton, { marginTop: spacing.lg, width: '100%' }]}
              onPress={handleShareBusinessLink}
              accessibilityLabel="Share business link"
              accessibilityRole="button"
            >
              <Text style={styles.submitButtonText}>Share Link</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setQrModalVisible(false)} style={{ marginTop: spacing.md }} accessibilityLabel="Close" accessibilityRole="button">
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={updateModalVisible} animationType="slide" transparent onRequestClose={() => setUpdateModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>Post Update</Text>
              <TextInput
                style={styles.input}
                placeholder="What's new?"
                placeholderTextColor={colors.textTertiary}
                value={updateTitle}
                onChangeText={setUpdateTitle}
                accessibilityLabel="Update title"
              />
              <TextInput
                style={[styles.input, { height: 90, textAlignVertical: 'top', marginTop: spacing.sm }]}
                placeholder="Details (optional)"
                placeholderTextColor={colors.textTertiary}
                value={updateBody}
                onChangeText={setUpdateBody}
                multiline
                accessibilityLabel="Update details, optional"
              />
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handlePostUpdate}
                disabled={postingUpdate}
                accessibilityLabel={postingUpdate ? 'Sending' : 'Send update'}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{postingUpdate ? 'Sending...' : 'Send to Followers'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setUpdateModalVisible(false)} style={{ marginTop: spacing.md }} accessibilityLabel="Cancel" accessibilityRole="button">
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={!!offerModalRequestId} animationType="slide" transparent onRequestClose={() => setOfferModalRequestId(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <ScrollView style={styles.sheet} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>Make an Offer</Text>
              <Text style={[styles.modalCloseText, { marginBottom: spacing.md }]}>
                Never just a discount -- offer whatever fits: your normal price, a discount, a
                perk, an upgrade, or a different time that works better.
              </Text>
              {/* Business Intelligence Phase 8: unlike missed-match/category-outcomes,
                  this suggestion is computed entirely client-side over data the business
                  already owns (its own experiences/opportunities) -- no server RPC boundary
                  exists to enforce this at, so the entitlement gate is purely a rendering
                  decision here, matching the feature's own real "convenience, not access to
                  someone else's data" shape. */}
              {entitlements && !hasEntitlement(entitlements, 'ai_offer_recommendations') ? (
                <View style={{ marginBottom: spacing.md }}>
                  {renderLockedFeature('ai_offer_recommendations', 'Get a suggested offer straight from your own Signature Experiences and your own past acceptance history -- never a guessed price.')}
                </View>
              ) : (
              <>
              {offerSuggestions.length > 0 && (
                <View style={{ marginBottom: spacing.md }}>
                  <Text style={styles.notesLabel}>💡 Suggested from your Signature Experiences</Text>
                  {offerSuggestions.map((s) => (
                    <TouchableOpacity
                      key={s.experienceId}
                      style={styles.offerCard}
                      onPress={() => applyExperienceSuggestion(s)}
                      accessibilityRole="button"
                      accessibilityLabel={`Use suggestion: ${s.title}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.offerTitle}>{s.title}</Text>
                        {s.reasons.map((r) => (
                          <Text key={r.label} style={[styles.breakdownText, { color: colors.primary, fontWeight: '600' }]}>
                            🎯 {r.label}
                          </Text>
                        ))}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {offerSuggestions.length === 0 && suggestedOfferType && (
                <TouchableOpacity
                  style={[styles.offerCard, { marginBottom: spacing.md }]}
                  onPress={applySuggestedOfferType}
                  accessibilityRole="button"
                  accessibilityLabel={`Use your best-performing offer type: ${suggestedOfferType.offerType}`}
                >
                  <Text style={styles.offerDescription}>
                    🏆 Based on your own history, {OFFER_TYPE_OPTIONS.find((o) => o.key === suggestedOfferType.offerType)?.label ?? suggestedOfferType.offerType} offers
                    get accepted {suggestedOfferType.rate}% of the time -- tap to use it
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
                    accessibilityLabel={o.label}
                    accessibilityState={{ selected: offerTypeInput === o.key }}
                  >
                    <Text style={[styles.chipText, offerTypeInput === o.key && styles.chipTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {offerTypeInput === 'alt_time' && (
                <>
                  <TouchableOpacity
                    style={[styles.input, { marginTop: spacing.sm, justifyContent: 'center' }]}
                    onPress={() => setShowOfferTimePicker(true)}
                    accessibilityLabel="Pick the time you're proposing"
                    accessibilityRole="button"
                  >
                    <Text style={{ color: offerProposedTime ? colors.textPrimary : colors.textTertiary }}>
                      {offerProposedTime
                        ? offerProposedTime.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                        : 'Pick a time…'}
                    </Text>
                  </TouchableOpacity>
                  {showOfferTimePicker && (
                    <DateTimePicker
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
              <TextInput
                style={[styles.input, { marginTop: spacing.sm, minHeight: 80 }]}
                placeholder="What are you offering? e.g. Table for 4 at 7:30, 15% off the check"
                placeholderTextColor={colors.textTertiary}
                value={offerDescriptionInput}
                onChangeText={setOfferDescriptionInput}
                multiline
                accessibilityLabel="Offer description"
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder="Price (optional)"
                placeholderTextColor={colors.textTertiary}
                value={offerPriceInput}
                onChangeText={setOfferPriceInput}
                keyboardType="decimal-pad"
                accessibilityLabel="Offer price, optional"
              />
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleSubmitOffer}
                disabled={respondingOpportunityId === offerModalRequestId || !offerDescriptionInput.trim() || (offerTypeInput === 'alt_time' && !offerProposedTime)}
                accessibilityLabel={respondingOpportunityId === offerModalRequestId ? 'Sending' : 'Send offer'}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{respondingOpportunityId === offerModalRequestId ? 'Sending...' : 'Send Offer'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setOfferModalRequestId(null)} style={{ marginTop: spacing.md }} accessibilityLabel="Cancel" accessibilityRole="button">
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={postAvailabilityModalVisible} animationType="slide" transparent onRequestClose={() => setPostAvailabilityModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>Post Availability</Text>
              <Text style={[styles.modalCloseText, { marginBottom: spacing.md }]}>
                We'll match this against open requests near you right now, and keep matching
                new ones for as long as it stays live.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="4 empty tables tonight"
                placeholderTextColor={colors.textTertiary}
                value={availabilityTitleInput}
                onChangeText={setAvailabilityTitleInput}
                accessibilityLabel="Availability title"
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm, minHeight: 70 }]}
                placeholder="Description (optional)"
                placeholderTextColor={colors.textTertiary}
                value={availabilityDescriptionInput}
                onChangeText={setAvailabilityDescriptionInput}
                multiline
                accessibilityLabel="Availability description, optional"
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>Category (optional)</Text>
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
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>What are you offering?</Text>
              <View style={styles.chipRow}>
                {OFFER_TYPE_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.key}
                    style={[styles.chip, availabilityOfferTypeInput === o.key && styles.chipSelected]}
                    onPress={() => setAvailabilityOfferTypeInput(o.key)}
                    accessibilityRole="button"
                    accessibilityLabel={o.label}
                    accessibilityState={{ selected: availabilityOfferTypeInput === o.key }}
                  >
                    <Text style={[styles.chipText, availabilityOfferTypeInput === o.key && styles.chipTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder="Price (optional)"
                placeholderTextColor={colors.textTertiary}
                value={availabilityPriceInput}
                onChangeText={setAvailabilityPriceInput}
                keyboardType="decimal-pad"
                accessibilityLabel="Price, optional"
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder="How many spots? (optional, e.g. 4)"
                placeholderTextColor={colors.textTertiary}
                value={availabilityCapacityInput}
                onChangeText={(t) => setAvailabilityCapacityInput(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                accessibilityLabel="Capacity, optional"
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>How long should this stay live?</Text>
              <View style={styles.chipRow}>
                {AVAILABILITY_DURATION_OPTIONS.map((d) => (
                  <TouchableOpacity
                    key={d.key}
                    style={[styles.chip, availabilityDurationKey === d.key && styles.chipSelected]}
                    onPress={() => setAvailabilityDurationKey(d.key)}
                    accessibilityRole="button"
                    accessibilityLabel={d.label}
                    accessibilityState={{ selected: availabilityDurationKey === d.key }}
                  >
                    <Text style={[styles.chipText, availabilityDurationKey === d.key && styles.chipTextSelected]}>{d.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.submitButton, { marginTop: spacing.md }]}
                onPress={handlePostAvailability}
                disabled={postingAvailability || !availabilityTitleInput.trim()}
                accessibilityLabel={postingAvailability ? 'Posting' : 'Post availability'}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{postingAvailability ? 'Posting...' : 'Post Availability'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPostAvailabilityModalVisible(false)} style={{ marginTop: spacing.md }} accessibilityLabel="Cancel" accessibilityRole="button">
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={policyModalVisible} animationType="slide" transparent onRequestClose={() => setPolicyModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.overlay}>
            <ScrollView style={styles.sheet} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>Fulfillment Policy</Text>
              <Text style={[styles.modalCloseText, { marginBottom: spacing.md }]}>
                A standing rule for every future request -- set it once, we'll match new
                requests against it automatically without you having to review each one.
              </Text>
              <Text style={styles.sectionHeader}>Party size range</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Min (optional)"
                  placeholderTextColor={colors.textTertiary}
                  value={policyPartySizeMinInput}
                  onChangeText={(t) => setPolicyPartySizeMinInput(t.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  accessibilityLabel="Minimum party size"
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Max (optional)"
                  placeholderTextColor={colors.textTertiary}
                  value={policyPartySizeMaxInput}
                  onChangeText={(t) => setPolicyPartySizeMaxInput(t.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  accessibilityLabel="Maximum party size"
                />
              </View>
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>Active hours (24h, optional)</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="17:00"
                  placeholderTextColor={colors.textTertiary}
                  value={policyActiveHoursStartInput}
                  onChangeText={setPolicyActiveHoursStartInput}
                  accessibilityLabel="Active hours start, 24-hour HH:MM"
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="22:00"
                  placeholderTextColor={colors.textTertiary}
                  value={policyActiveHoursEndInput}
                  onChangeText={setPolicyActiveHoursEndInput}
                  accessibilityLabel="Active hours end, 24-hour HH:MM"
                />
              </View>
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>Auto-accept party size up to</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 4 -- leave blank to review every request yourself"
                placeholderTextColor={colors.textTertiary}
                value={policyAutoAcceptMaxInput}
                onChangeText={(t) => setPolicyAutoAcceptMaxInput(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                accessibilityLabel="Auto-accept party size maximum"
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>Minimum spend per person (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="$"
                placeholderTextColor={colors.textTertiary}
                value={policyMinSpendInput}
                onChangeText={setPolicyMinSpendInput}
                keyboardType="decimal-pad"
                accessibilityLabel="Minimum spend per person"
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>Max discount % (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="0-100"
                placeholderTextColor={colors.textTertiary}
                value={policyMaxDiscountInput}
                onChangeText={setPolicyMaxDiscountInput}
                keyboardType="decimal-pad"
                accessibilityLabel="Maximum discount percent"
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>Deposit (optional, stored only -- not charged)</Text>
              <TextInput
                style={styles.input}
                placeholder="$"
                placeholderTextColor={colors.textTertiary}
                value={policyDepositInput}
                onChangeText={setPolicyDepositInput}
                keyboardType="decimal-pad"
                accessibilityLabel="Deposit amount, stored only, not charged"
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>Cancellation window, hours (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 2"
                placeholderTextColor={colors.textTertiary}
                value={policyCancellationWindowInput}
                onChangeText={(t) => setPolicyCancellationWindowInput(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                accessibilityLabel="Cancellation window in hours"
              />
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>Weather-Dependent</Text>
              <Text style={styles.helperText}>
                For outdoor/patio-only capacity. When on, auto-accept pauses itself during real
                rain or storms at your location (checked hourly) and picks back up once
                conditions clear -- no separate posting needed.
              </Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, policyWeatherDependentInput && styles.chipSelected]}
                  onPress={() => setPolicyWeatherDependentInput(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Weather-dependent on"
                  accessibilityState={{ selected: policyWeatherDependentInput }}
                >
                  <Text style={[styles.chipText, policyWeatherDependentInput && styles.chipTextSelected]}>On</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, !policyWeatherDependentInput && styles.chipSelected]}
                  onPress={() => setPolicyWeatherDependentInput(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Weather-dependent off"
                  accessibilityState={{ selected: !policyWeatherDependentInput }}
                >
                  <Text style={[styles.chipText, !policyWeatherDependentInput && styles.chipTextSelected]}>Off</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>Status</Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, policyActiveInput && styles.chipSelected]}
                  onPress={() => setPolicyActiveInput(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Active"
                  accessibilityState={{ selected: policyActiveInput }}
                >
                  <Text style={[styles.chipText, policyActiveInput && styles.chipTextSelected]}>Active</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, !policyActiveInput && styles.chipSelected]}
                  onPress={() => setPolicyActiveInput(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Paused"
                  accessibilityState={{ selected: !policyActiveInput }}
                >
                  <Text style={[styles.chipText, !policyActiveInput && styles.chipTextSelected]}>Paused</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.submitButton, { marginTop: spacing.md }]}
                onPress={handleSavePolicy}
                disabled={savingPolicy}
                accessibilityLabel={savingPolicy ? 'Saving' : 'Save policy'}
                accessibilityRole="button"
              >
                <Text style={styles.submitButtonText}>{savingPolicy ? 'Saving...' : 'Save Policy'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPolicyModalVisible(false)} style={{ marginTop: spacing.md, marginBottom: spacing.lg }} accessibilityLabel="Cancel" accessibilityRole="button">
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
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