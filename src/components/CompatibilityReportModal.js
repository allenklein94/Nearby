import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { supabase } from '../services/supabase';
import { generateCompatibilityCompass, generateFrictionPoints } from '../services/compatibility';
import { BASICS_FIELDS } from '../constants/basicsFields';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

function fieldLabel(key) {
  const field = BASICS_FIELDS.find((f) => f.key === key);
  return field ? `${field.icon} ${field.label}` : key;
}

const COMPASS_DIRECTIONS = [
  { key: 'north', icon: '🧭', label: 'North — What Connects You', color: 'success' },
  { key: 'east', icon: '🗺️', label: 'East — What To Explore Together', color: 'primary' },
  { key: 'south', icon: '💬', label: 'South — Worth Discussing Early', color: 'primary' },
  { key: 'west', icon: '🌱', label: 'West — Room To Grow Together', color: 'textTertiary' },
];

export default function CompatibilityReportModal({ visible, onClose, report, theirName }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [introduction, setIntroduction] = useState(null);
  const [loadingIntro, setLoadingIntro] = useState(false);
  const [view, setView] = useState('score');

  if (!report) return null;

  const compass = generateCompatibilityCompass(report);
  const friction = generateFrictionPoints(report);

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

  function resetAndClose() {
    setView('score');
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={resetAndClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{report.score}% Match with {theirName}</Text>

          <View style={styles.viewToggle}>
            <TouchableOpacity
              style={[styles.toggleButton, view === 'score' && styles.toggleButtonActive]}
              onPress={() => setView('score')}
              accessibilityLabel="Show detailed breakdown"
              accessibilityRole="button"
              accessibilityState={{ selected: view === 'score' }}
            >
              <Text style={[styles.toggleButtonText, view === 'score' && styles.toggleButtonTextActive]}>Details</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleButton, view === 'compass' && styles.toggleButtonActive]}
              onPress={() => setView('compass')}
              accessibilityLabel="Show compatibility compass"
              accessibilityRole="button"
              accessibilityState={{ selected: view === 'compass' }}
            >
              <Text style={[styles.toggleButtonText, view === 'compass' && styles.toggleButtonTextActive]}>🧭 Compass</Text>
            </TouchableOpacity>
            {friction.points.length > 0 && (
              <TouchableOpacity
                style={[styles.toggleButton, view === 'friction' && styles.toggleButtonActive]}
                onPress={() => setView('friction')}
                accessibilityLabel="Show specific talking points"
                accessibilityRole="button"
                accessibilityState={{ selected: view === 'friction' }}
              >
                <Text style={[styles.toggleButtonText, view === 'friction' && styles.toggleButtonTextActive]}>💡 Talk About</Text>
              </TouchableOpacity>
            )}
          </View>

          {view === 'score' && !introduction && !loadingIntro && (report.sharedInterests.length > 0 || report.matchingFields.length > 0) && (
            <TouchableOpacity style={styles.introButton} onPress={generateIntroduction} activeOpacity={0.85}>
              <Text style={styles.introButtonText}>✨ Why you two might connect</Text>
            </TouchableOpacity>
          )}
          {view === 'score' && loadingIntro && <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />}
          {view === 'score' && introduction && (
            <View style={styles.introCard}>
              <Text style={styles.introText}>{introduction}</Text>
            </View>
          )}

          <ScrollView style={{ maxHeight: 350 }}>
            {view === 'score' && (
              <>
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
              </>
            )}

            {view === 'compass' && (
              <>
                <Text style={styles.compassIntro}>
                  A single number can't capture something this nuanced — here's a fuller picture, in four directions.
                </Text>
                {COMPASS_DIRECTIONS.map((dir) => {
                  const items = compass[dir.key];
                  return (
                    <View key={dir.key} style={styles.compassBlock}>
                      <Text style={styles.compassLabel}>{dir.icon} {dir.label}</Text>
                      {items.length > 0 ? (
                        items.map((item, i) => (
                          <Text key={i} style={styles.compassItem}>• {item}</Text>
                        ))
                      ) : (
                        <Text style={styles.compassEmptyItem}>Nothing here yet</Text>
                      )}
                    </View>
                  );
                })}
              </>
            )}

            {view === 'friction' && (
              <>
                <Text style={styles.compassIntro}>
                  Specific things worth an actual conversation — not red flags, just real differences worth naming.
                </Text>
                {friction.points.map((point) => (
                  <View key={point.label} style={styles.frictionBlock}>
                    <Text style={styles.frictionLabel}>{point.label}</Text>
                    {point.details.map((d) => (
                      <View key={d.key} style={styles.frictionDetail}>
                        <Text style={styles.differText}>You: {d.myValue}</Text>
                        <Text style={styles.differText}>Them: {d.theirValue}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          <TouchableOpacity onPress={resetAndClose} style={styles.closeButton}>
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
  viewToggle: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  toggleButton: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  toggleButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  toggleButtonText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  toggleButtonTextActive: { color: '#fff' },
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
  compassIntro: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: spacing.md, fontStyle: 'italic' },
  compassBlock: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  compassLabel: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 14, marginBottom: spacing.xs },
  compassItem: { color: colors.textSecondary, fontSize: 13, marginTop: 2, lineHeight: 18 },
  compassEmptyItem: { color: colors.textTertiary, fontSize: 12, fontStyle: 'italic' },
  frictionBlock: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  frictionLabel: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 14, marginBottom: spacing.xs },
  frictionDetail: { marginTop: 2 },
  closeButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  closeButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});