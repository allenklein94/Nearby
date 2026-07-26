import React, { useState, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { supabase } from '../services/supabase';
import { usePostHog } from 'posthog-react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const SCENARIOS = [
  { key: 'ask_out', labelKey: 'askingSomeoneOut', opener: "Let's practice. I'll play the other person — go ahead and ask me out however you'd actually say it." },
  { key: 'boundary', labelKey: 'settingBoundary', opener: "Let's practice. I'll play the other person — tell me the boundary you want to set." },
  { key: 'hard_conversation', labelKey: 'hardConversation', opener: "Let's practice a difficult conversation. I'll play the other person — start however you'd actually begin." },
  { key: 'not_interested', labelKey: 'sayingNotInterested', opener: "Let's practice. I'll play the other person — tell me kindly that you're not interested." },
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
    setMessages([{ role: 'ai', text: s.opener }]);
    posthog.capture('rehearsal_room_started', { scenario: s.key });
  }

  function resetRoom() {
    setScenario(null);
    setMessages([]);
    setText('');
  }

  async function sendMessage() {
    if (!text.trim() || sending) return;
    const userMessage = { role: 'user', text: text.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setText('');
    setSending(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const response = await fetch('https://enmosvippabmuqslzrox.supabase.co/functions/v1/rehearsal-chat', {
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
            'Rehearsal Room is Premium',
            'Practicing hard conversations with an AI partner is a Premium feature. Upgrade to keep going.'
          );
          setScenario(null);
          setMessages([]);
          setSending(false);
          return;
        }
        Alert.alert('Error', result.error || 'Could not continue the practice conversation.');
        setSending(false);
        return;
      }

      posthog.capture('rehearsal_room_message_sent', { scenario: scenario.key });
      setMessages((prev) => [...prev, { role: 'ai', text: result.reply }]);
    } catch (e) {
      Alert.alert('Error', e.message);
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
              accessibilityLabel={`Practice: ${t(`rehearsalRoom.${s.labelKey}`)}`}
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
        <TouchableOpacity onPress={resetRoom} accessibilityLabel="End practice session" accessibilityRole="button">
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
            placeholder="Type what you'd actually say..."
            placeholderTextColor={colors.textTertiary}
            value={text}
            onChangeText={setText}
            multiline
            accessibilityLabel="Practice message input"
          />
          <TouchableOpacity
            style={styles.sendButton}
            onPress={sendMessage}
            disabled={sending || !text.trim()}
            accessibilityLabel="Send practice message"
            accessibilityRole="button"
          >
            {sending ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.sendText}>Send</Text>}
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