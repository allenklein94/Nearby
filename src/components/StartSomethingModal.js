import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ImageBackground } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { quickOptionLabel } from '../i18n/optionLabels';
import { spacing, radius, typography } from '../theme';
import { getQuickPrompts } from '../utils/timeContext';
import { iconNameForOption } from '../constants/quickPickIcons';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { curatedCoverPhotoFor } from '../constants/gatheringCoverPhotos';

import { modalAnimation } from '../motion';
const SOMETHING_ELSE = { icon: '➕', label: 'Something Else', category: null };

// Labels here are the English identity of each option (compared and looked up by code); what is shown comes from
// quickOptionLabel (i18n/optionLabels.js) in the person's language.
// Fixed, non-time-adaptive option set for CreateHubScreen's "Start a
// Gathering" card — unlike the default getQuickPrompts() list (which
// changes by time of day), Create is reached at any hour and needs a
// stable set. Categories map to real existing INTEREST_OPTIONS tags.
export const CREATE_HUB_OPTIONS = [
  { icon: '☕', label: 'Coffee', category: 'Coffee' },
  { icon: '🍽️', label: 'Dinner', category: 'Foodie' },
  { icon: '🚶', label: 'Walk', category: 'Outdoors' },
  { icon: '🏐', label: 'Sports', category: 'Sports' },
  { icon: '🎮', label: 'Games', category: 'Gaming' },
  { icon: '🎵', label: 'Music', category: 'Music' },
  { icon: '🤝', label: 'Volunteer', category: 'Volunteering' },
  SOMETHING_ELSE,
];

export const SUB_OPTIONS = {
  Dinner: [
    { icon: '🍕', label: 'Pizza' },
    { icon: '🌮', label: 'Mexican' },
    { icon: '🍣', label: 'Sushi' },
    { icon: '🍔', label: 'Burgers' },
    { icon: '🥗', label: 'Healthy' },
    { icon: '🍝', label: 'Italian' },
    { icon: '➕', label: "Doesn't matter" },
  ],
};

export default function StartSomethingModal({ visible, onClose, navigation, initialCategory = null, topLevelOptions = null }) {
  const { colors } = useTheme();
  const { t, language } = useLanguage();
  const styles = getStyles(colors);
  const [activeCategory, setActiveCategory] = useState(null);

  useEffect(() => {
    if (visible && initialCategory) {
      setActiveCategory(initialCategory);
    }
  }, [visible, initialCategory]);

  function handleClose() {
    setActiveCategory(null);
    onClose();
  }

  function handlePick(item) {
    if (item.category === null) {
      handleClose();
      navigation.navigate('CreateGathering');
      return;
    }
    if (SUB_OPTIONS[item.label]) {
      setActiveCategory(item);
      return;
    }
    handleClose();
    // The title is only a prefill the person edits, so it is in their language (like the date-proposal message)
    navigation.navigate('CreateGathering', {
      quickStartTitle: quickOptionLabel(item, language),
      quickStartCategory: item.category,
    });
  }

  function handlePickSub(subLabel) {
    handleClose();
    navigation.navigate('CreateGathering', {
      quickStartTitle: quickOptionLabel(subLabel === "Doesn't matter" || subLabel === 'Other' ? activeCategory : { label: subLabel }, language),
      quickStartCategory: activeCategory.category,
    });
  }

  const options = activeCategory ? SUB_OPTIONS[activeCategory.label] : topLevelOptions ?? [...getQuickPrompts(), SOMETHING_ELSE];
  const title = activeCategory ? t('ui.startSomething.whatKindOfDinner') : t('ui.startSomething.iWantTo');

  return (
    <Modal visible={visible} animationType={modalAnimation('slide')} transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {activeCategory && (
            <TouchableOpacity onPress={() => setActiveCategory(null)} accessibilityLabel={t('ui.startSomething.backA11y')} accessibilityRole="button">
              <Text style={styles.backText}>{t('ui.startSomething.back')}</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.title}>{title}</Text>
          <View style={styles.grid}>
            {options.map((item) => {
              // Same "real curated category photo, never blank white"
              // treatment as CreateHubScreen's own copy of this grid --
              // reuses each option's own real category photo/color.
              const categoryColor = item.category ? categoryStyleFor(item.category).color : null;
              const photoUrl = item.category ? curatedCoverPhotoFor(item.category) : null;
              return (
                <TouchableOpacity
                  key={item.label}
                  style={[
                    styles.option,
                    !photoUrl && (categoryColor ? { backgroundColor: `${categoryColor}20` } : { backgroundColor: colors.surfaceElevated }),
                  ]}
                  onPress={() => (activeCategory ? handlePickSub(item.label) : handlePick(item))}
                  accessibilityLabel={quickOptionLabel(item, language)}
                  accessibilityRole="button"
                >
                  {photoUrl ? (
                    <ImageBackground source={{ uri: photoUrl }} style={styles.optionPhoto}>
                      <View style={styles.optionPhotoScrim}>
                        <Ionicons name={iconNameForOption(item)} size={24} color="#fff" style={styles.optionIcon} />
                        <Text style={[styles.optionLabel, styles.optionLabelOnPhoto]}>{quickOptionLabel(item, language)}</Text>
                      </View>
                    </ImageBackground>
                  ) : (
                    <>
                      <Ionicons name={iconNameForOption(item)} size={26} color={categoryColor ?? colors.textSecondary} style={styles.optionIcon} />
                      <Text style={styles.optionLabel}>{quickOptionLabel(item, language)}</Text>
                    </>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity onPress={handleClose} style={{ marginTop: spacing.lg }} accessibilityLabel={t('ui.startSomething.cancel')} accessibilityRole="button">
            <Text style={styles.cancelText}>{t('ui.startSomething.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
const getStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  backText: { color: colors.primary, fontWeight: '600', marginBottom: spacing.sm },
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: {
    width: '31%', aspectRatio: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  optionPhoto: { width: '100%', height: '100%' },
  optionPhotoScrim: {
    flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.38)',
  },
  optionIcon: { marginBottom: spacing.xs },
  optionLabel: { color: colors.textPrimary, fontSize: 11, fontWeight: '600', textAlign: 'center' },
  optionLabelOnPhoto: { color: '#fff' },
  cancelText: { color: colors.textTertiary, textAlign: 'center', fontSize: 14 },
});