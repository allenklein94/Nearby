import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator } from 'react-native';
import { getOnboardingRecommendations } from '../services/homeDashboard';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function OnboardingRecommendationsScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [recommendations, setRecommendations] = useState([]);
  const [myName, setMyName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    if (myId) {
      const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', myId).single();
      setMyName(profile?.display_name?.split(' ')[0] ?? '');
    }
    const results = await getOnboardingRecommendations().catch(() => []);
    setRecommendations(results);
    setLoading(false);
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={{ flex: 1, padding: spacing.lg }}>
        <Text style={styles.greeting}>{getGreeting()}{myName ? `, ${myName}` : ''}.</Text>
        <Text style={styles.subtitle}>Based on what you told us...</Text>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : recommendations.length > 0 ? (
          <>
            <Text style={styles.foundText}>I found {recommendations.length} great opportunit{recommendations.length === 1 ? 'y' : 'ies'}.</Text>
            {recommendations.map((r) => (
              <TouchableOpacity
                key={r.id}
                style={styles.card}
                onPress={() => navigation.navigate('MainTabs')}
                activeOpacity={0.85}
                accessibilityLabel={`${r.title}, ${formatDate(r.scheduled_at)}`}
                accessibilityRole="button"
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{r.title}</Text>
                  <Text style={styles.cardDate}>{formatDate(r.scheduled_at)}</Text>
                  {r.matchScore > 0 && <Text style={styles.cardMatch}>⭐ Matches your interests</Text>}
                </View>
                <Text style={styles.cardChevron}>›</Text>
              </TouchableOpacity>
            ))}
          </>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🔍</Text>
            <Text style={styles.emptyText}>We're still gathering opportunities in your area — check back soon, or explore what's already happening.</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.navigate('MainTabs')}
          activeOpacity={0.85}
          accessibilityLabel="Continue to the app"
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Let's Go</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  greeting: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  foundText: { ...typography.bodyBold, color: colors.textPrimary, marginBottom: spacing.md },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, ...shadow.card,
  },
  cardTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  cardDate: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  cardMatch: { color: colors.primary, fontSize: 12, fontWeight: '700', marginTop: 4 },
  cardChevron: { color: colors.textTertiary, fontSize: 18, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center' },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 18, alignItems: 'center', ...shadow.button },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});