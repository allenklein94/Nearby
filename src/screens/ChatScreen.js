import React, { useEffect, useState, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform } from 'react-native';
import { supabase } from '../services/supabase';
import ReportBlockModal from '../components/ReportBlockModal';

export default function ChatScreen({ route, navigation }) {
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
      // Polling fallback: refetch every 3 seconds while this screen is
      // open. Realtime push is set up too (below), but this guarantees
      // messages show up even if the live subscription doesn't fire —
      // simple and robust rather than depending entirely on realtime
      // infra behaving perfectly.
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
        title: other?.display_name || 'Chat',
        headerStyle: { backgroundColor: '#1a1a2e' },
        headerTintColor: '#fff',
        headerRight: () => (
          <TouchableOpacity onPress={() => setReportModalVisible(true)} style={{ paddingHorizontal: 8 }}>
            <Text style={{ color: '#e94560', fontSize: 20 }}>⋯</Text>
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
    setText('');

    // Optimistic local append — show it immediately rather than waiting
    // on realtime or the next poll cycle to echo it back to the sender.
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

    // Replace the optimistic placeholder with the real saved row (real
    // id, exact server timestamp) once the insert confirms.
    setMessages((prev) =>
      prev.map((m) => (m.id === optimisticMessage.id ? data : m))
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.sender_id === userId ? styles.myBubble : styles.theirBubble]}>
              <Text style={styles.bubbleText}>{item.body}</Text>
            </View>
          )}
        />
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            placeholderTextColor="#8888a8"
            value={text}
            onChangeText={setText}
          />
          <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
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
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  bubble: { maxWidth: '75%', padding: 12, borderRadius: 16, marginBottom: 8 },
  myBubble: { backgroundColor: '#e94560', alignSelf: 'flex-end' },
  theirBubble: { backgroundColor: '#2a2a4a', alignSelf: 'flex-start' },
  bubbleText: { color: '#fff' },
  inputRow: { flexDirection: 'row', padding: 12, borderTopWidth: 1, borderTopColor: '#2a2a4a' },
  input: { flex: 1, backgroundColor: '#2a2a4a', borderRadius: 20, color: '#fff', paddingHorizontal: 16, paddingVertical: 10 },
  sendButton: { justifyContent: 'center', paddingHorizontal: 16 },
  sendText: { color: '#e94560', fontWeight: '600' },
});