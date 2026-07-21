import React, { useEffect, useState, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Alert, Image, ActivityIndicator } from 'react-native';
import { supabase } from '../services/supabase';
import { checkTextModeration } from '../services/textModeration';
import { isPremium } from '../services/purchases';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import ReportBlockModal from '../components/ReportBlockModal';
import GifPickerModal from '../components/GifPickerModal';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

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
  const [isUserPremium, setIsUserPremium] = useState(false);
  const [loadingIcebreaker, setLoadingIcebreaker] = useState(false);
  const listRef = useRef(null);

  async function loadMessages() {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: true });
    setMessages(data || []);
  }

  async function markMessagesAsRead(myId) {
    // Mark any messages sent TO me (not by me) as read, only if not
    // already marked — avoids unnecessary writes on every poll.
    await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('match_id', matchId)
      .neq('sender_id', myId)
      .is('read_at', null);
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
          <TouchableOpacity onPress={() => setReportModalVisible(true)} style={{ paddingHorizontal: spacing.sm }}>
            <Text style={{ color: colors.primary, fontSize: 20 }}>⋯</Text>
          </TouchableOpacity>
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

    return myId;
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
      read_at: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);

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
      read_at: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);

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
              {item.gif_url ? (
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
            onChangeText={setText}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendButton, !text.trim() && styles.sendButtonDisabled]}
            onPress={sendMessage}
            disabled={!text.trim()}
          >
            <Text style={styles.sendText}>{t('chat.send')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <GifPickerModal
        visible={gifPickerVisible}
        onClose={() => setGifPickerVisible(false)}
        onSelect={sendGif}
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
  sendButtonDisabled: { opacity: 0.4 },
  sendText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
});