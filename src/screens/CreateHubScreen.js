import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import StartSomethingModal, { CREATE_HUB_OPTIONS } from '../components/StartSomethingModal';
import { supabase } from '../services/supabase';
import { classifyCreateRequest } from '../services/createAssistant';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// A dedicated action hub — the "I want to do something" tab, distinct from
// Discover's "let me look around" browsing. Three entry points (Start a
// Gathering / Create a Community / Partner with a Business) plus a free-text
// Create Assistant box that classifies intent and routes with fields
// prefilled — never labeled "AI" anywhere in this screen, per the user's
// own call that Premium should sell convenience/intelligence, not
// permission to use Create at all. "Start Something" and "Host a Gathering"
// (two previously separate cards) are now one — StartSomethingModal's
// existing "Something Else" chip already covers the blank-wizard case.
export default function CreateHubScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [startModalVisible, setStartModalVisible] = useState(false);
  const [managesBusiness, setManagesBusiness] = useState(false);
  const [assistantText, setAssistantText] = useState('');
  const [thinking, setThinking] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const { data: sessionData } = await supabase.auth.getSession();
        const myId = sessionData?.session?.user?.id;
        if (!myId) return;

        const { data: profile } = await supabase.from('profiles').select('managed_partner_id').eq('id', myId).single();
        if (cancelled) return;
        setManagesBusiness(!!profile?.managed_partner_id);
      })();
      return () => { cancelled = true; };
    }, [])
  );

  async function handleAskAssistant() {
    if (!assistantText.trim()) return;
    setThinking(true);
    try {
      const result = await classifyCreateRequest(assistantText.trim());
      setAssistantText('');
      if (result.intent === 'gathering') {
        navigation.navigate('CreateGathering', { quickStartTitle: result.title, quickStartCategory: result.category });
      } else if (result.intent === 'community') {
        navigation.navigate('CreateCommunity', { quickStartTitle: result.title, quickStartCategory: result.category });
      } else if (result.intent === 'business_partner') {
        navigation.navigate('RequestBusinessPartner', { initialBusinessQuery: result.businessName ?? '' });
      } else {
        Alert.alert("Not quite sure", "We couldn't tell what you're planning — try one of the options above, or describe it a bit differently.");
      }
    } catch (e) {
      Alert.alert('Something went wrong', e.message);
    }
    setThinking(false);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Create</Text>
        <Text style={styles.subtitle}>What do you want to do?</Text>

        <TouchableOpacity
          style={styles.card}
          onPress={() => setStartModalVisible(true)}
          activeOpacity={0.85}
          accessibilityLabel="Start a gathering"
          accessibilityRole="button"
        >
          <Text style={styles.cardIcon}>🎉</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Start a Gathering</Text>
            <Text style={styles.cardSubtitle}>Coffee, dinner, a walk — plan something to do together</Text>
          </View>
          <Text style={styles.cardChevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('CreateCommunity')}
          activeOpacity={0.85}
          accessibilityLabel="Create a community"
          accessibilityRole="button"
        >
          <Text style={styles.cardIcon}>👥</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Create a Community</Text>
            <Text style={styles.cardSubtitle}>Build an ongoing group around a shared interest</Text>
          </View>
          <Text style={styles.cardChevron}>›</Text>
        </TouchableOpacity>

        {managesBusiness ? (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('BusinessDashboard')}
            activeOpacity={0.85}
            accessibilityLabel="Manage your business"
            accessibilityRole="button"
          >
            <Text style={styles.cardIcon}>🏪</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Manage Your Business</Text>
              <Text style={styles.cardSubtitle}>Open your business dashboard</Text>
            </View>
            <Text style={styles.cardChevron}>›</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('RequestBusinessPartner')}
            activeOpacity={0.85}
            accessibilityLabel="Partner with a business"
            accessibilityRole="button"
          >
            <Text style={styles.cardIcon}>🤝</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Partner with a Business</Text>
              <Text style={styles.cardSubtitle}>Get a real business involved in your gathering or community</Text>
            </View>
            <Text style={styles.cardChevron}>›</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.assistantLabel}>💡 Tell us what you're thinking</Text>
        <Text style={styles.assistantSubtext}>We'll help you turn it into a plan.</Text>
        <View style={styles.assistantRow}>
          <TextInput
            style={styles.assistantInput}
            placeholder='e.g. "get some people together for coffee this weekend"'
            placeholderTextColor={colors.textTertiary}
            value={assistantText}
            onChangeText={setAssistantText}
            onSubmitEditing={handleAskAssistant}
            returnKeyType="go"
            accessibilityLabel="Tell us what you're thinking"
          />
          <TouchableOpacity
            style={styles.assistantButton}
            onPress={handleAskAssistant}
            disabled={thinking || !assistantText.trim()}
            accessibilityLabel="Submit"
            accessibilityRole="button"
          >
            {thinking ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.assistantButtonText}>→</Text>}
          </TouchableOpacity>
        </View>

        <StartSomethingModal
          visible={startModalVisible}
          onClose={() => setStartModalVisible(false)}
          navigation={navigation}
          topLevelOptions={CREATE_HUB_OPTIONS}
        />
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  title: { ...typography.display, color: colors.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.xl },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.md, ...shadow.card,
  },
  cardIcon: { fontSize: 32, marginRight: spacing.md },
  cardTitle: { ...typography.headline, color: colors.textPrimary },
  cardSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  cardChevron: { color: colors.textTertiary, fontSize: 24 },
  assistantLabel: { ...typography.headline, color: colors.textPrimary, marginTop: spacing.lg },
  assistantSubtext: { ...typography.caption, color: colors.textTertiary, marginTop: 2, marginBottom: spacing.sm },
  assistantRow: { flexDirection: 'row', alignItems: 'center' },
  assistantInput: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, color: colors.textPrimary, ...typography.body, marginRight: spacing.sm,
  },
  assistantButton: {
    backgroundColor: colors.primary, borderRadius: radius.md, width: 48, height: 48,
    alignItems: 'center', justifyContent: 'center',
  },
  assistantButtonText: { color: '#fff', fontSize: 20, fontWeight: '700' },
});
