import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, Modal, TextInput, Alert, Switch, Keyboard, TouchableWithoutFeedback, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { getMyBusinessOffers, createBusinessOffer, toggleOfferActive, getMyBusinessGatherings, postBusinessUpdate, getBusinessInsights, updateBusinessAddress, updateBusinessProfile, getRedemptionCounts, getEstimatedAmountOwed, getMyManagedPartner, confirmOfferRedemption } from '../services/brandOffers';
import { getBusinessCommunities } from '../services/communities';
import { getBusinessConversations, replyAsBusinessOwner, getBusinessMessagesPage, getBusinessTopMembers, getBusinessVisitFrequency, getBusinessMemberGatheringHistory, getBusinessCustomerNote, saveBusinessCustomerNote } from '../services/brandOffers';
import { getPendingPartnershipRequestsForPartner, respondToBusinessPartnershipRequest } from '../services/businessPartnerships';
import { getBusinessOpportunities, submitBusinessOfferResponse, declineBusinessOpportunity, postBusinessAvailability, cancelBusinessAvailability, getMyBusinessAvailability } from '../services/businessFulfillment';
import { checkTextModeration } from '../services/textModeration';
import { BUSINESS_CATEGORIES } from './BusinessPartnerApplyScreen';
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

// Same 24-tag list business_requests/business_availability's own category
// CHECK constraints validate against (mirrors AskBusinessScreen.js's own
// copy of create-assistant's VALID_CATEGORIES) -- kept local rather than
// imported so this file has no new cross-screen dependency.
const AVAILABILITY_CATEGORY_OPTIONS = [
  'Travel', 'Coffee', 'Hiking', 'Music', 'Movies', 'Foodie', 'Fitness',
  'Reading', 'Art', 'Gaming', 'Photography', 'Yoga', 'Dancing', 'Cooking',
  'Wine', 'Dogs', 'Cats', 'Outdoors', 'Sports', 'Concerts', 'Museums',
  'Volunteering', 'Meditation', 'Running',
];

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

export default function BusinessDashboardScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [section, setSection] = useState('home');
  const [selectedPartner, setSelectedPartner] = useState(null);
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
  const [needsAttention, setNeedsAttention] = useState([]);
  const [topMembers, setTopMembers] = useState([]);
  const [expandedMemberId, setExpandedMemberId] = useState(null);
  const [memberHistories, setMemberHistories] = useState({});
  const [loadingMemberHistory, setLoadingMemberHistory] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [tagsDraft, setTagsDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [visitFrequency, setVisitFrequency] = useState(null);
  const [partnershipRequests, setPartnershipRequests] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
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
  const [offerTypeInput, setOfferTypeInput] = useState('standard');
  const [offerDescriptionInput, setOfferDescriptionInput] = useState('');
  const [offerPriceInput, setOfferPriceInput] = useState('');
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

  useEffect(() => {
    loadMyPartner();
  }, []);

  async function loadMyPartner() {
    try {
      const partner = await getMyManagedPartner();
      setSelectedPartner(partner);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateAddress() {
    if (!addressInput.trim()) return;
    setSavingAddress(true);
    try {
      await updateBusinessAddress(selectedPartner.id, addressInput.trim());
      setSelectedPartner((prev) => ({ ...prev, address: addressInput.trim() }));
      setAddressModalVisible(false);
      Alert.alert('Saved', 'Your business address is now set — offers will show to people nearby.');
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
      });
      setSelectedPartner((prev) => ({
        ...prev,
        name: editNameInput.trim(),
        description: editDescriptionInput.trim() || null,
        logo_url: editLogoUrlInput.trim() || null,
        category: editCategoryInput,
      }));
      setEditProfileModalVisible(false);
      Alert.alert('Saved', 'Your business profile has been updated.');
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSavingProfile(false);
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
        loadPartnershipRequests(selectedPartner.id);
        loadOpportunities(selectedPartner.id);
        loadMyAvailability(selectedPartner.id);
      }
    }, [selectedPartner])
  );

  async function loadPartnershipRequests(partnerId) {
    const results = await getPendingPartnershipRequestsForPartner(partnerId);
    setPartnershipRequests(results);
  }

  async function loadOpportunities(partnerId) {
    try {
      const results = await getBusinessOpportunities(partnerId);
      setOpportunities(results);
    } catch (e) {
      // Non-fatal -- the rest of the dashboard already loaded independently.
    }
  }

  function openOfferModal(requestId) {
    setOfferModalRequestId(requestId);
    setOfferTypeInput('standard');
    setOfferDescriptionInput('');
    setOfferPriceInput('');
  }

  async function handleSubmitOffer() {
    if (!offerDescriptionInput.trim()) {
      Alert.alert('Add a description', 'Say what you can offer.');
      return;
    }
    setRespondingOpportunityId(offerModalRequestId);
    try {
      const priceNum = offerPriceInput.trim() ? parseFloat(offerPriceInput.trim()) : null;
      await submitBusinessOfferResponse(offerModalRequestId, {
        offerType: offerTypeInput,
        offerDescription: offerDescriptionInput.trim(),
        offerPrice: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : null,
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

  function openPostAvailabilityModal() {
    setAvailabilityTitleInput('');
    setAvailabilityDescriptionInput('');
    setAvailabilityCategoryInput(null);
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
    const results = await getMyBusinessOffers(partnerId);
    setOffers(results);
    const counts = await getRedemptionCounts(results.map((o) => o.id));
    setOfferRedemptionCounts(counts);
  }

  async function loadGatherings(partnerId) {
    const results = await getMyBusinessGatherings(partnerId);
    setGatherings(results);

    const breakdowns = await Promise.all(
      results.map(async (g) => {
        const { data } = await supabase.rpc('get_gathering_attendee_breakdown', { gathering_id_param: g.id });
        return [g.id, data?.[0] ?? null];
      })
    );
    setGatheringBreakdowns(Object.fromEntries(breakdowns));
  }

  async function loadGrowth(partnerId) {
    const { data, error } = await supabase.rpc('get_business_growth', { partner_id_param: partnerId });
    if (!error) setGrowth(data?.[0] ?? null);
  }

  async function loadConversations(partnerId) {
    const results = await getBusinessConversations(partnerId);
    setConversations(results);
    return results;
  }

  async function loadNeedsAttention(partnerId, conversationsList) {
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
  }

  async function loadTopMembers(partnerId) {
    const results = await getBusinessTopMembers(partnerId);
    setTopMembers(results);
  }

  async function handleToggleMemberHistory(member) {
    if (expandedMemberId === member.user_id) {
      setExpandedMemberId(null);
      return;
    }
    setExpandedMemberId(member.user_id);
    if (!memberHistories[member.user_id]) {
      setLoadingMemberHistory(true);
      const history = await getBusinessMemberGatheringHistory(selectedPartner.id, member.user_id);
      setMemberHistories((prev) => ({ ...prev, [member.user_id]: history }));
      setLoadingMemberHistory(false);
    }
    const existingNote = await getBusinessCustomerNote(selectedPartner.id, member.user_id);
    setNoteDraft(existingNote?.note ?? '');
    setTagsDraft((existingNote?.tags ?? []).join(', '));
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
    const result = await getBusinessVisitFrequency(partnerId);
    setVisitFrequency(result);
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
    const result = await getBusinessInsights(partnerId);
    setInsights(result);
    const owed = await getEstimatedAmountOwed(partnerId).catch(() => ({ redemptionCount: 0, estimatedAmount: 0 }));
    setEstimatedOwed(owed);
  }

  async function loadCommunities(partnerId) {
    const results = await getBusinessCommunities(partnerId);
    setCommunities(results);
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
              stats ? (
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

                  {selectedPartner && (
                    <TouchableOpacity
                      onPress={() => navigation.navigate('BusinessProfile', { partnerId: selectedPartner.id })}
                      accessibilityLabel="View your public business profile"
                      accessibilityRole="button"
                    >
                      <Text style={styles.viewProfileLink}>👀 View Public Profile →</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <Text style={styles.emptyText}>No data yet for this business.</Text>
              )
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
                <Text style={styles.sectionHeader}>Business Opportunities</Text>
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
                    onPress={openPostAvailabilityModal}
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
              </>
            )}

            {section === 'insights' && (
              <>
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
                      setEditProfileModalVisible(true);
                    }}
                    style={{ marginTop: spacing.sm }}
                    accessibilityLabel="Edit business profile"
                    accessibilityRole="button"
                  >
                    <Text style={styles.messageMemberLink}>✏️ Edit Profile</Text>
                  </TouchableOpacity>
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
                    onPress={() => setOfferTypeInput(o.key)}
                    accessibilityRole="button"
                    accessibilityLabel={o.label}
                    accessibilityState={{ selected: offerTypeInput === o.key }}
                  >
                    <Text style={[styles.chipText, offerTypeInput === o.key && styles.chipTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
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
                disabled={respondingOpportunityId === offerModalRequestId || !offerDescriptionInput.trim()}
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