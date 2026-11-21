import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert, Keyboard, TouchableWithoutFeedback, Image } from 'react-native';
import KeyboardSafeView from '../components/KeyboardSafeView';
import FieldError from '../components/FieldError';
import useFormErrors from '../hooks/useFormErrors';
import { updateCommunity } from '../services/communities';
import { checkTextModeration } from '../services/textModeration';
import { INTEREST_OPTIONS } from '../constants/gatheringCategories';
import TagGroupPicker from '../components/TagGroupPicker';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

import { showSuccessToast } from '../motion';
import useCategoryNames from '../hooks/useCategoryNames';
import { disabledButtonStyle } from '../constants/buttonStates';
export default function EditCommunityScreen({ route, navigation }) {
  const { t } = useLanguage();
  const names = useCategoryNames(); // category / occasion names shown in the person's language (display only)
  const { community } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const form = useFormErrors();
  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description || '');
  const [interestTag, setInterestTag] = useState(community.interest_tag ?? null);
  const [isPublic, setIsPublic] = useState(community.is_public);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!name.trim()) {
      form.show('name', t('ui.community.giveYourCommunityAName'));
      return;
    }

    const nameCheck = await checkTextModeration(name);
    if (!nameCheck.safe) {
      form.show('name', t('ui.community.pleaseReviseTheNameAnd'));
      return;
    }
    if (description.trim()) {
      const descCheck = await checkTextModeration(description);
      if (!descCheck.safe) {
        form.show('description', t('ui.community.pleaseReviseYourDescriptionAnd'));
        return;
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
      showSuccessToast(t('ui.community.updated'), t('ui.community.yourChangesAreSaved'));
      navigation.goBack();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => submit() });
    }
    setSubmitting(false);
  }


  return (
    <SafeAreaView style={styles.container}>
      <KeyboardSafeView>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView ref={form.scrollRef} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
          <View ref={form.contentRef}>
          <Text style={styles.header}>{t('ui.community.editCommunity2')}</Text>

          <View ref={form.anchor('name')}>
          <Text style={styles.label}>{t('ui.community.name')}</Text>
          <TextInput
            ref={form.input('name')}
            style={styles.input}
            placeholder={t('ui.community.downtownRunners')}
            placeholderTextColor={colors.textTertiary}
            value={name}
            onChangeText={(v) => { setName(v); form.clear('name'); }}
            accessibilityLabel={t('ui.community.communityNameA11y')}
          />
          <FieldError message={form.errorFor('name')} />
          </View>

          <View ref={form.anchor('description')}>
          <Text style={styles.label}>{t('ui.community.description')}</Text>
          <TextInput
            ref={form.input('description')}
            style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
            placeholder={t('ui.community.whatsThisCommunityAbout')}
            placeholderTextColor={colors.textTertiary}
            value={description}
            onChangeText={(v) => { setDescription(v); form.clear('description'); }}
            multiline
            accessibilityLabel={t('ui.community.communityDescriptionOptionalA11y')}
          />
          <FieldError message={form.errorFor('description')} />
          </View>

          <Text style={styles.label}>{t('ui.community.category')}</Text>
          <TagGroupPicker
            options={INTEREST_OPTIONS}
            selected={interestTag ? [interestTag] : []}
            onToggle={(option) => setInterestTag(interestTag === option ? null : option)}
            single
            chipA11yLabel={(option) => t('ui.community.categoryA11y', { tag: names.tag(option) })}
          />

          <Text style={styles.label}>{t('ui.community.visibility')}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }}>
            <TouchableOpacity
              style={[styles.visToggle, isPublic && styles.visToggleActive]}
              onPress={() => setIsPublic(true)}
              accessibilityLabel={t('ui.community.publicAnyoneCanFindAndA11y')}
              accessibilityRole="button"
              accessibilityState={{ selected: isPublic }}
            >
              <Text style={[styles.visToggleText, isPublic && styles.visToggleTextActive]}>{t('ui.community.public')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.visToggle, !isPublic && styles.visToggleActive]}
              onPress={() => setIsPublic(false)}
              accessibilityLabel={t('ui.community.privateInviteOnlyA11y')}
              accessibilityRole="button"
              accessibilityState={{ selected: !isPublic }}
            >
              <Text style={[styles.visToggleText, !isPublic && styles.visToggleTextActive]}>{t('ui.community.private')}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, (submitting) && disabledButtonStyle(colors)]}
            onPress={submit}
            disabled={submitting}
            activeOpacity={0.85}
            accessibilityLabel={submitting ? t('ui.community.savingA11y') : t('ui.community.saveChangesA11y')}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{submitting ? t('ui.community.saving') : t('ui.community.saveChanges')}</Text>
          </TouchableOpacity>
          </View>
        </ScrollView>
      </TouchableWithoutFeedback>
      </KeyboardSafeView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.lg },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border },
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
