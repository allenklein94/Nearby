import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, FlatList, Dimensions } from 'react-native';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import { getExtraPhotos } from '../services/extraPhotos';
import { colors, typography, spacing, radius } from '../theme';

const { width } = Dimensions.get('window');

export default function ViewProfileScreen({ route }) {
  const { userId } = route.params;
  const [profile, setProfile] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);

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

  const details = [
    profile.pronouns && { label: 'Pronouns', value: profile.pronouns },
    profile.gender && { label: 'Gender', value: profile.gender },
    profile.sexual_orientation && { label: 'Orientation', value: profile.sexual_orientation },
  ].filter(Boolean);

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
            renderItem={({ item }) => (
              <Image source={{ uri: item.signedUrl }} style={[styles.photo, { width }]} />
            )}
          />
        ) : (
          <View style={[styles.photo, { width, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' }]}>
            <Text style={styles.emptyText}>No photos yet</Text>
          </View>
        )}

        <View style={styles.content}>
          <Text style={styles.name}>{profile.display_name}</Text>

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
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  interestChip: {
    backgroundColor: colors.primaryMuted, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  interestChipText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  emptyText: { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xxl },
});