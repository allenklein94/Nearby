import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, FlatList, Dimensions, TouchableOpacity } from 'react-native';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import { getExtraPhotos } from '../services/extraPhotos';
import { generateCompatibilityReport } from '../services/compatibility';
import { getRecentIntentionChangeCount } from '../services/intentionHistory';
import { intentionLabel } from '../constants/intentionOptions';
import { BASICS_FIELDS } from '../constants/basicsFields';
import CompatibilityReportModal from '../components/CompatibilityReportModal';
import ReportBlockModal from '../components/ReportBlockModal';
import PhotoLightbox from '../components/PhotoLightbox';
import { sendFriendRequest, getMutualFriends } from '../services/friends';
import { getHostStats, getHostReputation } from '../services/gatherings';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const { width } = Dimensions.get('window');
const NEW_HERE_DAYS = 7;
const FREQUENT_CHANGE_THRESHOLD = 3;

function calculateAge(birthdateString) {
  if (!birthdateString) return null;
  const birthdate = new Date(birthdateString);
  const today = new Date();
  let age = today.getFullYear() - birthdate.getFullYear();
  const monthDiff = today.getMonth() - birthdate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthdate.getDate())) {
    age--;
  }
  return age;
}

function isNewHere(createdAt) {
  if (!createdAt) return false;
  const daysSinceJoined = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceJoined <= NEW_HERE_DAYS;
}

export default function ViewProfileScreen({ route, navigation }) {
  const { userId } = route.params;
  const { colors } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors);
  const [profile, setProfile] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [compatibilityReport, setCompatibilityReport] = useState(null);
  const [compatModalVisible, setCompatModalVisible] = useState(false);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [isOwnProfile, setIsOwnProfile] = useState(false);
  const [intentionChangeCount, setIntentionChangeCount] = useState(0);
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxPhotoUri, setLightboxPhotoUri] = useState(null);
  const [sendingFriendRequest, setSendingFriendRequest] = useState(false);
  const [friendRequestSent, setFriendRequestSent] = useState(false);
  cconst [mutualFriends, setMutualFriends] = useState([]);
  const [hostStats, setHostStats] = useState(null);
  const [hostReputation, setHostReputation] = useState(null);
  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    if (myId && myId !== userId) {
      getMutualFriends(userId).then(setMutualFriends);
      getHostStats(userId).then(setHostStats);
      getHostReputation(userId).then(setHostReputation);
      const { data: blockedByMe } = await supabase
        .from('blocks')
        .select('id')
        .eq('blocker_id', myId)
        .eq('blocked_id', userId)
        .maybeSingle();
      const { data: blockedMe } = await supabase
        .from('blocks')
        .select('id')
        .eq('blocker_id', userId)
        .eq('blocked_id', myId)
        .maybeSingle();

      if (blockedByMe || blockedMe) {
        setProfile(null);
        setLoading(false);
        return;
      }
    }

    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, bio, photo_url, interests, basics, prompts, is_premium, birthdate, photo_verified, created_at, pronouns, gender, gender_hidden, sexual_orientation, ethnicity, ethnicity_hidden, relationship_intention, favorite_tracks')
      .eq('id', userId)
      .single();

    let mainPhotoUrl = null;
    if (data?.photo_url) {
      mainPhotoUrl = await getSignedPhotoUrl(data.photo_url);
    }

    const extras = await getExtraPhotos(userId);
    const verifiedExtras = extras.filter((p) => p.photo_verified && p.signedUrl);

    const allPhotos = [
      ...(mainPhotoUrl ? [{ id: 'main', signedUrl: mainPhotoUrl }] : []),
      ...verifiedExtras,
    ];

    setProfile(data);
    setPhotos(allPhotos);
    setLoading(false);

    if (data?.relationship_intention) {
      const count = await getRecentIntentionChangeCount(userId);
      setIntentionChangeCount(count);
    }

    const ownProfile = myId === userId;
    setIsOwnProfile(ownProfile);

    if (myId && !ownProfile && data) {
      const { data: myProfile } = await supabase.from('profiles').select('interests, basics, favorite_tracks').eq('id', myId).single();
      const report = generateCompatibilityReport(myProfile, data);
      setCompatibilityReport(report);
    }

    navigation.setOptions({
      headerRight: () =>
        !ownProfile ? (
          <TouchableOpacity
            onPress={() => setReportModalVisible(true)}
            style={{ paddingHorizontal: spacing.sm }}
            accessibilityLabel={`Report or block ${data?.display_name || 'this person'}`}
            accessibilityRole="button"
          >
            <Text style={{ color: colors.primary, fontSize: 20 }}>⋯</Text>
          </TouchableOpacity>
        ) : null,
    });
  }

  async function handleAddFriend() {
    setSendingFriendRequest(true);
    try {
      await sendFriendRequest(userId);
      setFriendRequestSent(true);
      Alert.alert('Friend request sent', `${profile.display_name} will see your request.`);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSendingFriendRequest(false);
  }

  function openLightbox(uri) {
    setLightboxPhotoUri(uri);
    setLightboxVisible(true);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.emptyText}>Profile not available.</Text>
      </SafeAreaView>
    );
  }

  const age = calculateAge(profile.birthdate);

  const badges = [
    profile.photo_verified && { icon: '✓', label: 'Verified', color: colors.success },
    profile.is_premium && { icon: '✨', label: 'Premium', color: colors.primary },
    isNewHere(profile.created_at) && { icon: '🌱', label: 'New Here', color: colors.textSecondary },
  ].filter(Boolean);

  const details = [
    profile.pronouns && { label: 'Pronouns', value: profile.pronouns },
    profile.gender && !profile.gender_hidden && { label: 'Gender', value: profile.gender },
    profile.sexual_orientation && { label: 'Orientation', value: profile.sexual_orientation },
    profile.ethnicity && !profile.ethnicity_hidden && { label: 'Ethnicity', value: profile.ethnicity },
  ].filter(Boolean);

  const filledDetails = BASICS_FIELDS
    .filter((f) => f.type === 'text')
    .map((field) => ({ icon: field.icon, value: profile.basics?.[field.key] }))
    .filter((f) => f.value);

  const filledBasics = BASICS_FIELDS
    .filter((f) => f.type === 'select')
    .map((field) => ({ icon: field.icon, value: profile.basics?.[field.key] }))
    .filter((f) => f.value);

  const prompts = profile.prompts || [];

  function compatibilityColor(score) {
    if (score >= 70) return colors.success;
    if (score >= 40) return colors.primary;
    return colors.textTertiary;
  }

  const intentionText = intentionLabel(profile.relationship_intention);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        {photos.length > 0 ? (
          <FlatList
            data={photos}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id}
            onMomentumScrollEnd={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.x / width);
              setActivePhotoIndex(index);
            }}
            renderItem={({ item, index }) => (
              <TouchableOpacity
                activeOpacity={0.95}
                onPress={() => openLightbox(item.signedUrl)}
                accessibilityLabel={`${profile.display_name}'s photo ${index + 1} of ${photos.length}, tap to view full screen`}
                accessibilityRole="button"
              >
                <Image
                  source={{ uri: item.signedUrl }}
                  style={[styles.photo, { width }]}
                />
              </TouchableOpacity>
            )}
          />
        ) : (
          <View style={[styles.photo, { width, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' }]}>
            <Text style={styles.emptyText}>{t('viewProfile.noPhotos')}</Text>
          </View>
        )}

        {photos.length > 1 && (
          <View style={styles.dotsRow} accessible={false}>
            {photos.map((_, i) => (
              <View key={i} style={[styles.dot, i === activePhotoIndex && styles.dotActive]} />
            ))}
          </View>
        )}

        <View style={styles.content}>
          <View style={styles.nameRow}>
            <Text style={styles.name} accessibilityRole="header">
              {profile.display_name}{age ? `, ${age}` : ''}
            </Text>
            {compatibilityReport?.score !== null && compatibilityReport?.score !== undefined && (
              <TouchableOpacity
                style={[styles.compatBadge, { borderColor: compatibilityColor(compatibilityReport.score) }]}
                onPress={() => setCompatModalVisible(true)}
                activeOpacity={0.7}
                accessibilityLabel={`${compatibilityReport.score} percent match, view why`}
                accessibilityRole="button"
              >
                <Text style={[styles.compatText, { color: compatibilityColor(compatibilityReport.score) }]}>
                  {compatibilityReport.score}% Match · Why?
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {!isOwnProfile && (
            <TouchableOpacity
              style={[styles.addFriendButton, friendRequestSent && styles.addFriendButtonSent]}
              onPress={handleAddFriend}
              disabled={sendingFriendRequest || friendRequestSent}
              activeOpacity={0.85}
              accessibilityLabel={friendRequestSent ? 'Friend request sent' : `Add ${profile.display_name} as a friend`}
              accessibilityRole="button"
            >
              <Text style={styles.addFriendButtonText}>
                {friendRequestSent ? '✓ Request Sent' : '🤝 Add Friend'}
              </Text>
            </TouchableOpacity>
          )}

          {mutualFriends.length > 0 && (
            <Text style={styles.mutualFriendsText}>
              🤝 {mutualFriends.length === 1
                ? `You both know ${mutualFriends[0].display_name}`
                : mutualFriends.length === 2
                  ? `You both know ${mutualFriends[0].display_name} and ${mutualFriends[1].display_name}`
                  : `You both know ${mutualFriends[0].display_name} and ${mutualFriends.length - 1} others`}
            </Text>
          )}

          {hostStats && hostStats.gatherings_hosted > 0 && (
            <Text style={styles.mutualFriendsText}>
              🎉 Hosted {hostStats.gatherings_hosted} gathering{hostStats.gatherings_hosted === 1 ? '' : 's'}, averaging {Math.round(hostStats.avg_attendance)} attendee{Math.round(hostStats.avg_attendance) === 1 ? '' : 's'}
            </Text>
          )}

          {hostReputation && hostReputation.feedback_count > 0 && (
            <Text style={styles.mutualFriendsText}>
              ⭐ {hostReputation.welcoming_pct}% said welcoming · {hostReputation.would_return_pct}% would attend again ({hostReputation.feedback_count} review{hostReputation.feedback_count === 1 ? '' : 's'})
            </Text>
          )}

          {intentionText && (
            <View style={styles.intentionCard}>
              <Text style={styles.intentionText}>Looking for: {intentionText}</Text>
              {intentionChangeCount >= FREQUENT_CHANGE_THRESHOLD && (
                <Text style={styles.intentionChangeText}>
                  Changed {intentionChangeCount}x in the last 30 days
                </Text>
              )}
            </View>
          )}

          {badges.length > 0 && (
            <View style={styles.badgesRow}>
              {badges.map((badge) => (
                <View key={badge.label} style={[styles.badge, { borderColor: badge.color }]}>
                  <Text style={[styles.badgeText, { color: badge.color }]}>{badge.icon} {badge.label}</Text>
                </View>
              ))}
            </View>
          )}

          {details.length > 0 && (
            <View style={styles.detailsRow}>
              {details.map((d) => (
                <View key={d.label} style={styles.detailChip}>
                  <Text style={styles.detailChipText}>{d.value}</Text>
                </View>
              ))}
            </View>
          )}

          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

          {prompts.length > 0 && prompts.map((prompt, i) => (
            <View key={i} style={styles.promptCard} accessibilityLabel={`${prompt.question}: ${prompt.answer}`}>
              <Text style={styles.promptQuestion}>{prompt.question}</Text>
              <Text style={styles.promptAnswer}>{prompt.answer}</Text>
            </View>
          ))}

          {profile.favorite_tracks?.length > 0 && (
            <>
              <Text style={styles.sectionLabel} accessibilityRole="header">🎵 Music</Text>
              {profile.favorite_tracks.map((track) => (
                <View key={track.id} style={styles.trackRowDisplay}>
                  {track.albumArt ? (
                    <Image source={{ uri: track.albumArt }} style={styles.trackArtDisplay} />
                  ) : (
                    <View style={[styles.trackArtDisplay, styles.trackArtPlaceholder]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.trackNameDisplay} numberOfLines={1}>{track.name}</Text>
                    <Text style={styles.trackArtistDisplay} numberOfLines={1}>{track.artist}</Text>
                  </View>
                </View>
              ))}
            </>
          )}

          {profile.interests?.length > 0 && (
            <>
              <Text style={styles.sectionLabel} accessibilityRole="header">{t('viewProfile.interests')}</Text>
              <View style={styles.chipsWrap}>
                {profile.interests.map((interest) => (
                  <View key={interest} style={styles.interestChip}>
                    <Text style={styles.interestChipText}>{interest}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {filledDetails.length > 0 && (
            <>
              <Text style={styles.sectionLabel} accessibilityRole="header">{t('viewProfile.details')}</Text>
              <View style={styles.chipsWrap}>
                {filledDetails.map((item, i) => (
                  <View key={i} style={styles.basicChip}>
                    <Text style={styles.basicChipText}>{item.icon} {item.value}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {filledBasics.length > 0 && (
            <>
              <Text style={styles.sectionLabel} accessibilityRole="header">{t('viewProfile.basics')}</Text>
              <View style={styles.chipsWrap}>
                {filledBasics.map((item, i) => (
                  <View key={i} style={styles.basicChip}>
                    <Text style={styles.basicChipText}>{item.icon} {item.value}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>

      <CompatibilityReportModal
        visible={compatModalVisible}
        onClose={() => setCompatModalVisible(false)}
        report={compatibilityReport}
        theirName={profile.display_name}
      />

      {!isOwnProfile && (
        <ReportBlockModal
          visible={reportModalVisible}
          onClose={() => setReportModalVisible(false)}
          onBlocked={() => {
            setReportModalVisible(false);
            navigation.goBack();
          }}
          reportedUserId={userId}
          reportedUserName={profile.display_name}
        />
      )}

      <PhotoLightbox
        visible={lightboxVisible}
        photoUri={lightboxPhotoUri}
        onClose={() => setLightboxVisible(false)}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  photo: { height: 420, backgroundColor: colors.surfaceElevated },
  content: { padding: spacing.lg },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  name: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.xs },
  compatBadge: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4, marginBottom: spacing.xs },
  compatText: { fontSize: 12, fontWeight: '700' },
  intentionCard: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.md, padding: spacing.sm,
    marginBottom: spacing.md, alignSelf: 'flex-start',
  },
  intentionText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  intentionChangeText: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  badge: {
    borderWidth: 1, borderRadius: radius.full,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  detailsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  detailChip: {
    backgroundColor: colors.surfaceElevated, paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.full,
  },
  detailChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  bio: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  promptCard: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  promptQuestion: { ...typography.caption, color: colors.textTertiary, marginBottom: 4 },
  promptAnswer: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 16, lineHeight: 22 },
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.lg, textTransform: 'uppercase', letterSpacing: 0.5 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  interestChip: {
    backgroundColor: colors.primaryMuted, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  interestChipText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  addFriendButton: {
    alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.primary,
    borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    marginBottom: spacing.md,
  },
  addFriendButtonSent: { borderColor: colors.success },
  addFriendButtonText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  mutualFriendsText: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.sm },
  emptyText: { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xxl },
  trackRowDisplay: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  trackArtDisplay: { width: 44, height: 44, borderRadius: radius.sm, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  trackArtPlaceholder: {},
  trackNameDisplay: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  trackArtistDisplay: { color: colors.textTertiary, fontSize: 12 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.sm, gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.primary, width: 16 },
  basicChip: {
    backgroundColor: colors.surfaceElevated, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
  },
  basicChipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
});