import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Image, StyleSheet, SafeAreaView, Alert, ActivityIndicator, TextInput, Modal } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyFriends, getPendingFriendRequests, respondToFriendRequest, sendFriendRequest, getSuggestedFriends } from '../services/friends';
import { getMyCircles, createCircle, deleteCircle, addFriendToCircle, removeFriendFromCircle } from '../services/friendCircles';
import { findFriendsFromContacts } from '../services/contactsImport';
import StoriesRow from '../components/StoriesRow';
import { Share } from 'react-native';
import { getSignedPhotoUrl } from '../services/photos';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export default function FriendsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [friends, setFriends] = useState([]);
  const [friendSearch, setFriendSearch] = useState('');
  const [pending, setPending] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [contactMatches, setContactMatches] = useState(null);
  const [searchingContacts, setSearchingContacts] = useState(false);
  const [requestedIds, setRequestedIds] = useState({});
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
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleRespond(friendshipId, accept) {
    try {
      await respondToFriendRequest(friendshipId, accept);
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
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
        Alert.alert('No new matches', "We didn't find any new people from your contacts.");
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSearchingContacts(false);
  }

  async function handleInviteContact(contact) {
    try {
      await Share.share({
        message: `Hey ${contact.name}, come join me on Nearby! Download it here: https://apps.apple.com/app/id6792143175`,
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
      Alert.alert('Error', e.message);
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
      Alert.alert('Error', e.message);
    }
  }

  function confirmDeleteCircle(circle) {
    Alert.alert(`Delete "${circle.name}"?`, 'This only removes the circle, not the friends in it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
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
      Alert.alert('Error', e.message);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StoriesRow />
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
                placeholder="Search your friends..."
                placeholderTextColor={colors.textTertiary}
                value={friendSearch}
                onChangeText={setFriendSearch}
                accessibilityLabel="Search friends by name"
              />
            </View>

            <TouchableOpacity
              style={styles.findContactsButton}
              onPress={handleFindFromContacts}
              disabled={searchingContacts}
              accessibilityLabel="Find friends from your contacts who are already on Nearby"
              accessibilityRole="button"
            >
              {searchingContacts ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.findContactsButtonText}>📱 Find Friends From Contacts</Text>
              )}
            </TouchableOpacity>

            {suggestedFriends.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>People You May Know</Text>
                {suggestedFriends.map((person) => (
                  <View key={person.suggested_id} style={styles.requestRow}>
                    <TouchableOpacity
                      style={styles.personInfo}
                      onPress={() => navigation.navigate('ViewProfile', { userId: person.suggested_id })}
                      accessibilityLabel={`View ${person.display_name}'s profile, ${person.mutual_count} mutual friends`}
                      accessibilityRole="button"
                    >
                      {photoUrls[person.suggested_id] ? (
                        <Image source={{ uri: photoUrls[person.suggested_id] }} style={styles.avatar} />
                      ) : (
                        <View style={[styles.avatar, styles.avatarPlaceholder]} />
                      )}
                      <View>
                        <Text style={styles.personName}>{person.display_name}</Text>
                        <Text style={styles.mutualText}>{person.mutual_count} mutual friend{person.mutual_count === 1 ? '' : 's'}</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.acceptButton, requestedIds[person.suggested_id] && styles.acceptButtonSent]}
                      onPress={() => handleSendRequest(person.suggested_id)}
                      disabled={requestedIds[person.suggested_id]}
                      accessibilityLabel={requestedIds[person.suggested_id] ? 'Friend request sent' : `Send friend request to ${person.display_name}`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.acceptButtonText}>{requestedIds[person.suggested_id] ? '✓ Sent' : 'Add'}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <View style={styles.divider} />
              </>
            )}

            {contactMatches !== null && contactMatches.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>From Your Contacts</Text>
                {contactMatches.map((person) => (
                  <View key={person.id} style={styles.requestRow}>
                    <TouchableOpacity
                      style={styles.personInfo}
                      onPress={() => navigation.navigate('ViewProfile', { userId: person.id })}
                      accessibilityLabel={`View ${person.display_name}'s profile`}
                      accessibilityRole="button"
                    >
                      {photoUrls[person.id] ? (
                        <Image source={{ uri: photoUrls[person.id] }} style={styles.avatar} />
                      ) : (
                        <View style={[styles.avatar, styles.avatarPlaceholder]} />
                      )}
                      <Text style={styles.personName}>{person.display_name}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.acceptButton, requestedIds[person.id] && styles.acceptButtonSent]}
                      onPress={() => handleSendRequest(person.id)}
                      disabled={requestedIds[person.id]}
                      accessibilityLabel={requestedIds[person.id] ? 'Friend request sent' : `Send friend request to ${person.display_name}`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.acceptButtonText}>{requestedIds[person.id] ? '✓ Sent' : 'Add'}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <View style={styles.divider} />
              </>
            )}

            {notOnAppContacts.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>Not On Nearby Yet</Text>
                {notOnAppContacts.map((contact) => (
                  <View key={contact.phone} style={styles.requestRow}>
                    <View style={styles.personInfo}>
                      <View style={[styles.avatar, styles.avatarPlaceholder]} />
                      <Text style={styles.personName}>{contact.name}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.acceptButton}
                      onPress={() => handleInviteContact(contact)}
                      accessibilityLabel={`Invite ${contact.name} to Nearby`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.acceptButtonText}>Invite</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <View style={styles.divider} />
              </>
            )}

            {pending.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>Friend Requests</Text>
                {pending.map((person) => (
                  <View key={person.friendshipId} style={styles.requestRow}>
                    <TouchableOpacity
                      style={styles.personInfo}
                      onPress={() => navigation.navigate('ViewProfile', { userId: person.id })}
                      accessibilityLabel={`View ${person.display_name}'s profile`}
                      accessibilityRole="button"
                    >
                      {photoUrls[person.id] ? (
                        <Image source={{ uri: photoUrls[person.id] }} style={styles.avatar} />
                      ) : (
                        <View style={[styles.avatar, styles.avatarPlaceholder]} />
                      )}
                      <Text style={styles.personName}>{person.display_name}</Text>
                    </TouchableOpacity>
                    <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                      <TouchableOpacity
                        style={styles.acceptButton}
                        onPress={() => handleRespond(person.friendshipId, true)}
                        accessibilityLabel={`Accept friend request from ${person.display_name}`}
                        accessibilityRole="button"
                      >
                        <Text style={styles.acceptButtonText}>Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.declineButton}
                        onPress={() => handleRespond(person.friendshipId, false)}
                        accessibilityLabel={`Decline friend request from ${person.display_name}`}
                        accessibilityRole="button"
                      >
                        <Text style={styles.declineButtonText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                <View style={styles.divider} />
              </>
            )}
            {(circles.length > 0 || friends.length > 0) && (
              <>
                <Text style={styles.sectionHeader}>Circles</Text>
                <View style={styles.circlesRow}>
                  {circles.map((circle) => {
                    const active = selectedCircleId === circle.id;
                    return (
                      <TouchableOpacity
                        key={circle.id}
                        style={[styles.circleChip, active && styles.circleChipActive]}
                        onPress={() => setSelectedCircleId(active ? null : circle.id)}
                        onLongPress={() => confirmDeleteCircle(circle)}
                        accessibilityLabel={`${circle.name}, ${circle.memberIds.length} friends. Long press to delete.`}
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
                    accessibilityLabel="Create a new circle"
                    accessibilityRole="button"
                  >
                    <Text style={styles.newCircleChipText}>+ New Circle</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
            <Text style={styles.sectionHeader}>
              {selectedCircleId ? circles.find((c) => c.id === selectedCircleId)?.name : `Your Friends (${friends.length})`}
            </Text>
          </>
        }
        ListEmptyComponent={
          !loading && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🤝</Text>
              <Text style={styles.emptyText}>
                Add friends from anyone's profile, or find friends from your contacts above, to see who's interested in the same gatherings as you.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <View style={styles.friendRow}>
            <TouchableOpacity
              style={styles.personInfo}
              onPress={() => navigation.navigate('ViewProfile', { userId: item.id })}
              accessibilityLabel={`View ${item.display_name}'s profile`}
              accessibilityRole="button"
            >
              {photoUrls[item.id] ? (
                <Image source={{ uri: photoUrls[item.id] }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]} />
              )}
              <Text style={styles.personName}>{item.display_name}</Text>
            </TouchableOpacity>
            {circles.length > 0 && (
              <TouchableOpacity
                onPress={() => setManageCirclesFor(item)}
                accessibilityLabel={`Manage circles for ${item.display_name}`}
                accessibilityRole="button"
              >
                <Text style={styles.circleTagIcon}>🏷️</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      />

      <Modal visible={newCircleModalVisible} animationType="slide" transparent onRequestClose={() => setNewCircleModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>New Circle</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Work, Fitness, Family, Travel"
              placeholderTextColor={colors.textTertiary}
              value={newCircleName}
              onChangeText={setNewCircleName}
              autoFocus
              accessibilityLabel="Circle name"
            />
            <TouchableOpacity style={styles.modalButton} onPress={handleCreateCircle} activeOpacity={0.85} accessibilityLabel="Create circle" accessibilityRole="button">
              <Text style={styles.modalButtonText}>Create Circle</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setNewCircleModalVisible(false); setNewCircleName(''); }} style={{ marginTop: spacing.md }}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!manageCirclesFor} animationType="slide" transparent onRequestClose={() => setManageCirclesFor(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Circles for {manageCirclesFor?.display_name}</Text>
            {circles.length === 0 && <Text style={styles.emptyText}>No circles yet — create one from the Friends screen first.</Text>}
            {circles.map((circle) => {
              const isMember = manageCirclesFor && circle.memberIds.includes(manageCirclesFor.id);
              return (
                <TouchableOpacity
                  key={circle.id}
                  style={styles.circleToggleRow}
                  onPress={() => handleToggleCircleMembership(circle, manageCirclesFor.id)}
                  accessibilityLabel={`${circle.name}, ${isMember ? 'in this circle' : 'not in this circle'}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isMember }}
                >
                  <Text style={styles.circleToggleCheck}>{isMember ? '✓' : ''}</Text>
                  <Text style={styles.circleToggleName}>{circle.name}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity onPress={() => setManageCirclesFor(null)} style={{ marginTop: spacing.md }}>
              <Text style={styles.modalCancelText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  requestRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  personInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  friendRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm,
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
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  avatarPlaceholder: {},
  personName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  mutualText: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  acceptButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 8 },
  acceptButtonSent: { backgroundColor: colors.success },
  acceptButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  declineButton: { backgroundColor: colors.surfaceElevated, borderRadius: radius.full, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  declineButtonText: { color: colors.textTertiary, fontSize: 14, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: spacing.xl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.lg },
});