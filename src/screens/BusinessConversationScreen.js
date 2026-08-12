import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import { getBusinessMessagesPage, sendMessageToBusiness } from '../services/brandOffers';
import ReportBlockModal from '../components/ReportBlockModal';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import useChatComposer from '../hooks/useChatComposer';
import usePaginatedMessages from '../hooks/usePaginatedMessages';

export default function BusinessConversationScreen({ route, navigation }) {
  const { partnerId, partnerName } = route.params;
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const fetchPage = useCallback(
    ({ limit, beforeCreatedAt }) => getBusinessMessagesPage(partnerId, null, { limit, beforeCreatedAt }),
    [partnerId]
  );
  const { messages, loadInitial, loadOlder, prependMessage, hasMore, loadingOlder } = usePaginatedMessages(fetchPage);
  const { text, setText, send, sendError } = useChatComposer();
  const [reportTarget, setReportTarget] = useState(null);

  useFocusEffect(
    useCallback(() => {
      loadInitial();

      // Was a setInterval(load, 4000) re-downloading this entire
      // conversation every 4 seconds while the screen was focused.
      // Replaced with a real realtime subscription — new messages arrive
      // as individual INSERT events and get prepended directly. No extra
      // per-row fetch is needed here (unlike gathering/community chat)
      // since business_messages rows carry no joined profile data to
      // begin with — getBusinessMessagesPage()'s own select is just raw
      // columns, so the INSERT payload already matches that shape. RLS's
      // own "Only the follower and business owner can see this
      // conversation" SELECT policy means a customer's subscription only
      // ever actually receives rows for their own conversation, even
      // though the filter below is scoped to partner_id only (Realtime
      // filters can't express a second conversation_with_id condition).
      const channel = supabase
        .channel(`business_messages:${partnerId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'business_messages', filter: `partner_id=eq.${partnerId}` },
          (payload) => {
            prependMessage(payload.new);
          }
        )
        .subscribe();

      return () => supabase.removeChannel(channel);
    }, [loadInitial, partnerId, prependMessage])
  );

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={handleReportBusiness}
          accessibilityLabel={`Report ${partnerName}`}
          accessibilityRole="button"
        >
          <Text style={{ fontSize: 20 }}>⋯</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, messages]);

  function handleReportBusiness() {
    const businessMessage = messages.find((m) => m.from_business);
    if (!businessMessage) {
      return;
    }
    setReportTarget({ id: businessMessage.sender_id, name: partnerName });
  }

  async function handleSend() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await send(async (body) => {
      await sendMessageToBusiness(partnerId, body);
      // No manual reload/append here — the realtime channel above delivers
      // this same INSERT back (Supabase doesn't suppress the echo to the
      // inserting client), which prepends it the same way a message from
      // the business would arrive.
    });
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {messages.length === 0 ? (
          <View style={[styles.emptyState, { flex: 1, justifyContent: 'center' }]}>
            <Text style={styles.emptyEmoji}>💬</Text>
            <Text style={styles.emptyText}>Say hi to {partnerName}!</Text>
          </View>
        ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          // Newest-first data + inverted rendering — same shape as
          // gathering/community chat, so onEndReached below corresponds to
          // scrolling toward the *oldest* end of the conversation.
          inverted
          onEndReached={loadOlder}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingOlder ? (
              <View style={{ paddingVertical: spacing.md }}>
                <ActivityIndicator color={colors.textTertiary} />
              </View>
            ) : !hasMore && messages.length > 0 ? (
              <Text style={styles.historyStartText}>The start of your conversation with {partnerName}</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.from_business && styles.bubbleFromBusiness]}>
              <Text style={item.from_business ? styles.bubbleTextFromBusiness : styles.bubbleText}>{item.body}</Text>
            </View>
          )}
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
            placeholder={`Message ${partnerName}...`}
            placeholderTextColor={colors.textTertiary}
            value={text}
            onChangeText={setText}
            multiline
            accessibilityLabel={`Message ${partnerName}`}
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
  bubble: {
    backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.sm, marginBottom: spacing.sm,
    alignSelf: 'flex-end', maxWidth: '80%', borderWidth: 1, borderColor: colors.primary,
  },
  bubbleFromBusiness: { backgroundColor: colors.surface, alignSelf: 'flex-start', borderColor: colors.border },
  bubbleText: { color: '#fff', fontSize: 14 },
  bubbleTextFromBusiness: { color: colors.textPrimary, fontSize: 14 },
  sendErrorBanner: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  sendErrorText: { color: colors.danger, fontSize: 12, textAlign: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.textPrimary, maxHeight: 100, borderWidth: 1, borderColor: colors.border },
  sendButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  sendButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});