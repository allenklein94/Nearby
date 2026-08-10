import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getConversationWithBusiness, sendMessageToBusiness } from '../services/brandOffers';
import ReportBlockModal from '../components/ReportBlockModal';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import useChatComposer from '../hooks/useChatComposer';

export default function BusinessConversationScreen({ route, navigation }) {
  const { partnerId, partnerName } = route.params;
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [messages, setMessages] = useState([]);
  const { text, setText, send, sendError } = useChatComposer();
  const [reportTarget, setReportTarget] = useState(null);

  const load = useCallback(async () => {
    const results = await getConversationWithBusiness(partnerId);
    setMessages(results);
  }, [partnerId]);

  useFocusEffect(
    useCallback(() => {
      load();

      // Was a setInterval(load, 4000) re-downloading this entire
      // conversation every 4 seconds while the screen was focused.
      // Replaced with a real realtime subscription — new messages arrive
      // as individual INSERT events and get appended directly. No extra
      // per-row fetch is needed here (unlike gathering/community chat)
      // since business_messages rows carry no joined profile data to
      // begin with — getConversationWithBusiness()'s own select is just
      // raw columns, so the INSERT payload already matches that shape.
      // RLS's own "Only the follower and business owner can see this
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
            setMessages((prev) => (prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new]));
          }
        )
        .subscribe();

      return () => supabase.removeChannel(channel);
    }, [load, partnerId])
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
    await send(async (body) => {
      await sendMessageToBusiness(partnerId, body);
      await load();
    });
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyText}>Say hi to {partnerName}!</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.from_business && styles.bubbleFromBusiness]}>
              <Text style={item.from_business ? styles.bubbleTextFromBusiness : styles.bubbleText}>{item.body}</Text>
            </View>
          )}
        />
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
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center' },
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