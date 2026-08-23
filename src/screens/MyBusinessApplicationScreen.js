import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyBusinessPartnerRequest, resubmitBusinessPartnerRequest } from '../services/businessPartnerApply';
import { checkTextModeration } from '../services/textModeration';
import { BUSINESS_CATEGORIES, FEATURE_OPTIONS } from './BusinessPartnerApplyScreen';
import LoadErrorState from '../components/LoadErrorState';
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
  // "Request More Information" -- closes the state deliberately deferred
  // when this app's Business Partner acquisition flow first shipped
  // ("skip building... for v1... flagged for later"). Same row, real
  // history preserved, not a fresh application.
  needs_info: {
    icon: '✍️',
    title: 'One More Thing Needed',
    body: 'Your application is almost there — add the missing info below and resend it.',
  },
};

export default function MyBusinessApplicationScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await getMyBusinessPartnerRequest();
      setRequest(data);
      setLoadError(false);
      if (data?.status === 'needs_info') {
        setForm({
          businessName: data.business_name || '',
          businessDescription: data.business_description || '',
          contactInfo: data.contact_info || '',
          category: data.category || null,
          website: data.website || '',
          phone: data.phone || '',
          address: data.address || '',
          requestedFeatures: data.requested_features || [],
        });
      }
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleFeature(key) {
    setForm((prev) => ({
      ...prev,
      requestedFeatures: prev.requestedFeatures.includes(key)
        ? prev.requestedFeatures.filter((k) => k !== key)
        : [...prev.requestedFeatures, key],
    }));
  }

  async function handleResubmit() {
    if (!form?.businessName?.trim()) {
      return Alert.alert('Business name required', "Tell us your business's name.");
    }
    const nameCheck = await checkTextModeration(form.businessName);
    if (!nameCheck.safe) {
      return Alert.alert('Name not allowed', 'Please revise and try again.');
    }
    setResubmitting(true);
    try {
      await resubmitBusinessPartnerRequest(request.id, {
        businessName: form.businessName.trim(),
        businessDescription: form.businessDescription.trim(),
        contactInfo: form.contactInfo.trim(),
        category: form.category,
        website: form.website.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        requestedFeatures: form.requestedFeatures,
      });
      Alert.alert('Sent', "We'll take another look and let you know.");
      await load();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setResubmitting(false);
    }
  }

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
          <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading your application...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load your application status." onRetry={load} />
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

        {(request.status === 'denied' || request.status === 'needs_info') && request.admin_notes ? (
          <View style={styles.notesCard}>
            <Text style={styles.notesLabel}>Note from our team</Text>
            <Text style={styles.notesText}>{request.admin_notes}</Text>
          </View>
        ) : null}

        {request.status !== 'needs_info' && (
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
        )}

        {request.status === 'needs_info' && form && (
          <View style={styles.detailsCard}>
            <Text style={styles.detailsHeader}>Update & Resend</Text>
            <TextInput
              style={styles.formInput}
              placeholder="Business name"
              placeholderTextColor={colors.textTertiary}
              value={form.businessName}
              onChangeText={(t) => updateForm('businessName', t)}
            />
            <TextInput
              style={[styles.formInput, styles.formInputMultiline]}
              placeholder="Description"
              placeholderTextColor={colors.textTertiary}
              value={form.businessDescription}
              onChangeText={(t) => updateForm('businessDescription', t)}
              multiline
            />
            <TextInput
              style={styles.formInput}
              placeholder="Website"
              placeholderTextColor={colors.textTertiary}
              value={form.website}
              onChangeText={(t) => updateForm('website', t)}
              autoCapitalize="none"
            />
            <TextInput
              style={styles.formInput}
              placeholder="Phone"
              placeholderTextColor={colors.textTertiary}
              value={form.phone}
              onChangeText={(t) => updateForm('phone', t)}
              keyboardType="phone-pad"
            />
            <TextInput
              style={styles.formInput}
              placeholder="Address"
              placeholderTextColor={colors.textTertiary}
              value={form.address}
              onChangeText={(t) => updateForm('address', t)}
            />

            <Text style={styles.formSectionLabel}>Category</Text>
            <View style={styles.chipRow}>
              {BUSINESS_CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.chip, form.category === c.key && styles.chipSelected]}
                  onPress={() => updateForm('category', c.key)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.chipText, form.category === c.key && styles.chipTextSelected]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.formSectionLabel}>What would you like to offer?</Text>
            <View style={styles.chipRow}>
              {FEATURE_OPTIONS.map((f) => (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.chip, form.requestedFeatures.includes(f.key) && styles.chipSelected]}
                  onPress={() => toggleFeature(f.key)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.chipText, form.requestedFeatures.includes(f.key) && styles.chipTextSelected]}>{f.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.button, { marginTop: spacing.lg }, resubmitting && { opacity: 0.6 }]}
              onPress={handleResubmit}
              disabled={resubmitting}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Resend application"
            >
              {resubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Resend Application</Text>}
            </TouchableOpacity>
          </View>
        )}

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
  formInput: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm, color: colors.textPrimary, fontSize: 14, marginBottom: spacing.sm,
  },
  formInputMultiline: { minHeight: 70, textAlignVertical: 'top' },
  formSectionLabel: { ...typography.caption, color: colors.textTertiary, fontWeight: '700', marginTop: spacing.sm, marginBottom: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.full,
    paddingVertical: 6, paddingHorizontal: 12, marginBottom: spacing.xs, backgroundColor: colors.surfaceElevated,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
});
