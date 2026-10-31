import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import EmptyCopy from './EmptyCopy';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { getGatheringQuestions, askGatheringQuestion, answerGatheringQuestion } from '../services/gatherings';
import { screenUserContent, blockedByScreening, handledScreeningRefusal } from '../services/userContentScreening';
import { UGC_KINDS } from '../utils/ugcText';
import { showSuccessToast } from '../motion';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// Public Q&A ("Can I bring my dog?") — anyone can ask, only the host can
// answer. Kept as its own component since it's mounted from three places
// (nearby card, attending card, hosting card) with the only difference
// being whether the current viewer can answer.
export default function GatheringQnA({ gatheringId, isHost }) {
  const { t } = useLanguage();
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

    // 20270373: screened before it's written; 'hold' = posted, seen only by you until a person approves it.
    const check = await screenUserContent([{ text: questionDraft, kind: UGC_KINDS.question }]);
    if (blockedByScreening(Alert, t, check, { notAllowedTitle: t('ui.gatheringParts.questionNotAllowed'), notAllowedBody: t('ui.gatheringParts.pleaseRephraseYourQuestionAnd') })) return;

    setAsking(true);
    try {
      await askGatheringQuestion(gatheringId, questionDraft.trim());
      setQuestionDraft('');
      if (check.outcome === 'hold') showSuccessToast(t('ui.shared.contentHeldTitle'), t('ui.shared.contentHeld'));
      await load();
    } catch (e) {
      if (handledScreeningRefusal(Alert, t, e, { notAllowedTitle: t('ui.gatheringParts.questionNotAllowed'), notAllowedBody: t('ui.gatheringParts.pleaseRephraseYourQuestionAnd') })) { setAsking(false); return; }
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleAsk() });
    }
    setAsking(false);
  }

  async function handleAnswer(questionId) {
    const answer = (answerDrafts[questionId] || '').trim();
    if (!answer) return;

    // 20270373: 'hold' = saved; the answer shows once a person approves it.
    const check = await screenUserContent([{ text: answer, kind: UGC_KINDS.answer }]);
    if (blockedByScreening(Alert, t, check, { notAllowedTitle: t('ui.gatheringParts.answerNotAllowed'), notAllowedBody: t('ui.gatheringParts.pleaseRephraseYourAnswerAnd') })) return;

    setAnsweringId(questionId);
    try {
      await answerGatheringQuestion(questionId, answer);
      setAnswerDrafts((prev) => ({ ...prev, [questionId]: '' }));
      if (check.outcome === 'hold') showSuccessToast(t('ui.shared.contentHeldTitle'), t('ui.shared.contentHeld'));
      await load();
    } catch (e) {
      if (handledScreeningRefusal(Alert, t, e, { notAllowedTitle: t('ui.gatheringParts.answerNotAllowed'), notAllowedBody: t('ui.gatheringParts.pleaseRephraseYourAnswerAnd') })) { setAnsweringId(null); return; }
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleAnswer(questionId) });
    }
    setAnsweringId(null);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{t('ui.gatheringParts.questions')}</Text>

      {loading && <Text style={styles.emptyText}>{t('ui.gatheringParts.loading')}</Text>}
      {!loading && questions.length === 0 && <EmptyCopy id="gathering_questions" />}

      {questions.map((q) => (
        <View key={q.id} style={styles.questionRow}>
          <Text style={styles.questionText}>
            <Text style={styles.questionAsker}>{q.asker?.display_name ?? t('ui.gatheringParts.someone')}: </Text>
            {q.question_body}
          </Text>
          {q.answer_body ? (
            <Text style={styles.answerText}>
              <Text style={styles.answerLabel}>{t('ui.gatheringParts.hostLabel')}{' '}</Text>
              {q.answer_body}
            </Text>
          ) : isHost ? (
            <View style={styles.answerRow}>
              <TextInput
                style={styles.answerInput}
                value={answerDrafts[q.id] || ''}
                onChangeText={(text) => setAnswerDrafts((prev) => ({ ...prev, [q.id]: text }))}
                placeholder={t('ui.gatheringParts.writeAnAnswer')}
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel={t('ui.gatheringParts.answerSQuestionA11y', { name: q.asker?.display_name ?? 'this' })}
              />
              <TouchableOpacity
                onPress={() => handleAnswer(q.id)}
                disabled={answeringId === q.id}
                accessibilityLabel={t('ui.gatheringParts.submitAnswerA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.answerSubmitText}>{answeringId === q.id ? '...' : t('ui.gatheringParts.reply')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.awaitingText}>{t('ui.gatheringParts.awaitingHostReply')}</Text>
          )}
        </View>
      ))}

      {!isHost && (
        <View style={styles.askRow}>
          <TextInput
            style={styles.askInput}
            value={questionDraft}
            onChangeText={setQuestionDraft}
            placeholder={t('ui.gatheringParts.askTheHostAQuestion')}
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel={t('ui.gatheringParts.askAQuestionAboutThisA11y')}
          />
          <TouchableOpacity
            onPress={handleAsk}
            disabled={asking || !questionDraft.trim()}
            accessibilityLabel={t('ui.gatheringParts.submitQuestionA11y')}
            accessibilityRole="button"
          >
            <Text style={[styles.askSubmitText, !questionDraft.trim() && { opacity: 0.4 }]}>{asking ? '...' : t('ui.gatheringParts.ask')}</Text>
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
