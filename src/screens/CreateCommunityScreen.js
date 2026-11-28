import React, { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert, Keyboard, TouchableWithoutFeedback, Image } from 'react-native';
import KeyboardSafeView from '../components/KeyboardSafeView';
import FieldError from '../components/FieldError';
import useFormErrors from '../hooks/useFormErrors';
import { createCommunity, seedCommunityFromGathering } from '../services/communities';
import { recordBehaviorEvent } from '../services/behaviorSignals';
import { getMyManagedPartner } from '../services/brandOffers';
import { screenUserContent, blockedByScreening, handledScreeningRefusal } from '../services/userContentScreening';
import { UGC_KINDS } from '../utils/ugcText';
import { showSuccessToast } from '../motion';
import { categoryStyleFor, CATEGORY_BUTTON_TEXT_COLOR } from '../constants/gatheringCategoryStyles';
import { curatedCoverPhotoFor } from '../constants/gatheringCoverPhotos';
import { INTEREST_OPTIONS } from '../constants/gatheringCategories';
import TagGroupPicker from '../components/TagGroupPicker';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import useCategoryNames from '../hooks/useCategoryNames';
import { disabledButtonStyle, PRIMARY_BUTTON } from '../constants/buttonStates';

export default function CreateCommunityScreen({ navigation, route }) {
  const { t } = useLanguage();
  const names = useCategoryNames(); // category / occasion names shown in the person's language (display only)
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const form = useFormErrors();
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
      form.show('name', t('ui.community.giveYourCommunityAName'));
      return;
    }

    // 20270373: screened before it's written; 'hold' = created, seen only by you until a person approves it.
    let held = false;
    if (true) {
      const nameCheck = await screenUserContent([{ text: name, kind: UGC_KINDS.communityName }]);
      if (blockedByScreening(Alert, t, nameCheck, { notAllowedTitle: t('ui.community.nameNotAllowed'), notAllowedBody: t('ui.community.pleaseReviseTheNameAnd'), onRefuse: (msg) => form.show('name', msg) })) return;
      held = nameCheck.outcome === 'hold';
    }
    if (description.trim()) {
      const descCheck = await screenUserContent([{ text: description, kind: UGC_KINDS.communityDescription }]);
      if (blockedByScreening(Alert, t, descCheck, { notAllowedTitle: t('ui.community.descriptionNotAllowed'), notAllowedBody: t('ui.community.pleaseReviseYourDescriptionAnd'), onRefuse: (msg) => form.show('description', msg) })) return;
      held = held || descCheck.outcome === 'hold';
    }

    setSubmitting(true);
    try {
      const community = await createCommunity({
        name: name.trim(),
        description: description.trim() || null,
        interestTag,
        isPublic,
      });

      recordBehaviorEvent('create', 'community', community.id, interestTag);
      // A held community (20270373) is seen only by you until approved: nobody is invited into it yet.
      if (held) {
        setSubmitting(false);
        navigation.replace('CommunityDetail', { communityId: community.id, communityName: community.name });
        showSuccessToast(t('ui.shared.contentHeldTitle'), t('ui.shared.contentHeld'));
        return;
      }
      const seedGatheringId = route?.params?.seedFromGatheringId;
      let seedReason = null;
      if (seedGatheringId) {
        const { invitedCount, totalAttendeeCount } = await seedCommunityFromGathering(community.id, seedGatheringId);
        if (totalAttendeeCount > 0) {
          seedReason = invitedCount === totalAttendeeCount
            ? t('ui.community.invitedAllAttendeeWhoAre', { count: invitedCount })
            : invitedCount > 0
              ? t('ui.community.invitedOfAttendeesWhoAre', { invitedCount: invitedCount, totalAttendeeCount: totalAttendeeCount })
              : t('ui.community.noneOfThisGatheringsAttendees');
        }
      }

      // Success state (per the Nearby Motion Language): previously a bare Alert here
      // (blocking, required a tap to dismiss before you could even see the new
      // community -- itself against the "never slow down the user's task" rule) or,
      // for a from-scratch community, literally nothing at all. Both now land on the
      // same real, non-blocking `justCreated` celebration the destination screen
      // already renders; the invite summary rides along as the same dismissible
      // reason banner every other notified-context arrival on this screen already
      // uses, not a second competing mechanism.
      navigation.replace('CommunityDetail', {
        communityId: community.id,
        communityName: community.name,
        justCreated: true,
        notificationReason: seedReason,
      });
    } catch (e) {
      if (handledScreeningRefusal(Alert, t, e, { notAllowedTitle: t('ui.community.nameNotAllowed'), notAllowedBody: t('ui.community.pleaseReviseTheNameAnd') })) { setSubmitting(false); return; }
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
          <Text style={styles.header}>{t('ui.community.createACommunity2')}</Text>
          <Text style={styles.subheader}>{t('ui.community.anOngoingGroupThatCan')}</Text>

          {managedPartner && (
            <View style={styles.businessNotice}>
              <Text style={styles.businessNoticeText}>{t('ui.community.sinceYouManageThisCommunity', { name: managedPartner.name })}</Text>
            </View>
          )}

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
            accessibilityLabel={submitting ? t('ui.community.creatingA11y') : t('ui.community.createCommunityA11y')}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{submitting ? t('ui.community.creating') : t('ui.community.createCommunity')}</Text>
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
  header: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  subheader: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg, lineHeight: 18 },
  businessNotice: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.lg,
  },
  businessNoticeText: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  visToggle: {
    flex: 1, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center',
  },
  visToggleActive: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  visToggleText: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  visToggleTextActive: { color: colors.primary },
  button: { ...PRIMARY_BUTTON, backgroundColor: colors.primary, alignItems: 'center', marginTop: spacing.xl, ...shadow.button },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});