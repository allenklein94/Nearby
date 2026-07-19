import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Image } from 'react-native';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import { pickProfilePhoto, uploadProfilePhoto, getSignedPhotoUrl } from '../services/photos';
import { checkTextModeration } from '../services/textModeration';
import { deleteAccount } from '../services/account';

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
      .upsert({ id: userId, display_name: displayName, bio });
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
    // Second, more explicit confirmation — deletion is irreversible and
    // this is a big enough action to deserve two distinct taps, not one
    // accidental one.
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
      // After this resolves, AuthContext's session listener detects the
      // sign-out and RootNavigator automatically returns to Onboarding —
      // no manual navigation needed here.
    } catch (e) {
      setDeleting(false);
      Alert.alert('Deletion failed', e.message);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Your Profile</Text>

      <TouchableOpacity style={styles.photoPicker} onPress={changePhoto} disabled={uploading}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.photoPreview} />
        ) : (
          <Text style={styles.photoPickerText}>{uploading ? 'Uploading...' : 'Tap to add a photo'}</Text>
        )}
      </TouchableOpacity>
      <Text style={styles.verifiedText}>
        {photoVerified ? 'Photo verified ✓' : 'Photo pending review'}
      </Text>

      <Text style={styles.label}>Display Name</Text>
      <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} />

      <Text style={styles.label}>Bio</Text>
      <TextInput
        style={[styles.input, { height: 100 }]}
        value={bio}
        onChangeText={setBio}
        multiline
      />

      <TouchableOpacity style={styles.button} onPress={save}>
        <Text style={styles.buttonText}>Save</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.premiumButton} onPress={() => navigation.navigate('Paywall')}>
        <Text style={styles.premiumButtonText}>Manage Premium</Text>
      </TouchableOpacity>

      {isAdmin && (
        <TouchableOpacity style={styles.adminButton} onPress={() => navigation.navigate('AdminReports')}>
          <Text style={styles.adminButtonText}>Review Reports (Admin)</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.deleteButton}
        onPress={confirmDeleteAccount}
        disabled={deleting}
      >
        <Text style={styles.deleteText}>
          {deleting ? 'Deleting account...' : 'Delete Account'}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 20 },
  header: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 20 },
  photoPicker: {
    backgroundColor: '#2a2a4a', borderRadius: 16, height: 120, width: 120,
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden', alignSelf: 'center',
  },
  photoPreview: { width: '100%', height: '100%' },
  photoPickerText: { color: '#8888a8', textAlign: 'center', paddingHorizontal: 10, fontSize: 12 },
  verifiedText: { color: '#8888a8', fontSize: 12, textAlign: 'center', marginTop: 8, marginBottom: 4 },
  label: { color: '#8888a8', fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '#2a2a4a', color: '#fff', borderRadius: 12, padding: 14 },
  button: { backgroundColor: '#e94560', borderRadius: 30, paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  premiumButton: { borderColor: '#e94560', borderWidth: 1, borderRadius: 30, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  premiumButtonText: { color: '#e94560', fontWeight: '600', fontSize: 16 },
  adminButton: { backgroundColor: '#2a2a4a', borderRadius: 30, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  adminButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  signOutButton: { paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  signOutText: { color: '#8888a8', fontSize: 14 },
  deleteButton: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  deleteText: { color: '#e94560', fontSize: 13, opacity: 0.8 },
});