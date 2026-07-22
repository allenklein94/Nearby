import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Image, RefreshControl, Alert } from 'react-native';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import { getSeenMatchIds, markMatchesSeen } from '../services/matchCelebration';
import { getPendingCheckIns, respondToCheckIn, buildShareMessage } from '../services/dateSafety';
import MatchCelebrationModal from '../components/MatchCelebrationModal';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';
import { Share } from 'react-native';

export default function MatchesScreen({ navigation }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors);
  const [matches, setMatches] = useState([]);
  const [myUserId, setMyUserId] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [celebrationMatch, setCelebrationMatch] = useState(null);
  const [myPhotoUrl, setMyPhotoUrl] = useState(null);

  const load = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    setMyUserId(myId);

    const { data, error } = await supabase
      .from('matches')
      .select('id, user_a, user_b, matched_at, a:profiles!matches_user_a_fkey(id, display_name, photo_url), b:profiles!matches_user_b_fkey(id, display_name, photo_url)')
      .order('matched_at', { ascending: false });

    if (!error) {
      setMatches(data);

      const urlEntries = await Promise.all(
        data.map(async (m) => {
          const other = m.user_a === myId ? m.b : m.a;
          if (!other?.photo_url) return [m.id, null];
          const url = await getSignedPhotoUrl(other.photo_url);
          return [m.id, url];
        })
      );
      setPhotoUrls(Object.fromEntries(urlEntries));

      const seenIds = await getSeenMatchIds();
      const isFirstRunEver = seenIds.length === 0 && data.length > 0;
      const newMatch = isFirstRunEver ? null : data.find((m) => !seenIds.includes(m.id));

      if (newMatch) {
        const { data: myProfile } = await supabase.from('profiles').select('photo_url').eq('id', myId).single();
        if (myProfile?.photo_url) {
          const myUrl = await getSignedPhotoUrl(myProfile.photo_url);
          setMyPhotoUrl(myUrl);
        }
        setCelebrationMatch(newMatch);
      }

      await markMatchesSeen(data.map((m) => m.id));
    }

    await checkPendingCheckIns();
  }, []);

  async function checkPendingCheckIns() {
    const pending = await getPendingCheckIns();
    if (pending.length === 0) return;

    // Only prompt for one at a time — if there are several, the rest
    // will surface again next time the screen loads.
    const checkin = pending[0];
    const match = checkin.matches;
    const otherName = match ? (match.a?.display_name ?? match.b?.display_name) : 'your date';

    Alert.alert(
      'How did your date go?',
      `Checking in on your plans with ${otherName}.`,
      [
        {
          text: "I'm safe 👍",
          onPress: () => respondToCheckIn(checkin.id, 'safe'),
        },
        {
          text: 'Something felt wrong',
          style: 'destructive',
          onPress: () => handleSomethingWrong(checkin, otherName),
        },
      ]
    );
  }

  function handleSomethingWrong(checkin, otherName) {
    Alert.alert(
      "We're here to help",
      'If you're in immediate danger, please contact local emergency services right away.',
      [
        {
          text: 'Message my check-in contact',
          onPress: async () => {
            await Share.share({ message: `Update: my date with ${otherName} didn't go well. Checking in — please reach out.` });
            respondToCheckIn(checkin.id, 'help_needed');
          },
        },
        {
          text: 'Report or Block',
          onPress: () => {
            respondToCheckIn(checkin.id, 'help_needed');
            navigation.navigate('Chat', { matchId: checkin.match_id });
          },
        },
        { text: 'Dismiss', style: 'cancel', onPress: () => respondToCheckIn(checkin.id, 'help_needed') },
      ]
    );
  }

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function otherPersonFor(match) {
    return match.user_a === myUserId ? match.b : match.a;
  }

  function handleSendMessage() {
    const match = celebrationMatch;
    setCelebrationMatch(null);
    if (match) {
      navigation.navigate('Chat', { matchId: match.id });
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('matches.title')}</Text>
      </View>
      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>✨</Text>
            <Text style={styles.emptyText}>{t('matches.emptyText')}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const other = otherPersonFor(item);
          return (
            <View style={styles.card}>
              <TouchableOpacity
                onPress={() => navigation.navigate('ViewProfile', { userId: other?.id })}
                activeOpacity={0.85}
              >
                {photoUrls[item.id] ? (
                  <Image source={{ uri: photoUrls[item.id] }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cardInfo}
                onPress={() => navigation.navigate('Chat', { matchId: item.id })}
                activeOpacity={0.85}
              >
                <Text style={styles.name}>{other?.display_name}</Text>
                <Text style={styles.sub}>{t('matches.tapToChat')}</Text>
              </TouchableOpacity>
              <Text style={styles.chevron}>›</Text>
            </View>
          );
        }}
      />

      <MatchCelebrationModal
        visible={!!celebrationMatch}
        myPhotoUrl={myPhotoUrl}
        theirPhotoUrl={celebrationMatch ? photoUrls[celebrationMatch.id] : null}
        theirName={celebrationMatch ? otherPersonFor(celebrationMatch)?.display_name : ''}
        onSendMessage={handleSendMessage}
        onDismiss={() => setCelebrationMatch(null)}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: { width: 52, height: 52, borderRadius: radius.md, marginRight: spacing.md },
  avatarPlaceholder: { backgroundColor: colors.surfaceElevated },
  cardInfo: { flex: 1 },
  name: { ...typography.bodyBold, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  chevron: { color: colors.textTertiary, fontSize: 22, fontWeight: '700' },
});