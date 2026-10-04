import AgeRangePicker from '../components/AgeRangePicker';
import { cleanAgeRange } from '../utils/suitedAges';
import { FORMAT_OPTIONS, formatIcon } from '../constants/activityFormat';
import { skillContext, skillOptionsFor, cleanSkillLevel } from '../constants/skillLevel';
import { EFFORT_OPTIONS } from '../constants/intensityEffort';
import { peopleGoing } from '../utils/gatheringFullness';
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
import useCategoryNames from '../hooks/useCategoryNames';
import { useLanguage } from '../context/LanguageContext';
import { displayDateTime } from '../i18n/display';
// Labels come from ui.gatheringVocab.vibe.<column> (the same wording GatheringDetail shows).
const VIBE_SCALES = [
  { key: 'energyLevel', column: 'energy_level' },
  { key: 'conversationLevel', column: 'conversation_level' },
  { key: 'groupSizeFeel', column: 'group_size_feel' },
];

const MAX_TIMELINE_STEPS = 8;

// Who the gathering is visible to (fixed at creation; the column is CHECK-limited to these four). Same labels as Create and
// GatheringDetail (ui.gatheringVocab.visibility).
function visibilityKey(g) {
  const v = g.visibility ?? (g.is_public === false ? 'invite_only' : 'everyone');
  return ['everyone', 'friends', 'community', 'invite_only'].includes(v) ? v : 'everyone';
}
const optionText = (t, ns, o) => (o.key === null || o.key === undefined ? t('ui.gatheringOptions.notSpecified') : t(`ui.gatheringOptions.${ns}.${o.key}`));
const equipmentText = (t, o) => (o.key === null ? t('ui.gatheringOptions.notSpecified') : t(o.key ? 'ui.gatheringOptions.equipment.provided' : 'ui.gatheringOptions.equipment.byo'));
const formatText = (t, o) => (o.key === null ? t('ui.gatheringOptions.notSpecified') : `${formatIcon(o.key)} ${t(`ui.gatheringOptions.format.${o.key}`)}`);

export default function EditGatheringScreen({ route, navigation }) {
  const names = useCategoryNames(); // category / occasion names shown in the person's language (display only)
  const { gathering } = route.params;
  const { t, language } = useLanguage();
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
  const [equipmentProvided, setEquipmentProvided] = useState(gathering.equipment_provided ?? null);
  const [ticketRequired, setTicketRequired] = useState(gathering.ticket_required === true); // item 188
  const [features, setFeatures] = useState(cleanFeatures(gathering.features));
  const [ageMin, setAgeMin] = useState(cleanAgeRange(gathering.suited_age_min, gathering.suited_age_max).min);
  const [ageMax, setAgeMax] = useState(cleanAgeRange(gathering.suited_age_min, gathering.suited_age_max).max);
  const [genre, setGenre] = useState(gathering.genre ?? null);
  const [format, setFormat] = useState(gathering.format ?? null);
  const [effortLevel, setEffortLevel] = useState(gathering.effort_level ?? null);
  const [skillLevel, setSkillLevel] = useState(gathering.skill_level ?? null);
  const [durationMinutes, setDurationMinutes] = useState(gathering.duration_minutes ?? null);
  const [showGroupInsights, setShowGroupInsights] = useState(gathering.show_group_insights ?? true);
  const [requiresApproval, setRequiresApproval] = useState(gathering.requires_approval ?? false);
  const [discoverable, setDiscoverable] = useState(gathering.discoverable ?? true);
  const [askLocalBusinesses, setAskLocalBusinesses] = useState(gathering.ask_local_businesses ?? false);
  const [hostNotifications, setHostNotifications] = useState(gathering.host_notifications ?? true);
  const [allowAttendeeInvites, setAllowAttendeeInvites] = useState(gathering.allow_attendee_invites ?? true);
  const [limitAttendees, setLimitAttendees] = useState(gathering.capacity != null);
  const [capacity, setCapacity] = useState(gathering.capacity ?? Math.max(10, peopleGoing(gathering)));
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
      return Alert.alert(t('ui.gatheringForm.alert.titleRequired'), t('ui.gatheringForm.alert.titleRequiredBody'));
    }
    if (scheduledAt.getTime() <= Date.now()) {
      return Alert.alert(t('ui.gatheringForm.edit.pickFutureTime'), t('ui.gatheringForm.alert.pickTimeBody'));
    }

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
        equipmentProvided,
        ticketRequired,
        features,
        suitedAgeMin: ageMin,
        suitedAgeMax: ageMax,
        durationMinutes,
        ...(isMusicTag(gathering.interest_tag) ? { genre } : {}),
        format,
        skillLevel: cleanSkillLevel(skillLevel, skillContext({ tag: gathering.interest_tag, format })),
        // Effort is asked only where skill is (activities, sports, classes); elsewhere it is not saved.
        effortLevel: skillOptionsFor(skillContext({ tag: gathering.interest_tag, format })) ? effortLevel : null,
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
      showSuccessToast(t('ui.gatheringForm.edit.updated'), t('ui.gatheringForm.edit.updatedBody'));
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
          <Text style={styles.header}>{t('ui.gatheringForm.edit.header')}</Text>
          <Text style={styles.subheader}>{t('ui.gatheringForm.edit.cantChange')}</Text>

          <Text style={styles.label}>{t('ui.gatheringForm.edit.title')}</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel={t('ui.gatheringForm.titleA11y')}
          />

          {missingCategory && (
            <>
              <Text style={styles.label}>{t('ui.gatheringForm.edit.category')}</Text>
              <Text style={styles.helper}>{t('ui.gatheringForm.edit.noCategory')}</Text>
              {CATEGORY_GROUPS.map((group) => (
                <View key={group.key} style={{ marginTop: spacing.sm }}>
                  <Text style={styles.helper}>{group.icon} {names.group(group.key, group.label)}</Text>
                  <View style={styles.chipsWrap}>
                    {group.tags.map((tag) => {
                      const selected = newCategory === tag;
                      return (
                        <TouchableOpacity
                          key={tag}
                          style={[styles.chip, selected && styles.chipSelected]}
                          onPress={() => setNewCategory(selected ? null : tag)}
                          accessibilityRole="button"
                          accessibilityLabel={t('ui.gatheringForm.categoryA11y', { name: names.tag(tag) })}
                          accessibilityState={{ selected }}
                        >
                          <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{names.tag(tag)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </>
          )}

          <Text style={styles.label}>{t('ui.gatheringForm.edit.description')}</Text>
          <TextInput
            style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
            value={description}
            onChangeText={setDescription}
            multiline
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel={t('ui.gatheringForm.descriptionA11y')}
          />

          <Text style={styles.label}>{t('ui.gatheringForm.edit.dateTime')}</Text>
          <TouchableOpacity
            style={styles.dateButton}
            onPress={() => setShowPicker(true)}
            accessibilityLabel={t('ui.gatheringForm.edit.scheduledA11y', { when: displayDateTime(scheduledAt, language) })}
            accessibilityRole="button"
          >
            <Text style={styles.dateButtonText}>{displayDateTime(scheduledAt, language)}</Text>
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

          <Text style={styles.label}>{t('ui.gatheringForm.edit.coverPhoto')}</Text>
          <TouchableOpacity
            style={styles.coverPhotoButton}
            onPress={handlePickCoverPhoto}
            disabled={uploadingCover}
            accessibilityLabel={coverPhotoUrl ? t('ui.gatheringForm.edit.changeCoverA11y') : t('ui.gatheringForm.edit.addCoverA11y')}
            accessibilityRole="button"
          >
            {coverPhotoUrl ? (
              <Image source={{ uri: coverPhotoUrl }} style={styles.coverPhotoPreview} />
            ) : (
              <Text style={styles.coverPhotoButtonText}>{uploadingCover ? t('ui.gatheringForm.edit.uploading') : t('ui.gatheringForm.edit.addCover')}</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.sectionHeader}>{t('ui.gatheringForm.edit.vibe')}</Text>
          {VIBE_SCALES.map((scale) => (
            <View key={scale.key} style={{ marginBottom: spacing.md }}>
              <Text style={styles.label}>{t(`ui.gatheringVocab.vibe.${scale.column}.label`)}</Text>
              <View style={styles.scaleRow}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const selected = vibeValues[scale.key] === n;
                  return (
                    <TouchableOpacity
                      key={n}
                      style={[styles.scaleOption, selected && styles.scaleOptionSelected]}
                      onPress={() => vibeSetters[scale.key](selected ? null : n)}
                      accessibilityLabel={t('ui.gatheringForm.edit.scaleA11y', { label: t(`ui.gatheringVocab.vibe.${scale.column}.label`), n })}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.scaleOptionText, selected && styles.scaleOptionTextSelected]}>{n}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.scaleLabelsRow}>
                <Text style={styles.scaleEndLabel}>{t(`ui.gatheringVocab.vibe.${scale.column}.low`)}</Text>
                <Text style={styles.scaleEndLabel}>{t(`ui.gatheringVocab.vibe.${scale.column}.high`)}</Text>
              </View>
            </View>
          ))}

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

          {/* Item 188: informational only. Nearby sells no tickets and this changes no join, capacity or ranking rule. */}
          <View style={styles.toggleRow}>
            <Text style={styles.label}>{t('ui.gatheringForm.ticket')}</Text>
            <Switch value={ticketRequired} onValueChange={setTicketRequired} accessibilityLabel={t('ui.gatheringForm.ticket')} />
          </View>
          <Text style={styles.subheader}>{t('ui.gatheringForm.ticketHelp')}</Text>

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

          {isMusicTag(gathering.interest_tag) && (
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
          {skillOptionsFor(skillContext({ tag: gathering.interest_tag, format })) && (
            <>
              <Text style={styles.label}>{t('ui.gatheringForm.skill')}</Text>
              <View style={styles.chipsWrap}>
                {skillOptionsFor(skillContext({ tag: gathering.interest_tag, format })).map((o) => ({ ...o, label: optionText(t, 'skill', o) })).map((option) => {
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
          {skillOptionsFor(skillContext({ tag: gathering.interest_tag, format })) && (
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
          <View style={styles.toggleRow}>
            <Text style={styles.label}>{t('ui.gatheringForm.edit.showInsights')}</Text>
            <Switch
              value={showGroupInsights}
              onValueChange={setShowGroupInsights}
              accessibilityLabel={t('ui.gatheringForm.edit.showInsightsA11y')}
            />
          </View>
          <Text style={styles.sectionHeader}>{t('ui.gatheringForm.edit.settings')}</Text>
          <Text style={styles.subheader}>{t('ui.gatheringForm.edit.visibilityLine', { label: t(`ui.gatheringVocab.visibility.${visibilityKey(gathering)}.label`) })}</Text>
          {canBeLinkOnly && (
            <>
              <View style={styles.toggleRow}>
                <Text style={styles.label}>{t('ui.gatheringForm.linkOnly')}</Text>
                <Switch value={!discoverable} onValueChange={(v) => setDiscoverable(!v)} accessibilityLabel={t('ui.gatheringForm.linkOnly')} />
              </View>
              <Text style={styles.subheader}>{t('ui.gatheringForm.edit.linkOnlyHelp')}</Text>
            </>
          )}
          {gathering.is_public !== false && (
            <>
              <View style={styles.toggleRow}>
                <Text style={styles.label}>{t('ui.gatheringForm.edit.approval')}</Text>
                <Switch
                  value={requiresApproval}
                  onValueChange={setRequiresApproval}
                  accessibilityLabel={t('ui.gatheringForm.edit.approval')}
                />
              </View>
              <Text style={styles.subheader}>{t('ui.gatheringForm.edit.approvalHelp')}</Text>
            </>
          )}

          <View style={styles.toggleRow}>
            <Text style={styles.label}>{t('ui.gatheringForm.edit.limit')}</Text>
            <Switch value={limitAttendees} onValueChange={setLimitAttendees} accessibilityLabel={t('ui.gatheringForm.edit.limit')} />
          </View>
          {limitAttendees && (
            <View style={styles.toggleRow}>
              <TouchableOpacity onPress={() => setCapacity((n) => Math.max(peopleGoing(gathering), n - 1))} accessibilityLabel={t('ui.gatheringForm.edit.decreaseA11y')} accessibilityRole="button">
                <Text style={styles.label}>−</Text>
              </TouchableOpacity>
              <Text style={styles.label}>{t('ui.gatheringForm.edit.upTo', { people: t('ui.common.count.people', { count: capacity }) })}</Text>
              <TouchableOpacity onPress={() => setCapacity((n) => n + 1)} accessibilityLabel={t('ui.gatheringForm.edit.increaseA11y')} accessibilityRole="button">
                <Text style={styles.label}>+</Text>
              </TouchableOpacity>
            </View>
          )}
          <Text style={styles.subheader}>{t('ui.gatheringForm.edit.limitHelp')}</Text>
          <View style={styles.toggleRow}>
            <Text style={styles.label}>{t('ui.gatheringForm.edit.allowBiz')}</Text>
            <Switch value={askLocalBusinesses} onValueChange={setAskLocalBusinesses} accessibilityLabel={t('ui.gatheringForm.edit.allowBiz')} />
          </View>
          <Text style={styles.subheader}>{t('ui.gatheringForm.edit.allowBizHelp')}</Text>
          <View style={styles.toggleRow}>
            <Text style={styles.label}>{t('ui.gatheringForm.guestsInvite')}</Text>
            <Switch value={allowAttendeeInvites} onValueChange={setAllowAttendeeInvites} accessibilityLabel={t('ui.gatheringForm.guestsInvite')} />
          </View>
          <Text style={styles.subheader}>{t('ui.gatheringForm.edit.guestsHelp')}</Text>
          <View style={styles.toggleRow}>
            <Text style={styles.label}>{t('ui.gatheringForm.notify')}</Text>
            <Switch value={hostNotifications} onValueChange={setHostNotifications} accessibilityLabel={t('ui.gatheringForm.notify')} />
          </View>
          <Text style={styles.subheader}>{t('ui.gatheringForm.edit.notifyHelp')}</Text>

          <Text style={styles.subheader}>{t('ui.gatheringForm.edit.insightsHelp')}</Text>

          <Text style={styles.sectionHeader}>{t('ui.gatheringForm.edit.timeline')}</Text>
          {timelineSteps.map((step, index) => (
            <View key={index} style={styles.timelineRow}>
              <TextInput
                style={[styles.input, styles.timelineTimeInput]}
                value={step.time}
                onChangeText={(text) => updateTimelineStep(index, 'time', text)}
                placeholder={t('ui.gatheringForm.edit.timePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel={t('ui.gatheringForm.edit.stepTimeA11y', { n: index + 1 })}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={step.label}
                onChangeText={(text) => updateTimelineStep(index, 'label', text)}
                placeholder={t('ui.gatheringForm.edit.stepPlaceholder')}
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel={t('ui.gatheringForm.edit.stepDescA11y', { n: index + 1 })}
              />
              <TouchableOpacity
                onPress={() => removeTimelineStep(index)}
                style={styles.timelineRemoveButton}
                accessibilityLabel={t('ui.gatheringForm.edit.removeStepA11y', { n: index + 1 })}
                accessibilityRole="button"
              >
                <Text style={styles.timelineRemoveText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
          {timelineSteps.length < MAX_TIMELINE_STEPS && (
            <TouchableOpacity onPress={addTimelineStep} accessibilityLabel={t('ui.gatheringForm.edit.addStepA11y')} accessibilityRole="button">
              <Text style={styles.addStepText}>{t('ui.gatheringForm.edit.addStep')}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.button}
            onPress={submit}
            disabled={submitting}
            activeOpacity={0.85}
            accessibilityLabel={submitting ? t('ui.gatheringForm.edit.savingA11y') : t('ui.gatheringForm.edit.saveA11y')}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{submitting ? t('ui.gatheringForm.edit.saving') : t('ui.gatheringForm.edit.save')}</Text>
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