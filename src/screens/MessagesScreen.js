import React, { useState, useCallback, useLayoutEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MatchesScreen from './MatchesScreen';
import FriendsScreen from './FriendsScreen';
import { getMyGatheringChats } from '../services/gatherings';
import { getMyCommunities } from '../services/communities';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// getMyGatheringChats() deliberately keeps a gathering's chat chip visible
// for up to 7 real days after it happened (a recent-past gathering's chat
// is still genuinely useful -- "thanks everyone!") before it drops off this
// row on its own. Real, user-reported gap in that window: nothing let
// someone dismiss a gathering's chat chip early if they didn't want to see
// it anymore -- and leave_gathering() itself explicitly refuses to "un-attend"
// something that already happened, so there was never a real leave action to
// reach for a past gathering either. This is a lightweight, local,
// non-destructive dismiss -- it never touches real attendance history or
// the gathering itself, it only ever hides the chip from this device.
const HIDDEN_GATHERING_CHATS_KEY = 'hidden_gathering_chats';

const MESSAGES_MODES = [
  { key: 'matches', icon: '💬', label: 'Matches' },
  { key: 'friends', icon: '🤝', label: 'Friends' },
];

// Phase 5 of the "build everything" plan (see CLAUDE.md): Messages left
// the bottom tab bar entirely, reachable instead from the persistent
// header icon (TabHeaderActions) on Home/People/Create/Activity, pushed
// as a real Stack screen (native header/back chevron, matching every
// other pushed screen's convention) rather than a tab. Extracted
// straight out of the old InboxScreen's "messages" half -- the
// Activity half of that screen is gone (it's now the real 'Activity'
// bottom tab, rendering ActivityScreen directly) -- MatchesScreen and
// the group-chats row are both completely unmodified, same real,
// already-working screens underneath, not a rebuild.
//
// Aug 24 2026 (CLAUDE.md, 14-item UX review item 2): the "🤝 Friends"
// row used to be a plain navigate()-away pill to the standalone Friends
// screen -- read like a small in-place control but actually pushed a
// whole new screen. Rebuilt as a real Matches/Friends mode toggle,
// reusing Discover's own modeToggleRow/modeToggleButton chrome verbatim
// (not a new visual language) -- content swaps in place, no navigation.
// FriendsScreen's own standalone `Friends` route (reached from Home's
// friend-count card, Settings, Profile) is completely untouched -- this
// is a second, embedded use of the same real component, same pattern
// MatchesScreen was already embedded with here.
export default function MessagesScreen({ navigation, route }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [mode, setMode] = useState('matches');
  const [groupChats, setGroupChats] = useState([]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: mode === 'friends' ? 'Friends' : 'Messages' });
  }, [navigation, mode]);

  const loadGroupChats = useCallback(async () => {
    try {
      const [gatheringChats, communities, hiddenRaw] = await Promise.all([
        getMyGatheringChats(),
        getMyCommunities(),
        AsyncStorage.getItem(HIDDEN_GATHERING_CHATS_KEY),
      ]);
      const hidden = new Set(hiddenRaw ? JSON.parse(hiddenRaw) : []);
      setGroupChats([
        ...gatheringChats
          .filter((g) => !hidden.has(g.id))
          .map((g) => ({ kind: 'gathering', id: g.id, title: g.title, isPast: new Date(g.scheduled_at) < new Date() })),
        ...communities.map((c) => ({ kind: 'community', id: c.id, title: c.name })),
      ]);
    } catch (e) {
      console.error('loadGroupChats failed', e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadGroupChats();
    }, [loadGroupChats])
  );

  async function hideGatheringChat(chat) {
    Alert.alert(
      'Hide this chat?',
      `"${chat.title} Chat" won't show up here anymore. This only affects this device — it doesn't remove you from the gathering.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Hide',
          style: 'destructive',
          onPress: async () => {
            const raw = await AsyncStorage.getItem(HIDDEN_GATHERING_CHATS_KEY);
            const hidden = raw ? JSON.parse(raw) : [];
            if (!hidden.includes(chat.id)) hidden.push(chat.id);
            await AsyncStorage.setItem(HIDDEN_GATHERING_CHATS_KEY, JSON.stringify(hidden));
            setGroupChats((prev) => prev.filter((c) => !(c.kind === 'gathering' && c.id === chat.id)));
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.modeToggleRow}>
          {MESSAGES_MODES.map((m) => {
            const active = mode === m.key;
            return (
              <TouchableOpacity
                key={m.key}
                style={[styles.modeToggleButton, active && styles.modeToggleButtonActive]}
                onPress={() => setMode(m.key)}
                accessibilityLabel={m.label}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={styles.modeToggleIcon}>{m.icon}</Text>
                <Text style={[styles.modeToggleText, active && styles.modeToggleTextActive]}>{m.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {mode === 'matches' ? (
        <>
          {groupChats.length > 0 && (
            <View style={styles.groupChatsRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
                {groupChats.map((chat) => (
                  <TouchableOpacity
                    key={`${chat.kind}-${chat.id}`}
                    style={styles.groupChatChip}
                    onPress={() => navigation.navigate(
                      chat.kind === 'gathering' ? 'GatheringChat' : 'CommunityChat',
                      chat.kind === 'gathering'
                        ? { gatheringId: chat.id, gatheringTitle: chat.title }
                        : { communityId: chat.id, communityName: chat.title }
                    )}
                    onLongPress={chat.kind === 'gathering' ? () => hideGatheringChat(chat) : undefined}
                    activeOpacity={0.85}
                    accessibilityLabel={
                      chat.kind === 'gathering'
                        ? `Open ${chat.title} group chat${chat.isPast ? ', this gathering already happened' : ''}. Long press to hide.`
                        : `Open ${chat.title} group chat`
                    }
                    accessibilityRole="button"
                  >
                    <Text style={styles.groupChatChipIcon}>{chat.kind === 'gathering' ? '🎉' : '🏘️'}</Text>
                    <Text style={styles.groupChatChipText} numberOfLines={1}>{chat.title} Chat</Text>
                    {chat.isPast && <Text style={styles.groupChatChipPast}>Past</Text>}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <MatchesScreen navigation={navigation} route={route} />
          </View>
        </>
      ) : (
        <View style={{ flex: 1 }}>
          <FriendsScreen navigation={navigation} />
        </View>
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  modeToggleRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  modeToggleButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1.5,
    borderColor: colors.border, paddingVertical: spacing.sm + 2, gap: 6,
  },
  modeToggleButtonActive: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  modeToggleIcon: { fontSize: 16 },
  modeToggleText: { color: colors.textSecondary, fontWeight: '700', fontSize: 14 },
  modeToggleTextActive: { color: colors.primary },
  groupChatsRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  groupChatChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, maxWidth: 160,
  },
  groupChatChipIcon: { fontSize: 14, marginRight: 4 },
  groupChatChipText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13, flexShrink: 1 },
  groupChatChipPast: {
    color: colors.textTertiary, fontSize: 10, fontWeight: '700', textTransform: 'uppercase',
    marginLeft: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full,
    paddingHorizontal: 6, paddingVertical: 1,
  },
});
