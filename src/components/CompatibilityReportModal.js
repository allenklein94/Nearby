import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { supabase } from '../services/supabase';
import { BASICS_FIELDS } from '../constants/basicsFields';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

function fieldLabel(key) {
  const field = BASICS_FIELDS.find((f) => f.key === key);
  return field ? `${field.icon} ${field.label}` : key;
}

export default function CompatibilityReportModal({ visible, onClose, report, theirName }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [introduction, setIntroduction] = useState(null);
  const [loadingIntro, setLoadingIntro] = useState(false);

  if (!report) return null;

  async function generateIntroduction() {
    setLoadingIntro(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const response = await fetch('https://enmosvippabmuqslzrox.supabase.co/functions/v1/generate-introduction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sharedInterests: report.sharedInterests,
          matchingFields: report.matchingFields,
          theirName,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        setLoadingIntro(false);
        return;
      }

      setIntroduction(result.introduction);
    } catch (e) {
      // Fail quietly — this is a nice-to-have on top of the report,
      // not essential, so no need to alarm the person with an error.
    }
    setLoadingIntro(false);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{report.score}% Match with {theirName}</Text>

          {!introduction && !loadingIntro && (report.sharedInterests.length > 0 || report.matchingFields.length > 0) && (
            <TouchableOpacity style={styles.introButton} onPress={generateIntroduction} activeOpacity={0.85}>
              <Text style={styles.introButtonText}>✨ Why you two might connect</Text>
            </TouchableOpacity>
          )}
          {loadingIntro && <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />}
          {introduction && (
            <View style={styles.introCard}>
              <Text style={styles.introText}>{introduction}</Text>
            </View>
          )}

          <ScrollView style={{ maxHeight: 350 }}>
            {report.sharedInterests.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>You Both Like</Text>
                <View style={styles.chipsWrap}>
                  {report.sharedInterests.map((interest) => (
                    <View key={interest} style={styles.matchChip}>
                      <Text style={styles.matchChipText}>{interest}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {report.matchingFields.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>You Match On</Text>
                {report.matchingFields.map((field) => (
                  <View key={field.key} style={styles.row}>
                    <Text style={styles.rowLabel}>{fieldLabel(field.key)}</Text>
                    <Text style={styles.rowValueMatch}>{field.value}</Text>
                  </View>
                ))}
              </>
            )}

            {report.differingFields.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>You Differ On</Text>
                {report.differingFields.map((field) => (
                  <View key={field.key} style={styles.differRow}>
                    <Text style={styles.rowLabel}>{fieldLabel(field.key)}</Text>
                    <Text style={styles.differText}>You: {field.myValue}</Text>
                    <Text style={styles.differText}>Them: {field.theirValue}</Text>
                  </View>
                ))}
              </>
            )}

            {report.sharedInterests.length === 0 && report.matchingFields.length === 0 && report.differingFields.length === 0 && (
              <Text style={styles.emptyText}>
                Not enough shared profile info yet to show a detailed breakdown — fill out more of your profile to see this.
              </Text>
            )}
          </ScrollView>

          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.md },
  introButton: {
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.full,
    paddingVertical: spacing.sm, alignItems: 'center', marginBottom: spacing.md,
  },
  introButtonText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  introCard: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.md,
  },
  introText: { color: colors.textPrimary, fontSize: 14, lineHeight: 20, fontStyle: 'italic' },
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.md, textTransform: 'uppercase', letterSpacing: 0.5 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  matchChip: { backgroundColor: colors.primaryMuted, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  matchChipText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel: { color: colors.textSecondary, fontSize: 14 },
  rowValueMatch: { color: colors.success, fontWeight: '700', fontSize: 14 },
  differRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  differText: { color: colors.textTertiary, fontSize: 13, marginTop: 2 },
  emptyText: { color: colors.textTertiary, textAlign: 'center', paddingVertical: spacing.xl, lineHeight: 20 },
  closeButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  closeButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});