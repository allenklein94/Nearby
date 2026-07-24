import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Image, RefreshControl, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import { getSeenMatchIds, markMatchesSeen } from '../services/matchCelebration';
import { getPendingCheckIns, respondToCheckIn } from '../services/dateSafety';
import { generateCompatibilityReport } from '../services/compatibility';
import MatchCelebrationModal from '../components/MatchCelebrationModal';
import CompatibilityReportModal from '../components/CompatibilityReportModal';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';
import { Share } from 'react-native';

function formatMatchedTime(iso) {
  if (!iso) return null;
  const then = new Date(iso);
  const diffMs = Date.now() - then.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const dateTimeStamp = then.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ', ' + then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  let relative;
  if (diffMins < 60) relative = 'Matched just now';
  else if (diffHours < 24) relative = `Matched ${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  else if (diffDays === 1) relative = 'Matched yesterday';
  else if (diffDays < 7) relative = `Matched ${diffDays} days ago`;
  else relative = null;

  return relative ? `${relative} (${dateTimeStamp})` : `Matched ${dateTimeStamp}`;
}

export default function MatchesScreen({ navigation }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors);
  const [matches, setMatches] = useState([]);
  const [myUserId, setMyUserId] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [celebrationMatch, setCelebrationMatch] = useState(null);
  const [myPhotoUrl, setMyPhotoUrl] = useState(null);
  const [compatModalReport, setCompatModalReport] = useState(null);
  const [compatModalName, setCompatModalName] = useState('');

  const load = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    setMyUserId(myId);

    const { data: mine } = await supabase.from('profiles').select('interests, basics').eq('id', myId).single();
    setMyProfile(mine);

    const { data, error } = await supabase
      .from('matches')
      .select('id, user_a, user_b, matched_at, source_gathering_id, gatherings(title), a:profiles!matches_user_a_fkey(id, display_name, photo_url, interests, basics), b:profiles!matches_user_b_fkey(id, display_name, photo_url, interests, basics)')
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

      const seenIds = await getSeenMatchIds(myId);
      const isFirstRunEver = seenIds.length === 0 && data.length > 0;
      const newMatch = isFirstRunEver ? null : data.find((m) => !seenIds.includes(m.id));

      if (newMatch) {
        const { data: myPhotoProfile } = await supabase.from('profiles').select('photo_url').eq('id', myId).single();
        if (myPhotoProfile?.photo_url) {
          const myUrl = await getSignedPhotoUrl(myPhotoProfile.photo_url);
          setMyPhotoUrl(myUrl);
        }
        setCelebrationMatch(newMatch);
      }

      await markMatchesSeen(myId, data.map((m) => m.id));
    }

    await checkPendingCheckIns();
  }, []);

  async function checkPendingCheckIns() {
    const pending = await getPendingCheckIns();
    if (pending.length === 0) return;

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
      "If you're in immediate danger, please contact local emergency services right away.",
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

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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

  function showCompatibilityReport(match) {
    const other = otherPersonFor(match);
    const report = generateCompatibilityReport(myProfile, other);
    setCompatModalReport(report);
    setCompatModalName(other?.display_name || '');
  }

  function compatibilityColor(score) {
    if (score >= 70) return colors.success;
    if (score >= 40) return colors.primary;
    return colors.textTertiary;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">{t('matches.title')}</Text>
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
          const report = generateCompatibilityReport(myProfile, other);
          const gatheringLabel = item.gatherings?.title ? `Met through ${item.gatherings.title}` : null;
          const matchedLabel = formatMatchedTime(item.matched_at);
          const subLabel = gatheringLabel ? `${gatheringLabel} · ${matchedLabel}` : matchedLabel || t('matches.tapToChat');
          return (
            <View style={styles.card}>
              <TouchableOpacity
                onPress={() => navigation.navigate('ViewProfile', { userId: other?.id })}
                activeOpacity={0.85}
                accessibilityLabel={`View ${other?.display_name}'s profile`}
                accessibilityRole="button"
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
                accessibilityLabel={`${other?.display_name}, ${subLabel}${report.score !== null ? `, ${report.score} percent compatible` : ''}`}
                accessibilityRole="button"
                accessibilityHint="Opens chat"
              >
                <View style={styles.nameRow}>
                  <Text style={styles.name}>{other?.display_name}</Text>
                  {report.score !== null && (
                    <TouchableOpacity
                      style={[styles.compatBadge, { borderColor: compatibilityColor(report.score) }]}
                      onPress={() => showCompatibilityReport(item)}
                      accessibilityLabel={`${report.score} percent compatible, view why`}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.compatText, { color: compatibilityColor(report.score) }]}>
                        {report.score}% · Why?
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.sub}>{subLabel}</Text>
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
        gatheringTitle={celebrationMatch?.gatherings?.title || null}
        onSendMessage={handleSendMessage}
        onDismiss={() => setCelebrationMatch(null)}
      />

      <CompatibilityReportModal
        visible={!!compatModalReport}
        onClose={() => setCompatModalReport(null)}
        report={compatModalReport}
        theirName={compatModalName}
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
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
  name: { ...typography.bodyBold, color: colors.textPrimary },
  compatBadge: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 6, paddingVertical: 1 },
  compatText: { fontSize: 10, fontWeight: '700' },
  sub: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  chevron: { color: colors.textTertiary, fontSize: 22, fontWeight: '700' },
});