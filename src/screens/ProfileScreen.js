import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Image } from 'react-native';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import { pickProfilePhoto, uploadProfilePhoto, getSignedPhotoUrl } from '../services/photos';
import { checkTextModeration } from '../services/textModeration';
import { deleteAccount } from '../services/account';
import { colors, typography, spacing, radius, shadow } from '../theme';

export default function ProfileScreen({ navigation }) {
  const { isAdmin } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [userId, setUserId] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoVerified, setPhotoVerified] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: sessionData } = await supabase.auth.getSession();
    const id = sessionData?.session?.user?.id;
    setUserId(id);

    const { data } = await supabase.from('profiles').select('*').eq('id', id).single();
    if (data) {
      setDisplayName(data.display_name || '');
      setBio(data.bio || '');
      setPhotoVerified(!!data.photo_verified);
      if (data.photo_url) {
        const url = await getSignedPhotoUrl(data.photo_url);
        setPhotoUrl(url);
      }
    }
  }

  async function save() {
    const nameCheck = await checkTextModeration(displayName);
    if (!nameCheck.safe) {
      return Alert.alert('Display name not allowed', 'Please revise your display name and try again.');
    }
    const bioCheck = await checkTextModeration(bio);
    if (!bioCheck.safe) {
      return Alert.alert('Bio not allowed', 'Please revise your bio and try again.');
    }

    const { error } = await supabase
      .from('profiles')
      .update({ display_name: displayName, bio })
      .eq('id', userId);
    if (error) return Alert.alert('Error', error.message);
    Alert.alert('Saved');
  }

  async function changePhoto() {
    try {
      const asset = await pickProfilePhoto();
      if (!asset) return;
      setUploading(true);
      await uploadProfilePhoto(userId, asset);
      setUploading(false);
      Alert.alert('Photo updated', 'Your new photo is being reviewed before it appears to others.');
      load();
    } catch (e) {
      setUploading(false);
      Alert.alert('Upload failed', e.message);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  function confirmDeleteAccount() {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your profile, photo, matches, and messages. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', style: 'destructive', onPress: confirmDeleteAccountFinal },
      ]
    );
  }

  function confirmDeleteAccountFinal() {
    Alert.alert(
      'Are you absolutely sure?',
      'Your account and all associated data will be permanently deleted right now.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete My Account', style: 'destructive', onPress: handleDeleteAccount },
      ]
    );
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      await deleteAccount();
    } catch (e) {
      setDeleting(false);
      Alert.alert('Deletion failed', e.message);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Your Profile</Text>
      </View>

      <TouchableOpacity style={styles.photoWrap} onPress={changePhoto} disabled={uploading} activeOpacity={0.85}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.photoPreview} />
        ) : (
          <Text style={styles.photoPickerText}>{uploading ? 'Uploading...' : 'Tap to\nadd a photo'}</Text>
        )}
        <View style={styles.photoEditBadge}>
          <Text style={styles.photoEditBadgeText}>✎</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.verifiedRow}>
        <View style={[styles.verifiedDot, photoVerified && styles.verifiedDotActive]} />
        <Text style={styles.verifiedText}>
          {photoVerified ? 'Photo verified' : 'Photo pending review'}
        </Text>
      </View>

      <View style={styles.formCard}>
        <Text style={styles.label}>Display Name</Text>
        <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholderTextColor={colors.textTertiary} />

        <Text style={styles.label}>Bio</Text>
        <TextInput
          style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
          value={bio}
          onChangeText={setBio}
          multiline
          placeholderTextColor={colors.textTertiary}
        />
      </View>

      <TouchableOpacity style={styles.button} onPress={save} activeOpacity={0.85}>
        <Text style={styles.buttonText}>Save Changes</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.premiumButton} onPress={() => navigation.navigate('Paywall')} activeOpacity={0.85}>
        <Text style={styles.premiumButtonText}>✨ Manage Premium</Text>
      </TouchableOpacity>

      {isAdmin && (
        <TouchableOpacity style={styles.adminButton} onPress={() => navigation.navigate('AdminReports')} activeOpacity={0.85}>
          <Text style={styles.adminButtonText}>Review Reports (Admin)</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.deleteButton} onPress={confirmDeleteAccount} disabled={deleting}>
        <Text style={styles.deleteText}>
          {deleting ? 'Deleting account...' : 'Delete Account'}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  header: { marginBottom: spacing.lg },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  photoWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    height: 110,
    width: 110,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoPreview: { width: '100%', height: '100%' },
  photoPickerText: { color: colors.textTertiary, textAlign: 'center', fontSize: 12 },
  photoEditBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: colors.primary,
    width: 26,
    height: 26,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoEditBadgeText: { color: '#fff', fontSize: 12 },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, marginBottom: spacing.lg },
  verifiedDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.textTertiary, marginRight: 6 },
  verifiedDotActive: { backgroundColor: colors.success },
  verifiedText: { ...typography.caption, color: colors.textTertiary },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: colors.surfaceElevated, color: colors.textPrimary, borderRadius: radius.sm, padding: spacing.md, fontSize: 15 },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', ...shadow.button },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  premiumButton: { borderColor: colors.primary, borderWidth: 1.5, borderRadius: radius.full, paddingVertical: 15, alignItems: 'center', marginTop: spacing.md },
  premiumButtonText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  adminButton: { backgroundColor: colors.surface, borderRadius: radius.full, paddingVertical: 15, alignItems: 'center', marginTop: spacing.md, borderWidth: 1, borderColor: colors.border },
  adminButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
  signOutButton: { paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md },
  signOutText: { color: colors.textTertiary, fontSize: 14 },
  deleteButton: { paddingVertical: spacing.sm, alignItems: 'center' },
  deleteText: { color: colors.primary, fontSize: 13, opacity: 0.7 },
});