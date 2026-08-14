import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Image, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import { getCommunityMessagesPage, getCommunityMessageById, sendCommunityMessage } from '../services/communities';
import { getSignedPhotoUrl } from '../services/photos';
import ReportBlockModal from '../components/ReportBlockModal';
import LoadErrorState from '../components/LoadErrorState';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import useChatComposer from '../hooks/useChatComposer';
import usePaginatedMessages from '../hooks/usePaginatedMessages';

export default function CommunityChatScreen({ route }) {
  const { communityId, communityName } = route.params;
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const fetchPage = useCallback(
    ({ limit, beforeCreatedAt }) => getCommunityMessagesPage(communityId, { limit, beforeCreatedAt }),
    [communityId]
  );
  const { messages, loadInitial, loadOlder, prependMessage, hasMore, loadingOlder, loadError, loadOlderError } = usePaginatedMessages(fetchPage);
  const { text, setText, send, sendError } = useChatComposer();
  const [myUserId, setMyUserId] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMyUserId(data?.session?.user?.id ?? null));
    loadInitial();

    // Was a setInterval(load, 3000) re-downloading the entire message
    // history every 3 seconds, unconditionally, for as long as this screen
    // stayed open — worse here than on a one-off gathering chat, since a
    // community's group chat is open-ended and ongoing. Replaced with a
    // real realtime subscription — new messages arrive as individual
    // INSERT events and get prepended to the already-loaded page.
    const channel = supabase
      .channel(`community_messages:${communityId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'community_messages', filter: `community_id=eq.${communityId}` },
        async (payload) => {
          const fullMessage = await getCommunityMessageById(payload.new.id);
          if (fullMessage) prependMessage(fullMessage);
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [loadInitial, communityId, prependMessage]);

  // Resolves any not-yet-signed sender photo URLs whenever the loaded
  // message set changes (initial load, load-older, or a realtime
  // arrival) — one place instead of duplicating the same fetch at each
  // of those three call sites.
  useEffect(() => {
    const missingSenderIds = [...new Set(
      messages.filter((m) => m.profiles?.photo_url && !(m.sender_id in photoUrls)).map((m) => m.sender_id)
    )];
    if (missingSenderIds.length === 0) return;
    (async () => {
      const entries = await Promise.all(
        missingSenderIds.map(async (senderId) => {
          const photoPath = messages.find((m) => m.sender_id === senderId)?.profiles?.photo_url;
          const url = await getSignedPhotoUrl(photoPath);
          return [senderId, url];
        })
      );
      setPhotoUrls((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
  }, [messages, photoUrls]);

  async function handleSend() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await send(async (body) => {
      await sendCommunityMessage(communityId, body);
      // No manual reload/append here — the realtime channel above
      // delivers this same INSERT back (Supabase doesn't suppress the
      // echo to the inserting client), which prepends it the same way a
      // message from anyone else would arrive.
    });
  }

  // Was previously indistinguishable from a genuinely empty chat --
  // getCommunityMessagesPage() used to swallow a real query error into an
  // empty array, which would have rendered the "Say hi" empty state below
  // instead of a real error + retry.
  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load this chat." onRetry={loadInitial} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {messages.length === 0 ? (
          <View style={[styles.emptyState, { flex: 1, justifyContent: 'center' }]}>
            <Text style={styles.emptyEmoji}>💬</Text>
            <Text style={styles.emptyText}>Say hi to everyone in "{communityName}"!</Text>
          </View>
        ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          // Newest-first data + inverted rendering — the standard chat-app
          // shape, and what lets onEndReached below correspond to
          // scrolling toward the *oldest* end of the conversation, which
          // is exactly when older history should load.
          inverted
          onEndReached={loadOlder}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            // Renders visually at the TOP under `inverted` — right above
            // the oldest currently-loaded message.
            loadingOlder ? (
              <View style={{ paddingVertical: spacing.md }}>
                <ActivityIndicator color={colors.textTertiary} />
              </View>
            ) : loadOlderError ? (
              <TouchableOpacity onPress={loadOlder} accessibilityLabel="Couldn't load older messages, tap to retry" accessibilityRole="button">
                <Text style={styles.historyErrorText}>Couldn't load older messages — tap to retry</Text>
              </TouchableOpacity>
            ) : !hasMore && messages.length > 0 ? (
              <Text style={styles.historyStartText}>The start of this community's chat</Text>
            ) : null
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
        )}

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
  historyStartText: { color: colors.textTertiary, fontSize: 12, textAlign: 'center', paddingVertical: spacing.md },
  historyErrorText: { color: colors.primary, fontSize: 12, fontWeight: '600', textAlign: 'center', paddingVertical: spacing.md },
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