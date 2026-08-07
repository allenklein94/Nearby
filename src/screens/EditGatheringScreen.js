import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert, Platform, Keyboard, TouchableWithoutFeedback, Image, Switch } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { updateGathering, pickGatheringCoverPhoto, uploadGatheringCoverPhoto, getSignedGatheringPhotoUrl } from '../services/gatherings';
import { checkTextModeration } from '../services/textModeration';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

const VIBE_SCALES = [
  { key: 'energyLevel', label: 'Energy', lowLabel: 'Chill', highLabel: 'High energy' },
  { key: 'conversationLevel', label: 'Conversation', lowLabel: 'Quiet', highLabel: 'Chatty' },
  { key: 'groupSizeFeel', label: 'Group feel', lowLabel: 'Intimate', highLabel: 'Big group' },
];

const MAX_TIMELINE_STEPS = 8;

export default function EditGatheringScreen({ route, navigation }) {
  const { gathering } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [title, setTitle] = useState(gathering.title);
  const [description, setDescription] = useState(gathering.description || '');
  const [scheduledAt, setScheduledAt] = useState(new Date(gathering.scheduled_at));
  const [showPicker, setShowPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [energyLevel, setEnergyLevel] = useState(gathering.energy_level ?? null);
  const [conversationLevel, setConversationLevel] = useState(gathering.conversation_level ?? null);
  const [groupSizeFeel, setGroupSizeFeel] = useState(gathering.group_size_feel ?? null);
  const [beginnerFriendly, setBeginnerFriendly] = useState(gathering.beginner_friendly ?? true);
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
      Alert.alert('Error', e.message);
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
        timelineSteps: cleanedTimelineSteps.length > 0 ? cleanedTimelineSteps : null,
      });
      Alert.alert('Updated', 'Your changes are saved.');
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message);
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