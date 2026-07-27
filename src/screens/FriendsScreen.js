import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Image, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyFriends, getPendingFriendRequests, respondToFriendRequest } from '../services/friends';
import { getSignedPhotoUrl } from '../services/photos';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export default function FriendsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [friends, setFriends] = useState([]);
  const [pending, setPending] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);

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

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={friends}
        keyExtractor={(item) => item.friendshipId}
        contentContainerStyle={{ padding: spacing.lg }}
        ListHeaderComponent={
          <>
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
                Add friends from anyone's profile to see who's interested in the same gatherings as you.
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
  acceptButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  declineButton: { backgroundColor: colors.surfaceElevated, borderRadius: radius.full, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  declineButtonText: { color: colors.textTertiary, fontSize: 14, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: spacing.xl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.lg },
});