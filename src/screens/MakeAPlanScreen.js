import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, Image, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { supabase } from '../services/supabase';
import { getOfferById } from '../services/brandOffers';
import { createGathering, getFriendsWithSharedContext } from '../services/gatherings';
import { sendInvite } from '../services/invites';
import { getSignedPhotoUrl } from '../services/photos';
import { checkTextModeration } from '../services/textModeration';
import LoadErrorState from '../components/LoadErrorState';
import { WHEN_PRESETS, dateForPreset } from '../utils/whenPresets';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Phase 4 of the "build everything" plan (see CLAUDE.md): "Make a plan" —
// one-tap orchestration over already-proven primitives (createGathering,
// sendInvite, GatheringConfirmationScreen's existing success shape), not
// a new atomic transaction/RPC. Reachable only from a perk-type Phase 1
// Home recommendation, not a gathering-type one -- see this file's own
// header comment in HomeScreen.js and CLAUDE.md's Phase 4 status note for
// the full reasoning: a gathering-type recommendation already names a
// real, existing event someone else is running (join is the honest
// action there, already one tap away); a perk-type recommendation is a
// standing business offer with no event around it yet, which is exactly
// where "create a new gathering, host it, invite people" is a genuine
// value-add rather than a confusing duplicate.
export default function MakeAPlanScreen({ route, navigation }) {
  const { offerId } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [offer, setOffer] = useState(null);
  const [title, setTitle] = useState('');
  const [whenPreset, setWhenPreset] = useState(null);
  const [scheduledAt, setScheduledAt] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [myUserId, setMyUserId] = useState(null);
  const [friends, setFriends] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [selectedFriendIds, setSelectedFriendIds] = useState({});
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadingFriends(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const myId = sessionData?.session?.user?.id;
      setMyUserId(myId);

      const found = await getOfferById(offerId);
      if (!found) {
        setLoadError(true);
        setLoading(false);
        setLoadingFriends(false);
        return;
      }
      setOffer(found);
      const partnerName = found.brand_partners?.name;
      setTitle(partnerName ? `${found.title} at ${partnerName}` : found.title);
      setLoadError(false);

      if (myId) {
        const list = await getFriendsWithSharedContext(myId);
        setFriends(list);
        const urlEntries = await Promise.all(
          list.map(async (f) => {
            if (!f.photo_url) return [f.id, null];
            return [f.id, await getSignedPhotoUrl(f.photo_url)];
          })
        );
        setPhotoUrls(Object.fromEntries(urlEntries));
      }
    } catch (e) {
      console.error('MakeAPlanScreen load failed', e);
      setLoadError(true);
    }
    setLoading(false);
    setLoadingFriends(false);
  }, [offerId]);

  useEffect(() => {
    load();
  }, [load]);

  function pickPreset(preset) {
    Haptics.selectionAsync();
    setWhenPreset(preset);
    if (preset === 'custom') {
      setShowPicker(true);
      return;
    }
    setScheduledAt(dateForPreset(preset));
  }

  function toggleFriend(id) {
    Haptics.selectionAsync();
    setSelectedFriendIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleConfirm() {
    if (!title.trim()) {
      return Alert.alert('Add a title', 'Give your plan a title before confirming.');
    }
    if (!scheduledAt) {
      return Alert.alert('Pick a time', 'Choose when this is happening.');
    }

    const titleCheck = await checkTextModeration(title);
    if (!titleCheck.safe) {
      return Alert.alert('Title not allowed', 'Please revise your title and try again.');
    }

    setConfirming(true);
    try {
      const partner = offer?.brand_partners;
      // The offer's own coordinates win when set (a real, specific spot
      // within the business, e.g. a particular counter); otherwise the
      // partner's own address coordinates; when neither exists,
      // createGathering() already falls back to the caller's own current
      // device location, matching Create 2.0's own established behavior
      // rather than inventing a third fallback here.
      const lat = offer?.latitude ?? partner?.latitude ?? null;
      const lng = offer?.longitude ?? partner?.longitude ?? null;
      const customLocation = lat != null && lng != null ? { latitude: lat, longitude: lng } : null;

      const created = await createGathering({
        title: title.trim(),
        description: offer?.description ?? null,
        interestTag: offer?.target_interest_tag ?? null,
        scheduledAt: scheduledAt.toISOString(),
        isPublic: true,
        customLocation,
        showOnMap: true,
      });

      const selectedIds = Object.keys(selectedFriendIds).filter((id) => selectedFriendIds[id]);
      let sentCount = 0;
      if (selectedIds.length > 0) {
        const results = await Promise.allSettled(
          selectedIds.map((friendId) => sendInvite('gathering', created.id, friendId))
        );
        sentCount = results.filter((r) => r.status === 'fulfilled').length;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.replace('GatheringConfirmation', {
        gatheringId: created.id,
        placeName: partner?.name ?? null,
        preInviteResult: selectedIds.length > 0 ? { sent: sentCount, total: selectedIds.length } : null,
      });
    } catch (e) {
      // Partial failure surfaces honestly rather than a fake all-or-
      // nothing guarantee — matches this whole phase's own locked
      // decision not to build a single atomic transaction/RPC for this.
      Alert.alert('Something went wrong', e.message || 'Could not create your plan. Please try again.');
    }
    setConfirming(false);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.centered}>
        <LoadErrorState message="Couldn't load this perk." onRetry={load} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.subtitle}>
          Turn this into a real plan — pick a time and who to invite. You're the host.
        </Text>

        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="What are you planning?"
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel="Plan title"
        />

        <Text style={styles.label}>When?</Text>
        <View style={styles.chipsWrap}>
          {WHEN_PRESETS.map((preset) => (
            <TouchableOpacity
              key={preset.key}
              style={[styles.chip, whenPreset === preset.key && styles.chipSelected]}
              onPress={() => pickPreset(preset.key)}
              activeOpacity={0.8}
              accessibilityLabel={preset.label}
              accessibilityRole="button"
              accessibilityState={{ selected: whenPreset === preset.key }}
            >
              <Text style={[styles.chipText, whenPreset === preset.key && styles.chipTextSelected]}>
                {preset.icon} {preset.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {scheduledAt && (
          <Text style={styles.whenSummary}>
            {scheduledAt.toLocaleDateString([], { month: 'short', day: 'numeric' })} · {scheduledAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </Text>
        )}
        {showPicker && (
          <DateTimePicker
            value={scheduledAt || new Date()}
            mode="datetime"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minimumDate={new Date()}
            onChange={(event, selectedDate) => {
              if (Platform.OS === 'android') setShowPicker(false);
              if (selectedDate) setScheduledAt(selectedDate);
            }}
          />
        )}

        <Text style={styles.label}>Invite Friends</Text>
        <Text style={styles.helperText}>Only people you're already friends with — never nearby strangers.</Text>
        {loadingFriends ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
        ) : friends.length === 0 ? (
          <Text style={styles.emptyText}>Add some friends first to be able to invite them here.</Text>
        ) : (
          friends.map((f) => {
            const selected = !!selectedFriendIds[f.id];
            return (
              <TouchableOpacity
                key={f.id}
                style={styles.friendRow}
                onPress={() => toggleFriend(f.id)}
                activeOpacity={0.8}
                accessibilityLabel={`${selected ? 'Deselect' : 'Select'} ${f.display_name}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
              >
                {photoUrls[f.id] ? (
                  <Image source={{ uri: photoUrls[f.id] }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.friendName}>{f.display_name}</Text>
                  {f.sharedContext && <Text style={styles.friendContext}>{f.sharedContext}</Text>}
                </View>
                <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                  {selected && <Text style={styles.checkboxMark}>✓</Text>}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.confirmButton, shadow.button, confirming && styles.confirmButtonDisabled]}
          onPress={handleConfirm}
          disabled={confirming}
          activeOpacity={0.85}
          accessibilityLabel="Confirm plan"
          accessibilityRole="button"
        >
          {confirming ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.confirmButtonText}>Confirm</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  label: { ...typography.body, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  helperText: { ...typography.small, color: colors.textTertiary, marginBottom: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md, color: colors.textPrimary, backgroundColor: colors.surface, fontSize: 16,
  },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.small, color: colors.textPrimary, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  whenSummary: { ...typography.small, color: colors.textSecondary, marginTop: spacing.sm },
  emptyText: { color: colors.textTertiary, textAlign: 'center', paddingVertical: spacing.lg, lineHeight: 20 },
  friendRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  avatarPlaceholder: {},
  friendName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  friendContext: { color: colors.textTertiary, fontSize: 11, marginTop: 1 },
  checkbox: {
    width: 24, height: 24, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { color: '#fff', fontWeight: '800', fontSize: 14 },
  footer: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  confirmButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center' },
  confirmButtonDisabled: { opacity: 0.7 },
  confirmButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
