import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, Image } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

export default function AdminVerificationScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [submissions, setSubmissions] = useState([]);
  const [imageUrls, setImageUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data, error } = await supabase
      .from('id_verification_submissions')
      .select('*, profiles(display_name)')
      .eq('status', 'pending')
      .order('submitted_at', { ascending: true });

    if (error) {
      console.error('load pending verifications error', error);
      setLoading(false);
      return;
    }

    setSubmissions(data ?? []);

    const urlEntries = await Promise.all(
      (data ?? []).flatMap((s) => [
        (async () => {
          const { data: url } = await supabase.storage.from('id-verification').createSignedUrl(s.selfie_path, 3600);
          return [`${s.id}-selfie`, url?.signedUrl];
        })(),
        (async () => {
          const { data: url } = await supabase.storage.from('id-verification').createSignedUrl(s.id_photo_path, 3600);
          return [`${s.id}-id`, url?.signedUrl];
        })(),
      ])
    );
    setImageUrls(Object.fromEntries(urlEntries.filter(([, v]) => v)));
    setLoading(false);
  }

  async function handleDecision(submission, approved) {
    setProcessingId(submission.id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const reviewerId = sessionData?.session?.user?.id;

      const { error: updateError } = await supabase
        .from('id_verification_submissions')
        .update({ status: approved ? 'approved' : 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: reviewerId })
        .eq('id', submission.id);

      if (updateError) throw updateError;

      if (approved) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({ photo_verified: true })
          .eq('id', submission.user_id);
        if (profileError) throw profileError;
      }

      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setProcessingId(null);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.headerTitle} accessibilityRole="header">Pending Verifications</Text>

        {submissions.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No pending submissions.</Text>
          </View>
        )}

        {submissions.map((s) => (
          <View key={s.id} style={styles.card}>
            <Text style={styles.name}>{s.profiles?.display_name}</Text>
            <View style={styles.imagesRow}>
              {imageUrls[`${s.id}-selfie`] && (
                <View style={styles.imageBlock}>
                  <Text style={styles.imageLabel}>Selfie</Text>
                  <Image source={{ uri: imageUrls[`${s.id}-selfie`] }} style={styles.image} />
                </View>
              )}
              {imageUrls[`${s.id}-id`] && (
                <View style={styles.imageBlock}>
                  <Text style={styles.imageLabel}>ID</Text>
                  <Image source={{ uri: imageUrls[`${s.id}-id`] }} style={styles.image} />
                </View>
              )}
            </View>
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.rejectButton}
                onPress={() => handleDecision(s, false)}
                disabled={processingId === s.id}
                accessibilityLabel={`Reject ${s.profiles?.display_name}'s verification`}
                accessibilityRole="button"
              >
                <Text style={styles.rejectButtonText}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.approveButton}
                onPress={() => handleDecision(s, true)}
                disabled={processingId === s.id}
                accessibilityLabel={`Approve ${s.profiles?.display_name}'s verification`}
                accessibilityRole="button"
              >
                <Text style={styles.approveButtonText}>Approve</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.lg },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyText: { color: colors.textTertiary },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  name: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 16, marginBottom: spacing.sm },
  imagesRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  imageBlock: { flex: 1 },
  imageLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs },
  image: { width: '100%', height: 150, borderRadius: radius.md, backgroundColor: colors.surfaceElevated },
  actionsRow: { flexDirection: 'row', gap: spacing.sm },
  rejectButton: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingVertical: 12, alignItems: 'center' },
  rejectButtonText: { color: colors.textSecondary, fontWeight: '700', fontSize: 14 },
  approveButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 12, alignItems: 'center' },
  approveButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});