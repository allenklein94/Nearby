import React, { useState, useRef } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { supabase, functionUrl } from '../services/supabase';
import { usePostHog } from 'posthog-react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

// The practice partner's first line: ui.rehearsal.opener.<key>, in the person's language.
const SCENARIOS = [
  { key: 'ask_out', labelKey: 'askingSomeoneOut' },
  { key: 'boundary', labelKey: 'settingBoundary' },
  { key: 'hard_conversation', labelKey: 'hardConversation' },
  { key: 'not_interested', labelKey: 'sayingNotInterested' },
];

export default function RehearsalRoomScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [scenario, setScenario] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  function startScenario(s) {
    setScenario(s);
    setMessages([{ role: 'ai', text: t(`ui.rehearsal.opener.${s.key}`) }]);
    posthog.capture('rehearsal_room_started', { scenario: s.key });
  }

  function resetRoom() {
    setScenario(null);
    setMessages([]);
    setText('');
  }

  async function sendMessage() {
    if (!text.trim() || sending) return;
    const messageText = text.trim();
    const userMessage = { role: 'user', text: messageText };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setText('');
    setSending(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const response = await fetch(functionUrl('rehearsal-chat'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ scenario: scenario.key, history: newMessages }),
      });
      const result = await response.json();

      if (!response.ok) {
        if (response.status === 403) {
          Alert.alert(
            t('ui.rehearsal.rehearsalRoomIsPremium'),
            t('ui.rehearsal.practicingHardConversationsWithAn')
          );
          setScenario(null);
          setMessages([]);
          setSending(false);
          return;
        }
        Alert.alert(t('ui.rehearsal.error'), result.error || t('ui.rehearsal.couldNotContinueThePractice'));
        setMessages(messages);
        setText(messageText);
        setSending(false);
        return;
      }

      posthog.capture('rehearsal_room_message_sent', { scenario: scenario.key });
      setMessages((prev) => [...prev, { role: 'ai', text: result.reply }]);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => sendMessage() });
      setMessages(messages);
      setText(messageText);
    }
    setSending(false);
  }

  if (!scenario) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ padding: spacing.lg }}>
          <Text style={styles.headerTitle} accessibilityRole="header">{t('rehearsalRoom.title')}</Text>
          <Text style={styles.headerSubtitle}>
            {t('rehearsalRoom.subtitle')}
          </Text>
          <Text style={styles.pickLabel}>{t('rehearsalRoom.whatToPractice')}</Text>
          {SCENARIOS.map((s) => (
            <TouchableOpacity
              key={s.key}
              style={styles.scenarioCard}
              onPress={() => startScenario(s)}
              activeOpacity={0.85}
              accessibilityLabel={t('ui.rehearsal.practiceA11y', { scenario: t(`rehearsalRoom.${s.labelKey}`) })}
              accessibilityRole="button"
            >
              <Text style={styles.scenarioLabel}>{t(`rehearsalRoom.${s.labelKey}`)}</Text>
              <Text style={styles.scenarioChevron}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.practiceBanner} accessibilityLiveRegion="polite">
        <Text style={styles.practiceBannerText}>{t('rehearsalRoom.practiceReminder')}</Text>
        <TouchableOpacity onPress={resetRoom} accessibilityLabel={t('ui.rehearsal.endPracticeSessionA11y')} accessibilityRole="button">
          <Text style={styles.endText}>{t('rehearsalRoom.end')}</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ padding: spacing.lg }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View style={[styles.bubbleRow, item.role === 'user' ? styles.rowRight : styles.rowLeft]}>
              <View style={[styles.bubble, item.role === 'user' ? styles.myBubble : styles.theirBubble]}>
                <Text style={[styles.bubbleText, item.role === 'user' && styles.myBubbleText]}>{item.text}</Text>
              </View>
            </View>
          )}
        />

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder={t('ui.rehearsal.typeWhatYoudActuallySay')}
            placeholderTextColor={colors.textTertiary}
            value={text}
            onChangeText={setText}
            multiline
            accessibilityLabel={t('ui.rehearsal.practiceMessageInputA11y')}
          />
          <TouchableOpacity
            style={styles.sendButton}
            onPress={sendMessage}
            disabled={sending || !text.trim()}
            accessibilityLabel={t('ui.rehearsal.sendPracticeMessageA11y')}
            accessibilityRole="button"
          >
            {sending ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.sendText}>{t('ui.rehearsal.send')}</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  pickLabel: { ...typography.bodyBold, color: colors.textPrimary, marginBottom: spacing.sm },
  scenarioCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  scenarioLabel: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  scenarioChevron: { color: colors.textTertiary, fontSize: 20 },
  practiceBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.primaryMuted, padding: spacing.md,
  },
  practiceBannerText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  endText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  bubbleRow: { marginBottom: spacing.md, maxWidth: '80%' },
  rowLeft: { alignSelf: 'flex-start' },
  rowRight: { alignSelf: 'flex-end' },
  bubble: { padding: spacing.md, borderRadius: radius.lg },
  myBubble: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  theirBubble: { backgroundColor: colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  bubbleText: { color: colors.textPrimary, fontSize: 15, lineHeight: 20 },
  myBubbleText: { color: '#fff' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, maxHeight: 100, borderWidth: 1, borderColor: colors.border },
  sendButton: { justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginLeft: spacing.sm },
  sendText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
});