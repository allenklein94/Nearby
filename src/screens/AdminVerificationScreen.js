import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, Image } from 'react-native';
import { supabase } from '../services/supabase';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

export default function AdminVerificationScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [submissions, setSubmissions] = useState([]);
  const [imageUrls, setImageUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [processingId, setProcessingId] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const { data, error } = await supabase
        .from('id_verification_submissions')
        .select('*, profiles(display_name)')
        .eq('status', 'pending')
        .order('submitted_at', { ascending: true });

      if (error) throw error;

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
      setLoadError(false);
    } catch (e) {
      console.error('load pending verifications error', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleDecision(submission, approved) {
    setProcessingId(submission.id);
    try {
      // Both the submission status and the submitter's own photo_verified
      // flag are set atomically server-side (admin_approve_id_verification) --
      // profiles has no client-updatable admin bypass, so a direct cross-user
      // update from here would silently affect 0 rows.
      const { error } = await supabase.rpc('admin_approve_id_verification', {
        submission_id_param: submission.id,
        approved,
      });
      if (error) throw error;

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
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading verification submissions...</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load verification submissions." onRetry={load} />
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