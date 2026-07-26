import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Image, ActivityIndicator } from 'react-native';
import { takeVerificationPhoto, submitVerification, getMyVerificationStatus } from '../services/idVerification';
import { supabase } from '../services/supabase';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

export default function IdVerificationScreen() {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [userId, setUserId] = useState(null);
  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [selfieAsset, setSelfieAsset] = useState(null);
  const [idAsset, setIdAsset] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: sessionData } = await supabase.auth.getSession();
    const id = sessionData?.session?.user?.id;
    setUserId(id);
    if (id) {
      const s = await getMyVerificationStatus(id);
      setStatus(s);
    }
    setLoadingStatus(false);
  }

  async function handleTakeSelfie() {
    try {
      const asset = await takeVerificationPhoto();
      if (asset) setSelfieAsset(asset);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleTakeIdPhoto() {
    try {
      const asset = await takeVerificationPhoto();
      if (asset) setIdAsset(asset);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleSubmit() {
    if (!selfieAsset || !idAsset) {
      return Alert.alert('Both photos needed', 'Take both a selfie and a photo of your ID before submitting.');
    }

    setSubmitting(true);
    try {
      await submitVerification(userId, selfieAsset, idAsset);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      posthog.capture('id_verification_submitted');
      Alert.alert('Submitted', "We'll review your submission — this usually takes a day or two.");
      setSelfieAsset(null);
      setIdAsset(null);
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSubmitting(false);
  }

  if (loadingStatus) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  if (status?.status === 'pending') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.statusState}>
          <Text style={styles.statusEmoji}>⏳</Text>
          <Text style={styles.statusTitle}>{t('idVerification.underReview')}</Text>
          <Text style={styles.statusText}>We're reviewing your submission — this usually takes a day or two. We'll let you know once it's done.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (status?.status === 'approved') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.statusState}>
          <Text style={styles.statusEmoji}>✓</Text>
          <Text style={styles.statusTitle}>{t('idVerification.verified')}</Text>
          <Text style={styles.statusText}>Your profile now shows a verified badge, and you'll appear when others filter for verified profiles.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.headerTitle} accessibilityRole="header">{t('idVerification.title')}</Text>
        <Text style={styles.headerSubtitle}>
          {t('idVerification.subtitle')}
        </Text>

        {status?.status === 'rejected' && (
          <View style={styles.rejectedBanner}>
            <Text style={styles.rejectedText}>Your last submission wasn't approved. You can try again below.</Text>
          </View>
        )}

        <Text style={styles.stepLabel}>1. {t('idVerification.takeSelfie')}</Text>
        {selfieAsset ? (
          <Image source={{ uri: selfieAsset.uri }} style={styles.preview} />
        ) : (
          <TouchableOpacity style={styles.captureButton} onPress={handleTakeSelfie} activeOpacity={0.85} accessibilityLabel={t('idVerification.takeSelfie')} accessibilityRole="button">
            <Text style={styles.captureButtonText}>{t('idVerification.takeSelfie')}</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.stepLabel}>2. {t('idVerification.takeIdPhoto')}</Text>
        {idAsset ? (
          <Image source={{ uri: idAsset.uri }} style={styles.preview} />
        ) : (
          <TouchableOpacity style={styles.captureButton} onPress={handleTakeIdPhoto} activeOpacity={0.85} accessibilityLabel={t('idVerification.takeIdPhoto')} accessibilityRole="button">
            <Text style={styles.captureButtonText}>{t('idVerification.takeIdPhoto')}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.submitButton}
          onPress={handleSubmit}
          disabled={submitting || !selfieAsset || !idAsset}
          activeOpacity={0.85}
          accessibilityLabel={submitting ? 'Submitting' : t('idVerification.submitButton')}
          accessibilityRole="button"
        >
          <Text style={styles.submitButtonText}>{submitting ? 'Submitting...' : t('idVerification.submitButton')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  rejectedBanner: { backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
  rejectedText: { color: colors.textSecondary, fontSize: 13 },
  stepLabel: { ...typography.bodyBold, color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  captureButton: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  captureButtonText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  preview: { width: '100%', height: 200, borderRadius: radius.lg, backgroundColor: colors.surfaceElevated },
  submitButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', marginTop: spacing.xl, ...shadow.button },
  submitButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  statusState: { alignItems: 'center', padding: spacing.xl, paddingTop: spacing.xxl },
  statusEmoji: { fontSize: 48, marginBottom: spacing.md },
  statusTitle: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.sm },
  statusText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
});