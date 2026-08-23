import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Image, ScrollView, Modal, FlatList, KeyboardAvoidingView, Platform, LayoutAnimation, UIManager } from 'react-native';
import { supabase, functionUrl } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { pickProfilePhoto, uploadProfilePhoto, getSignedPhotoUrl } from '../services/photos';
import { pickExtraPhoto, uploadExtraPhoto, getExtraPhotos, deleteExtraPhoto, setAsMainPhoto } from '../services/extraPhotos';
import { checkTextModeration } from '../services/textModeration';
import { getProfileQuickStats, getAchievements, getEarnedProfileStats } from '../services/homeDashboard';
import { getMyBusinessPartnerRequest } from '../services/businessPartnerApply';
import { startRecording, stopRecording, uploadVoiceIntro, getSignedVoiceIntroUrl, deleteVoiceIntro } from '../services/voiceNotes';
import { BASICS_FIELDS } from '../constants/basicsFields';
import { PROMPT_QUESTIONS } from '../constants/promptQuestions';
import { GENDER_IDENTITY_OPTIONS } from '../constants/genderOptions';
import VoicePlayButton from '../components/VoicePlayButton';
import { typography, spacing, radius } from '../theme';

const MAX_VOICE_INTRO_SECONDS = 30;

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const MAX_EXTRA_PHOTOS = 6;
const MAX_PROMPTS = 3;

const INTEREST_OPTIONS = [
  'Travel', 'Coffee', 'Hiking', 'Music', 'Movies', 'Foodie', 'Fitness',
  'Reading', 'Art', 'Gaming', 'Photography', 'Yoga', 'Dancing', 'Cooking',
  'Wine', 'Dogs', 'Cats', 'Outdoors', 'Sports', 'Concerts', 'Museums',
  'Volunteering', 'Meditation', 'Running',
];

const PROFILE_COMPLETENESS_ITEMS = [
  { key: 'photo', label: 'Add a main photo' },
  { key: 'bio', label: 'Write a short bio' },
  { key: 'prompt', label: 'Answer a prompt' },
  { key: 'interests', label: 'Pick a few interests' },
  { key: 'connectionGoal', label: "Say what you're hoping to find" },
  { key: 'extraPhoto', label: 'Add another photo' },
];

function getProfileCompleteness({ photoUrl, bio, prompts, interests, connectionGoal, extraPhotos }) {
  const checks = {
    photo: !!photoUrl,
    bio: !!bio.trim(),
    prompt: prompts.length > 0,
    interests: interests.length > 0,
    connectionGoal: !!connectionGoal,
    extraPhoto: extraPhotos.length > 0,
  };
  const missing = PROFILE_COMPLETENESS_ITEMS.filter((item) => !checks[item.key]);
  const percent = Math.round(
    ((PROFILE_COMPLETENESS_ITEMS.length - missing.length) / PROFILE_COMPLETENESS_ITEMS.length) * 100
  );
  return { percent, missing };
}

function AccordionField({ field, value, expanded, onToggle, children }) {
  const { colors } = useTheme();
  const styles = getAccordionStyles(colors);

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.header}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityLabel={`${field.label}${value ? `, currently ${value}` : ', not set'}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityHint={expanded ? 'Double tap to collapse' : 'Double tap to expand and edit'}
      >
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
  const [genderIdentity, setGenderIdentity] = useState([]);
  const [interestedInGenders, setInterestedInGenders] = useState([]);
  const [basics, setBasics] = useState({});
  const [prompts, setPrompts] = useState([]);
  const [questionPickerVisible, setQuestionPickerVisible] = useState(false);
  const [editingPromptIndex, setEditingPromptIndex] = useState(null);
  const [answerModalVisible, setAnswerModalVisible] = useState(false);
  const [draftQuestion, setDraftQuestion] = useState('');
  const [draftAnswer, setDraftAnswer] = useState('');
  const [expandedField, setExpandedField] = useState(null);
  const [loadingStrengths, setLoadingStrengths] = useState(false);
  const [quickStats, setQuickStats] = useState({ communities: 0, friends: 0, upcomingPlans: 0, pastGatherings: 0 });
  const [achievements, setAchievements] = useState([]);
  const [managesBusiness, setManagesBusiness] = useState(false);
  const [myBusinessRequestStatus, setMyBusinessRequestStatus] = useState(null);
  const [earnedStats, setEarnedStats] = useState({ favoriteVibe: null, usuallyActive: null });
  const [connectionGoal, setConnectionGoal] = useState('');
  const [voiceIntroPath, setVoiceIntroPath] = useState(null);
  const [isRecordingIntro, setIsRecordingIntro] = useState(false);
  const [recordingIntroSeconds, setRecordingIntroSeconds] = useState(0);
  const [uploadingIntro, setUploadingIntro] = useState(false);
  const recordingIntroRef = useRef(null);
  const recordingIntroTimerRef = useRef(null);
  const scrollRef = useRef(null);
  const editSectionYRef = useRef(0);

  useEffect(() => {
    load();
    return () => {
      if (recordingIntroTimerRef.current) clearInterval(recordingIntroTimerRef.current);
    };
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
      setGenderIdentity(data.gender_identity || []);
      setInterestedInGenders(data.interested_in_genders || []);
      setBasics(data.basics || {});
      setPrompts(data.prompts || []);
      setConnectionGoal(data.connection_goal || '');
      setVoiceIntroPath(data.voice_intro_path || null);
      if (data.photo_url) {
        const url = await getSignedPhotoUrl(data.photo_url);
        setPhotoUrl(url);
      }
    }

    const extras = await getExtraPhotos(id);
    setExtraPhotos(extras);

    const stats = await getProfileQuickStats();
    setQuickStats(stats);

    // Quietly keep the stored timezone current — used server-side
    // so daily AI usage limits reset at the user's actual midnight,
    // not the database server's default UTC midnight.
    try {
      const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (deviceTimezone) {
        supabase.from('profiles').update({ timezone: deviceTimezone }).eq('id', id);
      }
    } catch (e) {
      // fail quietly, this is a background nicety, not critical
    }

    const earnedAchievements = await getAchievements();
    setAchievements(earnedAchievements);
    setManagesBusiness(!!data?.managed_partner_id);
    if (!data?.managed_partner_id) {
      try {
        const myRequest = await getMyBusinessPartnerRequest();
        setMyBusinessRequestStatus(myRequest?.status ?? null);
      } catch (e) {
        // no-op: don't block the rest of Profile loading over this
      }
    }
    const earnedStats = await getEarnedProfileStats().catch(() => ({ favoriteVibe: null, usuallyActive: null }));
    setEarnedStats(earnedStats);
  }

  async function showStrengths() {
    setLoadingStrengths(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const response = await fetch(functionUrl('generate-strengths'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
const result = await response.json();

      if (!response.ok) {
        if (response.status === 403) {
          Alert.alert(
            'Premium Feature',
            'Generating a personalized note about your profile uses AI and is a Premium feature.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Upgrade to Premium', onPress: () => navigation.navigate('Paywall') },
            ]
          );
          setLoadingStrengths(false);
          return;
        }
        Alert.alert('Error', result.error || 'Could not generate this right now.');
        setLoadingStrengths(false);
        return;
      }

      Alert.alert('✨ A note for you', result.summary, [{ text: 'Thanks' }]);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setLoadingStrengths(false);
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

  function toggleGenderIdentity(option) {
    setGenderIdentity((prev) =>
      prev.includes(option) ? prev.filter((g) => g !== option) : [...prev, option]
    );
  }

  function toggleInterestedInGender(option) {
    setInterestedInGenders((prev) =>
      prev.includes(option) ? prev.filter((g) => g !== option) : [...prev, option]
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

  function formatVoiceIntroTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  async function startVoiceIntroRecording() {
    try {
      const recording = await startRecording();
      recordingIntroRef.current = recording;
      setIsRecordingIntro(true);
      setRecordingIntroSeconds(0);

      recordingIntroTimerRef.current = setInterval(() => {
        setRecordingIntroSeconds((prev) => {
          if (prev + 1 >= MAX_VOICE_INTRO_SECONDS) {
            stopVoiceIntroRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function cancelVoiceIntroRecording() {
    if (recordingIntroTimerRef.current) clearInterval(recordingIntroTimerRef.current);
    setIsRecordingIntro(false);
    if (recordingIntroRef.current) {
      await stopRecording(recordingIntroRef.current).catch(() => {});
      recordingIntroRef.current = null;
    }
  }

  async function stopVoiceIntroRecording() {
    if (recordingIntroTimerRef.current) clearInterval(recordingIntroTimerRef.current);
    setIsRecordingIntro(false);
    if (!recordingIntroRef.current) return;

    try {
      const uri = await stopRecording(recordingIntroRef.current);
      recordingIntroRef.current = null;

      setUploadingIntro(true);
      const previousPath = voiceIntroPath;
      const path = await uploadVoiceIntro(userId, uri);
      const { error } = await supabase.from('profiles').update({ voice_intro_path: path }).eq('id', userId);
      setUploadingIntro(false);

      if (error) {
        Alert.alert('Error', error.message);
        return;
      }
      setVoiceIntroPath(path);
      if (previousPath) deleteVoiceIntro(previousPath).catch(() => {});
    } catch (e) {
      setUploadingIntro(false);
      Alert.alert('Error', e.message);
    }
  }

  function removeVoiceIntro() {
    Alert.alert('Remove voice intro?', '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const pathToDelete = voiceIntroPath;
          setVoiceIntroPath(null);
          const { error } = await supabase.from('profiles').update({ voice_intro_path: null }).eq('id', userId);
          if (error) {
            Alert.alert('Error', error.message);
            setVoiceIntroPath(pathToDelete);
            return;
          }
          deleteVoiceIntro(pathToDelete).catch(() => {});
        },
      },
    ]);
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
        gender_identity: genderIdentity,
        interested_in_genders: interestedInGenders,
        basics,
        prompts,
        connection_goal: connectionGoal || null,
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
  const completeness = getProfileCompleteness({ photoUrl, bio, prompts, interests, connectionGoal, extraPhotos });

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: spacing.lg }}>
        <View style={styles.header}>
          <Text style={styles.headerTitle} accessibilityRole="header">{t('profile.title')}</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Settings')}
            style={styles.settingsGear}
            accessibilityLabel="Settings"
            accessibilityRole="button"
          >
            <Text style={styles.settingsGearText}>⚙️</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>Your story, your stats, your circle.</Text>

        {/* Aug 23 2026 IA pass (CLAUDE.md): a real "who am I" snapshot,
            first thing on the screen — direct feedback was that this
            screen dropped straight into numbers (stat tiles) with no
            visual sense of "this is me" until scrolling all the way down
            to the photo/bio editing fields. Read-only preview of the
            same already-loaded state the edit fields below use (no new
            query) — tapping "Edit Profile" scrolls straight to that
            section instead of making the user hunt for it. */}
        <View style={styles.snapshotCard}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.snapshotPhoto} />
          ) : (
            <View style={[styles.snapshotPhoto, styles.snapshotPhotoPlaceholder]} />
          )}
          <View style={styles.snapshotInfo}>
            <Text style={styles.snapshotName} numberOfLines={1}>{displayName || 'Your name'}</Text>
            <Text style={styles.snapshotBio} numberOfLines={2}>
              {bio ? bio : 'Add a bio so people know a bit about you.'}
            </Text>
            <TouchableOpacity
              onPress={() => scrollRef.current?.scrollTo({ y: editSectionYRef.current, animated: true })}
              accessibilityLabel="Edit your profile"
              accessibilityRole="button"
            >
              <Text style={styles.snapshotEditLink}>Edit Profile ›</Text>
            </TouchableOpacity>
          </View>
        </View>

        {completeness.percent < 100 && (
          <View
            style={styles.completenessCard}
            accessibilityLabel={`Your profile is ${completeness.percent}% complete. ${completeness.missing[0].label} to stand out more.`}
          >
            <Text style={styles.completenessTitle}>Your profile is {completeness.percent}% complete</Text>
            <View style={styles.completenessBarTrack}>
              <View style={[styles.completenessBarFill, { width: `${completeness.percent}%` }]} />
            </View>
            <Text style={styles.completenessHint}>{completeness.missing[0].label} to stand out more.</Text>
          </View>
        )}

        {/* Aug 23 2026 IA pass (CLAUDE.md): "Your Plans" pulled out as its
            own leading section — "what am I actually doing" is a more
            important question than "who am I connected to," per direct
            product feedback, so it now comes first, right after the
            profile header, instead of buried inside the activity group
            below it. Same two real quick-stat tiles, same destination
            (the existing Plans screen) -- only the grouping moved. */}
        <Text style={styles.sectionLabel} accessibilityRole="header">Your Plans</Text>
        <View style={styles.quickStatsRow}>
          <TouchableOpacity style={styles.quickStat} onPress={() => navigation.navigate('Plans', { initialTab: 'upcoming' })} accessibilityLabel={`${quickStats.upcomingPlans} upcoming plans`} accessibilityRole="button">
            <Text style={styles.quickStatNumber}>{quickStats.upcomingPlans}</Text>
            <Text style={styles.quickStatLabel}>Upcoming</Text>
          </TouchableOpacity>
         <TouchableOpacity style={styles.quickStat} onPress={() => navigation.navigate('Plans', { initialTab: 'past' })} accessibilityLabel={`${quickStats.pastGatherings} past experiences`} accessibilityRole="button">
            <Text style={styles.quickStatNumber}>{quickStats.pastGatherings}</Text>
            <Text style={styles.quickStatLabel}>Past</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">Your Connections</Text>
        <View style={styles.quickStatsRow}>
          <TouchableOpacity style={styles.quickStat} onPress={() => navigation.navigate('Communities')} accessibilityLabel={`${quickStats.communities} communities`} accessibilityRole="button">
            <Text style={styles.quickStatNumber}>{quickStats.communities}</Text>
            <Text style={styles.quickStatLabel}>Communities</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickStat} onPress={() => navigation.navigate('Friends')} accessibilityLabel={`${quickStats.friends} friends`} accessibilityRole="button">
            <Text style={styles.quickStatNumber}>{quickStats.friends}</Text>
            <Text style={styles.quickStatLabel}>Friends</Text>
          </TouchableOpacity>
        </View>

        {/* Renamed from "Your Activity" -- that label now belongs to the
            leading Plans section above; this group is the "how am I
            doing / what have I earned" set of links, not the plans
            themselves. */}
        <Text style={styles.sectionLabel} accessibilityRole="header">Your Story</Text>
        {/* Aug 23 2026 Product Coherence Audit P2 (CLAUDE.md): "Your
            Activity" and "Your Rewards" read as two similar "how am I
            doing" rows with no framing telling a reader why they're
            different things (a real social-participation streak vs. a
            real loyalty-tier count from perk redemptions -- genuinely
            different core objects, correctly kept as two screens, per
            the same audit's own "flows that should remain separate"
            list). A one-line subtitle per row, added to all four here
            for visual consistency rather than singling two out. */}
        <TouchableOpacity
          style={styles.timelineLink}
          onPress={() => navigation.navigate('Timeline')}
          activeOpacity={0.85}
          accessibilityLabel="View your timeline, how your social life has grown"
          accessibilityRole="button"
        >
          <View style={styles.timelineLinkTextCol}>
            <Text style={styles.timelineLinkText}>📖 View Your Timeline</Text>
            <Text style={styles.timelineLinkSubtitle}>How your social life has grown over time</Text>
          </View>
          <Text style={styles.timelineLinkChevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.timelineLink}
          onPress={() => navigation.navigate('MemoryVaultIndex')}
          activeOpacity={0.85}
          accessibilityLabel="View your memory vaults, one per match"
          accessibilityRole="button"
        >
          <View style={styles.timelineLinkTextCol}>
            <Text style={styles.timelineLinkText}>💫 Memory Vault</Text>
            <Text style={styles.timelineLinkSubtitle}>Saved moments, one collection per match</Text>
          </View>
          <Text style={styles.timelineLinkChevron}>›</Text>
        </TouchableOpacity>
        {/* Convergence pass P2 (CLAUDE.md): "Your Insights" and "Your
            Momentum" were two separate rows both answering "how am I
            doing?" -- merged into one destination (still the Momentum
            route/screen underneath, now covering both). */}
        <TouchableOpacity
          style={styles.timelineLink}
          onPress={() => navigation.navigate('Momentum')}
          activeOpacity={0.85}
          accessibilityLabel="View your activity, stats, and streak"
          accessibilityRole="button"
        >
          <View style={styles.timelineLinkTextCol}>
            <Text style={styles.timelineLinkText}>🔥 Your Activity</Text>
            <Text style={styles.timelineLinkSubtitle}>Your weekly streak and social stats</Text>
          </View>
          <Text style={styles.timelineLinkChevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.timelineLink}
          onPress={() => navigation.navigate('Rewards')}
          activeOpacity={0.85}
          accessibilityLabel="View your rewards tier"
          accessibilityRole="button"
        >
          <View style={styles.timelineLinkTextCol}>
            <Text style={styles.timelineLinkText}>🎁 Your Rewards</Text>
            <Text style={styles.timelineLinkSubtitle}>Your loyalty tier, from perks you've redeemed</Text>
          </View>
          <Text style={styles.timelineLinkChevron}>›</Text>
        </TouchableOpacity>
        {(earnedStats.favoriteVibe || earnedStats.usuallyActive) && (
          <View style={styles.earnedStatsRow}>
            {earnedStats.favoriteVibe && (
              <View style={styles.earnedStat}>
                <Text style={styles.earnedStatLabel}>Favorite vibe</Text>
                <Text style={styles.earnedStatValue}>{earnedStats.favoriteVibe}</Text>
              </View>
            )}
            {earnedStats.usuallyActive && (
              <View style={styles.earnedStat}>
                <Text style={styles.earnedStatLabel}>Usually active</Text>
                <Text style={styles.earnedStatValue}>{earnedStats.usuallyActive}s</Text>
              </View>
            )}
          </View>
        )}
        {achievements.some((a) => a.earned) && (
          <>
            <Text style={styles.sectionLabel} accessibilityRole="header">Achievements</Text>
            <View style={styles.achievementsGrid}>
              {achievements.filter((a) => a.earned).map((a) => (
                <View key={a.label} style={styles.achievementBadge} accessibilityLabel={`${a.label}: ${a.description}`}>
                  <Text style={styles.achievementIcon}>{a.icon}</Text>
                  <Text style={styles.achievementLabel}>{a.label}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionLabel} accessibilityRole="header">Business</Text>
        {managesBusiness ? (
          <TouchableOpacity
            style={styles.businessModeButton}
            onPress={() => navigation.navigate('BusinessDashboard')}
            activeOpacity={0.85}
            accessibilityLabel="Business"
            accessibilityRole="button"
          >
            <Text style={styles.businessModeButtonText}>🏪 Business</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.businessModeButton}
            onPress={() => navigation.navigate(
              (myBusinessRequestStatus === 'pending' || myBusinessRequestStatus === 'denied')
                ? 'MyBusinessApplication'
                : 'BusinessPartnerApply'
            )}
            activeOpacity={0.85}
            accessibilityLabel="List your business on Nearby"
            accessibilityRole="button"
          >
            <Text style={styles.businessModeButtonText}>🏪 List Your Business</Text>
          </TouchableOpacity>
        )}

        {/* A real visual break, not just another sectionLabel — everything
            above this point is a read-only summary of "your life on
            Nearby" (plans, connections, story, business); everything
            below is the identity-editing form. onLayout captures this
            section's real y-position so the snapshot card's "Edit
            Profile" link can scroll straight to it. */}
        <View
          style={styles.editSectionDivider}
          onLayout={(e) => { editSectionYRef.current = e.nativeEvent.layout.y; }}
        >
          <Text style={styles.editSectionTitle} accessibilityRole="header">Edit Your Profile</Text>
          <Text style={styles.editSectionSubtitle}>Your photos, bio, and what people see about you.</Text>
        </View>
        <TouchableOpacity
          style={styles.photoWrap}
          onPress={changePhoto}
          disabled={uploading}
          activeOpacity={0.85}
          accessibilityLabel={photoUrl ? 'Change your main profile photo' : 'Add a main profile photo'}
          accessibilityRole="button"
        >
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

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('profile.morePhotos')}</Text>
        <View style={styles.galleryGrid}>
          {extraPhotos.map((photo, index) => (
            <TouchableOpacity
              key={photo.id}
              style={styles.galleryItem}
              onLongPress={() => confirmDeleteExtraPhoto(photo)}
              activeOpacity={0.85}
              accessibilityLabel={`Additional photo ${index + 1}${!photo.photo_verified ? ', pending review' : ''}`}
              accessibilityHint="Double tap and hold for options to set as main photo or remove"
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
            <TouchableOpacity
              style={styles.addPhotoButton}
              onPress={addExtraPhoto}
              disabled={uploadingExtra}
              activeOpacity={0.85}
              accessibilityLabel="Add another photo"
              accessibilityRole="button"
            >
              <Text style={styles.addPhotoText}>{uploadingExtra ? '...' : '+'}</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.helperText}>Tap and hold a photo for options — set as main or remove. Up to {MAX_EXTRA_PHOTOS} additional photos.</Text>

        <View style={styles.formCard}>
          <Text style={styles.label}>{t('profile.displayName')}</Text>
          <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholderTextColor={colors.textTertiary} accessibilityLabel="Display name" />

          <Text style={styles.label}>{t('profile.bio')}</Text>
          <TextInput
            style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
            value={bio}
            onChangeText={setBio}
            multiline
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Bio"
          />
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('profile.prompts')}</Text>
        <View style={styles.formCard}>
          {prompts.map((prompt, index) => (
            <TouchableOpacity
              key={index}
              style={styles.promptCard}
              onPress={() => openEditPrompt(index)}
              activeOpacity={0.85}
              accessibilityLabel={`Prompt: ${prompt.question}, answer: ${prompt.answer}. Double tap to edit`}
              accessibilityRole="button"
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.promptQuestion}>{prompt.question}</Text>
                <Text style={styles.promptAnswer}>{prompt.answer}</Text>
              </View>
              <TouchableOpacity
                onPress={() => removePrompt(index)}
                style={styles.promptRemove}
                accessibilityLabel={`Remove this prompt`}
                accessibilityRole="button"
              >
                <Text style={styles.promptRemoveText}>✕</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
          {prompts.length < MAX_PROMPTS && (
            <TouchableOpacity
              style={styles.addPromptButton}
              onPress={openAddPrompt}
              activeOpacity={0.85}
              accessibilityLabel="Add a prompt"
              accessibilityRole="button"
            >
              <Text style={styles.addPromptText}>{t('profile.addPrompt')}</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.helperText}>Add up to {MAX_PROMPTS} prompts to show more of your personality.</Text>
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">Voice Intro</Text>
        <View style={styles.formCard}>
          {voiceIntroPath ? (
            <View style={styles.voiceIntroRow}>
              <VoicePlayButton
                getUrl={() => getSignedVoiceIntroUrl(voiceIntroPath)}
                label="Your voice intro"
                style={styles.voicePlayButton}
              />
              <Text style={styles.voiceIntroLabel}>Your voice intro</Text>
              <TouchableOpacity
                onPress={removeVoiceIntro}
                style={styles.promptRemove}
                accessibilityLabel="Remove voice intro"
                accessibilityRole="button"
              >
                <Text style={styles.promptRemoveText}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : isRecordingIntro ? (
            <View style={styles.voiceIntroRow}>
              <Text style={styles.recordingIntroTime}>{formatVoiceIntroTime(recordingIntroSeconds)}</Text>
              <TouchableOpacity
                onPress={stopVoiceIntroRecording}
                style={styles.addPromptButton}
                accessibilityLabel="Stop recording"
                accessibilityRole="button"
              >
                <Text style={styles.addPromptText}>Stop</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={cancelVoiceIntroRecording}
                accessibilityLabel="Cancel recording"
                accessibilityRole="button"
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.addPromptButton}
              onPress={startVoiceIntroRecording}
              disabled={uploadingIntro}
              activeOpacity={0.85}
              accessibilityLabel="Record a voice intro"
              accessibilityRole="button"
            >
              <Text style={styles.addPromptText}>{uploadingIntro ? 'Uploading...' : '🎙️ Record a Voice Intro'}</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.helperText}>Up to {MAX_VOICE_INTRO_SECONDS} seconds. A quick voice intro helps you stand out.</Text>
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">What are you hoping to find?</Text>
        <View style={styles.chipsWrap}>
          {['Meet friends', 'Date', 'Network', 'Explore my city', 'Find community', 'Get out more'].map((goal) => {
            const selected = connectionGoal === goal;
            return (
              <TouchableOpacity
                key={goal}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => setConnectionGoal(selected ? '' : goal)}
                activeOpacity={0.8}
                accessibilityLabel={goal}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{goal}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.helperText}>This helps us tailor what we show you — you can change it anytime.</Text>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('profile.aboutYou')}</Text>
        <View style={styles.formCard}>
          <Text style={styles.label}>I identify as</Text>
          <View style={styles.chipsWrap}>
            {GENDER_IDENTITY_OPTIONS.map((option) => {
              const selected = genderIdentity.includes(option);
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleGenderIdentity(option)}
                  activeOpacity={0.8}
                  accessibilityLabel={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.helperText}>Select all that apply — this affects who you're matched with.</Text>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>I'm interested in dating</Text>
          <View style={styles.chipsWrap}>
            {GENDER_IDENTITY_OPTIONS.map((option) => {
              const selected = interestedInGenders.includes(option);
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleInterestedInGender(option)}
                  activeOpacity={0.8}
                  accessibilityLabel={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.helperText}>Select all that apply. Matching is mutual — you'll only see people whose preferences also include you.</Text>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>{t('profile.pronounsLabel')}</Text>
          <TextInput
            style={styles.input}
            value={pronouns}
            onChangeText={setPronouns}
            placeholder={t('profile.pronounsPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Pronouns"
          />

          <Text style={styles.label}>{t('profile.orientationLabel')}</Text>
          <TextInput
            style={styles.input}
            value={sexualOrientation}
            onChangeText={setSexualOrientation}
            placeholder={t('profile.optionalPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Sexual orientation"
          />
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('profile.detailsSection')}</Text>
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
                accessibilityLabel={field.label}
              />
            </AccordionField>
          ))}
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('profile.basicsSection')}</Text>
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
                      accessibilityLabel={option}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </AccordionField>
          ))}
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('profile.interestsSection')}</Text>
        <View style={styles.chipsWrap}>
          {INTEREST_OPTIONS.map((interest) => {
            const selected = interests.includes(interest);
            return (
              <TouchableOpacity
                key={interest}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => toggleInterest(interest)}
                activeOpacity={0.8}
                accessibilityLabel={interest}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{interest}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={styles.strengthsButton}
          onPress={showStrengths}
          disabled={loadingStrengths}
          activeOpacity={0.85}
          accessibilityLabel="Generate a note about why someone would be lucky to date you"
          accessibilityRole="button"
        >
          <Text style={styles.strengthsButtonText}>{loadingStrengths ? 'Thinking...' : '✨ Why someone would be lucky to date you'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.button}
          onPress={save}
          activeOpacity={0.85}
          accessibilityLabel="Save changes"
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{t('profile.save')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={questionPickerVisible} animationType="slide" onRequestClose={() => setQuestionPickerVisible(false)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle} accessibilityRole="header">Choose a Prompt</Text>
            <TouchableOpacity
              onPress={() => setQuestionPickerVisible(false)}
              accessibilityLabel="Cancel"
              accessibilityRole="button"
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={PROMPT_QUESTIONS.filter((q) => !usedQuestions.includes(q))}
            keyExtractor={(item) => item}
            contentContainerStyle={{ padding: spacing.lg }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.questionRow}
                onPress={() => selectQuestion(item)}
                accessibilityLabel={item}
                accessibilityRole="button"
              >
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
            <Text style={styles.sheetQuestion} accessibilityRole="header">{draftQuestion}</Text>
            <TextInput
              style={[styles.input, { height: 90, textAlignVertical: 'top', marginTop: spacing.md }]}
              placeholder="Your answer..."
              placeholderTextColor={colors.textTertiary}
              value={draftAnswer}
              onChangeText={setDraftAnswer}
              multiline
              autoFocus
              accessibilityLabel="Your answer"
            />
            <TouchableOpacity
              style={styles.button}
              onPress={saveDraftPrompt}
              activeOpacity={0.85}
              accessibilityLabel="Save prompt answer"
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setAnswerModalVisible(false)}
              style={{ marginTop: spacing.md }}
              accessibilityLabel="Cancel"
              accessibilityRole="button"
            >
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
  header: { marginBottom: 2, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settingsGear: { padding: spacing.xs },
  settingsGearText: { fontSize: 22 },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  snapshotCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  snapshotPhoto: { width: 64, height: 64, borderRadius: radius.full },
  snapshotPhotoPlaceholder: { backgroundColor: colors.surfaceElevated },
  snapshotInfo: { flex: 1 },
  snapshotName: { ...typography.headline, color: colors.textPrimary },
  snapshotBio: { ...typography.caption, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.xs },
  snapshotEditLink: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  editSectionDivider: {
    borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.xl, paddingTop: spacing.lg, marginBottom: spacing.sm,
  },
  editSectionTitle: { ...typography.title, color: colors.textPrimary },
  editSectionSubtitle: { ...typography.body, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.sm },
  completenessCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  completenessTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 13, marginBottom: spacing.sm },
  completenessBarTrack: { height: 6, borderRadius: radius.full, backgroundColor: colors.surfaceElevated, overflow: 'hidden' },
  completenessBarFill: { height: '100%', borderRadius: radius.full, backgroundColor: colors.primary },
  completenessHint: { color: colors.textTertiary, fontSize: 12, marginTop: spacing.sm },
  timelineLink: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  timelineLinkTextCol: { flex: 1 },
  timelineLinkText: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  timelineLinkSubtitle: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  timelineLinkChevron: { color: colors.textTertiary, fontSize: 18, fontWeight: '700' },
  earnedStatsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  earnedStat: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  earnedStatLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  earnedStatValue: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  quickStatsRow: {
    flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg, overflow: 'hidden',
  },
  quickStat: { flex: 1, alignItems: 'center', paddingVertical: spacing.md },
  quickStatNumber: { ...typography.headline, color: colors.textPrimary },
  quickStatLabel: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  achievementsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  achievementBadge: {
    alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, width: 90,
  },
  achievementIcon: { fontSize: 24, marginBottom: 4 },
  achievementLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  businessModeButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14,
    alignItems: 'center', marginBottom: spacing.lg,
  },
  businessModeButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
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
    width: 108, height: 108, borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  galleryImage: { width: '100%', height: '100%' },
  pendingOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingVertical: 2,
  },
  pendingOverlayText: { color: '#fff', fontSize: 9, textAlign: 'center', fontWeight: '700' },
  addPhotoButton: {
    width: 108, height: 108, borderRadius: radius.md,
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
  strengthsButton: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.full, paddingVertical: 14,
    alignItems: 'center', marginTop: spacing.lg, borderWidth: 1, borderColor: colors.primary,
  },
  strengthsButtonText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
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
  voiceIntroRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm,
  },
  voicePlayButton: {
    width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.primary,
  },
  voiceIntroLabel: { flex: 1, color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
  recordingIntroTime: { flex: 1, color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg },
  modalTitle: { ...typography.title, color: colors.textPrimary },
  modalCancelText: { color: colors.textSecondary, fontWeight: '600', textAlign: 'center' },
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