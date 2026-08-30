import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert, Keyboard, TouchableWithoutFeedback } from 'react-native';
import { createCommunity, seedCommunityFromGathering } from '../services/communities';
import { getMyManagedPartner } from '../services/brandOffers';
import { checkTextModeration } from '../services/textModeration';
import { categoryStyleFor, CATEGORY_BUTTON_TEXT_COLOR } from '../constants/gatheringCategoryStyles';
import { INTEREST_OPTIONS } from '../constants/gatheringCategories';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export default function CreateCommunityScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [interestTag, setInterestTag] = useState(null);
  const [isPublic, setIsPublic] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [managedPartner, setManagedPartner] = useState(null);

  // Prefill from CreateHubScreen's Create Assistant, same
  // quickStartTitle/quickStartCategory param shape CreateGatheringScreen
  // already accepts from StartSomethingModal.
  useEffect(() => {
    if (route?.params?.quickStartTitle) {
      setName(route.params.quickStartTitle);
    }
    if (route?.params?.quickStartCategory && INTEREST_OPTIONS.includes(route.params.quickStartCategory)) {
      setInterestTag(route.params.quickStartCategory);
    }
  }, [route?.params?.quickStartTitle, route?.params?.quickStartCategory]);

  // A business owner's every new community is automatically linked to
  // their own business (set_community_hosting_partner_from_creator DB
  // trigger) so it shows up on their Business Dashboard's Community tab --
  // surfaced here up front so it isn't a surprise on the next screen.
  useEffect(() => {
    getMyManagedPartner().then(setManagedPartner);
  }, []);

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
      const community = await createCommunity({
        name: name.trim(),
        description: description.trim() || null,
        interestTag,
        isPublic,
      });

      const seedGatheringId = route?.params?.seedFromGatheringId;
      if (seedGatheringId) {
        const { invitedCount, totalAttendeeCount } = await seedCommunityFromGathering(community.id, seedGatheringId);
        if (totalAttendeeCount > 0) {
          const message = invitedCount === totalAttendeeCount
            ? `Invited all ${invitedCount} attendee${invitedCount === 1 ? '' : 's'} who are already your friends.`
            : invitedCount > 0
              ? `Invited ${invitedCount} of ${totalAttendeeCount} attendees who are already your friends. Add the rest as friends to invite them here too.`
              : "None of this gathering's attendees are your friends yet — add them as friends to invite them here.";
          Alert.alert('Community created! 🎉', message);
        }
      }

      navigation.replace('CommunityDetail', { communityId: community.id, communityName: community.name });
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
          <Text style={styles.header}>Create a Community</Text>
          <Text style={styles.subheader}>An ongoing group that can host recurring gatherings over time.</Text>

          {managedPartner && (
            <View style={styles.businessNotice}>
              <Text style={styles.businessNoticeText}>
                🏪 Since you manage {managedPartner.name}, this community will be linked to your business page and appear on your Business Dashboard's Community tab.
              </Text>
            </View>
          )}

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
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, isSelected && { backgroundColor: style.color, borderColor: style.color }]}
                  onPress={() => setInterestTag(interestTag === option ? null : option)}
                  activeOpacity={0.8}
                  accessibilityLabel={`Category: ${option}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{style.icon} {option}</Text>
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
            accessibilityLabel={submitting ? 'Creating' : 'Create Community'}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{submitting ? 'Creating...' : 'Create Community'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  subheader: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg, lineHeight: 18 },
  businessNotice: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.lg,
  },
  businessNoticeText: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  // Aug 30 2026 -- the one and only chip variant in this screen is the
  // category picker, whose selected background is categoryStyle.color
  // (a deliberately low-saturation palette) -- white text there measures
  // 2.03-3.19:1, below the WCAG floor for large bold text. See
  // gatheringCategoryStyles.js's own CATEGORY_BUTTON_TEXT_COLOR comment.
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