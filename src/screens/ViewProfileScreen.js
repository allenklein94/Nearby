import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, FlatList, Dimensions } from 'react-native';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import { getExtraPhotos } from '../services/extraPhotos';
import { BASICS_FIELDS } from '../constants/basicsFields';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const { width } = Dimensions.get('window');
const NEW_HERE_DAYS = 7;

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

export default function ViewProfileScreen({ route }) {
  const { userId } = route.params;
  const { colors } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors);
  const [profile, setProfile] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

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
            renderItem={({ item }) => (
              <Image source={{ uri: item.signedUrl }} style={[styles.photo, { width }]} />
            )}
          />
        ) : (
          <View style={[styles.photo, { width, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' }]}>
            <Text style={styles.emptyText}>{t('viewProfile.noPhotos')}</Text>
          </View>
        )}

        {photos.length > 1 && (
          <View style={styles.dotsRow}>
            {photos.map((_, i) => (
              <View key={i} style={[styles.dot, i === activePhotoIndex && styles.dotActive]} />
            ))}
          </View>
        )}

        <View style={styles.content}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>
              {profile.display_name}{age ? `, ${age}` : ''}
            </Text>
          </View>

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
            <View key={i} style={styles.promptCard}>
              <Text style={styles.promptQuestion}>{prompt.question}</Text>
              <Text style={styles.promptAnswer}>{prompt.answer}</Text>
            </View>
          ))}

          {profile.interests?.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>{t('viewProfile.interests')}</Text>
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
              <Text style={styles.sectionLabel}>{t('viewProfile.details')}</Text>
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
              <Text style={styles.sectionLabel}>{t('viewProfile.basics')}</Text>
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
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  photo: { height: 420, backgroundColor: colors.surfaceElevated },
  content: { padding: spacing.lg },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.xs },
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