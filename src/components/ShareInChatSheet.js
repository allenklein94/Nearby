import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Modal, Alert, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { NLoader, modalAnimation, showSuccessToast } from '../motion';
import { presentRecoverableError } from '../utils/recoverableError';
import { getMyOneToOneChats, shareGatheringInChat } from '../services/chatShare';

// "Share in a chat" (owner decision 2026-10-20, idea "244" follow-up): one question, which chat. Each row's Send is the
// person's explicit send of a compact card into that one-to-one chat; nothing is sent until they tap it. Rows stay
// "✓ Sent" while the sheet is open. Same shape as InviteFriendsModal (idea "225": one quick action, no mini-app).
// `restricted` (not public, or women-only): one fixed note that only people who can already see it can open it. It is
// about the gathering, never about a recipient: nothing here checks or reveals who can see it.
export default function ShareInChatSheet({ visible, onClose, gatheringId, gatheringTitle, restricted = false }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sentIds, setSentIds] = useState({});
  const [sendingId, setSendingId] = useState(null);

  useEffect(() => {
    if (visible) {
      setSentIds({});
      load();
    }
  }, [visible]);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      setChats(await getMyOneToOneChats());
    } catch (e) {
      setLoadError(true);
    }
    setLoading(false);
  }

  async function send(chat) {
    setSendingId(chat.matchId);
    try {
      await shareGatheringInChat(chat.matchId, gatheringId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSentIds((prev) => ({ ...prev, [chat.matchId]: true }));
      showSuccessToast(t('ui.shareInChat.toastTitle'), t('ui.shareInChat.toastBody', { name: chat.name }));
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => send(chat) });
    }
    setSendingId(null);
  }

  return (
    <Modal visible={visible} animationType={modalAnimation('slide')} transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{t('ui.shareInChat.title')}</Text>
          <Text style={styles.subtitle}>{t('ui.shareInChat.subtitle', { title: gatheringTitle })}</Text>
          {restricted ? <Text style={styles.note}>{t('ui.shareInChat.restrictedNote')}</Text> : null}

          {loading ? (
            <NLoader fullScreen={false} size="compact" caption={t('ui.shareInChat.loading')} />
          ) : loadError ? (
            <TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel={t('ui.shared.errors.tryAgain')}>
              <Text style={styles.retry}>{t('ui.shared.errors.tryAgain')}</Text>
            </TouchableOpacity>
          ) : chats.length === 0 ? (
            <Text style={styles.emptyText}>{t('ui.shareInChat.none')}</Text>
          ) : (
            <FlatList
              data={chats}
              keyExtractor={(item) => item.matchId}
              style={{ maxHeight: 400 }}
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <Text style={styles.name}>{item.name}</Text>
                  <TouchableOpacity
                    style={[styles.sendButton, sentIds[item.matchId] && styles.sendButtonSent]}
                    onPress={() => send(item)}
                    disabled={sendingId === item.matchId || !!sentIds[item.matchId]}
                    accessibilityLabel={sentIds[item.matchId]
                      ? t('ui.shareInChat.sentA11y', { name: item.name })
                      : t('ui.shareInChat.sendA11y', { title: gatheringTitle, name: item.name })}
                    accessibilityRole="button"
                  >
                    {sendingId === item.matchId ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.sendButtonText}>{sentIds[item.matchId] ? t('ui.shareInChat.sent') : t('ui.shareInChat.send')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            />
          )}

          <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.lg }} accessibilityRole="button">
            <Text style={styles.closeText}>{t('ui.shareInChat.done')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg },
  note: { ...typography.caption, color: colors.textSecondary, marginTop: -spacing.sm, marginBottom: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  name: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  sendButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 8, minWidth: 70, alignItems: 'center' },
  sendButtonSent: { backgroundColor: colors.success },
  sendButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  emptyText: { color: colors.textTertiary, textAlign: 'center', paddingVertical: spacing.xl, lineHeight: 20 },
  retry: { color: colors.primary, textAlign: 'center', fontSize: 14, fontWeight: '600', paddingVertical: spacing.xl },
  closeText: { color: colors.textTertiary, textAlign: 'center', fontSize: 14 },
});
