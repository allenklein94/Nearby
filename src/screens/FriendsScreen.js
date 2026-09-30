import React, { useState, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import EmptyCopy from '../components/EmptyCopy';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Alert, ActivityIndicator, TextInput, Modal, KeyboardAvoidingView, Platform, Keyboard, TouchableWithoutFeedback } from 'react-native';
import FadeInState from '../components/FadeInState';
import { useFocusEffect } from '@react-navigation/native';
import { getMyFriends, getPendingFriendRequests, respondToFriendRequest, sendFriendRequest, getSuggestedFriends } from '../services/friends';
import { getMyCircles, createCircle, deleteCircle, addFriendToCircle, removeFriendFromCircle } from '../services/friendCircles';
import { findFriendsFromContacts } from '../services/contactsImport';
import PersonCard from '../components/PersonCard';
import { Share } from 'react-native';
import { getSignedPhotoUrl } from '../services/photos';
import LoadErrorState from '../components/LoadErrorState';
import { MatchAnimation, SkeletonFeed, modalAnimation } from '../motion';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export default function FriendsScreen({ navigation }) {
  const { t, language } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [friends, setFriends] = useState([]);
  const [friendSearch, setFriendSearch] = useState('');
  const [pending, setPending] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [contactMatches, setContactMatches] = useState(null);
  const [searchingContacts, setSearchingContacts] = useState(false);
  const [requestedIds, setRequestedIds] = useState({});
  const [celebratingFriend, setCelebratingFriend] = useState(null);
  const [notOnAppContacts, setNotOnAppContacts] = useState([]);
  const [suggestedFriends, setSuggestedFriends] = useState([]);
  const [circles, setCircles] = useState([]);
  const [selectedCircleId, setSelectedCircleId] = useState(null);
  const [newCircleModalVisible, setNewCircleModalVisible] = useState(false);
  const [newCircleName, setNewCircleName] = useState('');
  const [manageCirclesFor, setManageCirclesFor] = useState(null);

  const loadCircles = useCallback(async () => {
    setCircles(await getMyCircles());
  }, []);

  const load = useCallback(async () => {
    try {
      const [friendsList, pendingList, suggested] = await Promise.all([getMyFriends(), getPendingFriendRequests(), getSuggestedFriends()]);
      setFriends(friendsList);
      setPending(pendingList);
      setSuggestedFriends(suggested);
      loadCircles();

      const all = [...friendsList, ...pendingList, ...suggested.map((s) => ({ id: s.suggested_id, photo_url: s.photo_url }))];
      const urlEntries = await Promise.all(
        all.map(async (person) => {
          if (!person.photo_url) return [person.id, null];
          const url = await getSignedPhotoUrl(person.photo_url);
          return [person.id, url];
        })
      );
      setPhotoUrls(Object.fromEntries(urlEntries));
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleRespond(friendshipId, accept, person) {
    try {
      await respondToFriendRequest(friendshipId, accept);
      // Connection (🤝, per the Nearby Motion Language): reuse the same real
      // "you're now friends" moment the friend-discovery swipe flow already shows on
      // a mutual match -- accepting an explicit request is the same real outcome, it
      // shouldn't feel like a lesser, silent path to the identical relationship state.
      if (accept && person) setCelebratingFriend(person);
      load();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleRespond(friendshipId, accept, person) });
    }
  }

  async function handleFindFromContacts() {
    setSearchingContacts(true);
    try {
      const { matches, notOnApp } = await findFriendsFromContacts();
      const existingIds = new Set([...friends.map((f) => f.id), ...pending.map((p) => p.id)]);
      const newMatches = matches.filter((m) => !existingIds.has(m.id));
      setContactMatches(newMatches);
      setNotOnAppContacts(notOnApp);

      const urlEntries = await Promise.all(
        newMatches.map(async (person) => {
          if (!person.photo_url) return [person.id, null];
          const url = await getSignedPhotoUrl(person.photo_url);
          return [person.id, url];
        })
      );
      setPhotoUrls((prev) => ({ ...prev, ...Object.fromEntries(urlEntries) }));

      if (newMatches.length === 0 && notOnApp.length === 0) {
        Alert.alert(t('ui.friends.noNewMatches'), t('ui.friends.weDidntFindAnyNew'));
      }
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleFindFromContacts() });
    }
    setSearchingContacts(false);
  }

  async function handleInviteContact(contact) {
    try {
      await Share.share({
        message: t('ui.friends.heyComeJoinMeOn', { name: contact.name }),
      });
    } catch (e) {
      // user cancelled the share sheet, nothing to do
    }
  }

  async function handleSendRequest(personId) {
    try {
      await sendFriendRequest(personId);
      setRequestedIds((prev) => ({ ...prev, [personId]: true }));
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSendRequest(personId) });
    }
  }

  async function handleCreateCircle() {
    const name = newCircleName.trim();
    if (!name) return;
    try {
      await createCircle(name);
      setNewCircleName('');
      setNewCircleModalVisible(false);
      loadCircles();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleCreateCircle() });
    }
  }

  function confirmDeleteCircle(circle) {
    Alert.alert(t('ui.friends.delete', { name: circle.name }), t('ui.friends.thisOnlyRemovesTheCircle'), [
      { text: t('ui.friends.cancel'), style: 'cancel' },
      {
        text: t('ui.friends.delete2'),
        style: 'destructive',
        onPress: async () => {
          if (selectedCircleId === circle.id) setSelectedCircleId(null);
          await deleteCircle(circle.id);
          loadCircles();
        },
      },
    ]);
  }

  async function handleToggleCircleMembership(circle, friendId) {
    const isMember = circle.memberIds.includes(friendId);
    try {
      if (isMember) {
        await removeFriendFromCircle(circle.id, friendId);
      } else {
        await addFriendToCircle(circle.id, friendId);
      }
      loadCircles();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleToggleCircleMembership(circle, friendId) });
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      {loading ? (
        <View style={{ marginTop: spacing.xl, alignItems: 'center' }}>
          <SkeletonFeed count={4} />
        </View>
      ) : loadError ? (
        <LoadErrorState message={t('ui.friends.couldntLoadYourFriends')} onRetry={load} />
      ) : (
      <FlatList
        data={friends
          .filter((f) => !friendSearch.trim() || f.display_name?.toLowerCase().includes(friendSearch.trim().toLowerCase()))
          .filter((f) => !selectedCircleId || circles.find((c) => c.id === selectedCircleId)?.memberIds.includes(f.id))}
        keyExtractor={(item) => item.friendshipId}
        contentContainerStyle={{ padding: spacing.lg }}
        ListHeaderComponent={
          <>
            <View style={styles.searchBarWrap}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                placeholder={t('ui.friends.searchYourFriends')}
                placeholderTextColor={colors.textTertiary}
                value={friendSearch}
                onChangeText={setFriendSearch}
                accessibilityLabel={t('ui.friends.searchFriendsByNameA11y')}
              />
            </View>

            <TouchableOpacity
              style={styles.findContactsButton}
              onPress={handleFindFromContacts}
              disabled={searchingContacts}
              accessibilityLabel={t('ui.friends.findFriendsFromYourContactsA11y')}
              accessibilityRole="button"
            >
              {searchingContacts ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.findContactsButtonText}>{t('ui.friends.findFriendsFromContacts')}</Text>
              )}
            </TouchableOpacity>

            {suggestedFriends.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>{t('ui.friends.peopleYouMayKnow')}</Text>
                {suggestedFriends.map((person) => (
                  <PersonCard
                    key={person.suggested_id}
                    style={styles.requestRow}
                    photoUrl={photoUrls[person.suggested_id]}
                    name={person.display_name}
                    subtitle={t('ui.friends.mutualFriends', { count: person.mutual_count })}
                    onPress={() => navigation.navigate('ViewProfile', { userId: person.suggested_id })}
                    action={
                      <TouchableOpacity
                        style={[styles.acceptButton, requestedIds[person.suggested_id] && styles.acceptButtonSent]}
                        onPress={() => handleSendRequest(person.suggested_id)}
                        disabled={requestedIds[person.suggested_id]}
                        accessibilityLabel={requestedIds[person.suggested_id] ? t('ui.friends.friendRequestSentA11y') : t('ui.friends.sendFriendRequestToA11y', { name: person.display_name })}
                        accessibilityRole="button"
                      >
                        <Text style={styles.acceptButtonText}>{requestedIds[person.suggested_id] ? t('ui.friends.sent') : t('ui.friends.add')}</Text>
                      </TouchableOpacity>
                    }
                  />
                ))}
                <View style={styles.divider} />
              </>
            )}

            {contactMatches !== null && contactMatches.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>{t('ui.friends.fromYourContacts')}</Text>
                {contactMatches.map((person) => (
                  <PersonCard
                    key={person.id}
                    style={styles.requestRow}
                    photoUrl={photoUrls[person.id]}
                    name={person.display_name}
                    onPress={() => navigation.navigate('ViewProfile', { userId: person.id })}
                    action={
                      <TouchableOpacity
                        style={[styles.acceptButton, requestedIds[person.id] && styles.acceptButtonSent]}
                        onPress={() => handleSendRequest(person.id)}
                        disabled={requestedIds[person.id]}
                        accessibilityLabel={requestedIds[person.id] ? t('ui.friends.friendRequestSentA11y') : t('ui.friends.sendFriendRequestToA11y', { name: person.display_name })}
                        accessibilityRole="button"
                      >
                        <Text style={styles.acceptButtonText}>{requestedIds[person.id] ? t('ui.friends.sent') : t('ui.friends.add')}</Text>
                      </TouchableOpacity>
                    }
                  />
                ))}
                <View style={styles.divider} />
              </>
            )}

            {notOnAppContacts.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>{t('ui.friends.notOnNearbyYet')}</Text>
                {notOnAppContacts.map((contact) => (
                  <PersonCard
                    key={contact.phone}
                    style={styles.requestRow}
                    name={contact.name}
                    accessibilityLabel={contact.name}
                    action={
                      <TouchableOpacity
                        style={styles.acceptButton}
                        onPress={() => handleInviteContact(contact)}
                        accessibilityLabel={t('ui.friends.inviteToNearbyA11y', { name: contact.name })}
                        accessibilityRole="button"
                      >
                        <Text style={styles.acceptButtonText}>{t('ui.friends.invite')}</Text>
                      </TouchableOpacity>
                    }
                  />
                ))}
                <View style={styles.divider} />
              </>
            )}

            {pending.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>{t('ui.friends.friendRequests')}</Text>
                {pending.map((person) => (
                  <PersonCard
                    key={person.friendshipId}
                    style={styles.requestRow}
                    photoUrl={photoUrls[person.id]}
                    name={person.display_name}
                    onPress={() => navigation.navigate('ViewProfile', { userId: person.id })}
                    action={
                      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                        <TouchableOpacity
                          style={styles.acceptButton}
                          onPress={() => handleRespond(person.friendshipId, true, person)}
                          accessibilityLabel={t('ui.friends.acceptFriendRequestFromA11y', { name: person.display_name })}
                          accessibilityRole="button"
                        >
                          <Text style={styles.acceptButtonText}>{t('ui.friends.accept')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.declineButton}
                          onPress={() => handleRespond(person.friendshipId, false, person)}
                          accessibilityLabel={t('ui.friends.declineFriendRequestFromA11y', { name: person.display_name })}
                          accessibilityRole="button"
                        >
                          <Text style={styles.declineButtonText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    }
                  />
                ))}
                <View style={styles.divider} />
              </>
            )}
            {circles.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>{t('ui.friends.circles')}</Text>
                <View style={styles.circlesRow}>
                  {circles.map((circle) => {
                    const active = selectedCircleId === circle.id;
                    return (
                      <TouchableOpacity
                        key={circle.id}
                        style={[styles.circleChip, active && styles.circleChipActive]}
                        onPress={() => setSelectedCircleId(active ? null : circle.id)}
                        onLongPress={() => confirmDeleteCircle(circle)}
                        accessibilityLabel={t('ui.friends.circleA11y', { name: circle.name, count: circle.memberIds.length })}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.circleChipText, active && styles.circleChipTextActive]}>
                          {circle.name} ({circle.memberIds.length})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity
                    style={styles.newCircleChip}
                    onPress={() => setNewCircleModalVisible(true)}
                    accessibilityLabel={t('ui.friends.createANewCircleA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.newCircleChipText}>{t('ui.friends.newCircle')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
            <View style={styles.friendsHeaderRow}>
              <Text style={[styles.sectionHeader, { marginBottom: 0, marginTop: 0 }]}>
                {selectedCircleId ? circles.find((c) => c.id === selectedCircleId)?.name : t('ui.friends.yourFriends', { count: friends.length })}
              </Text>
              {/* Circles used to appear as a whole always-visible chip row the
                  moment anyone had a single friend -- a new UI concept
                  showing up unprompted, which read as a "random tab." Now it
                  only shows once you actually have a circle; this small text
                  link is the one deliberate way in for everyone else, so the
                  feature stays reachable without reintroducing the clutter. */}
              {circles.length === 0 && friends.length > 0 && (
                <TouchableOpacity
                  onPress={() => setNewCircleModalVisible(true)}
                  accessibilityLabel={t('ui.friends.organizeYourFriendsIntoCirclesA11y')}
                  accessibilityRole="button"
                >
                  <Text style={styles.organizeCirclesLink}>{t('ui.friends.organizeIntoCircles')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        }
        ListEmptyComponent={
          !loading && (
            <FadeInState opportunity style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🤝</Text>
              <Text style={styles.emptyText}>
                {t('ui.friends.addFriendsFromAnyonesProfile')}
              </Text>
              {/* Thursday plan item 25: the header's "Find Friends From
                  Contacts" button already covers one real path, but a
                  direct action attached to the empty state itself
                  shouldn't depend on the user noticing a button "above" --
                  Meet New People is a real, distinct destination that
                  button doesn't cover. */}
              <TouchableOpacity
                onPress={() => navigation.navigate('FriendDiscovery')}
                accessibilityLabel={t('ui.friends.meetNewPeopleNearbyA11y')}
                accessibilityRole="button"
                style={{ marginTop: spacing.md }}
              >
                <Text style={styles.emptyActionText}>{t('ui.friends.meetNewPeople')}</Text>
              </TouchableOpacity>
            </FadeInState>
          )
        }
        renderItem={({ item }) => (
          <PersonCard
            style={styles.friendRow}
            photoUrl={photoUrls[item.id]}
            name={item.display_name}
            onPress={() => navigation.navigate('ViewProfile', { userId: item.id })}
            action={
              circles.length > 0 ? (
                <TouchableOpacity
                  onPress={() => setManageCirclesFor(item)}
                  accessibilityLabel={t('ui.friends.manageCirclesForA11y', { name: item.display_name })}
                  accessibilityRole="button"
                >
                  <Text style={styles.circleTagIcon}>🏷️</Text>
                </TouchableOpacity>
              ) : null
            }
          />
        )}
      />
      )}

      <Modal visible={newCircleModalVisible} animationType={modalAnimation('slide')} transparent onRequestClose={() => setNewCircleModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={styles.modalSheet}>
                  <Text style={styles.modalTitle}>{t('ui.friends.newCircle2')}</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder={t('ui.friends.eGWorkFitnessFamily')}
                    placeholderTextColor={colors.textTertiary}
                    value={newCircleName}
                    onChangeText={setNewCircleName}
                    autoFocus
                    accessibilityLabel={t('ui.friends.circleNameA11y')}
                  />
                  <TouchableOpacity style={styles.modalButton} onPress={handleCreateCircle} activeOpacity={0.85} accessibilityLabel={t('ui.friends.createCircleA11y')} accessibilityRole="button">
                    <Text style={styles.modalButtonText}>{t('ui.friends.createCircle')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setNewCircleModalVisible(false); setNewCircleName(''); }} style={{ marginTop: spacing.md }}>
                    <Text style={styles.modalCancelText}>{t('ui.friends.cancel')}</Text>
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!manageCirclesFor} animationType={modalAnimation('slide')} transparent onRequestClose={() => setManageCirclesFor(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={styles.modalSheet}>
                  <Text style={styles.modalTitle}>{t('ui.friends.circlesFor', { name: manageCirclesFor?.display_name })}</Text>
                  {circles.length === 0 && (
                    <View>
                      <EmptyCopy id="friend_circles" />
                      {/* Thursday plan item 25: this modal used to point
                          the user back at "the Friends screen" they're
                          already on -- a self-referential dead end. Opens
                          the exact same New Circle modal the main screen's
                          own "+ Organize into Circles" link opens, right
                          from here. */}
                      <TouchableOpacity
                        onPress={() => { setManageCirclesFor(null); setNewCircleModalVisible(true); }}
                        accessibilityLabel={t('ui.friends.createACircleA11y')}
                        accessibilityRole="button"
                        style={{ marginTop: spacing.sm }}
                      >
                        <Text style={styles.emptyActionText}>{t('ui.friends.createACircle')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {circles.map((circle) => {
                    const isMember = manageCirclesFor && circle.memberIds.includes(manageCirclesFor.id);
                    return (
                      <TouchableOpacity
                        key={circle.id}
                        style={styles.circleToggleRow}
                        onPress={() => handleToggleCircleMembership(circle, manageCirclesFor.id)}
                        accessibilityLabel={isMember ? t('ui.friends.inCircleA11y', { name: circle.name }) : t('ui.friends.notInCircleA11y', { name: circle.name })}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isMember }}
                      >
                        <Text style={styles.circleToggleCheck}>{isMember ? '✓' : ''}</Text>
                        <Text style={styles.circleToggleName}>{circle.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity onPress={() => setManageCirclesFor(null)} style={{ marginTop: spacing.md }}>
                    <Text style={styles.modalCancelText}>{t('ui.friends.done')}</Text>
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      <MatchAnimation haptic
        kind="friend"
        visible={!!celebratingFriend}
        theirName={celebratingFriend?.display_name}
        theirPhotoUrl={photoUrls[celebratingFriend?.id]}
        onSayHi={() => {
          const userId = celebratingFriend?.id;
          setCelebratingFriend(null);
          if (userId) navigation.navigate('ViewProfile', { userId });
        }}
        onDismiss={() => setCelebratingFriend(null)}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  searchBarWrap: {
    flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  searchIcon: { fontSize: 14, marginRight: spacing.sm },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 14 },
  findContactsButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14,
    alignItems: 'center', marginBottom: spacing.lg,
  },
  findContactsButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sectionHeader: {
    ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: spacing.sm, marginTop: spacing.sm,
  },
  friendsHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.sm, marginTop: spacing.sm,
  },
  organizeCirclesLink: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  requestRow: { marginBottom: spacing.md },
  friendRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  circleTagIcon: { fontSize: 16, paddingHorizontal: spacing.sm },
  circlesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  circleChip: {
    backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  circleChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  circleChipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  circleChipTextActive: { color: '#fff' },
  newCircleChip: {
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  newCircleChipText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.md },
  modalInput: {
    backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  modalButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center' },
  modalButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  modalCancelText: { color: colors.textTertiary, textAlign: 'center' },
  circleToggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  circleToggleCheck: { width: 24, color: colors.primary, fontWeight: '800', fontSize: 16 },
  circleToggleName: { color: colors.textPrimary, fontSize: 15 },
  acceptButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 8 },
  acceptButtonSent: { backgroundColor: colors.success },
  acceptButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  declineButton: { backgroundColor: colors.surfaceElevated, borderRadius: radius.full, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  declineButtonText: { color: colors.textTertiary, fontSize: 14, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: spacing.xl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.lg },
  emptyActionText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
});