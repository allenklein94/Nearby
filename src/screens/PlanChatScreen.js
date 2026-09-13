import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Image, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import { getPlanChatInfo, getPlanMessagesPage, getPlanMessageById, sendPlanMessage } from '../services/planChat';
import { getSignedPhotoUrl } from '../services/photos';
import ReportBlockModal from '../components/ReportBlockModal';
import LoadErrorState from '../components/LoadErrorState';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import useChatComposer from '../hooks/useChatComposer';
import usePaginatedMessages from '../hooks/usePaginatedMessages';

const ROLE_LABEL = { host: 'Host', organizer: 'Co-organizer', guest: 'Guest' };

// Item 89 (CLAUDE.md, "Give the occasion a single shared conversation"):
// "Rather than Messages -> individual chats -> trying to coordinate, the
// occasion itself can have a lightweight group conversation." Scoped to
// business_request-destined Plans -- a gathering-destined occasion (a
// party) already has its own real group chat (gathering_messages /
// GatheringChatScreen), so this is the genuinely missing piece, not a
// duplicate. See 20261109_plan_group_chat.sql for the schema/RLS.
export default function PlanChatScreen({ route, navigation }) {
  const { businessRequestId, initialTitle } = route.params;
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const [planId, setPlanId] = useState(null);
  const [planTitle, setPlanTitle] = useState(initialTitle ?? null);
  const [participants, setParticipants] = useState([]);
  const [resolving, setResolving] = useState(true);
  const [resolveError, setResolveError] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [myUserId, setMyUserId] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const [reportTarget, setReportTarget] = useState(null);

  const fetchPage = useCallback(
    ({ limit, beforeCreatedAt }) => getPlanMessagesPage(planId, { limit, beforeCreatedAt }),
    [planId]
  );
  const { messages, loadInitial, loadOlder, prependMessage, hasMore, loadingOlder, loadingInitial, loadError, loadOlderError } = usePaginatedMessages(fetchPage);
  const { text, setText, send, sendError } = useChatComposer('');

  const resolvePlan = useCallback(async () => {
    setResolving(true);
    setResolveError(false);
    try {
      const info = await getPlanChatInfo(businessRequestId);
      setPlanId(info.planId);
      const resolvedTitle = info.title ?? initialTitle ?? 'Plan Chat';
      setPlanTitle(resolvedTitle);
      navigation.setOptions({ title: resolvedTitle });
      setParticipants(info.participants ?? []);
    } catch (e) {
      console.error('getPlanChatInfo failed', e);
      setResolveError(true);
    }
    setResolving(false);
  }, [businessRequestId, initialTitle, navigation]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMyUserId(data?.session?.user?.id ?? null));
    resolvePlan();
  }, [resolvePlan]);

  useEffect(() => {
    if (!planId) return undefined;
    loadInitial();

    const channel = supabase
      .channel(`plan_messages:${planId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'plan_messages', filter: `plan_id=eq.${planId}` },
        async (payload) => {
          const fullMessage = await getPlanMessageById(payload.new.id);
          if (fullMessage) prependMessage(fullMessage);
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [planId, loadInitial, prependMessage]);

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
      await sendPlanMessage(planId, body);
      // No manual append -- the realtime channel above delivers this same
      // INSERT back and prepends it, same as gathering/community chat.
    });
  }

  if (resolveError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load this chat." onRetry={resolvePlan} />
      </SafeAreaView>
    );
  }

  if (resolving || !planId) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => setShowRoster((v) => !v)}
          accessibilityLabel={`${participants.length} people in this plan, tap to ${showRoster ? 'hide' : 'view'} the list`}
          accessibilityRole="button"
        >
          <Text style={styles.headerSubtitle}>👥 {participants.length} {participants.length === 1 ? 'person' : 'people'} {showRoster ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {showRoster && (
          <View style={styles.rosterPanel}>
            {participants.map((p) => (
              <Text key={p.id} style={styles.rosterRow}>
                {p.displayName ?? 'Someone'} · {ROLE_LABEL[p.role] ?? p.role}
              </Text>
            ))}
          </View>
        )}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loadError ? (
          <LoadErrorState message="Couldn't load this chat." onRetry={loadInitial} />
        ) : loadingInitial ? (
          <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
        ) : messages.length === 0 ? (
          <View style={[styles.emptyState, { flex: 1, justifyContent: 'center' }]}>
            <Text style={styles.emptyEmoji}>💬</Text>
            <Text style={styles.emptyText}>Say hi to everyone coordinating this plan!</Text>
          </View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: spacing.lg }}
            inverted
            onEndReached={loadOlder}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              loadingOlder ? (
                <View style={{ paddingVertical: spacing.md }}>
                  <ActivityIndicator color={colors.textTertiary} />
                </View>
              ) : loadOlderError ? (
                <TouchableOpacity onPress={loadOlder} accessibilityLabel="Couldn't load older messages, tap to retry" accessibilityRole="button">
                  <Text style={styles.historyErrorText}>Couldn't load older messages — tap to retry</Text>
                </TouchableOpacity>
              ) : !hasMore && messages.length > 0 ? (
                <Text style={styles.historyStartText}>The start of this plan's chat</Text>
              ) : null
            }
            renderItem={({ item }) => {
              const isMe = item.sender_id === myUserId;
              return (
                <View style={[styles.messageRow, isMe && styles.messageRowMe]}>
                  {!isMe && (
                    <TouchableOpacity
                      onPress={() => navigation.navigate('ViewProfile', { userId: item.sender_id })}
                      accessibilityLabel={`View ${item.profiles?.display_name ?? 'this person'}'s profile`}
                      accessibilityRole="button"
                    >
                      {photoUrls[item.sender_id] ? (
                        <Image source={{ uri: photoUrls[item.sender_id] }} style={styles.avatar} />
                      ) : (
                        <View style={[styles.avatar, styles.avatarPlaceholder]} />
                      )}
                    </TouchableOpacity>
                  )}
                  <View style={{ maxWidth: '75%' }}>
                    {!isMe && (
                      <TouchableOpacity
                        onPress={() => navigation.navigate('ViewProfile', { userId: item.sender_id })}
                        onLongPress={() => setReportTarget({ id: item.sender_id, name: item.profiles?.display_name })}
                        accessibilityLabel={`${item.profiles?.display_name}, view profile, hold to report or block`}
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
            placeholder="Message everyone in this plan..."
            placeholderTextColor={colors.textTertiary}
            value={text}
            onChangeText={setText}
            multiline
            accessibilityLabel="Message everyone coordinating this plan"
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
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerSubtitle: { fontSize: 13, color: colors.textSecondary },
  rosterPanel: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  rosterRow: { fontSize: 13, color: colors.textPrimary, paddingVertical: 2 },
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
