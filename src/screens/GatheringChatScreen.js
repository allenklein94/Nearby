import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Image } from 'react-native';
import * as Haptics from 'expo-haptics';
import { getGatheringMessagesPage, getGatheringMessageById, sendGatheringMessage } from '../services/gatheringChat';
import { getSignedPhotoUrl } from '../services/photos';
import { captureStoryMedia, uploadStory } from '../services/stories';
import ReportBlockModal from '../components/ReportBlockModal';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { Alert, ActivityIndicator } from 'react-native';
import useChatComposer from '../hooks/useChatComposer';
import usePaginatedMessages from '../hooks/usePaginatedMessages';

export default function GatheringChatScreen({ route }) {
  const { gatheringId, gatheringTitle, draftText } = route.params;
  const { colors } = useTheme();
  const [postingStory, setPostingStory] = useState(false);
  const [suggestingOffers, setSuggestingOffers] = useState(false);

  async function handleSuggestOffers() {
    setSuggestingOffers(true);
    try {
      // "Shared by at least 2 people" rather than requiring
      // unanimous agreement — for a group of 10, expecting every
      // single person to share the exact same interest would almost
      // never trigger a suggestion at all.
      const { data: attendees } = await supabase
        .from('gathering_interest')
        .select('profiles(interests)')
        .eq('gathering_id', gatheringId)
        .eq('status', 'approved');

      const interestCounts = {};
      (attendees ?? []).forEach((a) => {
        (a.profiles?.interests ?? []).forEach((i) => {
          interestCounts[i] = (interestCounts[i] ?? 0) + 1;
        });
      });
      const sharedInterests = Object.entries(interestCounts)
        .filter(([, count]) => count >= 2)
        .map(([interest]) => interest);

      if (sharedInterests.length === 0) {
        Alert.alert('No shared interests yet', "This group doesn't have enough overlapping interests on their profiles to base a suggestion on.");
        setSuggestingOffers(false);
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
        Alert.alert('No suggestions right now', "There aren't any active offers matching what this group likes yet — check back soon.");
        setSuggestingOffers(false);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const myId = sessionData?.session?.user?.id;
      const suggestionText = `💡 Group ideas, since a few of you like ${sharedInterests.slice(0, 3).join(', ')}:\n${offersData.map((o) => `• ${o.title} at ${o.brand_partners?.name ?? 'a local spot'}`).join('\n')}`;
      await sendGatheringMessage(gatheringId, suggestionText);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSuggestingOffers(false);
  }

  async function handlePostStory() {
    try {
      const media = await captureStoryMedia();
      if (!media) return;
      const { data: sessionData } = await supabase.auth.getSession();
      const myId = sessionData?.session?.user?.id;
      setPostingStory(true);
      await uploadStory(myId, media.uri, media.type, false, gatheringId);
      Alert.alert('Posted!', `Your story is now shared with everyone at ${gatheringTitle}.`);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setPostingStory(false);
  }
  const styles = getStyles(colors);
  const fetchPage = useCallback(
    ({ limit, beforeCreatedAt }) => getGatheringMessagesPage(gatheringId, { limit, beforeCreatedAt }),
    [gatheringId]
  );
  const { messages, loadInitial, loadOlder, prependMessage, hasMore, loadingOlder } = usePaginatedMessages(fetchPage);
  const { text, setText, send, sendError } = useChatComposer(draftText ?? '');
  const [myUserId, setMyUserId] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const [reportTarget, setReportTarget] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMyUserId(data?.session?.user?.id ?? null));
    loadInitial();

    // Was a setInterval(load, 3000) re-downloading the entire message
    // history every 3 seconds, unconditionally, for as long as this screen
    // stayed open. Replaced with a real realtime subscription — new
    // messages arrive as individual INSERT events and get prepended to the
    // already-loaded page (see usePaginatedMessages), instead of the whole
    // conversation being re-fetched on a timer or on every load.
    const channel = supabase
      .channel(`gathering_messages:${gatheringId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'gathering_messages', filter: `gathering_id=eq.${gatheringId}` },
        async (payload) => {
          const fullMessage = await getGatheringMessageById(payload.new.id);
          if (fullMessage) prependMessage(fullMessage);
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [loadInitial, gatheringId, prependMessage]);

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
      await sendGatheringMessage(gatheringId, body);
      // No manual reload/append here — the realtime channel above
      // delivers this same INSERT back (Supabase doesn't suppress the
      // echo to the inserting client), which prepends it the same way a
      // message from anyone else would arrive.
    });
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {messages.length === 0 ? (
          <View style={[styles.emptyState, { flex: 1, justifyContent: 'center' }]}>
            <Text style={styles.emptyEmoji}>💬</Text>
            <Text style={styles.emptyText}>Say hi to everyone attending "{gatheringTitle}"!</Text>
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
            // Renders visually at the TOP under `inverted` — i.e. above
            // the oldest currently-loaded message, right where "loading
            // more history" belongs.
            loadingOlder ? (
              <View style={{ paddingVertical: spacing.md }}>
                <ActivityIndicator color={colors.textTertiary} />
              </View>
            ) : !hasMore && messages.length > 0 ? (
              <Text style={styles.historyStartText}>The start of this gathering's chat</Text>
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
          <TouchableOpacity
            onPress={handlePostStory}
            disabled={postingStory}
            accessibilityLabel="Post a story from this gathering"
            accessibilityRole="button"
          >
            <Text style={{ fontSize: 22 }}>📸</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSuggestOffers}
            disabled={suggestingOffers}
            accessibilityLabel="Suggest offers based on what this group likes"
            accessibilityRole="button"
          >
            <Text style={{ fontSize: 22 }}>💡</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Message everyone..."
            placeholderTextColor={colors.textTertiary}
            value={text}
            onChangeText={setText}
            multiline
            accessibilityLabel="Message the gathering group chat"
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