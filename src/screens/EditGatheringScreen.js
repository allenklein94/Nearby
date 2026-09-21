import { EQUIPMENT_OPTIONS, DURATION_OPTIONS, GENRE_OPTIONS, GATHERING_FEATURE_OPTIONS, cleanFeatures, toggleFeature, isMusicTag } from '../utils/gatheringPractical';
import React, { useState, useEffect } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert, Platform, Keyboard, TouchableWithoutFeedback, Image, Switch } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { updateGathering, setGatheringCapacity, setGatheringCategoryIfMissing, pickGatheringCoverPhoto, uploadGatheringCoverPhoto, getSignedGatheringPhotoUrl } from '../services/gatherings';
import { checkTextModeration } from '../services/textModeration';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

import { showSuccessToast } from '../motion';
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
const VIBE_SCALES = [
  { key: 'energyLevel', label: 'Energy', lowLabel: 'Chill', highLabel: 'High energy' },
  { key: 'conversationLevel', label: 'Conversation', lowLabel: 'Quiet', highLabel: 'Chatty' },
  { key: 'groupSizeFeel', label: 'Group feel', lowLabel: 'Intimate', highLabel: 'Big group' },
];

const MAX_TIMELINE_STEPS = 8;

// Who the gathering is visible to (fixed at creation; the column is CHECK-limited to these four).
function visibilityLabel(g) {
  const v = g.visibility ?? (g.is_public === false ? 'invite_only' : 'everyone');
  return { everyone: 'Public', friends: 'Friends', community: 'Community members', invite_only: 'Private (invite only)' }[v] ?? 'Public';
}

export default function EditGatheringScreen({ route, navigation }) {
  const { gathering } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  // Item 74: Link only exists only for an Everyone gathering (also a DB CHECK).
  const canBeLinkOnly = (gathering.visibility ?? 'everyone') === 'everyone' && gathering.is_public !== false;
  const [title, setTitle] = useState(gathering.title);
  const [description, setDescription] = useState(gathering.description || '');
  const [scheduledAt, setScheduledAt] = useState(new Date(gathering.scheduled_at));
  const [showPicker, setShowPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [energyLevel, setEnergyLevel] = useState(gathering.energy_level ?? null);
  const [conversationLevel, setConversationLevel] = useState(gathering.conversation_level ?? null);
  const [groupSizeFeel, setGroupSizeFeel] = useState(gathering.group_size_feel ?? null);
  const [beginnerFriendly, setBeginnerFriendly] = useState(gathering.beginner_friendly ?? true);
  const [equipmentProvided, setEquipmentProvided] = useState(gathering.equipment_provided ?? null);
  const [features, setFeatures] = useState(cleanFeatures(gathering.features));
  const [genre, setGenre] = useState(gathering.genre ?? null);
  const [durationMinutes, setDurationMinutes] = useState(gathering.duration_minutes ?? null);
  const [showGroupInsights, setShowGroupInsights] = useState(gathering.show_group_insights ?? true);
  const [requiresApproval, setRequiresApproval] = useState(gathering.requires_approval ?? false);
  const [discoverable, setDiscoverable] = useState(gathering.discoverable ?? true);
  const [askLocalBusinesses, setAskLocalBusinesses] = useState(gathering.ask_local_businesses ?? false);
  const [hostNotifications, setHostNotifications] = useState(gathering.host_notifications ?? true);
  const [allowAttendeeInvites, setAllowAttendeeInvites] = useState(gathering.allow_attendee_invites ?? true);
  const [limitAttendees, setLimitAttendees] = useState(gathering.capacity != null);
  const [capacity, setCapacity] = useState(gathering.capacity ?? 10);
  // A gathering made before the category became required has none; the host can fill it in (never change one).
  const missingCategory = !gathering.interest_tag;
  const [newCategory, setNewCategory] = useState(null);
  const [timelineSteps, setTimelineSteps] = useState(gathering.timeline_steps ?? []);
  const [coverPhotoPath, setCoverPhotoPath] = useState(gathering.cover_photo_path ?? null);
  const [coverPhotoUrl, setCoverPhotoUrl] = useState(null);
  const [uploadingCover, setUploadingCover] = useState(false);

  const vibeValues = { energyLevel, conversationLevel, groupSizeFeel };
  const vibeSetters = { energyLevel: setEnergyLevel, conversationLevel: setConversationLevel, groupSizeFeel: setGroupSizeFeel };

  useEffect(() => {
    let cancelled = false;
    if (coverPhotoPath) {
      getSignedGatheringPhotoUrl(coverPhotoPath).then((url) => {
        if (!cancelled) setCoverPhotoUrl(url);
      });
    }
    return () => { cancelled = true; };
  }, [coverPhotoPath]);

  function addTimelineStep() {
    if (timelineSteps.length >= MAX_TIMELINE_STEPS) return;
    setTimelineSteps((prev) => [...prev, { time: '', label: '' }]);
  }

  function updateTimelineStep(index, field, value) {
    setTimelineSteps((prev) => prev.map((step, i) => (i === index ? { ...step, [field]: value } : step)));
  }

  function removeTimelineStep(index) {
    setTimelineSteps((prev) => prev.filter((_, i) => i !== index));
  }

  async function handlePickCoverPhoto() {
    try {
      const asset = await pickGatheringCoverPhoto();
      if (!asset) return;
      setUploadingCover(true);
      const path = await uploadGatheringCoverPhoto(gathering.id, asset);
      setCoverPhotoPath(path);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handlePickCoverPhoto() });
    }
    setUploadingCover(false);
  }

  async function submit() {
    if (!title.trim()) {
      return Alert.alert('Title required', 'Give your gathering a short title.');
    }
    if (scheduledAt.getTime() <= Date.now()) {
      return Alert.alert('Pick a future time', "Your gathering's date and time needs to be in the future.");
    }

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

    const cleanedTimelineSteps = timelineSteps
      .filter((step) => step.label?.trim())
      .map((step) => ({ time: step.time?.trim() || null, label: step.label.trim() }));

    setSubmitting(true);
    try {
      await updateGathering(gathering.id, {
        title: title.trim(),
        description: description.trim() || null,
        scheduledAt: scheduledAt.toISOString(),
        energyLevel,
        conversationLevel,
        groupSizeFeel,
        beginnerFriendly,
        equipmentProvided,
        features,
        durationMinutes,
        ...(isMusicTag(gathering.interest_tag) ? { genre } : {}),
        timelineSteps: cleanedTimelineSteps.length > 0 ? cleanedTimelineSteps : null,
        showGroupInsights,
        ...(gathering.is_public === false ? {} : { requiresApproval }),
        ...(canBeLinkOnly ? { discoverable } : {}),
        askLocalBusinesses,
        hostNotifications,
        allowAttendeeInvites,
      });
      const nextCapacity = limitAttendees ? capacity : null;
      if ((gathering.capacity ?? null) !== nextCapacity) await setGatheringCapacity(gathering.id, nextCapacity);
      if (missingCategory && newCategory) await setGatheringCategoryIfMissing(gathering.id, newCategory);
      showSuccessToast('Updated', 'Your changes are saved.');
      navigation.goBack();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'save your changes', error: e, draftKept: true, onRetry: () => submit() });
    }
    setSubmitting(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
          <Text style={styles.header}>Edit Gathering</Text>
          <Text style={styles.subheader}>Location, visibility, and recurrence can't be changed here — cancel and recreate if those need to change.</Text>

          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Gathering title"
          />

          {missingCategory && (
            <>
              <Text style={styles.label}>Category</Text>
              <Text style={styles.helper}>This gathering has no category yet. Pick one so the right people and businesses can find it. It can't be changed once set.</Text>
              {CATEGORY_GROUPS.map((group) => (
                <View key={group.key} style={{ marginTop: spacing.sm }}>
                  <Text style={styles.helper}>{group.icon} {group.label}</Text>
                  <View style={styles.chipsWrap}>
                    {group.tags.map((tag) => {
                      const selected = newCategory === tag;
                      return (
                        <TouchableOpacity
                          key={tag}
                          style={[styles.chip, selected && styles.chipSelected]}
                          onPress={() => setNewCategory(selected ? null : tag)}
                          accessibilityRole="button"
                          accessibilityLabel={`Category: ${tag}`}
                          accessibilityState={{ selected }}
                        >
                          <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{tag}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </>
          )}

          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
            value={description}
            onChangeText={setDescription}
            multiline
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Gathering description, optional"
          />

          <Text style={styles.label}>Date & Time</Text>
          <TouchableOpacity
            style={styles.dateButton}
            onPress={() => setShowPicker(true)}
            accessibilityLabel={`Scheduled for ${scheduledAt.toLocaleString()}, tap to change`}
            accessibilityRole="button"
          >
            <Text style={styles.dateButtonText}>{scheduledAt.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>
          </TouchableOpacity>
          {showPicker && (
            <DateTimePicker
              value={scheduledAt}
              mode="datetime"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, selectedDate) => {
                setShowPicker(Platform.OS === 'ios');
                if (selectedDate) setScheduledAt(selectedDate);
              }}
            />
          )}

          <Text style={styles.label}>Cover Photo</Text>
          <TouchableOpacity
            style={styles.coverPhotoButton}
            onPress={handlePickCoverPhoto}
            disabled={uploadingCover}
            accessibilityLabel={coverPhotoUrl ? 'Change cover photo' : 'Add a cover photo'}
            accessibilityRole="button"
          >
            {coverPhotoUrl ? (
              <Image source={{ uri: coverPhotoUrl }} style={styles.coverPhotoPreview} />
            ) : (
              <Text style={styles.coverPhotoButtonText}>{uploadingCover ? 'Uploading...' : '+ Add a cover photo'}</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.sectionHeader}>Vibe</Text>
          {VIBE_SCALES.map((scale) => (
            <View key={scale.key} style={{ marginBottom: spacing.md }}>
              <Text style={styles.label}>{scale.label}</Text>
              <View style={styles.scaleRow}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const selected = vibeValues[scale.key] === n;
                  return (
                    <TouchableOpacity
                      key={n}
                      style={[styles.scaleOption, selected && styles.scaleOptionSelected]}
                      onPress={() => vibeSetters[scale.key](selected ? null : n)}
                      accessibilityLabel={`${scale.label} ${n} of 5`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.scaleOptionText, selected && styles.scaleOptionTextSelected]}>{n}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.scaleLabelsRow}>
                <Text style={styles.scaleEndLabel}>{scale.lowLabel}</Text>
                <Text style={styles.scaleEndLabel}>{scale.highLabel}</Text>
              </View>
            </View>
          ))}

          <View style={styles.toggleRow}>
            <Text style={styles.label}>Beginner friendly</Text>
            <Switch
              value={beginnerFriendly}
              onValueChange={setBeginnerFriendly}
              accessibilityLabel="Beginner friendly"
            />
          </View>

          <Text style={styles.label}>Accessibility & family</Text>
          <View style={styles.chipsWrap}>
            {GATHERING_FEATURE_OPTIONS.map((option) => {
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

          <Text style={styles.label}>Equipment</Text>
          <View style={styles.chipsWrap}>
            {EQUIPMENT_OPTIONS.map((option) => {
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

          <Text style={styles.label}>How long</Text>
          <View style={styles.chipsWrap}>
            {DURATION_OPTIONS.map((option) => {
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

          {isMusicTag(gathering.interest_tag) && (
            <>
              <Text style={styles.label}>Genre</Text>
              <View style={styles.chipsWrap}>
                {GENRE_OPTIONS.map((option) => {
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
          <View style={styles.toggleRow}>
            <Text style={styles.label}>Show group insights</Text>
            <Switch
              value={showGroupInsights}
              onValueChange={setShowGroupInsights}
              accessibilityLabel="Show group insights to attendees"
            />
          </View>
          <Text style={styles.sectionHeader}>Gathering settings</Text>
          <Text style={styles.subheader}>Visibility: {visibilityLabel(gathering)}. Set when the gathering was created.</Text>
          {canBeLinkOnly && (
            <>
              <View style={styles.toggleRow}>
                <Text style={styles.label}>Link only</Text>
                <Switch value={!discoverable} onValueChange={(v) => setDiscoverable(!v)} accessibilityLabel="Link only" />
              </View>
              <Text style={styles.subheader}>How can people find it? Off: discoverable, people can find this in Nearby. On: only people with the link can find it. It is not listed in Nearby, Discover, Home or Trending. Who can join it is unchanged.</Text>
            </>
          )}
          {gathering.is_public !== false && (
            <>
              <View style={styles.toggleRow}>
                <Text style={styles.label}>Require approval to join</Text>
                <Switch
                  value={requiresApproval}
                  onValueChange={setRequiresApproval}
                  accessibilityLabel="Require approval to join"
                />
              </View>
              <Text style={styles.subheader}>Off: anyone can join in one tap. On: new people request to join and you approve or decline. Changing this doesn't affect people already in.</Text>
            </>
          )}

          <View style={styles.toggleRow}>
            <Text style={styles.label}>Limit attendees</Text>
            <Switch value={limitAttendees} onValueChange={setLimitAttendees} accessibilityLabel="Limit attendees" />
          </View>
          {limitAttendees && (
            <View style={styles.toggleRow}>
              <TouchableOpacity onPress={() => setCapacity((n) => Math.max(1, n - 1))} accessibilityLabel="Decrease maximum attendees" accessibilityRole="button">
                <Text style={styles.label}>−</Text>
              </TouchableOpacity>
              <Text style={styles.label}>{capacity} max</Text>
              <TouchableOpacity onPress={() => setCapacity((n) => n + 1)} accessibilityLabel="Increase maximum attendees" accessibilityRole="button">
                <Text style={styles.label}>+</Text>
              </TouchableOpacity>
            </View>
          )}
          <Text style={styles.subheader}>When you're at the limit, new people join the waitlist. Raising or removing the limit lets the waitlist in, in order. You can't go below the people already attending.</Text>
          <View style={styles.toggleRow}>
            <Text style={styles.label}>Allow business requests</Text>
            <Switch value={askLocalBusinesses} onValueChange={setAskLocalBusinesses} accessibilityLabel="Allow business requests" />
          </View>
          <Text style={styles.subheader}>On: Nearby can look for a business to help with this gathering once you say so. Nothing is sent until you tap "Yes, look now". Turning it off doesn't cancel a request you already made.</Text>
          <View style={styles.toggleRow}>
            <Text style={styles.label}>Allow guests to invite</Text>
            <Switch value={allowAttendeeInvites} onValueChange={setAllowAttendeeInvites} accessibilityLabel="Allow guests to invite" />
          </View>
          <Text style={styles.subheader}>Off: only you can send invitations to this gathering. Invitations already sent stay.</Text>
          <View style={styles.toggleRow}>
            <Text style={styles.label}>Notify me about joins and requests</Text>
            <Switch value={hostNotifications} onValueChange={setHostNotifications} accessibilityLabel="Notify me about joins and requests" />
          </View>
          <Text style={styles.subheader}>Off: no push when someone joins, asks to join or joins the waitlist for this gathering. Other Plans notifications are unchanged.</Text>

          <Text style={styles.subheader}>Shared interests and an age/gender-makeup summary, shown to attendees once there's enough people to keep it anonymous.</Text>

          <Text style={styles.sectionHeader}>Timeline</Text>
          {timelineSteps.map((step, index) => (
            <View key={index} style={styles.timelineRow}>
              <TextInput
                style={[styles.input, styles.timelineTimeInput]}
                value={step.time}
                onChangeText={(text) => updateTimelineStep(index, 'time', text)}
                placeholder="7:00 PM"
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel={`Timeline step ${index + 1} time`}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={step.label}
                onChangeText={(text) => updateTimelineStep(index, 'label', text)}
                placeholder="Arrive & mingle"
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel={`Timeline step ${index + 1} description`}
              />
              <TouchableOpacity
                onPress={() => removeTimelineStep(index)}
                style={styles.timelineRemoveButton}
                accessibilityLabel={`Remove timeline step ${index + 1}`}
                accessibilityRole="button"
              >
                <Text style={styles.timelineRemoveText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
          {timelineSteps.length < MAX_TIMELINE_STEPS && (
            <TouchableOpacity onPress={addTimelineStep} accessibilityLabel="Add timeline step" accessibilityRole="button">
              <Text style={styles.addStepText}>+ Add a step</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.button}
            onPress={submit}
            disabled={submitting}
            activeOpacity={0.85}
            accessibilityLabel={submitting ? 'Saving' : 'Save changes'}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{submitting ? 'Saving...' : 'Save Changes'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  subheader: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg, lineHeight: 18 },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  helper: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full ?? 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textPrimary, fontSize: 14 },
  chipTextSelected: { color: '#fff', fontWeight: '600' },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  dateButton: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  dateButtonText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  sectionHeader: { ...typography.bodyBold, color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.xs },
  coverPhotoButton: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', height: 120, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  coverPhotoButtonText: { color: colors.textTertiary, fontSize: 14, fontWeight: '600' },
  coverPhotoPreview: { width: '100%', height: '100%' },
  scaleRow: { flexDirection: 'row', gap: spacing.sm },
  scaleOption: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  scaleOptionSelected: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  scaleOptionText: { color: colors.textSecondary, fontWeight: '700', fontSize: 14 },
  scaleOptionTextSelected: { color: colors.primary },
  scaleLabelsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  scaleEndLabel: { color: colors.textTertiary, fontSize: 11 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  timelineTimeInput: { width: 90 },
  timelineRemoveButton: { paddingHorizontal: spacing.xs },
  timelineRemoveText: { color: colors.textTertiary, fontSize: 20, fontWeight: '700' },
  addStepText: { color: colors.primary, fontWeight: '700', fontSize: 14, marginTop: spacing.xs },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', marginTop: spacing.xl, ...shadow.button },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});