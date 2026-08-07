import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { getGatheringQuestions, askGatheringQuestion, answerGatheringQuestion } from '../services/gatherings';
import { checkTextModeration } from '../services/textModeration';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// Public Q&A ("Can I bring my dog?") — anyone can ask, only the host can
// answer. Kept as its own component since it's mounted from three places
// (nearby card, attending card, hosting card) with the only difference
// being whether the current viewer can answer.
export default function GatheringQnA({ gatheringId, isHost }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [questionDraft, setQuestionDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [answerDrafts, setAnswerDrafts] = useState({});
  const [answeringId, setAnsweringId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getGatheringQuestions(gatheringId);
    setQuestions(data);
    setLoading(false);
  }, [gatheringId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAsk() {
    if (!questionDraft.trim()) return;

    const check = await checkTextModeration(questionDraft);
    if (!check.safe) {
      Alert.alert('Question not allowed', 'Please rephrase your question and try again.');
      return;
    }

    setAsking(true);
    try {
      await askGatheringQuestion(gatheringId, questionDraft.trim());
      setQuestionDraft('');
      await load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setAsking(false);
  }

  async function handleAnswer(questionId) {
    const answer = (answerDrafts[questionId] || '').trim();
    if (!answer) return;

    const check = await checkTextModeration(answer);
    if (!check.safe) {
      Alert.alert('Answer not allowed', 'Please rephrase your answer and try again.');
      return;
    }

    setAnsweringId(questionId);
    try {
      await answerGatheringQuestion(questionId, answer);
      setAnswerDrafts((prev) => ({ ...prev, [questionId]: '' }));
      await load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setAnsweringId(null);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Questions</Text>

      {loading && <Text style={styles.emptyText}>Loading...</Text>}
      {!loading && questions.length === 0 && <Text style={styles.emptyText}>No questions yet.</Text>}

      {questions.map((q) => (
        <View key={q.id} style={styles.questionRow}>
          <Text style={styles.questionText}>
            <Text style={styles.questionAsker}>{q.asker?.display_name ?? 'Someone'}: </Text>
            {q.question_body}
          </Text>
          {q.answer_body ? (
            <Text style={styles.answerText}>
              <Text style={styles.answerLabel}>Host: </Text>
              {q.answer_body}
            </Text>
          ) : isHost ? (
            <View style={styles.answerRow}>
              <TextInput
                style={styles.answerInput}
                value={answerDrafts[q.id] || ''}
                onChangeText={(text) => setAnswerDrafts((prev) => ({ ...prev, [q.id]: text }))}
                placeholder="Write an answer..."
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel={`Answer ${q.asker?.display_name ?? 'this'}'s question`}
              />
              <TouchableOpacity
                onPress={() => handleAnswer(q.id)}
                disabled={answeringId === q.id}
                accessibilityLabel="Submit answer"
                accessibilityRole="button"
              >
                <Text style={styles.answerSubmitText}>{answeringId === q.id ? '...' : 'Reply'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.awaitingText}>Awaiting host reply</Text>
          )}
        </View>
      ))}

      {!isHost && (
        <View style={styles.askRow}>
          <TextInput
            style={styles.askInput}
            value={questionDraft}
            onChangeText={setQuestionDraft}
            placeholder="Ask the host a question..."
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Ask a question about this gathering"
          />
          <TouchableOpacity
            onPress={handleAsk}
            disabled={asking || !questionDraft.trim()}
            accessibilityLabel="Submit question"
            accessibilityRole="button"
          >
            <Text style={[styles.askSubmitText, !questionDraft.trim() && { opacity: 0.4 }]}>{asking ? '...' : 'Ask'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  label: { ...typography.caption, color: colors.textTertiary, fontWeight: '700', marginBottom: spacing.sm },
  emptyText: { color: colors.textTertiary, fontSize: 13, marginBottom: spacing.sm },
  questionRow: { marginBottom: spacing.sm },
  questionText: { color: colors.textPrimary, fontSize: 14, lineHeight: 19 },
  questionAsker: { fontWeight: '700' },
  answerText: { color: colors.textSecondary, fontSize: 14, lineHeight: 19, marginTop: 2 },
  answerLabel: { fontWeight: '700', color: colors.primary },
  awaitingText: { color: colors.textTertiary, fontSize: 12, fontStyle: 'italic', marginTop: 2 },
  answerRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs, gap: spacing.sm },
  answerInput: { flex: 1, backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 8, fontSize: 13, borderWidth: 1, borderColor: colors.border },
  answerSubmitText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  askRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs, gap: spacing.sm },
  askInput: { flex: 1, backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 8, fontSize: 13, borderWidth: 1, borderColor: colors.border },
  askSubmitText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
});
