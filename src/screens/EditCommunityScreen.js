import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert, Keyboard, TouchableWithoutFeedback, Image } from 'react-native';
import { updateCommunity } from '../services/communities';
import { checkTextModeration } from '../services/textModeration';
import { categoryStyleFor, CATEGORY_BUTTON_TEXT_COLOR } from '../constants/gatheringCategoryStyles';
import { curatedCoverPhotoFor } from '../constants/gatheringCoverPhotos';
import { INTEREST_OPTIONS } from '../constants/gatheringCategories';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export default function EditCommunityScreen({ route, navigation }) {
  const { community } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description || '');
  const [interestTag, setInterestTag] = useState(community.interest_tag ?? null);
  const [isPublic, setIsPublic] = useState(community.is_public);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!name.trim()) {
      return Alert.alert('Name required', 'Give your community a name.');
    }

    const nameCheck = await checkTextModeration(name);
    if (!nameCheck.safe) {
      return Alert.alert('Name not allowed', 'Please revise the name and try again.');
    }
    if (description.trim()) {
      const descCheck = await checkTextModeration(description);
      if (!descCheck.safe) {
        return Alert.alert('Description not allowed', 'Please revise your description and try again.');
      }
    }

    setSubmitting(true);
    try {
      await updateCommunity(community.id, {
        name: name.trim(),
        description: description.trim() || null,
        interestTag,
        isPublic,
      });
      Alert.alert('Updated', 'Your changes are saved.');
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSubmitting(false);
  }

  const selectedStyle = interestTag ? categoryStyleFor(interestTag) : null;

  return (
    <SafeAreaView style={styles.container}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
          <Text style={styles.header}>Edit Community</Text>

          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Downtown Runners"
            placeholderTextColor={colors.textTertiary}
            value={name}
            onChangeText={setName}
            accessibilityLabel="Community name"
          />

          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
            placeholder="What's this community about?"
            placeholderTextColor={colors.textTertiary}
            value={description}
            onChangeText={setDescription}
            multiline
            accessibilityLabel="Community description, optional"
          />

          <Text style={styles.label}>Category</Text>
          <View style={styles.chipsWrap}>
            {INTEREST_OPTIONS.map((option) => {
              const style = categoryStyleFor(option);
              const isSelected = interestTag === option;
              const photoUrl = curatedCoverPhotoFor(option);
              return (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.chip,
                    !isSelected && { backgroundColor: `${style.color}20`, borderColor: `${style.color}40` },
                    isSelected && { backgroundColor: style.color, borderColor: style.color },
                  ]}
                  onPress={() => setInterestTag(interestTag === option ? null : option)}
                  activeOpacity={0.8}
                  accessibilityLabel={`Category: ${option}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  {photoUrl ? <Image source={{ uri: photoUrl }} style={styles.chipPhoto} /> : null}
                  <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{photoUrl ? '' : `${style.icon} `}{option}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Visibility</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }}>
            <TouchableOpacity
              style={[styles.visToggle, isPublic && styles.visToggleActive]}
              onPress={() => setIsPublic(true)}
              accessibilityLabel="Public, anyone can find and join"
              accessibilityRole="button"
              accessibilityState={{ selected: isPublic }}
            >
              <Text style={[styles.visToggleText, isPublic && styles.visToggleTextActive]}>🌍 Public</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.visToggle, !isPublic && styles.visToggleActive]}
              onPress={() => setIsPublic(false)}
              accessibilityLabel="Private, invite only"
              accessibilityRole="button"
              accessibilityState={{ selected: !isPublic }}
            >
              <Text style={[styles.visToggleText, !isPublic && styles.visToggleTextActive]}>🔒 Private</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, selectedStyle && { backgroundColor: selectedStyle.color }]}
            onPress={submit}
            disabled={submitting}
            activeOpacity={0.85}
            accessibilityLabel={submitting ? 'Saving' : 'Save changes'}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{submitting ? 'Saving...' : 'Save Changes'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.lg },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipPhoto: { width: 18, height: 18, borderRadius: 9 },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: CATEGORY_BUTTON_TEXT_COLOR },
  visToggle: {
    flex: 1, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center',
  },
  visToggleActive: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  visToggleText: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  visToggleTextActive: { color: colors.primary },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', marginTop: spacing.xl, ...shadow.button },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
