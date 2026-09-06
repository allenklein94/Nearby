import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import LoadErrorState from '../components/LoadErrorState';
import {
  DATING_QUICK_FILTER_CATALOG, DATING_DEFAULT_ORDER, DATING_DEFAULT_VISIBLE, DATING_DEFAULT_CONFIG,
  FRIEND_QUICK_FILTER_CATALOG, FRIEND_DEFAULT_ORDER, FRIEND_DEFAULT_VISIBLE, FRIEND_DEFAULT_CONFIG,
} from '../constants/quickFilterCatalog';

// Sep 6 2026 (CLAUDE.md, external UX critique item 9): one real "select
// filters, set values, reorder" screen, driven by route.params.mode --
// Dating and Friends get their own real catalog (quickFilterCatalog.js)
// and their own profile columns, not two copies of this screen. Dating's
// Match % is the one 'threshold' entry with an actual settable value;
// everything else here is select + reorder, which is honest for Friends
// since its filters are already set live in its own accordion.
const MODE_SETUP = {
  dating: {
    catalog: DATING_QUICK_FILTER_CATALOG,
    defaultOrder: DATING_DEFAULT_ORDER,
    defaultVisible: DATING_DEFAULT_VISIBLE,
    defaultConfig: DATING_DEFAULT_CONFIG,
    columns: { order: 'quick_filter_order', visible: 'quick_filter_visible', config: 'quick_filter_config' },
    description: 'Choose which Quick Filters show up on Dating, set your Match % threshold, and reorder them.',
  },
  friends: {
    catalog: FRIEND_QUICK_FILTER_CATALOG,
    defaultOrder: FRIEND_DEFAULT_ORDER,
    defaultVisible: FRIEND_DEFAULT_VISIBLE,
    defaultConfig: FRIEND_DEFAULT_CONFIG,
    columns: { order: 'friend_quick_filter_order', visible: 'friend_quick_filter_visible', config: 'friend_quick_filter_config' },
    description: "Choose which filters show up on Friends, and reorder them. Interests and Distance are still picked live in the filter panel — this just controls which sections appear there.",
  },
};

export default function QuickFilterCustomizeScreen({ route }) {
  const mode = route?.params?.mode === 'friends' ? 'friends' : 'dating';
  const setup = MODE_SETUP[mode];
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const [order, setOrder] = useState(setup.defaultOrder);
  const [visible, setVisible] = useState(setup.defaultVisible);
  const [config, setConfig] = useState(setup.defaultConfig);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function load() {
    setLoading(true);
    try {
      const { order: orderCol, visible: visibleCol, config: configCol } = setup.columns;
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      const { data, error } = await supabase.from('profiles').select(`${orderCol}, ${visibleCol}, ${configCol}`).eq('id', userId).single();
      if (error) throw error;
      const savedOrder = data?.[orderCol];
      // A catalog key added after a user's saved order predates it -- append
      // rather than silently drop it, so newly-added filters are still reachable.
      const mergedOrder = savedOrder
        ? [...savedOrder, ...setup.catalog.map((f) => f.key).filter((k) => !savedOrder.includes(k))]
        : setup.defaultOrder;
      setOrder(mergedOrder);
      if (data?.[visibleCol]) setVisible(data[visibleCol]);
      setConfig({ ...setup.defaultConfig, ...(data?.[configCol] ?? {}) });
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  async function save(newOrder, newVisible, newConfig) {
    const { order: orderCol, visible: visibleCol, config: configCol } = setup.columns;
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    await supabase.from('profiles').update({ [orderCol]: newOrder, [visibleCol]: newVisible, [configCol]: newConfig }).eq('id', userId);
  }

  function toggleVisible(key) {
    const newVisible = visible.includes(key) ? visible.filter((v) => v !== key) : [...visible, key];
    setVisible(newVisible);
    save(order, newVisible, config);
  }

  function setThresholdValue(key, value) {
    const newConfig = { ...config, [key]: { value } };
    setConfig(newConfig);
    save(order, visible, newConfig);
  }

  function moveUp(index) {
    if (index === 0) return;
    const newOrder = [...order];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setOrder(newOrder);
    save(newOrder, visible, config);
  }

  function moveDown(index) {
    if (index === order.length - 1) return;
    const newOrder = [...order];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    setOrder(newOrder);
    save(newOrder, visible, config);
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
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.description}>{setup.description}</Text>
        {order.map((key, index) => {
          const info = setup.catalog.find((f) => f.key === key);
          if (!info) return null;
          const isVisible = visible.includes(key);
          return (
            <View key={key} style={styles.row}>
              <View style={styles.rowTop}>
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
                    value={isVisible}
                    onValueChange={() => toggleVisible(key)}
                    accessibilityLabel={`Show ${info.label} in Quick Filters`}
                  />
                </View>
              </View>
              {isVisible && info.kind === 'threshold' && (
                <View style={styles.valueRow}>
                  <Text style={styles.valueLabel}>At least:</Text>
                  <View style={styles.valueChips}>
                    {info.valueOptions.map((opt) => {
                      const active = (config[key]?.value ?? info.defaultValue) === opt;
                      return (
                        <TouchableOpacity
                          key={opt}
                          style={[styles.valueChip, active && styles.valueChipActive]}
                          onPress={() => setThresholdValue(key, opt)}
                          accessibilityLabel={`${opt}${info.unit ?? ''}`}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                        >
                          <Text style={[styles.valueChipText, active && styles.valueChipTextActive]}>{opt}{info.unit}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  description: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg, lineHeight: 18 },
  row: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  arrowButton: {
    width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center',
  },
  arrowButtonDisabled: { opacity: 0.3 },
  arrowText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  valueRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, gap: spacing.sm },
  valueLabel: { color: colors.textSecondary, fontSize: 13 },
  valueChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, flex: 1 },
  valueChip: {
    paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  valueChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  valueChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  valueChipTextActive: { color: '#fff' },
});
