import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import MatchesScreen from './MatchesScreen';
import { getMyGatheringChats } from '../services/gatherings';
import { getMyCommunities } from '../services/communities';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

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
export default function MessagesScreen({ navigation, route }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [groupChats, setGroupChats] = useState([]);

  const loadGroupChats = useCallback(async () => {
    try {
      const [gatheringChats, communities] = await Promise.all([getMyGatheringChats(), getMyCommunities()]);
      setGroupChats([
        ...gatheringChats.map((g) => ({ kind: 'gathering', id: g.id, title: g.title })),
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.friendsLink}
          onPress={() => navigation.navigate('Friends')}
          accessibilityLabel="Friends"
          accessibilityRole="button"
        >
          <Text style={styles.friendsLinkText}>🤝 Friends</Text>
        </TouchableOpacity>
      </View>
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
                activeOpacity={0.85}
                accessibilityLabel={`Open ${chat.title} group chat`}
                accessibilityRole="button"
              >
                <Text style={styles.groupChatChipIcon}>{chat.kind === 'gathering' ? '🎉' : '🏘️'}</Text>
                <Text style={styles.groupChatChipText} numberOfLines={1}>{chat.title} Chat</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <MatchesScreen navigation={navigation} route={route} />
      </View>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  friendsLink: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
  },
  friendsLinkText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  groupChatsRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  groupChatChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, maxWidth: 160,
  },
  groupChatChipIcon: { fontSize: 14, marginRight: 4 },
  groupChatChipText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
});
