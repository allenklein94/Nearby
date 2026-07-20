import React, { useEffect, useState, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { supabase } from '../services/supabase';
import { checkTextModeration } from '../services/textModeration';
import ReportBlockModal from '../components/ReportBlockModal';
import { colors, typography, spacing, radius } from '../theme';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';

export default function ChatScreen({ route, navigation }) {
  const posthog = usePostHog();
  const { matchId } = route.params;
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [userId, setUserId] = useState(null);
  const [otherUser, setOtherUser] = useState(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const listRef = useRef(null);

  async function loadMessages() {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: true });
    setMessages(data || []);
  }

  useEffect(() => {
    let pollInterval;
    init().then(() => {
      pollInterval = setInterval(loadMessages, 3000);
    });
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  async function init() {
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    setUserId(myId);

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
      .subscribe();

    return () => supabase.removeChannel(channel);
  }

  async function sendMessage() {
    if (!text.trim()) return;
    const body = text.trim();

    const moderationResult = await checkTextModeration(body);
    if (!moderationResult.safe) {
      Alert.alert('Message not sent', 'This message may violate our community guidelines. Please revise it.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setText('');

    const optimisticMessage = {
      id: `optimistic-${Date.now()}`,
      match_id: matchId,
      sender_id: userId,
      body,
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

  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

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
              <Text style={styles.emptyText}>Say hi — you both noticed each other.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.bubbleRow, item.sender_id === userId ? styles.rowRight : styles.rowLeft]}>
              <View style={[styles.bubble, item.sender_id === userId ? styles.myBubble : styles.theirBubble]}>
                <Text style={[styles.bubbleText, item.sender_id === userId && styles.myBubbleText]}>{item.body}</Text>
              </View>
              <Text style={styles.timestamp}>{formatTime(item.created_at)}</Text>
            </View>
          )}
        />
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            placeholderTextColor={colors.textTertiary}
            value={text}
            onChangeText={setText}
            multiline
            textAlignVertical="top"
            keyboardType="default"
          />
          <TouchableOpacity
            style={[styles.sendButton, !text.trim() && styles.sendButtonDisabled]}
            onPress={sendMessage}
            disabled={!text.trim()}
          >
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary },
  bubbleRow: { marginBottom: spacing.md, maxWidth: '78%' },
  rowLeft: { alignSelf: 'flex-start' },
  rowRight: { alignSelf: 'flex-end' },
  bubble: { padding: spacing.md, borderRadius: radius.lg },
  myBubble: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  theirBubble: { backgroundColor: colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  bubbleText: { color: colors.textPrimary, fontSize: 15, lineHeight: 20 },
  myBubbleText: { color: '#fff' },
  timestamp: { ...typography.small, color: colors.textTertiary, marginTop: 4, marginHorizontal: 4 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
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