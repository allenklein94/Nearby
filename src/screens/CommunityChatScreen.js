import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { getCommunityMessages, getCommunityMessageById, sendCommunityMessage } from '../services/communities';
import { getSignedPhotoUrl } from '../services/photos';
import ReportBlockModal from '../components/ReportBlockModal';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import useChatComposer from '../hooks/useChatComposer';

export default function CommunityChatScreen({ route }) {
  const { communityId, communityName } = route.params;
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [messages, setMessages] = useState([]);
  const { text, setText, send, sendError } = useChatComposer();
  const [myUserId, setMyUserId] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const listRef = useRef(null);

  const load = useCallback(async () => {
    const results = await getCommunityMessages(communityId);
    setMessages(results);

    const urlEntries = await Promise.all(
      results.map(async (m) => {
        if (!m.profiles?.photo_url) return [m.sender_id, null];
        const url = await getSignedPhotoUrl(m.profiles.photo_url);
        return [m.sender_id, url];
      })
    );
    setPhotoUrls((prev) => ({ ...prev, ...Object.fromEntries(urlEntries) }));
  }, [communityId]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMyUserId(data?.session?.user?.id ?? null));
    load();

    // Was a setInterval(load, 3000) re-downloading the entire message
    // history every 3 seconds, unconditionally, for as long as this screen
    // stayed open — worse here than on a one-off gathering chat, since a
    // community's group chat is open-ended and ongoing. Replaced with a
    // real realtime subscription — new messages arrive as individual
    // INSERT events and get appended to the already-loaded list.
    const channel = supabase
      .channel(`community_messages:${communityId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'community_messages', filter: `community_id=eq.${communityId}` },
        async (payload) => {
          const fullMessage = await getCommunityMessageById(payload.new.id);
          if (!fullMessage) return;
          setMessages((prev) => (prev.some((m) => m.id === fullMessage.id) ? prev : [...prev, fullMessage]));
          if (fullMessage.profiles?.photo_url) {
            const url = await getSignedPhotoUrl(fullMessage.profiles.photo_url);
            setPhotoUrls((prev) => ({ ...prev, [fullMessage.sender_id]: url }));
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [load, communityId]);

  async function handleSend() {
    await send(async (body) => {
      await sendCommunityMessage(communityId, body);
      await load();
      listRef.current?.scrollToEnd({ animated: true });
    });
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
              <Text style={styles.emptyText}>Say hi to everyone in "{communityName}"!</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isMe = item.sender_id === myUserId;
            return (
              <View style={[styles.messageRow, isMe && styles.messageRowMe]}>
                {!isMe && (
                  photoUrls[item.sender_id] ? (
                    <Image source={{ uri: photoUrls[item.sender_id] }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarPlaceholder]} />
                  )
                )}
                <View style={{ maxWidth: '75%' }}>
                  {!isMe && (
                    <TouchableOpacity
                      onLongPress={() => setReportTarget({ id: item.sender_id, name: item.profiles?.display_name })}
                      accessibilityLabel={`${item.profiles?.display_name}, hold to report or block`}
                    >
                      <Text style={styles.senderName}>{item.profiles?.display_name}</Text>
                    </TouchableOpacity>
                  )}
                  <View style={[styles.bubble, isMe && styles.bubbleMe]}>
                    <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.body}</Text>
                  </View>
                </View>
              </View>
            );
          }}
        />

        {!!sendError && (
          <View style={styles.sendErrorBanner}>
            <Text style={styles.sendErrorText}>{sendError}</Text>
          </View>
        )}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Message everyone..."
            placeholderTextColor={colors.textTertiary}
            value={text}
            onChangeText={setText}
            multiline
            accessibilityLabel="Message the community group chat"
          />
          <TouchableOpacity style={styles.sendButton} onPress={handleSend} accessibilityLabel="Send message" accessibilityRole="button">
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <ReportBlockModal
        visible={!!reportTarget}
        onClose={() => setReportTarget(null)}
        onBlocked={() => setReportTarget(null)}
        reportedUserId={reportTarget?.id}
        reportedUserName={reportTarget?.name}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center', paddingHorizontal: spacing.xl },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: spacing.sm, gap: spacing.xs },
  messageRowMe: { justifyContent: 'flex-end' },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceElevated },
  avatarPlaceholder: {},
  senderName: { fontSize: 11, color: colors.textTertiary, marginBottom: 2, marginLeft: spacing.xs },
  bubble: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.sm, borderWidth: 1, borderColor: colors.border },
  bubbleMe: { backgroundColor: colors.primary, borderColor: colors.primary },
  bubbleText: { color: colors.textPrimary, fontSize: 14 },
  bubbleTextMe: { color: '#fff' },
  sendErrorBanner: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  sendErrorText: { color: colors.danger, fontSize: 12, textAlign: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.textPrimary, maxHeight: 100, borderWidth: 1, borderColor: colors.border },
  sendButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  sendButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});