import React, { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { tr } from '../i18n/translate';
import { presentRecoverableError } from '../utils/recoverableError';
import EmptyCopy from './EmptyCopy';
import { View, Text, FlatList, TouchableOpacity, Image, StyleSheet, Modal, Alert, ActivityIndicator, Share } from 'react-native';
import { getMyFriends } from '../services/friends';
import { gatheringInviteShareUrl } from '../services/gatherings';
import { getSignedPhotoUrl } from '../services/photos';
import { supabase } from '../services/supabase';
import { sendInvite } from '../services/invites';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

import { NLoader, modalAnimation, showSuccessToast } from '../motion';
import { inviteSentConfirmation } from '../utils/actionConfirmations';
import { inviteSheetRows, inviteStateMap, inviteRefusalState, inviteRowCanInvite, INVITE_ROW_LABEL_KEYS } from '../utils/inviteSheetRows';
// Gathering invites go through the older, gathering-specific
// invite_friend_to_gathering RPC (women-only + blocks-aware, already
// wired here before this component also learned to invite to
// communities) — kept as-is rather than folded into the newer generic
// social_invites path, so nothing about its existing safety checks
// changes. Community invites use the newer generic path since no
// gathering-specific RPC exists for them.
export default function InviteFriendsModal({
  visible, onClose,
  gatheringId, gatheringTitle,
  inviteType = 'gathering', targetId, targetTitle,
}) {
  const { t } = useLanguage();
  const resolvedType = gatheringId ? 'gathering' : inviteType;
  const resolvedTargetId = gatheringId ?? targetId;
  const resolvedTargetTitle = gatheringTitle ?? targetTitle;
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [friends, setFriends] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);
  // Idea "360": each friend's real state for this gathering (going / invited / ineligible / invite), from the server's one
  // rule, plus this sheet's own "sent". Unknown = Invite; the server re-checks every send.
  const [rowStates, setRowStates] = useState({});
  const [invitingId, setInvitingId] = useState(null);

  useEffect(() => {
    if (visible) {
      setRowStates({});
      loadFriends();
    }
  }, [visible]);

  async function loadInviteStates() {
    if (resolvedType !== 'gathering') return {};
    const { data, error } = await supabase.rpc('get_gathering_invite_states', { gathering_id_param: resolvedTargetId });
    return error ? {} : inviteStateMap(data);
  }

  async function loadFriends() {
    setLoading(true);
    const [friendsList, states] = await Promise.all([getMyFriends(), loadInviteStates()]);
    setFriends(friendsList);
    setRowStates(states);

    const urlEntries = await Promise.all(
      friendsList.map(async (f) => {
        if (!f.photo_url) return [f.id, null];
        const url = await getSignedPhotoUrl(f.photo_url);
        return [f.id, url];
      })
    );
    setPhotoUrls(Object.fromEntries(urlEntries));
    setLoading(false);
  }

  async function handleInvite(friendId) {
    setInvitingId(friendId);
    try {
      if (resolvedType === 'gathering') {
        const { error } = await supabase.rpc('invite_friend_to_gathering', {
          gathering_id_param: resolvedTargetId,
          friend_id_param: friendId,
        });
        if (error) throw error;
      } else {
        await sendInvite('community', resolvedTargetId, friendId);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setRowStates((prev) => ({ ...prev, [friendId]: 'sent' }));
      showSuccessToast(...inviteSentConfirmation(friends.find((f) => f.id === friendId)?.display_name));
    } catch (e) {
      // The server refused because the row was stale (already going / already invited / can't join): show the real
      // state, never a success and never a retry.
      const refused = inviteRefusalState(e);
      if (refused) setRowStates((prev) => ({ ...prev, [friendId]: refused }));
      else presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleInvite(friendId) });
    }
    setInvitingId(null);
  }

  async function handleShareWithNonUser() {
    try {
      // Item 72 (CLAUDE.md): "Make invitations frictionless -- don't
      // require everyone to download Nearby just to participate." This
      // function is literally named for exactly that case, but used to
      // share a bare nearby:// deep link -- useless for anyone without
      // the app already installed. Now shares a plain https link that
      // works for anyone: view the plan with zero install, then "Open in
      // Nearby" or "Get Nearby" for the full experience.
      const shareUrl = gatheringInviteShareUrl(resolvedTargetId);
      await Share.share({
        message: tr('ui.inviteModal.joinMe', { title: resolvedTargetTitle ?? tr('ui.inviteModal.myGathering'), url: shareUrl }),
        url: shareUrl,
      });
    } catch (e) {
      // Share sheet dismissal/cancel throws on some platforms -- not a real error.
    }
  }

  return (
    <Modal visible={visible} animationType={modalAnimation('slide')} transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{t('ui.inviteModal.inviteFriends')}</Text>
          <Text style={styles.subtitle}>{t('ui.inviteModal.to', { resolvedTargetTitle: resolvedTargetTitle })}</Text>

          {loading ? (
            <NLoader fullScreen={false} size="compact" caption={t('ui.inviteModal.loadingFriends')} />
          ) : (
            // Item 126 ("Don't animate every card"): the whole list settles into place once,
            // instead of each friend row independently staggering in -- a real friends list can
            // easily hold far more than a handful of rows.
            <View>
            <FlatList
              data={inviteSheetRows(friends, rowStates)}
              keyExtractor={(row) => row.friend.id}
              style={{ maxHeight: 400 }}
              ListEmptyComponent={
                <EmptyCopy id="no_friends_to_invite" />
              }
              renderItem={({ item: { friend: item, state } }) => (
                <View style={styles.friendRow}>
                  {photoUrls[item.id] ? (
                    <Image source={{ uri: photoUrls[item.id] }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarPlaceholder]} />
                  )}
                  <Text style={styles.friendName}>{item.display_name}</Text>
                  {state === 'going' || state === 'invited' ? (
                    <View style={styles.statePill} accessible accessibilityLabel={`${item.display_name}, ${t(INVITE_ROW_LABEL_KEYS[state])}`}>
                      <Text style={styles.statePillText}>{t(INVITE_ROW_LABEL_KEYS[state])}</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.inviteButton, state === 'sent' && styles.inviteButtonSent]}
                      onPress={() => handleInvite(item.id)}
                      disabled={invitingId === item.id || !inviteRowCanInvite(state)}
                      accessibilityLabel={state === 'sent' ? t('ui.inviteModal.inviteSentA11y') : t('ui.inviteModal.inviteA11y', { name: item.display_name })}
                      accessibilityRole="button"
                    >
                      {invitingId === item.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.inviteButtonText}>{t(INVITE_ROW_LABEL_KEYS[state])}</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              )}
            />
            </View>
          )}

          {resolvedType === 'gathering' && (
            <TouchableOpacity
              onPress={handleShareWithNonUser}
              style={{ marginTop: spacing.md }}
              accessibilityLabel={t('ui.inviteModal.inviteSomeoneNotOnNearbyA11y')}
              accessibilityRole="button"
            >
              <Text style={styles.shareLink}>{t('ui.inviteModal.inviteSomeoneNotOnNearby')}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.lg }}>
            <Text style={styles.closeText}>{t('ui.inviteModal.done')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg },
  friendRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  avatarPlaceholder: {},
  friendName: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  inviteButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 8, minWidth: 70, alignItems: 'center' },
  inviteButtonSent: { backgroundColor: colors.success },
  inviteButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  statePill: { backgroundColor: colors.surfaceElevated, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 8, minWidth: 70, alignItems: 'center' },
  statePillText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  emptyText: { color: colors.textTertiary, textAlign: 'center', paddingVertical: spacing.xl, lineHeight: 20 },
  shareLink: { color: colors.primary, textAlign: 'center', fontSize: 14, fontWeight: '600' },
  closeText: { color: colors.textTertiary, textAlign: 'center', fontSize: 14 },
});