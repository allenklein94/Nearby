import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, Modal, TextInput, Alert, Switch, Keyboard, TouchableWithoutFeedback, KeyboardAvoidingView, Platform, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import QRCode from 'react-native-qrcode-svg';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { getMyBusinessOffers, createBusinessOffer, toggleOfferActive, getMyBusinessGatherings, postBusinessUpdate, getBusinessInsights, updateBusinessAddress, updateBusinessProfile, getRedemptionCounts, getEstimatedAmountOwed, getMyManagedPartner, confirmOfferRedemption, getBusinessDiscoveryStats } from '../services/brandOffers';
import { getBusinessCommunities } from '../services/communities';
import { getBusinessConversations, replyAsBusinessOwner, getBusinessMessagesPage, getBusinessTopMembers, getBusinessVisitFrequency, getBusinessMemberGatheringHistory, getBusinessCustomerNote, saveBusinessCustomerNote } from '../services/brandOffers';
import { getPendingPartnershipRequestsForPartner, respondToBusinessPartnershipRequest } from '../services/businessPartnerships';
import { getBusinessOpportunities, submitBusinessOfferResponse, declineBusinessOpportunity, postBusinessAvailability, cancelBusinessAvailability, getMyBusinessAvailability, getAggregatedDemandForPartner, getMyBusinessFulfillmentPolicy, upsertBusinessFulfillmentPolicy, formatOfferSummary } from '../services/businessFulfillment';
import { checkTextModeration } from '../services/textModeration';
import { logBusinessAcquisitionEvent } from '../services/businessAcquisitionEvents';
import { getMyStripeConnectStatus, startStripeOnboarding, isStripeConfigured } from '../services/stripeConnect';
import { getMyReservationProviderStatus, updateReservationProvider } from '../services/reservationProvider';
import { captureStoryMedia, uploadBusinessMoment } from '../services/stories';
import { BUSINESS_CATEGORIES } from './BusinessPartnerApplyScreen';
import { BUSINESS_ATTRIBUTE_OPTIONS, CUISINE_OPTIONS, businessAttributeLabel, cuisineLabel } from '../constants/businessAttributes';
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
  const [savingProfile, setSavingProfile] = useState(false);
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

  useEffect(() => {
    loadMyPartner();
  }, []);

  async function loadMyPartner() {
    try {
      const partner = await getMyManagedPartner();
      setSelectedPartner(partner);
      setLoadError(false);
      if (partner) {
        logBusinessAcquisitionEvent(sessionId, 'dashboard_viewed', { partnerId: partner.id });
        const seenKey = `business_dashboard_welcome_seen_${partner.id}`;
        const seen = await AsyncStorage.getItem(seenKey);
        if (!seen) setShowWelcomeCard(true);
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

  async function handleSaveProfile() {
    if (!editNameInput.trim()) return;
    setSavingProfile(true);
    try {
      await updateBusinessProfile(selectedPartner.id, {
        name: editNameInput.trim(),
        description: editDescriptionInput.trim() || null,
        address: selectedPartner.address ?? null,
        logoUrl: editLogoUrlInput.trim() || null,
        category: editCategoryInput,
        attributes: editAttributesInput,
        cuisine: editCategoryInput === 'food_drink' ? editCuisineInput : null,
      });
      setSelectedPartner((prev) => ({
        ...prev,
        name: editNameInput.trim(),
        description: editDescriptionInput.trim() || null,
        logo_url: editLogoUrlInput.trim() || null,
        category: editCategoryInput,
        attributes: editAttributesInput,
        cuisine: editCategoryInput === 'food_drink' ? editCuisineInput : null,
      }));
      setEditProfileModalVisible(false);
      Alert.alert('Saved', 'Your business profile has been updated.');
      logBusinessAcquisitionEvent(sessionId, 'profile_completed', { partnerId: selectedPartner.id });
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSavingProfile(false);
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
      }
    }, [selectedPartner])
  );

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

  async function handleSubmitOffer() {
    if (!offerDescriptionInput.trim()) {
      Alert.alert('Add a description', 'Say what you can offer.');
      return;
    }
    if (offerTypeInput === 'alt_time' && !offerProposedTime) {
      Alert.alert('Pick a time', 'Choose the time you’re proposing instead.');
      return;
    }
    const descCheck = await checkTextModeration(offerDescriptionInput);
    if (!descCheck.safe) {
      Alert.alert('Not allowed', 'Please revise your offer description and try again.');
      return;
    }
    setRespondingOpportunityId(offerModalRequestId);
    try {
      const priceNum = offerPriceInput.trim() ? parseFloat(offerPriceInput.trim()) : null;
      await submitBusinessOfferResponse(offerModalRequestId, {
        offerType: offerTypeInput,
        offerDescription: offerDescriptionInput.trim(),
        offerPrice: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : null,
        proposedTime: offerTypeInput === 'alt_time' && offerProposedTime ? offerProposedTime.toISOString() : null,
      });
      setOfferModalRequestId(null);
      await loadOpportunities(selectedPartner.id);
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
  // Pure UI wiring -- postBusinessAvailability() itself is unchanged, and
  // every field stays editable before Post, same as the blank-start path.
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

  async function handlePostAvailability() {
    if (!availabilityTitleInput.trim()) {
      Alert.alert('Add a title', 'Say what you have available, e.g. "4 empty tables tonight".');
      return;
    }
    const titleCheck = await checkTextModeration(availabilityTitleInput);
    if (!titleCheck.safe) {
      Alert.alert('Title not allowed', 'Please revise and try again.');
      return;
    }
    setPostingAvailability(true);
    try {
      const duration = AVAILABILITY_DURATION_OPTIONS.find((d) => d.key === availabilityDurationKey);
      const startsAt = new Date();
      const endsAt = duration.hours
        ? new Date(startsAt.getTime() + duration.hours * 60 * 60 * 1000)
        : new Date(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate(), 23, 59, 59);
      const priceNum = availabilityPriceInput.trim() ? parseFloat(availabilityPriceInput.trim()) : null;
      const capacityNum = availabilityCapacityInput.trim() ? parseInt(availabilityCapacityInput.trim(), 10) : null;
      const { matchedCount } = await postBusinessAvailability({
        category: availabilityCategoryInput,
        title: availabilityTitleInput.trim(),
        description: availabilityDescriptionInput.trim() || null,
        offerType: availabilityOfferTypeInput,
        price: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : null,
        capacity: Number.isFinite(capacityNum) && capacityNum > 0 ? capacityNum : null,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      });
      setPostAvailabilityModalVisible(false);
      await loadMyAvailability(selectedPartner.id);
      Alert.alert(
        'Posted!',
        matchedCount > 0
          ? `We matched this against ${matchedCount} open request${matchedCount === 1 ? '' : 's'} nearby -- they'll see your offer right away.`
          : 'No open requests match this right now, but it stays live for anyone who asks while it\'s active.'
      );
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
      Alert.alert('Error', e.message);
    }
    setPostingMoment(false);
  }

  async function handlePostUpdate() {
    if (!updateTitle.trim()) {
      return Alert.alert('Title required', 'Give your update a short title.');
    }
    const titleCheck = await checkTextModeration(updateTitle);
    if (!titleCheck.safe) {
      return Alert.alert('Title not allowed', 'Please revise and try again.');
    }
    setPostingUpdate(true);
    try {
      await postBusinessUpdate(selectedPartner.id, updateTitle.trim(), updateBody.trim() || null);
      setUpdateModalVisible(false);
      setUpdateTitle('');
      setUpdateBody('');
      Alert.alert('Sent', 'Your followers have been notified.');
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setPostingUpdate(false);
  }

  async function handleCreateOffer() {
    if (!newTitle.trim()) {
      return Alert.alert('Title required', 'Give your offer a title.');
    }
    const titleCheck = await checkTextModeration(newTitle);
    if (!titleCheck.safe) {
      return Alert.alert('Title not allowed', 'Please revise and try again.');
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
      await createBusinessOffer({
        partnerId: selectedPartner.id,
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
                      onPress={() => setEditProfileModalVisible(true)}
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

                <Text style={styles.sectionHeader}>📊 Demand Near You</Text>
                <Text style={styles.helperText}>
                  Real open requests within reach of your business right now, grouped by
                  category -- a quantified early signal, not a review score. Categories marked
                  🟡 are a softer signal: real recent searches nearby that found nothing, not a
                  confirmed request. Reads near-zero until there's real volume nearby, which is
                  expected this early on.
                </Text>
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
                {opportunities.length === 0 ? (
                  <Text style={styles.emptyText}>No requests yet.</Text>
                ) : (
                  opportunities.map((o) => (
                    <View key={o.id} style={styles.gatheringRow}>
                      <Text style={styles.offerTitle}>{o.business_requests?.raw_text}</Text>
                      <Text style={styles.breakdownText}>
                        {[
                          o.business_requests?.category,
                          o.business_requests?.party_size ? `${o.business_requests.party_size} people` : null,
                          o.business_requests?.budget_max ? `up to $${o.business_requests.budget_max}` : null,
                        ].filter(Boolean).join(' · ') || 'No further details given'}
                      </Text>
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
                  ))
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
              <TouchableOpacity
                style={[styles.createOfferButton, { marginTop: spacing.lg }]}
                onPress={() => navigation.navigate('BusinessAIAssistant', { partnerId: selectedPartner.id, partnerName: selectedPartner.name })}
                accessibilityLabel="Ask the AI Assistant about your business"
                accessibilityRole="button"
              >
                <Text style={styles.createOfferButtonText}>✨ Ask the AI Assistant</Text>
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
                  <TouchableOpacity
                    onPress={() => {
                      setEditNameInput(selectedPartner?.name ?? '');
                      setEditDescriptionInput(selectedPartner?.description ?? '');
                      setEditLogoUrlInput(selectedPartner?.logo_url ?? '');
                      setEditCategoryInput(selectedPartner?.category ?? null);
                      setEditAttributesInput(selectedPartner?.attributes ?? []);
                      setEditCuisineInput(selectedPartner?.cuisine ?? null);
                      setEditProfileModalVisible(true);
                    }}
                    style={{ marginTop: spacing.sm }}
                    accessibilityLabel="Edit business profile"
                    accessibilityRole="button"
                  >
                    <Text style={styles.messageMemberLink}>✏️ Edit Profile</Text>
                  </TouchableOpacity>
                </View>

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
              <Text style={[styles.sectionHeader, { marginTop: spacing.md }]}>Attributes</Text>
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
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>Make an Offer</Text>
              <Text style={[styles.modalCloseText, { marginBottom: spacing.md }]}>
                Never just a discount -- offer whatever fits: your normal price, a discount, a
                perk, an upgrade, or a different time that works better.
              </Text>
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
            </View>
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