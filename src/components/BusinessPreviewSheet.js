import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Linking } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { modalAnimation } from '../motion';
import { businessPreview, businessPreviewRoute } from '../utils/businessPreview';

// The one business sheet (owner item 17, 2026-10-04, LOCKED): a lightweight preview over Discover's business browsing surfaces
// (result rows, map pins). Not a screen and not a mini Business Profile: name, measured distance, open status, two declared
// qualities, the business's own action, and "View business" for the full profile. Closing (tap outside, Android Back, or opening
// something) leaves Discover exactly as it was underneath: search, filters and scroll belong to Discover and are never touched.
// Content comes only from utils/businessPreview.js; the screen passes the row it already holds.
export default function BusinessPreviewSheet({ partner, navigation, onClose }) {
  const { t, language } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const preview = partner ? businessPreview(partner, { language }) : null;

  // Close first, then go (the same order ActionSheetModal uses), so the sheet is gone when the person comes Back.
  function go(fn) {
    onClose();
    setTimeout(fn, 0);
  }
  function runAction() {
    const route = businessPreviewRoute(partner, preview.action);
    if (!route) return;
    go(() => (route.kind === 'url' ? route.url && Linking.openURL(route.url) : navigation.navigate(route.screen, route.params)));
  }
  function viewBusiness() {
    go(() => navigation.navigate('BusinessProfile', { partnerId: partner.id }));
  }

  return (
    <Modal visible={!!preview} animationType={modalAnimation('slide')} transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel={preview ? t('ui.businessSheet.closeA11y', { name: preview.title ?? '' }) : undefined}
        />
        {preview ? (
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <Text style={styles.title} numberOfLines={2}>{preview.title}</Text>
            {preview.distance ? <Text style={styles.line}>{preview.distance}</Text> : null}
            {preview.hours ? <Text style={styles.line}>🕒 {preview.hours}</Text> : null}
            {preview.qualities.length > 0 ? <Text style={styles.line}>{preview.qualities.join(' · ')}</Text> : null}
            <TouchableOpacity style={styles.primary} onPress={runAction} accessibilityRole="button" accessibilityLabel={`${preview.action.label}, ${preview.title ?? ''}`}>
              <Text style={styles.primaryText}>{preview.action.label}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={viewBusiness} accessibilityRole="button" accessibilityLabel={t('ui.businessSheet.viewBusinessA11y', { name: preview.title ?? '' })}>
              <Text style={styles.secondaryText}>{t('ui.businessSheet.viewBusiness')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const getStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
  line: { color: colors.textSecondary, fontSize: 14, marginBottom: spacing.xs },
  primary: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondary: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  secondaryText: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
});
