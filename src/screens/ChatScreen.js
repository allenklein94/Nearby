import React, { useEffect, useState, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Alert, Image, ActivityIndicator } from 'react-native';
import { Audio } from 'expo-av';
import { supabase } from '../services/supabase';
import { checkTextModeration } from '../services/textModeration';
import { isPremium } from '../services/purchases';
import { updateBadgeCount } from '../services/notifications';
import { startRecording, stopRecording, uploadVoiceNote, getSignedAudioUrl } from '../services/voiceNotes';
import { unmatch } from '../services/matchActions';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import ReportBlockModal from '../components/ReportBlockModal';
import GifPickerModal from '../components/GifPickerModal';
import DateCheckInModal from '../components/DateCheckInModal';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const MAX_RECORDING_SECONDS = 60;
const TYPING_IDLE_MS = 3000;
const STALLED_THRESHOLD_DAYS = 3;

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
  const { t } = useLanguage();
  const styles = getStyles(colors);
  const posthog = usePostHog();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [userId, setUserId] = useState(null);
  const [otherUser, setOtherUser] = useState(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [gifPickerVisible, setGifPickerVisible] = useState(false);
  const [checkInModalVisible, setCheckInModalVisible] = useState(false);
  const [isUserPremium, setIsUserPremium] = useState(false);
  const [loadingIcebreaker, setLoadingIcebreaker] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const [otherIsTyping, setOtherIsTyping] = useState(false);
  const [isStalled, setIsStalled] = useState(false);
  const listRef = useRef(null);
  const recordingRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const typingChannelRef = useRef(null);
  const otherTypingTimeoutRef = useRef(null);

  async function loadMessages() {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: true });
    setMessages(data || []);

    if (data && data.length > 0) {
      const lastMessage = data[data.length - 1];
      const daysSinceLastMessage = (Date.now() - new Date(lastMessage.created_at).getTime()) / (1000 * 60 * 60 * 24);
      setIsStalled(daysSinceLastMessage >= STALLED_THRESHOLD_DAYS);
    } else {
      setIsStalled(false);
    }
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
    let pollInterval;
    init().then((myId) => {
      pollInterval = setInterval(async () => {
        await loadMessages();
        if (myId) await markMessagesAsRead(myId);
      }, 3000);
    });
    return () => {
      if (pollInterval) clearInterval(pollInterval);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (otherTypingTimeoutRef.current) clearTimeout(otherTypingTimeoutRef.current);
      if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
    };
  }, []);

  async function init() {
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    setUserId(myId);

    isPremium().then(setIsUserPremium).catch(() => setIsUserPremium(false));

    const { data: match } = await supabase
      .from('matches')
      .select('user_a, user_b, a:profiles!matches_user_a_fkey(id, display_name), b:profiles!matches_user_b_fkey(id, display_name)')
      .eq('id', matchId)
      .single();

    if (match) {
      const other = match.user_a === myId ? match.b : match.a;
      setOtherUser(other);
      navigation.setOptions({
        headerShown: true,
        headerTitle: () => (
          <TouchableOpacity onPress={() => navigation.navigate('ViewProfile', { userId: other?.id })}>
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
            <TouchableOpacity onPress={() => navigation.navigate('TripPlanning', { matchId, matchName: other?.display_name })} style={{ paddingHorizontal: spacing.sm }}>
              <Text style={{ fontSize: 18 }}>🧳</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('SharedPlaylist', { matchId, matchName: other?.display_name })} style={{ paddingHorizontal: spacing.sm }}>
              <Text style={{ fontSize: 18 }}>🎵</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setCheckInModalVisible(true)} style={{ paddingHorizontal: spacing.sm }}>
              <Text style={{ fontSize: 18 }}>🛡️</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={showChatOptions} style={{ paddingHorizontal: spacing.sm }}>
              <Text style={{ color: colors.primary, fontSize: 20 }}>⋯</Text>
            </TouchableOpacity>
          </View>
        ),
      });
    }

    await loadMessages();
    await markMessagesAsRead(myId);

    const channel = supabase
      .channel(`messages:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` },
        (payload) => {
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
          setIsStalled(false);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` },
        (payload) => {
          setMessages((prev) => prev.map((m) => (m.id === payload.new.id ? payload.new : m)));
        }
      )
      .subscribe();

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

    return myId;
  }

  function showChatOptions() {
    Alert.alert(
      'Chat Options',
      '',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unmatch', style: 'destructive', onPress: confirmUnmatch },
        { text: 'Report or Block', onPress: () => setReportModalVisible(true) },
      ]
    );
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
            try {
              await unmatch(matchId);
              navigation.goBack();
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
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
      setMessages((prev) => [...prev, optimisticMessage]);
      setIsStalled(false);

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

      const response = await fetch('https://enmosvippabmuqslzrox.supabase.co/functions/v1/generate-icebreaker', {
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
    const body = text.trim();

    const moderationResult = await checkTextModeration(body);
    if (!moderationResult.safe) {
      Alert.alert(t('chat.messageBlocked'), t('chat.messageBlockedText'));
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setText('');

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
    setMessages((prev) => [...prev, optimisticMessage]);
    setIsStalled(false);

    const { data, error } = await supabase
      .from('messages')
      .insert({ match_id: matchId, sender_id: userId, body })
      .select()
      .single();

    if (error) {
      console.error('sendMessage error', error);
      return;
    }

    posthog.capture('message_sent');
    setMessages((prev) => prev.map((m) => (m.id === optimisticMessage.id ? data : m)));
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
    setMessages((prev) => [...prev, optimisticMessage]);
    setIsStalled(false);

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

  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function formatRecordingTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  const lastMyMessage = [...messages].reverse().find((m) => m.sender_id === userId);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyText}>{t('chat.sayHi')}</Text>
              {isUserPremium && (
                <TouchableOpacity style={styles.icebreakerEmptyButton} onPress={getIcebreaker} disabled={loadingIcebreaker}>
                  {loadingIcebreaker ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <Text style={styles.icebreakerEmptyText}>✨ Get an AI icebreaker suggestion</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.bubbleRow, item.sender_id === userId ? styles.rowRight : styles.rowLeft]}>
              {item.audio_url ? (
                <VoiceBubble audioPath={item.audio_url} isMe={item.sender_id === userId} colors={colors} />
              ) : item.gif_url ? (
                <Image source={{ uri: item.gif_url }} style={styles.gifBubble} resizeMode="cover" />
              ) : (
                <View style={[styles.bubble, item.sender_id === userId ? styles.myBubble : styles.theirBubble]}>
                  <Text style={[styles.bubbleText, item.sender_id === userId && styles.myBubbleText]}>{item.body}</Text>
                </View>
              )}
              <Text style={styles.timestamp}>{formatTime(item.created_at)}</Text>
              {lastMyMessage?.id === item.id && item.read_at && (
                <Text style={styles.seenText}>Seen</Text>
              )}
            </View>
          )}
        />

        {isStalled && messages.length > 0 && isUserPremium && (
          <View style={styles.stalledBanner}>
            <Text style={styles.stalledText}>This conversation's gone quiet.</Text>
            <TouchableOpacity onPress={getIcebreaker} disabled={loadingIcebreaker}>
              <Text style={styles.stalledLink}>{loadingIcebreaker ? 'Loading...' : 'Get an AI suggestion ✨'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {otherIsTyping && !isRecording && (
          <View style={styles.typingRow}>
            <View style={styles.typingBubble}>
              <Text style={styles.typingText}>{otherUser?.display_name} is typing...</Text>
            </View>
          </View>
        )}

        {isRecording ? (
          <View style={styles.recordingRow}>
            <View style={styles.recordingIndicator} />
            <Text style={styles.recordingTime}>{formatRecordingTime(recordingSeconds)}</Text>
            <Text style={styles.recordingHint}>Recording voice note...</Text>
            <TouchableOpacity style={styles.stopButton} onPress={handleStopRecording}>
              <Text style={styles.stopButtonText}>Send</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.inputRow}>
            {isUserPremium && (
              <TouchableOpacity style={styles.icebreakerButton} onPress={getIcebreaker} disabled={loadingIcebreaker}>
                {loadingIcebreaker ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.icebreakerButtonText}>✨</Text>}
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.gifButton} onPress={() => setGifPickerVisible(true)}>
              <Text style={styles.gifButtonText}>GIF</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              placeholder={t('chat.typePlaceholder')}
              placeholderTextColor={colors.textTertiary}
              value={text}
              onChangeText={handleTextChange}
              multiline
            />
            {text.trim() ? (
              <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
                <Text style={styles.sendText}>{t('chat.send')}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.micButton} onPress={handleStartRecording} disabled={uploadingVoice}>
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
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary },
  icebreakerEmptyButton: { marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1, borderColor: colors.primary },
  icebreakerEmptyText: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  bubbleRow: { marginBottom: spacing.md, maxWidth: '78%' },
  rowLeft: { alignSelf: 'flex-start' },
  rowRight: { alignSelf: 'flex-end' },
  bubble: { padding: spacing.md, borderRadius: radius.lg },
  myBubble: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  theirBubble: { backgroundColor: colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  bubbleText: { color: colors.textPrimary, fontSize: 15, lineHeight: 20 },
  myBubbleText: { color: '#fff' },
  gifBubble: { width: 180, height: 180, borderRadius: radius.lg, backgroundColor: colors.surfaceElevated },
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
});