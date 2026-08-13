import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet, SafeAreaView, Alert, ActivityIndicator } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import LoadErrorState from '../components/LoadErrorState';

const FILTER_LABELS = {
  verified: { icon: '✓', label: 'Verified Only' },
  highCompat: { icon: '💯', label: 'High Compatibility' },
  online: { icon: '🟢', label: 'Online Now' },
};

export default function QuickFilterCustomizeScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [order, setOrder] = useState(['verified', 'highCompat', 'online']);
  const [visible, setVisible] = useState(['verified', 'highCompat', 'online']);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      const { data, error } = await supabase.from('profiles').select('quick_filter_order, quick_filter_visible').eq('id', userId).single();
      if (error) throw error;
      if (data?.quick_filter_order) setOrder(data.quick_filter_order);
      if (data?.quick_filter_visible) setVisible(data.quick_filter_visible);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  async function save(newOrder, newVisible) {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    await supabase.from('profiles').update({ quick_filter_order: newOrder, quick_filter_visible: newVisible }).eq('id', userId);
  }

  function toggleVisible(key) {
    const newVisible = visible.includes(key) ? visible.filter((v) => v !== key) : [...visible, key];
    setVisible(newVisible);
    save(order, newVisible);
  }

  function moveUp(index) {
    if (index === 0) return;
    const newOrder = [...order];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setOrder(newOrder);
    save(newOrder, visible);
  }

  function moveDown(index) {
    if (index === order.length - 1) return;
    const newOrder = [...order];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    setOrder(newOrder);
    save(newOrder, visible);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading your filters...</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load your quick filters." onRetry={load} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.description}>
        Choose which Quick Filters show up, and drag to reorder them.
      </Text>
      {order.map((key, index) => {
        const info = FILTER_LABELS[key];
        if (!info) return null;
        return (
          <View key={key} style={styles.row}>
            <Text style={styles.rowLabel}>{info.icon} {info.label}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <TouchableOpacity
                  onPress={() => moveUp(index)}
                  disabled={index === 0}
                  style={[styles.arrowButton, index === 0 && styles.arrowButtonDisabled]}
                  accessibilityLabel={`Move ${info.label} up`}
                  accessibilityRole="button"
                >
                  <Text style={styles.arrowText}>↑</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => moveDown(index)}
                  disabled={index === order.length - 1}
                  style={[styles.arrowButton, index === order.length - 1 && styles.arrowButtonDisabled]}
                  accessibilityLabel={`Move ${info.label} down`}
                  accessibilityRole="button"
                >
                  <Text style={styles.arrowText}>↓</Text>
                </TouchableOpacity>
              </View>
              <Switch
                value={visible.includes(key)}
                onValueChange={() => toggleVisible(key)}
                accessibilityLabel={`Show ${info.label} in Quick Filters`}
              />
            </View>
          </View>
        );
      })}
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  description: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg, lineHeight: 18 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  rowLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  arrowButton: {
    width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center',
  },
  arrowButtonDisabled: { opacity: 0.3 },
  arrowText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
});