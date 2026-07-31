import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getConversationWithBusiness, sendMessageToBusiness } from '../services/brandOffers';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';

export default function BusinessConversationScreen({ route }) {
  const { partnerId, partnerName } = route.params;
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');

  const load = useCallback(async () => {
    const results = await getConversationWithBusiness(partnerId);
    setMessages(results);
  }, [partnerId]);

  useFocusEffect(
    useCallback(() => {
      load();
      const interval = setInterval(load, 4000);
      return () => clearInterval(interval);
    }, [load])
  );

  async function handleSend() {
    if (!text.trim()) return;
    const body = text.trim();
    setText('');
    try {
      await sendMessageToBusiness(partnerId, body);
      await load();
    } catch (e) {
      // fail quietly, message stays in composer would be nicer but simple for now
    }
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
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.textPrimary, maxHeight: 100, borderWidth: 1, borderColor: colors.border },
  sendButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  sendButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});