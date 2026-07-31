import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, FlatList, Modal, TextInput, Alert, Switch, Keyboard, TouchableWithoutFeedback } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { getMyBusinessOffers, createBusinessOffer, toggleOfferActive, getMyBusinessGatherings, postBusinessUpdate } from '../services/brandOffers';
import { checkTextModeration } from '../services/textModeration';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export default function BusinessDashboardScreen() {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [partners, setPartners] = useState([]);
  const [selectedPartner, setSelectedPartner] = useState(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offers, setOffers] = useState([]);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newInstructions, setNewInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [gatherings, setGatherings] = useState([]);
  const [updateModalVisible, setUpdateModalVisible] = useState(false);
  const [updateTitle, setUpdateTitle] = useState('');
  const [updateBody, setUpdateBody] = useState('');
  const [postingUpdate, setPostingUpdate] = useState(false);

  useEffect(() => {
    loadPartners();
  }, []);

  async function loadPartners() {
    const { data } = await supabase.from('brand_partners').select('id, name').order('name');
    setPartners(data ?? []);
    if (data?.[0]) setSelectedPartner(data[0]);
    setLoading(false);
  }

  useFocusEffect(
    useCallback(() => {
      if (selectedPartner) {
        loadStats(selectedPartner.id);
        loadOffers(selectedPartner.id);
        loadGatherings(selectedPartner.id);
      }
    }, [selectedPartner])
  );

  async function loadStats(partnerId) {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_business_dashboard_stats', { partner_id_param: partnerId });
    if (!error) setStats(data?.[0] ?? null);
    setLoading(false);
  }

  async function loadOffers(partnerId) {
    const results = await getMyBusinessOffers(partnerId);
    setOffers(results);
  }

  async function loadGatherings(partnerId) {
    const results = await getMyBusinessGatherings(partnerId);
    setGatherings(results);
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

    setSubmitting(true);
    try {
      await createBusinessOffer({
        partnerId: selectedPartner.id,
        title: newTitle.trim(),
        description: newDescription.trim() || null,
        rewardType: 'discount',
        redemptionInstructions: newInstructions.trim() || null,
      });
      setCreateModalVisible(false);
      setNewTitle('');
      setNewDescription('');
      setNewInstructions('');
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.title}>Business Dashboard</Text>

        <TouchableOpacity
          style={styles.partnerSelector}
          onPress={() => setPickerVisible(true)}
          accessibilityLabel={`Viewing ${selectedPartner?.name ?? 'no business selected'}, tap to change`}
          accessibilityRole="button"
        >
          <Text style={styles.partnerSelectorText}>{selectedPartner?.name ?? 'Select a business'}</Text>
          <Text style={styles.partnerSelectorChevron}>▾</Text>
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : stats ? (
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
          </>
        ) : (
          <Text style={styles.emptyText}>No data yet for this business.</Text>
        )}

        <Text style={styles.sectionHeader}>Gatherings</Text>
        {gatherings.length === 0 ? (
          <Text style={styles.emptyText}>No gatherings hosted yet — create one from the Create tab and it'll show up here.</Text>
        ) : (
          gatherings.map((g) => (
            <View key={g.id} style={styles.gatheringRow}>
              <Text style={styles.offerTitle}>{g.title}</Text>
              <Text style={styles.offerDescription}>{formatDate(g.scheduled_at)}</Text>
            </View>
          ))
        )}

        <TouchableOpacity
          style={styles.postUpdateButton}
          onPress={() => setUpdateModalVisible(true)}
          accessibilityLabel="Post an update to your followers"
          accessibilityRole="button"
        >
          <Text style={styles.postUpdateButtonText}>📣 Post Update to Followers</Text>
        </TouchableOpacity>

        <View style={styles.offersHeader}>
          <Text style={styles.sectionHeader}>Rewards & Offers</Text>
          <TouchableOpacity
            style={styles.createOfferButton}
            onPress={() => setCreateModalVisible(true)}
            accessibilityLabel="Create a new offer"
            accessibilityRole="button"
          >
            <Text style={styles.createOfferButtonText}>+ Create</Text>
          </TouchableOpacity>
        </View>

        {offers.length === 0 ? (
          <Text style={styles.emptyText}>No offers yet — create one to give your community a reason to visit.</Text>
        ) : (
          offers.map((offer) => (
            <View key={offer.id} style={styles.offerCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.offerTitle}>{offer.title}</Text>
                {offer.description ? <Text style={styles.offerDescription}>{offer.description}</Text> : null}
              </View>
              <Switch
                value={offer.active}
                onValueChange={() => handleToggleActive(offer)}
                accessibilityLabel={`${offer.title}, ${offer.active ? 'active' : 'inactive'}, tap to toggle`}
              />
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={pickerVisible} animationType="slide" onRequestClose={() => setPickerVisible(false)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select a Business</Text>
            <TouchableOpacity onPress={() => setPickerVisible(false)} accessibilityLabel="Close" accessibilityRole="button">
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={partners}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: spacing.lg }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.partnerRow}
                onPress={() => {
                  setSelectedPartner(item);
                  setPickerVisible(false);
                }}
                accessibilityLabel={item.name}
                accessibilityRole="button"
              >
                <Text style={styles.partnerRowText}>{item.name}</Text>
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>

      <Modal visible={createModalVisible} animationType="slide" transparent onRequestClose={() => setCreateModalVisible(false)}>
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
      </Modal>
      <Modal visible={updateModalVisible} animationType="slide" transparent onRequestClose={() => setUpdateModalVisible(false)}>
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
      </Modal>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.md },
  partnerSelector: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  partnerSelectorText: { ...typography.bodyBold, color: colors.textPrimary },
  partnerSelectorChevron: { color: colors.textTertiary, fontSize: 16 },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statCard: {
    width: '31%', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, alignItems: 'center', ...shadow.card,
  },
  statNumber: { ...typography.title, color: colors.primary },
  statLabel: { color: colors.textTertiary, fontSize: 11, textAlign: 'center', marginTop: 2 },
  helperText: { color: colors.textTertiary, fontSize: 12, lineHeight: 18, marginTop: spacing.lg, fontStyle: 'italic' },
  emptyText: { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.md },
  offersHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.sm },
  createOfferButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  createOfferButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  postUpdateButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14,
    alignItems: 'center', marginTop: spacing.xl,
  },
  postUpdateButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  offerCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  offerTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 14 },
  offerDescription: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  gatheringRow: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg },
  modalTitle: { ...typography.title, color: colors.textPrimary },
  modalCloseText: { color: colors.primary, fontWeight: '600' },
  partnerRow: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  partnerRowText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.md },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  submitButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  submitButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});