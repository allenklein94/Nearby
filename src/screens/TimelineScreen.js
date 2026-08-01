import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, ActivityIndicator } from 'react-native';
import { getMyTimeline } from '../services/homeDashboard';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export default function TimelineScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMyTimeline().then((result) => {
      setItems(result);
      setLoading(false);
    });
  }, []);

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">Your Timeline</Text>
      <Text style={styles.subtitle}>How your social life has grown</Text>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item, i) => `${item.date}-${i}`}
          contentContainerStyle={{ padding: spacing.lg }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📖</Text>
              <Text style={styles.emptyText}>Your story is just getting started.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.rowIcon}>{item.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowText}>{item.text}</Text>
                <Text style={styles.rowDate}>{formatDate(item.date)}</Text>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.sm },
  title: { ...typography.display, color: colors.textPrimary, marginBottom: 2, paddingHorizontal: spacing.lg },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md, paddingHorizontal: spacing.lg },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  rowIcon: { fontSize: 22, marginRight: spacing.md },
  rowText: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
  rowDate: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center' },
});