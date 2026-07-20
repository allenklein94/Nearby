import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, FlatList, Dimensions } from 'react-native';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import { getExtraPhotos } from '../services/extraPhotos';
import { BASICS_FIELDS } from '../constants/basicsFields';
import { colors, typography, spacing, radius } from '../theme';

const { width } = Dimensions.get('window');

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

export default function ViewProfileScreen({ route }) {
  const { userId } = route.params;
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

  const details = [
    profile.pronouns && { label: 'Pronouns', value: profile.pronouns },
    profile.gender && { label: 'Gender', value: profile.gender },
    profile.sexual_orientation && { label: 'Orientation', value: profile.sexual_orientation },
  ].filter(Boolean);

  // Only show Basics fields the person actually filled in — blank
  // fields are simply omitted, never shown as empty.
  const filledBasics = BASICS_FIELDS
    .map((field) => ({ label: field.label, value: profile.basics?.[field.key] }))
    .filter((f) => f.value);

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
            <Text style={styles.emptyText}>No photos yet</Text>
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
          <Text style={styles.name}>
            {profile.display_name}{age ? `, ${age}` : ''}
          </Text>

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

          {profile.interests?.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Interests</Text>
              <View style={styles.chipsWrap}>
                {profile.interests.map((interest) => (
                  <View key={interest} style={styles.interestChip}>
                    <Text style={styles.interestChipText}>{interest}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {filledBasics.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Basics</Text>
              <View style={styles.basicsCard}>
                {filledBasics.map((item, i) => (
                  <View key={item.label} style={[styles.basicRow, i > 0 && styles.basicRowBorder]}>
                    <Text style={styles.basicLabel}>{item.label}</Text>
                    <Text style={styles.basicValue}>{item.value}</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  photo: { height: 420, backgroundColor: colors.surfaceElevated },
  content: { padding: spacing.lg },
  name: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.sm },
  detailsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  detailChip: {
    backgroundColor: colors.surfaceElevated, paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.full,
  },
  detailChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  bio: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
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
  basicsCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, overflow: 'hidden',
  },
  basicRow: { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md },
  basicRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  basicLabel: { color: colors.textTertiary, fontSize: 14 },
  basicValue: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
});