import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, SafeAreaView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { askBusinessAssistant } from '../services/businessAI';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const SUGGESTIONS = ['Why did attendance drop this month?', 'What should I promote right now?', 'How am I doing compared to last month?', 'Suggest a new offer'];

export default function BusinessAIAssistantScreen({ route }) {
  const { partnerId, partnerName } = route.params ?? {};
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [thread, setThread] = useState([]);

  async function handleAsk(text) {
    const q = (text ?? question).trim();
    if (!q || loading) return;
    setQuestion('');
    setLoading(true);
    setThread((prev) => [...prev, { role: 'question', text: q }]);
    try {
      const answer = await askBusinessAssistant(partnerId, q);
      setThread((prev) => [...prev, { role: 'answer', text: answer }]);
    } catch (e) {
      setThread((prev) => [...prev, { role: 'error', text: e.message || 'Could not process that right now.' }]);
    }
    setLoading(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <Text style={styles.subtitle}>Ask about {partnerName ?? 'your business'}'s real performance data — followers, redemptions, and growth.</Text>
        </View>

        <FlatList
          contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm }}
          data={thread}
          keyExtractor={(_, i) => String(i)}
          ListEmptyComponent={
            !loading ? (
              <View style={styles.suggestionsRow}>
                {SUGGESTIONS.map((s) => (
                  <TouchableOpacity key={s} style={styles.suggestionChip} onPress={() => handleAsk(s)} accessibilityRole="button">
                    <Text style={styles.suggestionChipText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.role === 'question' ? styles.bubbleQuestion : item.role === 'error' ? styles.bubbleError : styles.bubbleAnswer]}>
              <Text style={item.role === 'question' ? styles.bubbleQuestionText : styles.bubbleAnswerText}>{item.text}</Text>
            </View>
          )}
          ListFooterComponent={loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} /> : null}
        />

        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            placeholder="Ask a question about your business..."
            placeholderTextColor={colors.textTertiary}
            value={question}
            onChangeText={setQuestion}
            onSubmitEditing={() => handleAsk()}
            returnKeyType="send"
            accessibilityLabel="Ask the business assistant a question"
          />
          <TouchableOpacity style={styles.askButton} onPress={() => handleAsk()} disabled={loading} accessibilityLabel="Ask" accessibilityRole="button">
            {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.askButtonText}>Ask</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  subtitle: { ...typography.body, color: colors.textSecondary },
  suggestionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  suggestionChip: {
    backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  suggestionChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  bubble: { borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm, maxWidth: '90%' },
  bubbleQuestion: { backgroundColor: colors.primary, alignSelf: 'flex-end' },
  bubbleAnswer: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignSelf: 'flex-start' },
  bubbleError: { backgroundColor: colors.danger + '20', borderWidth: 1, borderColor: colors.danger, alignSelf: 'flex-start' },
  bubbleQuestionText: { color: '#fff', fontSize: 14, lineHeight: 20 },
  bubbleAnswerText: { color: colors.textPrimary, fontSize: 14, lineHeight: 20 },
  inputWrap: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, paddingTop: spacing.sm },
  input: {
    flex: 1, backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  askButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  askButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
