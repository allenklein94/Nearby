import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Image, ScrollView, Modal, FlatList, KeyboardAvoidingView, Platform, LayoutAnimation, UIManager } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { pickProfilePhoto, uploadProfilePhoto, getSignedPhotoUrl } from '../services/photos';
import { pickExtraPhoto, uploadExtraPhoto, getExtraPhotos, deleteExtraPhoto, setAsMainPhoto } from '../services/extraPhotos';
import { checkTextModeration } from '../services/textModeration';
import { BASICS_FIELDS } from '../constants/basicsFields';
import { PROMPT_QUESTIONS } from '../constants/promptQuestions';
import { typography, spacing, radius } from '../theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const MAX_EXTRA_PHOTOS = 5;
const MAX_PROMPTS = 3;

const INTEREST_OPTIONS = [
  'Travel', 'Coffee', 'Hiking', 'Music', 'Movies', 'Foodie', 'Fitness',
  'Reading', 'Art', 'Gaming', 'Photography', 'Yoga', 'Dancing', 'Cooking',
  'Wine', 'Dogs', 'Cats', 'Outdoors', 'Sports', 'Concerts', 'Museums',
  'Volunteering', 'Meditation', 'Running',
];

function AccordionField({ field, value, expanded, onToggle, children }) {
  const { colors } = useTheme();
  const styles = getAccordionStyles(colors);

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.header} onPress={onToggle} activeOpacity={0.7}>
        <Text style={styles.headerLabel}>{field.icon} {field.label}</Text>
        <View style={styles.headerRight}>
          {value ? <Text style={styles.headerValue} numberOfLines={1}>{value}</Text> : null}
          <Text style={styles.chevron}>{expanded ? '⌃' : '⌄'}</Text>
        </View>
      </TouchableOpacity>
      {expanded && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const getAccordionStyles = (colors) => StyleSheet.create({
  wrap: { borderBottomWidth: 1, borderBottomColor: colors.border },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md },
  headerLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1, marginLeft: spacing.sm },
  headerValue: { color: colors.textTertiary, fontSize: 13, flexShrink: 1 },
  chevron: { color: colors.textTertiary, fontSize: 14 },
  body: { paddingBottom: spacing.md },
});

export default function ProfileScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors, shadow);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [userId, setUserId] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoVerified, setPhotoVerified] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extraPhotos, setExtraPhotos] = useState([]);
  const [uploadingExtra, setUploadingExtra] = useState(false);
  const [interests, setInterests] = useState([]);
  const [pronouns, setPronouns] = useState('');
  const [gender, setGender] = useState('');
  const [sexualOrientation, setSexualOrientation] = useState('');
  const [basics, setBasics] = useState({});
  const [prompts, setPrompts] = useState([]);
  const [questionPickerVisible, setQuestionPickerVisible] = useState(false);
  const [editingPromptIndex, setEditingPromptIndex] = useState(null);
  const [answerModalVisible, setAnswerModalVisible] = useState(false);
  const [draftQuestion, setDraftQuestion] = useState('');
  const [draftAnswer, setDraftAnswer] = useState('');
  const [expandedField, setExpandedField] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: sessionData } = await supabase.auth.getSession();
    const id = sessionData?.session?.user?.id;
    setUserId(id);

    const { data } = await supabase.from('profiles').select('*').eq('id', id).single();
    if (data) {
      setDisplayName(data.display_name || '');
      setBio(data.bio || '');
      setPhotoVerified(!!data.photo_verified);
      setInterests(data.interests || []);
      setPronouns(data.pronouns || '');
      setGender(data.gender || '');
      setSexualOrientation(data.sexual_orientation || '');
      setBasics(data.basics || {});
      setPrompts(data.prompts || []);
      if (data.photo_url) {
        const url = await getSignedPhotoUrl(data.photo_url);
        setPhotoUrl(url);
      }
    }

    const extras = await getExtraPhotos(id);
    setExtraPhotos(extras);
  }

  function toggleFieldExpanded(key) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedField((prev) => (prev === key ? null : key));
  }

  function toggleInterest(interest) {
    setInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  }

  function setBasicField(key, value) {
    setBasics((prev) => {
      const next = { ...prev };
      if (next[key] === value) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedField(null);
  }

  function setBasicTextField(key, value) {
    setBasics((prev) => ({ ...prev, [key]: value }));
  }

  function openAddPrompt() {
    if (prompts.length >= MAX_PROMPTS) {
      return Alert.alert('Limit reached', `You can add up to ${MAX_PROMPTS} prompts.`);
    }
    setEditingPromptIndex(null);
    setQuestionPickerVisible(true);
  }

  function openEditPrompt(index) {
    setEditingPromptIndex(index);
    setDraftQuestion(prompts[index].question);
    setDraftAnswer(prompts[index].answer);
    setAnswerModalVisible(true);
  }

  function selectQuestion(question) {
    setDraftQuestion(question);
    setDraftAnswer('');
    setQuestionPickerVisible(false);
    setAnswerModalVisible(true);
  }

  async function saveDraftPrompt() {
    if (!draftAnswer.trim()) {
      return Alert.alert('Answer required', 'Write a short answer to this prompt.');
    }
    const check = await checkTextModeration(draftAnswer);
    if (!check.safe) {
      return Alert.alert('Answer not allowed', 'Please revise your answer and try again.');
    }

    setPrompts((prev) => {
      const next = [...prev];
      const entry = { question: draftQuestion, answer: draftAnswer.trim() };
      if (editingPromptIndex !== null) {
        next[editingPromptIndex] = entry;
      } else {
        next.push(entry);
      }
      return next;
    });

    setAnswerModalVisible(false);
    setDraftQuestion('');
    setDraftAnswer('');
    setEditingPromptIndex(null);
  }

  function removePrompt(index) {
    setPrompts((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    const nameCheck = await checkTextModeration(displayName);
    if (!nameCheck.safe) {
      return Alert.alert('Display name not allowed', 'Please revise your display name and try again.');
    }
    const bioCheck = await checkTextModeration(bio);
    if (!bioCheck.safe) {
      return Alert.alert('Bio not allowed', 'Please revise your bio and try again.');
    }
    for (const [label, value] of [['Pronouns', pronouns], ['Gender', gender], ['Sexual orientation', sexualOrientation]]) {
      if (value.trim()) {
        const check = await checkTextModeration(value);
        if (!check.safe) {
          return Alert.alert(`${label} not allowed`, `Please revise this field and try again.`);
        }
      }
    }

    const textBasicsFields = BASICS_FIELDS.filter((f) => f.type === 'text');
    for (const field of textBasicsFields) {
      const value = basics[field.key];
      if (value && value.trim()) {
        const check = await checkTextModeration(value);
        if (!check.safe) {
          return Alert.alert(`${field.label} not allowed`, `Please revise this field and try again.`);
        }
      }
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: displayName,
        bio,
        interests,
        pronouns: pronouns.trim() || null,
        gender: gender.trim() || null,
        sexual_orientation: sexualOrientation.trim() || null,
        basics,
        prompts,
      })
      .eq('id', userId);
    if (error) return Alert.alert('Error', error.message);
    Alert.alert('Saved');
  }

  async function changePhoto() {
    try {
      const asset = await pickProfilePhoto();
      if (!asset) return;
      setUploading(true);
      await uploadProfilePhoto(userId, asset);
      setUploading(false);
      Alert.alert('Photo updated', 'Your new photo is being reviewed before it appears to others.');
      load();
    } catch (e) {
      setUploading(false);
      Alert.alert('Upload failed', e.message);
    }
  }

  async function addExtraPhoto() {
    if (extraPhotos.length >= MAX_EXTRA_PHOTOS) {
      return Alert.alert('Limit reached', `You can add up to ${MAX_EXTRA_PHOTOS} additional photos.`);
    }
    try {
      const asset = await pickExtraPhoto();
      if (!asset) return;
      setUploadingExtra(true);
      await uploadExtraPhoto(userId, asset, extraPhotos.length);
      setUploadingExtra(false);
      load();
    } catch (e) {
      setUploadingExtra(false);
      Alert.alert('Upload failed', e.message);
    }
  }

  function confirmDeleteExtraPhoto(photo) {
    Alert.alert('Photo options', '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Set as Main Photo',
        onPress: async () => {
          try {
            await setAsMainPhoto(userId, photo.id);
            load();
          } catch (e) {
            Alert.alert('Error', e.message);
          }
        },
      },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteExtraPhoto(photo.id, photo.photo_url);
            load();
          } catch (e) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  }

  const usedQuestions = prompts.map((p) => p.question);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('profile.title')}</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.settingsGear}>
            <Text style={styles.settingsGearText}>⚙️</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.photoWrap} onPress={changePhoto} disabled={uploading} activeOpacity={0.85}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.photoPreview} />
          ) : (
            <Text style={styles.photoPickerText}>{uploading ? 'Uploading...' : 'Tap to\nadd a photo'}</Text>
          )}
          <View style={styles.photoEditBadge}>
            <Text style={styles.photoEditBadgeText}>✎</Text>
          </View>
        </TouchableOpacity>
        <View style={styles.verifiedRow}>
          <View style={[styles.verifiedDot, photoVerified && styles.verifiedDotActive]} />
          <Text style={styles.verifiedText}>
            {photoVerified ? 'Main photo verified' : 'Main photo pending review'}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>{t('profile.morePhotos')}</Text>
        <View style={styles.galleryGrid}>
          {extraPhotos.map((photo) => (
            <TouchableOpacity
              key={photo.id}
              style={styles.galleryItem}
              onLongPress={() => confirmDeleteExtraPhoto(photo)}
              activeOpacity={0.85}
            >
              {photo.signedUrl && <Image source={{ uri: photo.signedUrl }} style={styles.galleryImage} />}
              {!photo.photo_verified && (
                <View style={styles.pendingOverlay}>
                  <Text style={styles.pendingOverlayText}>Pending</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
          {extraPhotos.length < MAX_EXTRA_PHOTOS && (
            <TouchableOpacity style={styles.addPhotoButton} onPress={addExtraPhoto} disabled={uploadingExtra} activeOpacity={0.85}>
              <Text style={styles.addPhotoText}>{uploadingExtra ? '...' : '+'}</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.helperText}>Tap and hold a photo for options — set as main or remove. Up to {MAX_EXTRA_PHOTOS} additional photos.</Text>

        <View style={styles.formCard}>
          <Text style={styles.label}>{t('profile.displayName')}</Text>
          <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholderTextColor={colors.textTertiary} />

          <Text style={styles.label}>{t('profile.bio')}</Text>
          <TextInput
            style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
            value={bio}
            onChangeText={setBio}
            multiline
            placeholderTextColor={colors.textTertiary}
          />
        </View>

        <Text style={styles.sectionLabel}>{t('profile.prompts')}</Text>
        <View style={styles.formCard}>
          {prompts.map((prompt, index) => (
            <TouchableOpacity key={index} style={styles.promptCard} onPress={() => openEditPrompt(index)} activeOpacity={0.85}>
              <View style={{ flex: 1 }}>
                <Text style={styles.promptQuestion}>{prompt.question}</Text>
                <Text style={styles.promptAnswer}>{prompt.answer}</Text>
              </View>
              <TouchableOpacity onPress={() => removePrompt(index)} style={styles.promptRemove}>
                <Text style={styles.promptRemoveText}>✕</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
          {prompts.length < MAX_PROMPTS && (
            <TouchableOpacity style={styles.addPromptButton} onPress={openAddPrompt} activeOpacity={0.85}>
              <Text style={styles.addPromptText}>{t('profile.addPrompt')}</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.helperText}>Add up to {MAX_PROMPTS} prompts to show more of your personality.</Text>
        </View>

        <Text style={styles.sectionLabel}>{t('profile.aboutYou')}</Text>
        <View style={styles.formCard}>
          <Text style={styles.label}>{t('profile.pronounsLabel')}</Text>
          <TextInput
            style={styles.input}
            value={pronouns}
            onChangeText={setPronouns}
            placeholder={t('profile.pronounsPlaceholder')}
            placeholderTextColor={colors.textTertiary}
          />

          <Text style={styles.label}>{t('profile.genderLabel')}</Text>
          <TextInput
            style={styles.input}
            value={gender}
            onChangeText={setGender}
            placeholder={t('profile.optionalPlaceholder')}
            placeholderTextColor={colors.textTertiary}
          />

          <Text style={styles.label}>{t('profile.orientationLabel')}</Text>
          <TextInput
            style={styles.input}
            value={sexualOrientation}
            onChangeText={setSexualOrientation}
            placeholder={t('profile.optionalPlaceholder')}
            placeholderTextColor={colors.textTertiary}
          />
        </View>

        {/* Details and Basics are now a true accordion — only one field
            expanded at a time, showing just the current value when
            collapsed, dramatically shortening what used to be a very
            long page with every option always visible. */}
        <Text style={styles.sectionLabel}>{t('profile.detailsSection')}</Text>
        <View style={styles.formCard}>
          {BASICS_FIELDS.filter((f) => f.type === 'text').map((field) => (
            <AccordionField
              key={field.key}
              field={field}
              value={basics[field.key]}
              expanded={expandedField === field.key}
              onToggle={() => toggleFieldExpanded(field.key)}
            >
              <TextInput
                style={styles.input}
                value={basics[field.key] || ''}
                onChangeText={(v) => setBasicTextField(field.key, v)}
                placeholder={field.placeholder}
                placeholderTextColor={colors.textTertiary}
                autoFocus
              />
            </AccordionField>
          ))}
        </View>

        <Text style={styles.sectionLabel}>{t('profile.basicsSection')}</Text>
        <View style={styles.formCard}>
          {BASICS_FIELDS.filter((f) => f.type === 'select').map((field) => (
            <AccordionField
              key={field.key}
              field={field}
              value={basics[field.key]}
              expanded={expandedField === field.key}
              onToggle={() => toggleFieldExpanded(field.key)}
            >
              <View style={styles.chipsWrap}>
                {field.options.map((option) => {
                  const selected = basics[field.key] === option;
                  return (
                    <TouchableOpacity
                      key={option}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => setBasicField(field.key, option)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </AccordionField>
          ))}
        </View>

        <Text style={styles.sectionLabel}>{t('profile.interestsSection')}</Text>
        <View style={styles.chipsWrap}>
          {INTEREST_OPTIONS.map((interest) => {
            const selected = interests.includes(interest);
            return (
              <TouchableOpacity
                key={interest}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => toggleInterest(interest)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{interest}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity style={styles.button} onPress={save} activeOpacity={0.85}>
          <Text style={styles.buttonText}>{t('profile.save')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={questionPickerVisible} animationType="slide" onRequestClose={() => setQuestionPickerVisible(false)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Choose a Prompt</Text>
            <TouchableOpacity onPress={() => setQuestionPickerVisible(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={PROMPT_QUESTIONS.filter((q) => !usedQuestions.includes(q))}
            keyExtractor={(item) => item}
            contentContainerStyle={{ padding: spacing.lg }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.questionRow} onPress={() => selectQuestion(item)}>
                <Text style={styles.questionText}>{item}</Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>

      <Modal visible={answerModalVisible} animationType="slide" transparent onRequestClose={() => setAnswerModalVisible(false)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <Text style={styles.sheetQuestion}>{draftQuestion}</Text>
            <TextInput
              style={[styles.input, { height: 90, textAlignVertical: 'top', marginTop: spacing.md }]}
              placeholder="Your answer..."
              placeholderTextColor={colors.textTertiary}
              value={draftAnswer}
              onChangeText={setDraftAnswer}
              multiline
              autoFocus
            />
            <TouchableOpacity style={styles.button} onPress={saveDraftPrompt} activeOpacity={0.85}>
              <Text style={styles.buttonText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAnswerModalVisible(false)} style={{ marginTop: spacing.md }}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { marginBottom: spacing.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settingsGear: { padding: spacing.xs },
  settingsGearText: { fontSize: 22 },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  photoWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    height: 110,
    width: 110,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoPreview: { width: '100%', height: '100%' },
  photoPickerText: { color: colors.textTertiary, textAlign: 'center', fontSize: 12 },
  photoEditBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: colors.primary,
    width: 26,
    height: 26,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoEditBadgeText: { color: '#fff', fontSize: 12 },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, marginBottom: spacing.lg },
  verifiedDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.textTertiary, marginRight: 6 },
  verifiedDotActive: { backgroundColor: colors.success },
  verifiedText: { ...typography.caption, color: colors.textTertiary },
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.lg, textTransform: 'uppercase', letterSpacing: 0.5 },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xs },
  galleryItem: {
    width: 72, height: 72, borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  galleryImage: { width: '100%', height: '100%' },
  pendingOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingVertical: 2,
  },
  pendingOverlayText: { color: '#fff', fontSize: 9, textAlign: 'center', fontWeight: '700' },
  addPhotoButton: {
    width: 72, height: 72, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center',
  },
  addPhotoText: { color: colors.textTertiary, fontSize: 28, fontWeight: '300' },
  helperText: { ...typography.small, color: colors.textTertiary, marginBottom: spacing.md },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  basicFieldBlock: { marginBottom: spacing.sm },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: colors.surfaceElevated, color: colors.textPrimary, borderRadius: radius.sm, padding: spacing.md, fontSize: 15 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', ...shadow.button, marginTop: spacing.sm },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  promptCard: {
    flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm,
  },
  promptQuestion: { ...typography.caption, color: colors.textTertiary, marginBottom: 4 },
  promptAnswer: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  promptRemove: { padding: spacing.xs },
  promptRemoveText: { color: colors.textTertiary, fontSize: 16 },
  addPromptButton: {
    borderWidth: 1.5, borderColor: colors.primary, borderStyle: 'dashed',
    borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm,
  },
  addPromptText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg },
  modalTitle: { ...typography.title, color: colors.textPrimary },
  modalCancelText: { color: colors.primary, fontWeight: '600', textAlign: 'center' },
  questionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  questionText: { ...typography.body, color: colors.textPrimary, flex: 1 },
  chevron: { color: colors.textTertiary, fontSize: 20, fontWeight: '700' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetQuestion: { ...typography.headline, color: colors.textPrimary },
});