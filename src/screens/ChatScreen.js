import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Alert, Image, ActivityIndicator, AppState } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { Audio, Video } from 'expo-av';
import { supabase, functionUrl } from '../services/supabase';
import { checkTextModeration } from '../services/textModeration';
import { isPremium } from '../services/purchases';
import { updateBadgeCount } from '../services/notifications';
import { startRecording, stopRecording, uploadVoiceNote, getSignedAudioUrl } from '../services/voiceNotes';
import { checkVoiceNoteLimit } from '../services/voiceNoteLimits';
import { pickChatPhoto, uploadChatPhoto, pickChatVideo, uploadChatVideo, getSignedChatMediaUrl } from '../services/chatMedia';
import { unmatch } from '../services/matchActions';
import { toggleReaction, getReactionsForMatch } from '../services/messageReactions';
import { randomExperiment } from '../constants/relationshipExperiments';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import ReportBlockModal from '../components/ReportBlockModal';
import ActionSheetModal from '../components/ActionSheetModal';
import LoadErrorState from '../components/LoadErrorState';
import useChatComposer from '../hooks/useChatComposer';
import usePaginatedMessages from '../hooks/usePaginatedMessages';
import GifPickerModal from '../components/GifPickerModal';
import DateCheckInModal from '../components/DateCheckInModal';
import AnimatedMessageBubble from '../components/AnimatedMessageBubble';
import * as ScreenCapture from 'expo-screen-capture';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const MAX_RECORDING_SECONDS = 60;
const TYPING_IDLE_MS = 3000;
const STALLED_THRESHOLD_DAYS = 3;
const REACTION_EMOJIS = ['❤️', '😂', '👍', '😮', '😢'];

function VoiceBubble({ audioPath, isMe, colors }) {
  const [sound, setSound] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  async function togglePlay() {
    if (playing && sound) {
      await sound.pauseAsync();
      setPlaying(false);
      return;
    }

    if (sound) {
      await sound.playAsync();
      setPlaying(true);
      return;
    }

    setLoading(true);
    const url = await getSignedAudioUrl(audioPath);
    if (!url) {
      setLoading(false);
      Alert.alert('Error', 'Could not load this voice note.');
      return;
    }

    const { sound: newSound } = await Audio.Sound.createAsync(
      { uri: url },
      { shouldPlay: true },
      (status) => {
        if (status.didJustFinish) {
          setPlaying(false);
          newSound.setPositionAsync(0);
        }
      }
    );
    setSound(newSound);
    setPlaying(true);
    setLoading(false);
  }

  useEffect(() => {
    return () => {
      if (sound) sound.unloadAsync();
    };
  }, [sound]);

  return (
    <TouchableOpacity
      style={[voiceStyles.bubble, isMe ? { backgroundColor: colors.primary } : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
      onPress={togglePlay}
      activeOpacity={0.8}
      accessibilityLabel={`${isMe ? 'Your' : 'Their'} voice message, ${playing ? 'playing, tap to pause' : 'tap to play'}`}
      accessibilityRole="button"
    >
      {loading ? (
        <ActivityIndicator size="small" color={isMe ? '#fff' : colors.primary} />
      ) : (
        <Text style={{ fontSize: 18 }}>{playing ? '⏸' : '▶️'}</Text>
      )}
      <Text style={[voiceStyles.label, { color: isMe ? '#fff' : colors.textPrimary }]}>Voice message</Text>
    </TouchableOpacity>
  );
}

const voiceStyles = StyleSheet.create({
  bubble: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 18, gap: 8 },
  label: { fontSize: 14, fontWeight: '600' },
});

export default function ChatScreen({ route, navigation }) {
  const { matchId } = route.params;
  const { colors } = useTheme();
  const { t, language } = useLanguage();
  const styles = getStyles(colors);
  const posthog = usePostHog();
  const headerHeight = useHeaderHeight();
  const fetchPage = useCallback(async ({ limit, beforeCreatedAt }) => {
    let query = supabase
      .from('messages')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (beforeCreatedAt) query = query.lt('created_at', beforeCreatedAt);
    const { data, error } = await query;
    if (error) {
      console.error('loadMessages page error', error);
      return [];
    }
    return data ?? [];
  }, [matchId]);
  const { messages, setMessages, loadInitial, loadOlder, prependMessage, updateMessage, hasMore, loadingOlder } = usePaginatedMessages(fetchPage);
  const { text, setText, send, sendError } = useChatComposer();
  const [userId, setUserId] = useState(null);
  const [otherUser, setOtherUser] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [gatheringTitle, setGatheringTitle] = useState(null);
  const [isRomanticMatch, setIsRomanticMatch] = useState(true);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [togetherMenuVisible, setTogetherMenuVisible] = useState(false);
  const [courageMenuVisible, setCourageMenuVisible] = useState(false);
  const [gifPickerVisible, setGifPickerVisible] = useState(false);
  const [checkInModalVisible, setCheckInModalVisible] = useState(false);
  const [isUserPremium, setIsUserPremium] = useState(false);
  const [loadingIcebreaker, setLoadingIcebreaker] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const [otherIsTyping, setOtherIsTyping] = useState(false);
  const [isStalled, setIsStalled] = useState(false);
  const [reactions, setReactions] = useState({});
  const [mediaUrls, setMediaUrls] = useState({});
  const [imageLoadFailed, setImageLoadFailed] = useState({});
  const [disappearingMode, setDisappearingMode] = useState('off');
  const [firstMessageSentFlag, setFirstMessageSentFlag] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [designatedFirstMessengerId, setDesignatedFirstMessengerId] = useState(null);
  const [designatedFirstMessengerName, setDesignatedFirstMessengerName] = useState(null);
  const seenMessageIdsRef = useRef(new Set());
  const recordingRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const typingChannelRef = useRef(null);
  const messagesChannelRef = useRef(null);
  const reactionChannelRef = useRef(null);
  const otherTypingTimeoutRef = useRef(null);

  async function loadReactions() {
    const data = await getReactionsForMatch(matchId);
    const grouped = {};
    data.forEach((r) => {
      if (!grouped[r.message_id]) grouped[r.message_id] = [];
      grouped[r.message_id].push(r);
    });
    setReactions(grouped);
  }

  async function markMessagesAsRead(myId) {
    await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('match_id', matchId)
      .neq('sender_id', myId)
      .is('read_at', null);

    updateBadgeCount(myId);
  }

  useEffect(() => {
    const missingMediaIds = messages.filter((m) => m.media_url && !mediaUrls[m.id]);
    if (missingMediaIds.length === 0) return;
    (async () => {
      const entries = await Promise.all(
        missingMediaIds.map(async (m) => {
          const url = await getSignedChatMediaUrl(m.media_url);
          return [m.id, url];
        })
      );
      setMediaUrls((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
  }, [messages]);

  // messages is kept in DESC order (see usePaginatedMessages) so
  // messages[0] is always the newest currently-loaded message — recomputed
  // whenever the loaded set changes (initial load, a realtime arrival, or
  // an optimistic send), same reactivity the old loadMessages() had on
  // every call, just without a whole-conversation re-fetch to trigger it.
  useEffect(() => {
    if (messages.length === 0) {
      setIsStalled(false);
      return;
    }
    const daysSinceLastMessage = (Date.now() - new Date(messages[0].created_at).getTime()) / (1000 * 60 * 60 * 24);
    setIsStalled(daysSinceLastMessage >= STALLED_THRESHOLD_DAYS);
  }, [messages]);

  useEffect(() => {
    let currentMyId;
    init().then((myId) => {
      currentMyId = myId;
    });

    // Was also driving a setInterval(..., 3000) here that re-ran
    // loadMessages() (the entire conversation, re-fetched from scratch)
    // every 3 seconds, on top of the realtime channel already subscribed
    // to new messages inside init() — two independent delivery mechanisms
    // running at once for the same data. The poll is gone; new messages
    // and their read-receipt marking are now both handled reactively by
    // the channel's own INSERT handler (see init()). The AppState listener
    // below is kept exactly as it was — iOS suspends JS timers (which
    // would also suspend the realtime socket) whenever the screen locks or
    // the app backgrounds, so a real refresh on returning to foreground is
    // still the right fallback, independent of the poll this replaces.
    // Re-syncs to just the most recent page (loadInitial), same as a fresh
    // screen open — if the user had scrolled up via loadOlder before
    // backgrounding, that older history is dropped on resume rather than
    // re-fetched, matching what a fresh open of this screen would show.
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        loadInitial();
        if (currentMyId) markMessagesAsRead(currentMyId);
      }
    });

    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (otherTypingTimeoutRef.current) clearTimeout(otherTypingTimeoutRef.current);
      if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
      if (messagesChannelRef.current) supabase.removeChannel(messagesChannelRef.current);
      if (reactionChannelRef.current) supabase.removeChannel(reactionChannelRef.current);
      subscription.remove();
    };
  }, []);

  // Screenshot detection only makes sense when disappearing messages
  // are actually on — true prevention isn't possible on iOS, so this
  // is the realistic equivalent: the other person finds out a
  // screenshot happened, same as Snapchat's approach.
  useEffect(() => {
    if (disappearingMode === 'off') return;
    const subscription = ScreenCapture.addScreenshotListener(() => {
      supabase.rpc('notify_screenshot_taken', { match_id_param: matchId }).catch((err) => {
        console.error('notify_screenshot_taken error', err);
      });
    });
    return () => subscription.remove();
  }, [disappearingMode, matchId]);

  // Re-registers the header's "⋯" button whenever disappearingMode
  // changes — navigation.setOptions inside init() only runs once on
  // mount, which would otherwise permanently freeze the button's
  // closure to whatever disappearingMode was at that exact moment,
  // never reflecting later updates.
  useEffect(() => {
    if (!otherUser) return;
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            onPress={showTogetherMenu}
            style={{ paddingHorizontal: spacing.sm }}
            accessibilityLabel="Do something together"
            accessibilityRole="button"
          >
            <Text style={{ fontSize: 18 }}>🎯</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setCheckInModalVisible(true)}
            style={{ paddingHorizontal: spacing.sm }}
            accessibilityLabel="Set up a date safety check-in"
            accessibilityRole="button"
          >
            <Text style={{ fontSize: 18 }}>🛡️</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={showChatOptions}
            style={{ paddingHorizontal: spacing.sm }}
            accessibilityLabel="Chat options"
            accessibilityRole="button"
          >
            <Text style={{ color: colors.primary, fontSize: 20 }}>⋯</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [disappearingMode, otherUser]);

  async function init() {
    try {
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    setUserId(myId);

    isPremium().then(setIsUserPremium).catch(() => setIsUserPremium(false));

    const { data: match } = await supabase
      .from('matches')
      .select('user_a, user_b, disappearing_mode, first_message_sent, source_gathering_id, source_friendship_id, gatherings(title), a:profiles!matches_user_a_fkey(id, display_name, read_receipts_enabled, women_message_first), b:profiles!matches_user_b_fkey(id, display_name, read_receipts_enabled, women_message_first)')
      .eq('id', matchId)
      .single();

    if (match) {
      setDisappearingMode(match.disappearing_mode ?? 'off');
      setFirstMessageSentFlag(!!match.first_message_sent);
      const other = match.user_a === myId ? match.b : match.a;
      const me = match.user_a === myId ? match.a : match.b;
      setOtherUser(other);
      setGatheringTitle(match.gatherings?.title || null);

      // "Women message first" only makes sense for genuinely
      // romantic matches — applying it to a friend or gathering
      // connection would incorrectly gate what's meant to be a
      // platonic chat with dating-context framing.
      const matchIsRomantic = !match.source_gathering_id && !match.source_friendship_id;
      setIsRomanticMatch(matchIsRomantic);
      const meOptedIn = matchIsRomantic && !!me?.women_message_first;
      const otherOptedIn = matchIsRomantic && !!other?.women_message_first;
      if (meOptedIn && !otherOptedIn) {
        setDesignatedFirstMessengerId(myId);
        setDesignatedFirstMessengerName('You');
      } else if (otherOptedIn && !meOptedIn) {
        setDesignatedFirstMessengerId(other.id);
        setDesignatedFirstMessengerName(other.display_name);
      } else {
        setDesignatedFirstMessengerId(null);
        setDesignatedFirstMessengerName(null);
      }

      navigation.setOptions({
        headerShown: true,
        headerTitle: () => (
          <TouchableOpacity
            onPress={() => navigation.navigate('ViewProfile', { userId: other?.id })}
            accessibilityLabel={`View ${other?.display_name}'s profile`}
            accessibilityRole="button"
          >
            <Text style={{ color: colors.textPrimary, fontSize: 17, fontWeight: '600' }}>
              {other?.display_name || 'Chat'}
            </Text>
          </TouchableOpacity>
        ),
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity
              onPress={showTogetherMenu}
              style={{ paddingHorizontal: spacing.sm }}
              accessibilityLabel="Do something together"
              accessibilityRole="button"
            >
              <Text style={{ fontSize: 18 }}>🎯</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setCheckInModalVisible(true)}
              style={{ paddingHorizontal: spacing.sm }}
              accessibilityLabel="Set up a date safety check-in"
              accessibilityRole="button"
            >
              <Text style={{ fontSize: 18 }}>🛡️</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={showChatOptions}
              style={{ paddingHorizontal: spacing.sm }}
              accessibilityLabel="Chat options"
              accessibilityRole="button"
            >
              <Text style={{ color: colors.primary, fontSize: 20 }}>⋯</Text>
            </TouchableOpacity>
          </View>
        ),
      });
    }

    await loadInitial();
    await loadReactions();
    await markMessagesAsRead(myId);

    const channel = supabase
      .channel(`messages:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` },
        (payload) => {
          // prependMessage (see usePaginatedMessages) dedupes by id, so
          // this is a no-op for the sender's own echoed insert if it was
          // already added optimistically below.
          prependMessage(payload.new);
          // Mark read reactively, right as the message actually arrives,
          // instead of waiting for the poll tick that used to run this —
          // more immediate than the old 3-second timer ever was, and
          // doesn't need the rest of what that timer did (a full
          // loadMessages() re-fetch of the entire conversation).
          if (payload.new.sender_id !== myId) markMessagesAsRead(myId);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` },
        (payload) => {
          updateMessage(payload.new);
        }
      )
      .subscribe();
    messagesChannelRef.current = channel;

    const reactionChannel = supabase
      .channel(`reactions:${matchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions' },
        () => {
          loadReactions();
        }
      )
      .subscribe();
    reactionChannelRef.current = reactionChannel;

    const typingChannel = supabase
      .channel(`typing:${matchId}`)
      .on('broadcast', { event: 'typing' }, (payload) => {
        if (payload.payload.userId === myId) return;
        setOtherIsTyping(true);
        if (otherTypingTimeoutRef.current) clearTimeout(otherTypingTimeoutRef.current);
        otherTypingTimeoutRef.current = setTimeout(() => setOtherIsTyping(false), TYPING_IDLE_MS);
      })
      .subscribe();
    typingChannelRef.current = typingChannel;

    setLoadError(false);
    return myId;
    } catch (e) {
      console.error('ChatScreen init error', e);
      setLoadError(true);
      return null;
    }
  }

  function showTogetherMenu() {
    setTogetherMenuVisible(true);
  }

  // Real menu options, not an Alert.alert button list — RN's Alert is
  // documented as unreliable beyond ~3 buttons on Android, and this menu
  // has 12 real destinations, so it renders via ActionSheetModal instead.
  const togetherMenuOptions = [
    { key: 'playlist', text: '🎵 Shared Playlist', onPress: () => navigation.navigate('SharedPlaylist', { matchId, matchName: otherUser?.display_name }) },
    { key: 'trip', text: '🧳 Plan a Trip', onPress: () => navigation.navigate('TripPlanning', { matchId, matchName: otherUser?.display_name }) },
    { key: 'bigpicture', text: '🧭 Big Picture Chat', onPress: () => navigation.navigate('SharedDecisions', { matchId, matchName: otherUser?.display_name }) },
    { key: 'experiment', text: '💡 Suggest an Activity', onPress: showRandomExperiment },
    { key: 'legacy', text: '💌 Leave Relationship Wisdom', onPress: () => navigation.navigate('RelationshipLegacy', { matchId, matchName: otherUser?.display_name }) },
    { key: 'timeline', text: '🗓️ Timeline Thoughts', onPress: () => navigation.navigate('TimelinePlanner', { matchId, matchName: otherUser?.display_name }) },
    { key: 'memoryvault', text: '💫 Memory Vault', onPress: () => navigation.navigate('MemoryVault', { matchId, matchName: otherUser?.display_name }) },
    { key: 'chemistry', text: '📔 Log a Chemistry Check-In', onPress: () => navigation.navigate('ChemistryDiaryEntry', { aboutDisplayName: otherUser?.display_name }) },
    { key: 'stresstest', text: '🧪 What If... Scenarios', onPress: () => navigation.navigate('StressTest', { matchId, matchName: otherUser?.display_name }) },
    { key: 'constitution', text: '📜 Our Constitution', onPress: () => navigation.navigate('RelationshipConstitution', { matchId, matchName: otherUser?.display_name }) },
    { key: 'courage', text: '🦁 Help Me Say It', onPress: showCourageMenu },
    { key: 'datenight', text: '🌆 Suggest a Date Night', onPress: suggestDateNight },
  ];

  async function suggestDateNight() {
    try {
      // Genuinely matched to what both people actually share, not a
      // random pick from recent offers — this is the core mechanic
      // of the brand-matching vision: real shared interests driving
      // real local business referrals.
      const { data: matchRow } = await supabase.from('matches').select('user_a, user_b').eq('id', matchId).single();
      if (!matchRow) throw new Error('Could not find this match.');
      const otherId = matchRow.user_a === userId ? matchRow.user_b : matchRow.user_a;

      const { data: myProfile } = await supabase.from('profiles').select('interests').eq('id', userId).single();
      const { data: theirProfile } = await supabase.from('profiles').select('interests').eq('id', otherId).single();
      const myInterests = myProfile?.interests ?? [];
      const theirInterests = theirProfile?.interests ?? [];
      const sharedInterests = myInterests.filter((i) => theirInterests.some((t) => t.toLowerCase() === i.toLowerCase()));

      if (sharedInterests.length === 0) {
        Alert.alert('No shared interests yet', "You don't have any interests in common on your profiles yet to base a suggestion on.");
        return;
      }

      const { data: offersData } = await supabase
        .from('brand_offers')
        .select('*, brand_partners(name)')
        .eq('active', true)
        .is('gathering_id', null)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .in('target_interest_tag', sharedInterests)
        .order('created_at', { ascending: false })
        .limit(3);

      if (!offersData || offersData.length === 0) {
        Alert.alert('No suggestions right now', "There aren't any active offers matching what you both like yet — check back soon.");
        return;
      }

      const suggestionText = `💡 Date night ideas, since you both like ${sharedInterests.slice(0, 3).join(', ')}:\n${offersData.map((o) => `• ${o.title} at ${o.brand_partners?.name ?? 'a local spot'}`).join('\n')}`;
      const { data, error } = await supabase
        .from('messages')
        .insert({ match_id: matchId, sender_id: userId, body: suggestionText })
        .select()
        .single();
      if (error) throw error;
      setMessages((prev) => [data, ...prev]);
      posthog.capture('date_night_suggested');
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  function showCourageMenu() {
    setCourageMenuVisible(true);
  }

  // "Ask them out" / "Say I'm interested" only make sense for a
  // genuinely romantic match — offering them in a friend or
  // gathering-sourced chat would be genuinely wrong. Setting a
  // boundary is universal, so that one stays either way.
  const courageMenuOptions = [
    { key: 'boundary', text: 'Set a boundary', onPress: () => getCourageMessage('set_boundary') },
    ...(isRomanticMatch
      ? [
          { key: 'ask_out', text: 'Ask them out', onPress: () => getCourageMessage('ask_out') },
          { key: 'say_interested', text: "Say I'm interested", onPress: () => getCourageMessage('say_interested') },
          { key: 'say_not_interested', text: "Say I'm not interested", onPress: () => getCourageMessage('say_not_interested') },
        ]
      : []),
  ];

  async function getCourageMessage(goal) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const response = await fetch(functionUrl('generate-courage-message'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ goal }),
      });
      const result = await response.json();

      if (!response.ok) {
        if (response.status === 403) {
          Alert.alert(
            'Help Me Say It is Premium',
            'This uses AI to help you find the right words. Upgrade to Premium to use it.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Upgrade to Premium', onPress: () => navigation.navigate('Paywall') },
            ]
          );
          return;
        }
        Alert.alert('Error', result.error || 'Could not generate a message right now.');
        return;
      }

      Alert.alert('Here\u2019s a draft', result.message, [
        { text: 'Dismiss', style: 'cancel' },
        { text: 'Use This', onPress: () => setText(result.message) },
      ]);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  function showRandomExperiment() {
    Alert.alert('💡 Try This Together', randomExperiment(), [{ text: 'OK' }]);
  }

  function showChatOptions() {
    const modeLabel = disappearingMode === 'off' ? 'Off' : disappearingMode === '24h' ? '24 Hours' : 'Instant';
    Alert.alert(
      'Chat Options',
      '',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Disappearing Messages: ${modeLabel} (tap to change)`, onPress: showDisappearingModeOptions },
        { text: 'Unmatch', style: 'destructive', onPress: confirmUnmatch },
        { text: 'Report or Block', onPress: () => setReportModalVisible(true) },
      ]
    );
  }

  function showDisappearingModeOptions() {
    Alert.alert(
      'Disappearing Messages',
      'Choose how long new messages stay in this chat, for both of you.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: disappearingMode === 'off' ? '✓ Off' : 'Off', onPress: () => updateDisappearingMode(  'off') },
        { text: disappearingMode === '24h' ? '✓ 24 Hours' : '24 Hours', onPress: () => updateDisappearingMode('24h') },
        { text: disappearingMode === 'instant' ? '✓ Instant (view once)' : 'Instant (view once)', onPress: () => updateDisappearingMode('instant') },
      ]
    );
  }

  async function updateDisappearingMode(mode) {
    const { error } = await supabase.from('matches').update({ disappearing_mode: mode }).eq('id', matchId);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setDisappearingMode(mode);
    const labels = { off: 'Messages will now be kept normally.', '24h': 'New messages will automatically delete after 24 hours, for both of you.', instant: "New messages will disappear shortly after being read, for both of you — there's no window to reconsider once seen." };
    Alert.alert('Updated', labels[mode]);
  }

  function confirmUnmatch() {
    Alert.alert(
      `Unmatch with ${otherUser?.display_name || 'this person'}?`,
      "This ends your match and removes this conversation. They won't be notified, and you can still Report or Block them separately if needed.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unmatch',
          style: 'destructive',
          onPress: async () => {
            let otherPersonName = otherUser?.display_name;
            if (!otherPersonName) {
              const { data: freshMatch } = await supabase
                .from('matches')
                .select('user_a, user_b, a:profiles!matches_user_a_fkey(id, display_name), b:profiles!matches_user_b_fkey(id, display_name)')
                .eq('id', matchId)
                .single();
              if (freshMatch) {
                const fresh = freshMatch.user_a === userId ? freshMatch.b : freshMatch.a;
                otherPersonName = fresh?.display_name;
              }
            }
            otherPersonName = otherPersonName || null;
            try {
              await unmatch(matchId);
              navigation.goBack();
              setTimeout(() => {
                Alert.alert(
                  'Want to reflect?',
                  'You can privately write down what worked, what didn\u2019t, and what you\u2019d want next time. Only you will ever see it.',
                  [
                    { text: 'Not now', style: 'cancel' },
                    {
                      text: 'Add a Reflection',
                      onPress: () => navigation.navigate('GoodbyeArchiveEntry', { aboutDisplayName: otherPersonName }),
                    },
                  ]
                );
              }, 400);
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  }

  function showReactionPicker(messageId) {
    const myExisting = (reactions[messageId] ?? []).find((r) => r.user_id === userId);
    Alert.alert(
      myExisting ? 'Change Reaction' : 'React',
      '',
      [
        { text: 'Cancel', style: 'cancel' },
        ...REACTION_EMOJIS.map((emoji) => ({
          text: `${emoji}${myExisting?.emoji === emoji ? ' (tap to remove)' : ''}`,
          onPress: () => handleReact(messageId, emoji),
        })),
      ]
    );
  }

  async function handleReact(messageId, emoji) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await toggleReaction(messageId, emoji);
      loadReactions();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleTranslate(messageText) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const response = await fetch(functionUrl('translate-message'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: messageText, targetLanguage: language }),
      });
      const result = await response.json();

      if (!response.ok) {
        Alert.alert('Error', result.error || 'Could not translate this message.');
        return;
      }

      Alert.alert(t('chat.translationTitle'), result.translation);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  function handleTextChange(value) {
    setText(value);

    if (typingChannelRef.current && userId) {
      typingChannelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId },
      });
    }
  }

  async function handleStartRecording() {
    const limitCheck = await checkVoiceNoteLimit();
    if (!limitCheck.allowed) {
      Alert.alert(
        'Daily limit reached',
        limitCheck.reason,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Upgrade to Premium', onPress: () => navigation.navigate('Paywall') },
        ]
      );
      return;
    }

    try {
      const recording = await startRecording();
      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingSeconds(0);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev + 1 >= MAX_RECORDING_SECONDS) {
            handleStopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleCancelRecording() {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    if (recordingRef.current) {
      await stopRecording(recordingRef.current).catch(() => {});
      recordingRef.current = null;
    }
  }

  async function handleStopRecording() {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);

    if (!recordingRef.current) return;

    try {
      const uri = await stopRecording(recordingRef.current);
      recordingRef.current = null;

      setUploadingVoice(true);
      const path = await uploadVoiceNote(userId, uri);

      const optimisticMessage = {
        id: `optimistic-${Date.now()}`,
        match_id: matchId,
        sender_id: userId,
        body: null,
        gif_url: null,
        audio_url: path,
        read_at: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [optimisticMessage, ...prev]);

      const { data, error } = await supabase
        .from('messages')
        .insert({ match_id: matchId, sender_id: userId, body: '', audio_url: path })
        .select()
        .single();

      setUploadingVoice(false);

      if (error) {
        console.error('sendVoiceNote error', error);
        return;
      }

      posthog.capture('voice_note_sent');
      setMessages((prev) => prev.map((m) => (m.id === optimisticMessage.id ? data : m)));
    } catch (e) {
      setUploadingVoice(false);
      Alert.alert('Error', e.message);
    }
  }

  async function getIcebreaker() {
    setLoadingIcebreaker(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const response = await fetch(functionUrl('generate-icebreaker'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ matchId }),
      });
      const result = await response.json();

      if (!response.ok) {
        Alert.alert('Error', result.error || 'Could not generate an icebreaker.');
        return;
      }

      Alert.alert('✨ Icebreaker suggestion', result.icebreaker, [
        { text: 'Dismiss', style: 'cancel' },
        { text: 'Use This', onPress: () => setText(result.icebreaker) },
      ]);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setLoadingIcebreaker(false);
  }

  async function sendMessage() {
    if (!text.trim()) return;

    const moderationResult = await checkTextModeration(text.trim());
    if (!moderationResult.safe) {
      Alert.alert(t('chat.messageBlocked'), t('chat.messageBlockedText'));
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    await send(async (body) => {
      const optimisticMessage = {
        id: `optimistic-${Date.now()}`,
        match_id: matchId,
        sender_id: userId,
        body,
        gif_url: null,
        audio_url: null,
        read_at: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [optimisticMessage, ...prev]);

      try {
        const { data, error } = await supabase
          .from('messages')
          .insert({ match_id: matchId, sender_id: userId, body })
          .select()
          .single();

        if (error) throw error;

        // Recorded as a permanent fact on the match itself, not derived
        // from the current messages list — a disappearing message can
        // vanish afterward, but "did they ever send the first message"
        // needs to stay true forever once it's genuinely happened.
        if (userId === designatedFirstMessengerId) {
          await supabase.from('matches').update({ first_message_sent: true }).eq('id', matchId).select();
        }

        posthog.capture('message_sent');
        setMessages((prev) => prev.map((m) => (m.id === optimisticMessage.id ? data : m)));
      } catch (e) {
        // Remove the optimistic bubble so a failed send doesn't look like
        // it went through — the hook restores the draft and shows a real
        // error instead of silently dropping the message.
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMessage.id));
        throw e;
      }
    });
  }

  async function sendGif(gifUrl) {
    setGifPickerVisible(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const optimisticMessage = {
      id: `optimistic-${Date.now()}`,
      match_id: matchId,
      sender_id: userId,
      body: null,
      gif_url: gifUrl,
      audio_url: null,
      read_at: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [optimisticMessage, ...prev]);

    const { data, error } = await supabase
      .from('messages')
      .insert({ match_id: matchId, sender_id: userId, body: '', gif_url: gifUrl })
      .select()
      .single();

    if (error) {
      console.error('sendGif error', error);
      return;
    }

    posthog.capture('gif_sent');
    setMessages((prev) => prev.map((m) => (m.id === optimisticMessage.id ? data : m)));
  }

  async function handlePickVideo() {
    try {
      const asset = await pickChatVideo();
      if (!asset) return;

      setUploadingPhoto(true);
      const path = await uploadChatVideo(userId, asset.uri);

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const optimisticMessage = {
        id: `optimistic-${Date.now()}`,
        match_id: matchId,
        sender_id: userId,
        body: null,
        gif_url: null,
        audio_url: null,
        media_url: path,
        media_type: 'video',
        read_at: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [optimisticMessage, ...prev]);

      const { data, error } = await supabase
        .from('messages')
        .insert({ match_id: matchId, sender_id: userId, body: '', media_url: path, media_type: 'video' })
        .select()
        .single();

      setUploadingPhoto(false);

      if (error) {
        console.error('sendVideo error', error);
        return;
      }

      posthog.capture('chat_video_sent');
      setMessages((prev) => prev.map((m) => (m.id === optimisticMessage.id ? data : m)));
    } catch (e) {
      setUploadingPhoto(false);
      Alert.alert('Error', e.message);
    }
  }

  async function handlePickPhoto() {
    try {
      const asset = await pickChatPhoto();
      if (!asset) return;

      setUploadingPhoto(true);
      const path = await uploadChatPhoto(userId, asset.uri);

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const optimisticMessage = {
        id: `optimistic-${Date.now()}`,
        match_id: matchId,
        sender_id: userId,
        body: null,
        gif_url: null,
        audio_url: null,
        media_url: path,
        media_type: 'image',
        read_at: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [optimisticMessage, ...prev]);

      const { data, error } = await supabase
        .from('messages')
        .insert({ match_id: matchId, sender_id: userId, body: '', media_url: path, media_type: 'image' })
        .select()
        .single();

      setUploadingPhoto(false);

      if (error) {
        console.error('sendPhoto error', error);
        return;
      }

      posthog.capture('chat_photo_sent');
      setMessages((prev) => prev.map((m) => (m.id === optimisticMessage.id ? data : m)));
    } catch (e) {
      setUploadingPhoto(false);
      Alert.alert('Error', e.message);
    }
  }

  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function formatRecordingTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function reactionSummary(messageId) {
    const list = reactions[messageId];
    if (!list || list.length === 0) return null;
    const counts = {};
    list.forEach((r) => {
      counts[r.emoji] = (counts[r.emoji] || 0) + 1;
    });
    return Object.entries(counts).map(([emoji, count]) => (count > 1 ? `${emoji}${count}` : emoji)).join(' ');
  }

  // messages is DESC (newest first, see usePaginatedMessages), so the
  // first match here is already the most recent — no reverse needed.
  const lastMyMessage = messages.find((m) => m.sender_id === userId);
  const emptyStateText = gatheringTitle
    ? `Say hi — you're both attending "${gatheringTitle}"!`
    : t('chat.sayHi');

  const designatedHasSentMessage = designatedFirstMessengerId
    ? (firstMessageSentFlag || messages.some((m) => m.sender_id === designatedFirstMessengerId))
    : true;
  const isBlockedFromSending = designatedFirstMessengerId && designatedFirstMessengerId !== userId && !designatedHasSentMessage;

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load this conversation." onRetry={init} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
      >
        {messages.length === 0 ? (
          <View style={[styles.emptyState, { flex: 1, justifyContent: 'center' }]}>
            <Text style={styles.emptyEmoji}>💬</Text>
            <Text style={styles.emptyText}>{emptyStateText}</Text>
            {isBlockedFromSending && (
              <Text style={styles.firstMessageHint}>
                {designatedFirstMessengerName} will send the first message.
              </Text>
            )}
            {isUserPremium && (
              <TouchableOpacity
                style={styles.icebreakerEmptyButton}
                onPress={getIcebreaker}
                disabled={loadingIcebreaker}
                accessibilityLabel="Get an AI icebreaker suggestion"
                accessibilityRole="button"
              >
                {loadingIcebreaker ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={styles.icebreakerEmptyText}>✨ Get an AI icebreaker suggestion</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          // Newest-first data + inverted rendering — same shape as
          // gathering/community/business chat, so onEndReached below
          // corresponds to scrolling toward the *oldest* end of the
          // conversation, and a new message stays pinned at the visual
          // bottom without a manual scrollToEnd.
          inverted
          onEndReached={loadOlder}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            // Renders visually at the TOP under `inverted`.
            loadingOlder ? (
              <View style={{ paddingVertical: spacing.md }}>
                <ActivityIndicator color={colors.textTertiary} />
              </View>
            ) : !hasMore && messages.length > 0 ? (
              <Text style={styles.historyStartText}>The start of your conversation</Text>
            ) : null
          }
          renderItem={({ item }) => {
            const isMe = item.sender_id === userId;
            const senderLabel = isMe ? 'You' : (otherUser?.display_name || 'They');
            const reactionText = reactionSummary(item.id);
            const isNewMessage = !seenMessageIdsRef.current.has(item.id);
            seenMessageIdsRef.current.add(item.id);
            return (
              <AnimatedMessageBubble isNew={isNewMessage}>
              <View style={[styles.bubbleRow, isMe ? styles.rowRight : styles.rowLeft]}>
                {item.audio_url ? (
                  <TouchableOpacity onLongPress={() => showReactionPicker(item.id)} activeOpacity={1}>
                    <VoiceBubble audioPath={item.audio_url} isMe={isMe} colors={colors} />
                  </TouchableOpacity>
                ) : item.media_url ? (
                  <TouchableOpacity onLongPress={() => showReactionPicker(item.id)} activeOpacity={0.9}>
                    {mediaUrls[item.id] === undefined ? (
                      <View style={[styles.gifBubble, { justifyContent: 'center', alignItems: 'center' }]}>
                        <ActivityIndicator color={colors.primary} />
                      </View>
                    ) : mediaUrls[item.id] === null ? (
                      <View style={[styles.gifBubble, { justifyContent: 'center', alignItems: 'center', padding: spacing.md }]}>
                        <Text style={{ color: colors.textTertiary, fontSize: 12, textAlign: 'center' }}>Couldn't load photo</Text>
                      </View>
                    ) : imageLoadFailed[item.id] ? (
                      <View style={[styles.gifBubble, { justifyContent: 'center', alignItems: 'center', padding: spacing.md }]}>
                        <Text style={{ color: colors.textTertiary, fontSize: 12, textAlign: 'center' }}>Couldn't load photo</Text>
                      </View>
                    ) : item.media_type === 'video' ? (
                      <Video
                        source={{ uri: mediaUrls[item.id] }}
                        style={styles.gifBubble}
                        resizeMode="cover"
                        useNativeControls
                        accessibilityLabel={`${senderLabel} sent a video`}
                      />
                    ) : (
                      <Image
                        source={{ uri: mediaUrls[item.id] }}
                        style={styles.gifBubble}
                        resizeMode="cover"
                        accessibilityLabel={`${senderLabel} sent a photo`}
                        onError={(e) => {
                          console.error('Photo failed to load:', e.nativeEvent.error);
                          setImageLoadFailed((prev) => ({ ...prev, [item.id]: true }));
                        }}
                      />
                    )}
                  </TouchableOpacity>
                ) : item.gif_url ? (
                  <TouchableOpacity onLongPress={() => showReactionPicker(item.id)} activeOpacity={0.9}>
                    <Image
                      source={{ uri: item.gif_url }}
                      style={styles.gifBubble}
                      resizeMode="cover"
                      accessibilityLabel={`${senderLabel} sent a GIF`}
                    />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.bubbleWithTranslate}>
                    <TouchableOpacity
                      style={[styles.bubble, isMe ? styles.myBubble : styles.theirBubble]}
                      onLongPress={() => showReactionPicker(item.id)}
                      activeOpacity={0.85}
                      accessibilityLabel={`${senderLabel} said: ${item.body}, sent at ${formatTime(item.created_at)}`}
                      accessibilityHint="Double tap and hold to react"
                    >
                      <Text style={[styles.bubbleText, isMe && styles.myBubbleText]}>{item.body}</Text>
                    </TouchableOpacity>
                    {!isMe && item.body ? (
                      <TouchableOpacity
                        onPress={() => handleTranslate(item.body)}
                        style={styles.translateButton}
                        accessibilityLabel="Translate this message"
                        accessibilityRole="button"
                      >
                        <Text style={styles.translateButtonText}>🌐</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                )}
                {reactionText && (
                  <TouchableOpacity
                    onPress={() => showReactionPicker(item.id)}
                    style={styles.reactionBadge}
                    accessibilityLabel={`Reactions: ${reactionText}, tap to change your reaction`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.reactionBadgeText}>{reactionText}</Text>
                  </TouchableOpacity>
                )}
                <Text style={styles.timestamp}>{formatTime(item.created_at)}</Text>
                {lastMyMessage?.id === item.id && item.read_at && otherUser?.read_receipts_enabled !== false && (
                  <Text style={styles.seenText}>Seen</Text>
                )}
              </View>
              </AnimatedMessageBubble>
            );
          }}
        />
        )}

        {isStalled && messages.length > 0 && isUserPremium && (
          <View style={styles.stalledBanner}>
            <Text style={styles.stalledText}>{t('chat.stalledText')}</Text>
            <TouchableOpacity
              onPress={getIcebreaker}
              disabled={loadingIcebreaker}
              accessibilityLabel="Get an AI conversation suggestion"
              accessibilityRole="button"
            >
              <Text style={styles.stalledLink}>{loadingIcebreaker ? '...' : t('chat.stalledLink')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {otherIsTyping && !isRecording && (
          <View style={styles.typingRow} accessibilityLiveRegion="polite">
            <View style={styles.typingBubble}>
              <Text style={styles.typingText}>{otherUser?.display_name} is typing...</Text>
            </View>
          </View>
        )}

        {!!sendError && (
          <View style={styles.sendErrorBanner}>
            <Text style={styles.sendErrorText}>{sendError}</Text>
          </View>
        )}

        {isBlockedFromSending ? (
          <View style={styles.blockedRow}>
            <Text style={styles.blockedText}>
              🔒 {designatedFirstMessengerName} needs to send the first message before you can reply.
            </Text>
          </View>
        ) : isRecording ? (
          <View style={styles.recordingRow}>
            <View style={styles.recordingIndicator} />
            <Text style={styles.recordingTime}>{formatRecordingTime(recordingSeconds)}</Text>
            <Text style={styles.recordingHint}>Recording voice note...</Text>
            <TouchableOpacity
              style={styles.cancelRecordingButton}
              onPress={handleCancelRecording}
              accessibilityLabel="Cancel recording without sending"
              accessibilityRole="button"
            >
              <Text style={styles.cancelRecordingButtonText}>✕</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.stopButton}
              onPress={handleStopRecording}
              accessibilityLabel="Stop recording and send voice message"
              accessibilityRole="button"
            >
              <Text style={styles.stopButtonText}>Send</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.inputRow}>
            {isUserPremium && (
              <TouchableOpacity
                style={styles.icebreakerButton}
                onPress={getIcebreaker}
                disabled={loadingIcebreaker}
                accessibilityLabel="Get an AI icebreaker suggestion"
                accessibilityRole="button"
              >
                {loadingIcebreaker ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.icebreakerButtonText}>✨</Text>}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.gifButton}
              onPress={() => setGifPickerVisible(true)}
              accessibilityLabel="Send a GIF"
              accessibilityRole="button"
            >
              <Text style={styles.gifButtonText}>GIF</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.gifButton}
              onPress={handlePickPhoto}
              disabled={uploadingPhoto}
              accessibilityLabel={uploadingPhoto ? 'Checking photo' : 'Send a photo'}
              accessibilityRole="button"
            >
              {uploadingPhoto ? <ActivityIndicator size="small" color={colors.textSecondary} /> : <Text style={styles.gifButtonText}>📷</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.gifButton}
              onPress={handlePickVideo}
              disabled={uploadingPhoto}
              accessibilityLabel={uploadingPhoto ? 'Checking video' : 'Send a video'}
              accessibilityRole="button"
            >
              {uploadingPhoto ? <ActivityIndicator size="small" color={colors.textSecondary} /> : <Text style={styles.gifButtonText}>🎥</Text>}
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              placeholder={t('chat.typePlaceholder')}
              placeholderTextColor={colors.textTertiary}
              value={text}
              onChangeText={handleTextChange}
              multiline
              accessibilityLabel="Message input"
            />
            {text.trim() ? (
              <TouchableOpacity
                style={styles.sendButton}
                onPress={sendMessage}
                accessibilityLabel="Send message"
                accessibilityRole="button"
              >
                <Text style={styles.sendText}>{t('chat.send')}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.micButton}
                onPress={handleStartRecording}
                disabled={uploadingVoice}
                accessibilityLabel="Record a voice message"
                accessibilityRole="button"
              >
                {uploadingVoice ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={{ fontSize: 18 }}>🎤</Text>}
              </TouchableOpacity>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      <GifPickerModal
        visible={gifPickerVisible}
        onClose={() => setGifPickerVisible(false)}
        onSelect={sendGif}
      />

      <DateCheckInModal
        visible={checkInModalVisible}
        onClose={() => setCheckInModalVisible(false)}
        matchId={matchId}
        matchName={otherUser?.display_name || 'this person'}
        navigation={navigation}
      />

      <ReportBlockModal
        visible={reportModalVisible}
        onClose={() => setReportModalVisible(false)}
        onBlocked={() => {
          setReportModalVisible(false);
          navigation.goBack();
        }}
        reportedUserId={otherUser?.id}
        reportedUserName={otherUser?.display_name}
      />

      <ActionSheetModal
        visible={togetherMenuVisible}
        onClose={() => setTogetherMenuVisible(false)}
        title="Do Something Together"
        options={togetherMenuOptions}
      />

      <ActionSheetModal
        visible={courageMenuVisible}
        onClose={() => setCourageMenuVisible(false)}
        title="Help Me Say It"
        message="What are you trying to say? I'll help you find the words."
        options={courageMenuOptions}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  historyStartText: { color: colors.textTertiary, fontSize: 12, textAlign: 'center', paddingVertical: spacing.md },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center', paddingHorizontal: spacing.xl },
  firstMessageHint: { ...typography.caption, color: colors.primary, textAlign: 'center', marginTop: spacing.sm, fontWeight: '600' },
  icebreakerEmptyButton: { marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1, borderColor: colors.primary },
  icebreakerEmptyText: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  bubbleRow: { marginBottom: spacing.md, maxWidth: '78%' },
  rowLeft: { alignSelf: 'flex-start' },
  rowRight: { alignSelf: 'flex-end' },
  bubbleWithTranslate: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  bubble: { padding: spacing.md, borderRadius: radius.lg },
  myBubble: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  theirBubble: { backgroundColor: colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  bubbleText: { color: colors.textPrimary, fontSize: 15, lineHeight: 20 },
  myBubbleText: { color: '#fff' },
  translateButton: { padding: 4 },
  translateButtonText: { fontSize: 14 },
  gifBubble: { width: 180, height: 180, borderRadius: radius.lg, backgroundColor: colors.surfaceElevated },
  reactionBadge: {
    alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2, marginTop: 2, marginHorizontal: 4,
  },
  reactionBadgeText: { fontSize: 12 },
  timestamp: { ...typography.small, color: colors.textTertiary, marginTop: 4, marginHorizontal: 4 },
  seenText: { ...typography.small, color: colors.textTertiary, marginTop: 2, marginHorizontal: 4, fontStyle: 'italic' },
  stalledBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surfaceElevated, marginHorizontal: spacing.lg, marginBottom: spacing.sm,
    padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  stalledText: { color: colors.textSecondary, fontSize: 13, flex: 1 },
  stalledLink: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  typingRow: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  typingBubble: { backgroundColor: colors.surfaceElevated, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, alignSelf: 'flex-start' },
  typingText: { color: colors.textTertiary, fontSize: 12, fontStyle: 'italic' },
  blockedRow: {
    padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceElevated,
  },
  blockedText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  sendErrorBanner: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  sendErrorText: { color: colors.danger, fontSize: 12, textAlign: 'center' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  icebreakerButton: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, marginRight: spacing.sm,
    borderWidth: 1, borderColor: colors.primary, minWidth: 36, alignItems: 'center',
  },
  icebreakerButtonText: { fontSize: 14 },
  gifButton: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, marginRight: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  gifButtonText: { color: colors.textSecondary, fontWeight: '700', fontSize: 12 },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendButton: {
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginLeft: spacing.sm,
  },
  sendText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  micButton: {
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginLeft: spacing.sm,
  },
  recordingRow: {
    flexDirection: 'row', alignItems: 'center', padding: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background,
  },
  recordingIndicator: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger, marginRight: spacing.sm },
  recordingTime: { color: colors.textPrimary, fontWeight: '700', marginRight: spacing.md },
  recordingHint: { color: colors.textTertiary, flex: 1, fontSize: 13 },
  stopButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  stopButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  cancelRecordingButton: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.full,
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm,
  },
  cancelRecordingButtonText: { color: colors.textTertiary, fontSize: 14, fontWeight: '700' },
});