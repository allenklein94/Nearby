import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyBusinessPartnerRequest } from '../services/businessPartnerApply';
import { BUSINESS_CATEGORIES, FEATURE_OPTIONS } from './BusinessPartnerApplyScreen';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

const STATUS_COPY = {
  pending: {
    icon: '⏳',
    title: 'Application Pending',
    body: "We're reviewing your application. We'll let you know as soon as there's an update.",
  },
  approved: {
    icon: '🎉',
    title: "You're a Partner!",
    body: 'Your application was approved. Business Mode is unlocked.',
  },
  denied: {
    icon: '📋',
    title: 'Application Not Approved',
    body: "This application wasn't approved. You're welcome to submit a new one any time.",
  },
};

export default function MyBusinessApplicationScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await getMyBusinessPartnerRequest();
      setRequest(data);
    } catch (e) {
      // no-op: an applicant-facing status screen shouldn't surface a raw error
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!request) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No application on file yet.</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => navigation.navigate('BusinessPartnerApply')}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Apply to partner your business"
          >
            <Text style={styles.buttonText}>List Your Business</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const copy = STATUS_COPY[request.status] || STATUS_COPY.pending;
  const categoryLabel = BUSINESS_CATEGORIES.find((c) => c.key === request.category)?.label;
  const featureLabels = (request.requested_features || [])
    .map((key) => FEATURE_OPTIONS.find((f) => f.key === key)?.label)
    .filter(Boolean);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <View style={styles.statusCard}>
          <Text style={styles.statusIcon}>{copy.icon}</Text>
          <Text style={styles.statusTitle}>{copy.title}</Text>
          <Text style={styles.statusBody}>{copy.body}</Text>
        </View>

        {request.status === 'denied' && request.admin_notes ? (
          <View style={styles.notesCard}>
            <Text style={styles.notesLabel}>Note from our team</Text>
            <Text style={styles.notesText}>{request.admin_notes}</Text>
          </View>
        ) : null}

        <View style={styles.detailsCard}>
          <Text style={styles.detailsHeader}>Your Application</Text>
          <DetailRow label="Business Name" value={request.business_name} styles={styles} />
          {categoryLabel ? <DetailRow label="Category" value={categoryLabel} styles={styles} /> : null}
          {request.business_description ? <DetailRow label="Description" value={request.business_description} styles={styles} /> : null}
          {request.website ? <DetailRow label="Website" value={request.website} styles={styles} /> : null}
          {request.phone ? <DetailRow label="Phone" value={request.phone} styles={styles} /> : null}
          {request.address ? <DetailRow label="Address" value={request.address} styles={styles} /> : null}
          {featureLabels.length ? (
            <DetailRow label="Interested In" value={featureLabels.join(', ')} styles={styles} />
          ) : null}
        </View>

        {request.status === 'denied' && (
          <TouchableOpacity
            style={styles.button}
            onPress={() => navigation.navigate('BusinessPartnerApply')}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Submit a new application"
          >
            <Text style={styles.buttonText}>Submit a New Application</Text>
          </TouchableOpacity>
        )}

        {request.status === 'approved' && (
          <TouchableOpacity
            style={styles.button}
            onPress={() => navigation.navigate('BusinessDashboard')}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Go to your business dashboard"
          >
            <Text style={styles.buttonText}>Go to Business Dashboard</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value, styles }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  emptyText: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg, textAlign: 'center' },
  statusCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    alignItems: 'center', marginBottom: spacing.lg, ...shadow.card,
  },
  statusIcon: { fontSize: 40, marginBottom: spacing.sm },
  statusTitle: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs, textAlign: 'center' },
  statusBody: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  notesCard: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  notesLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, fontWeight: '700' },
  notesText: { ...typography.body, color: colors.textPrimary },
  detailsCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    marginBottom: spacing.lg, ...shadow.card,
  },
  detailsHeader: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.md, fontWeight: '700' },
  detailRow: { marginBottom: spacing.sm },
  detailLabel: { ...typography.caption, color: colors.textTertiary },
  detailValue: { ...typography.body, color: colors.textPrimary },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', ...shadow.button },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
