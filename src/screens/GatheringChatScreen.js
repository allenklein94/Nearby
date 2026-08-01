import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { getGatheringMessages, sendGatheringMessage } from '../services/gatheringChat';
import { getSignedPhotoUrl } from '../services/photos';
import { captureStoryMedia, uploadStory } from '../services/stories';
import ReportBlockModal from '../components/ReportBlockModal';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { Alert } from 'react-native';

export default function GatheringChatScreen({ route }) {
  const { gatheringId, gatheringTitle } = route.params;
  const { colors } = useTheme();
  const [postingStory, setPostingStory] = useState(false);

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
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [myUserId, setMyUserId] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const [reportTarget, setReportTarget] = useState(null);
  const listRef = useRef(null);

  const load = useCallback(async () => {
    const results = await getGatheringMessages(gatheringId);
    setMessages(results);

    const urlEntries = await Promise.all(
      results.map(async (m) => {
        if (!m.profiles?.photo_url) return [m.sender_id, null];
        const url = await getSignedPhotoUrl(m.profiles.photo_url);
        return [m.sender_id, url];
      })
    );
    setPhotoUrls((prev) => ({ ...prev, ...Object.fromEntries(urlEntries) }));
  }, [gatheringId]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMyUserId(data?.session?.user?.id ?? null));
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleSend() {
    if (!text.trim()) return;
    const body = text.trim();
    setText('');
    try {
      await sendGatheringMessage(gatheringId, body);
      await load();
      listRef.current?.scrollToEnd({ animated: true });
    } catch (e) {
      // silently fail, message stays in composer would be nicer but
      // keeping this simple for now
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyText}>Say hi to everyone attending "{gatheringTitle}"!</Text>
            </View>
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

        <View style={styles.inputRow}>
          <TouchableOpacity
            onPress={handlePostStory}
            disabled={postingStory}
            accessibilityLabel="Post a story from this gathering"
            accessibilityRole="button"
          >
            <Text style={{ fontSize: 22 }}>📸</Text>
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
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.textPrimary, maxHeight: 100, borderWidth: 1, borderColor: colors.border },
  sendButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  sendButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});