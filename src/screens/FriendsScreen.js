import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Image, StyleSheet, SafeAreaView, Alert, ActivityIndicator, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyFriends, getPendingFriendRequests, respondToFriendRequest, sendFriendRequest } from '../services/friends';
import { findFriendsFromContacts } from '../services/contactsImport';
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

  const load = useCallback(async () => {
    const [friendsList, pendingList] = await Promise.all([getMyFriends(), getPendingFriendRequests()]);
    setFriends(friendsList);
    setPending(pendingList);

    const all = [...friendsList, ...pendingList];
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

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={friends.filter((f) => !friendSearch.trim() || f.display_name?.toLowerCase().includes(friendSearch.trim().toLowerCase()))}
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
            <Text style={styles.sectionHeader}>Your Friends ({friends.length})</Text>
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
          <TouchableOpacity
            style={styles.friendRow}
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
        )}
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
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  requestRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  personInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  friendRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  avatarPlaceholder: {},
  personName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  acceptButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 8 },
  acceptButtonSent: { backgroundColor: colors.success },
  acceptButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  declineButton: { backgroundColor: colors.surfaceElevated, borderRadius: radius.full, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  declineButtonText: { color: colors.textTertiary, fontSize: 14, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: spacing.xl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.lg },
});