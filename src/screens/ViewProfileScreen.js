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

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();

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

    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    const ownProfile = myId === userId;
    setIsOwnProfile(ownProfile);

    if (myId && !ownProfile && data) {
      const { data: myProfile } = await supabase.from('profiles').select('interests, basics').eq('id', myId).single();
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
              <Image
                source={{ uri: item.signedUrl }}
                style={[styles.photo, { width }]}
                accessibilityLabel={`${profile.display_name}'s photo ${index + 1} of ${photos.length}`}
              />
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
  emptyText: { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xxl },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.sm, gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.primary, width: 16 },
  basicChip: {
    backgroundColor: colors.surfaceElevated, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
  },
  basicChipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
});