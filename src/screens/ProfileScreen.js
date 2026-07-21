import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Image, ScrollView, Switch } from 'react-native';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import { pickProfilePhoto, uploadProfilePhoto, getSignedPhotoUrl } from '../services/photos';
import { pickExtraPhoto, uploadExtraPhoto, getExtraPhotos, deleteExtraPhoto, setAsMainPhoto } from '../services/extraPhotos';
import { checkTextModeration } from '../services/textModeration';
import { deleteAccount } from '../services/account';
import { requestDataExport } from '../services/dataExport';
import { registerForPushNotifications, disablePushNotifications } from '../services/notifications';
import { BASICS_FIELDS } from '../constants/basicsFields';
import { colors, typography, spacing, radius, shadow } from '../theme';

const MAX_EXTRA_PHOTOS = 5;

const INTEREST_OPTIONS = [
  'Travel', 'Coffee', 'Hiking', 'Music', 'Movies', 'Foodie', 'Fitness',
  'Reading', 'Art', 'Gaming', 'Photography', 'Yoga', 'Dancing', 'Cooking',
  'Wine', 'Dogs', 'Cats', 'Outdoors', 'Sports', 'Concerts', 'Museums',
  'Volunteering', 'Meditation', 'Running',
];

export default function ProfileScreen({ navigation }) {
  const { isAdmin } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [userId, setUserId] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoVerified, setPhotoVerified] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [extraPhotos, setExtraPhotos] = useState([]);
  const [uploadingExtra, setUploadingExtra] = useState(false);
  const [interests, setInterests] = useState([]);
  const [pronouns, setPronouns] = useState('');
  const [gender, setGender] = useState('');
  const [sexualOrientation, setSexualOrientation] = useState('');
  const [profileHidden, setProfileHidden] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [basics, setBasics] = useState({});

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
      setInterests(data.interests || []);
      setPronouns(data.pronouns || '');
      setGender(data.gender || '');
      setSexualOrientation(data.sexual_orientation || '');
      setProfileHidden(!!data.profile_hidden);
      setNotificationsEnabled(!!data.expo_push_token);
      setBasics(data.basics || {});
      if (data.photo_url) {
        const url = await getSignedPhotoUrl(data.photo_url);
        setPhotoUrl(url);
      }
    }

    const extras = await getExtraPhotos(id);
    setExtraPhotos(extras);
  }

  function toggleInterest(interest) {
    setInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  }

  function setBasicField(key, value) {
    setBasics((prev) => {
      const next = { ...prev };
      if (next[key] === value) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  function setBasicTextField(key, value) {
    setBasics((prev) => ({ ...prev, [key]: value }));
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
    for (const [label, value] of [['Pronouns', pronouns], ['Gender', gender], ['Sexual orientation', sexualOrientation]]) {
      if (value.trim()) {
        const check = await checkTextModeration(value);
        if (!check.safe) {
          return Alert.alert(`${label} not allowed`, `Please revise this field and try again.`);
        }
      }
    }

    const textBasicsFields = BASICS_FIELDS.filter((f) => f.type === 'text');
    for (const field of textBasicsFields) {
      const value = basics[field.key];
      if (value && value.trim()) {
        const check = await checkTextModeration(value);
        if (!check.safe) {
          return Alert.alert(`${field.label} not allowed`, `Please revise this field and try again.`);
        }
      }
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: displayName,
        bio,
        interests,
        pronouns: pronouns.trim() || null,
        gender: gender.trim() || null,
        sexual_orientation: sexualOrientation.trim() || null,
        basics,
      })
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

  async function addExtraPhoto() {
    if (extraPhotos.length >= MAX_EXTRA_PHOTOS) {
      return Alert.alert('Limit reached', `You can add up to ${MAX_EXTRA_PHOTOS} additional photos.`);
    }
    try {
      const asset = await pickExtraPhoto();
      if (!asset) return;
      setUploadingExtra(true);
      await uploadExtraPhoto(userId, asset, extraPhotos.length);
      setUploadingExtra(false);
      load();
    } catch (e) {
      setUploadingExtra(false);
      Alert.alert('Upload failed', e.message);
    }
  }

  function confirmDeleteExtraPhoto(photo) {
    Alert.alert('Photo options', '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Set as Main Photo',
        onPress: async () => {
          try {
            await setAsMainPhoto(userId, photo.id);
            load();
          } catch (e) {
            Alert.alert('Error', e.message);
          }
        },
      },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteExtraPhoto(photo.id, photo.photo_url);
            load();
          } catch (e) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  }

  async function toggleHideProfile(value) {
    setProfileHidden(value);
    const { error } = await supabase.from('profiles').update({ profile_hidden: value }).eq('id', userId);
    if (error) {
      setProfileHidden(!value);
      Alert.alert('Error', error.message);
    }
  }

  async function toggleNotifications(value) {
    setNotificationsEnabled(value);
    try {
      if (value) {
        await registerForPushNotifications(userId);
      } else {
        await disablePushNotifications(userId);
      }
    } catch (e) {
      setNotificationsEnabled(!value);
      Alert.alert('Error', e.message);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function handleDataExport() {
    setExporting(true);
    try {
      await requestDataExport();
    } catch (e) {
      Alert.alert('Export failed', e.message);
    }
    setExporting(false);
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
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Your Profile</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.settingsGear}>
            <Text style={styles.settingsGearText}>⚙️</Text>
          </TouchableOpacity>
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
            {photoVerified ? 'Main photo verified' : 'Main photo pending review'}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>More Photos</Text>
        <View style={styles.galleryGrid}>
          {extraPhotos.map((photo) => (
            <TouchableOpacity
              key={photo.id}
              style={styles.galleryItem}
              onLongPress={() => confirmDeleteExtraPhoto(photo)}
              activeOpacity={0.85}
            >
              {photo.signedUrl && <Image source={{ uri: photo.signedUrl }} style={styles.galleryImage} />}
              {!photo.photo_verified && (
                <View style={styles.pendingOverlay}>
                  <Text style={styles.pendingOverlayText}>Pending</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
          {extraPhotos.length < MAX_EXTRA_PHOTOS && (
            <TouchableOpacity style={styles.addPhotoButton} onPress={addExtraPhoto} disabled={uploadingExtra} activeOpacity={0.85}>
              <Text style={styles.addPhotoText}>{uploadingExtra ? '...' : '+'}</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.helperText}>Tap and hold a photo for options — set as main or remove. Up to {MAX_EXTRA_PHOTOS} additional photos.</Text>

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

        <Text style={styles.sectionLabel}>About You (Optional)</Text>
        <View style={styles.formCard}>
          <Text style={styles.label}>Pronouns</Text>
          <TextInput
            style={styles.input}
            value={pronouns}
            onChangeText={setPronouns}
            placeholder="e.g. she/her, he/him, they/them"
            placeholderTextColor={colors.textTertiary}
          />

          <Text style={styles.label}>Gender</Text>
          <TextInput
            style={styles.input}
            value={gender}
            onChangeText={setGender}
            placeholder="Optional"
            placeholderTextColor={colors.textTertiary}
          />

          <Text style={styles.label}>Sexual Orientation</Text>
          <TextInput
            style={styles.input}
            value={sexualOrientation}
            onChangeText={setSexualOrientation}
            placeholder="Optional"
            placeholderTextColor={colors.textTertiary}
          />
        </View>

        <Text style={styles.sectionLabel}>Details (Optional)</Text>
        <View style={styles.formCard}>
          {BASICS_FIELDS.filter((f) => f.type === 'text').map((field) => (
            <View key={field.key} style={styles.basicFieldBlock}>
              <Text style={styles.label}>{field.icon} {field.label}</Text>
              <TextInput
                style={styles.input}
                value={basics[field.key] || ''}
                onChangeText={(v) => setBasicTextField(field.key, v)}
                placeholder={field.placeholder}
                placeholderTextColor={colors.textTertiary}
              />
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Basics (Optional)</Text>
        <View style={styles.formCard}>
          {BASICS_FIELDS.filter((f) => f.type === 'select').map((field) => (
            <View key={field.key} style={styles.basicFieldBlock}>
              <Text style={styles.label}>{field.icon} {field.label}</Text>
              <View style={styles.chipsWrap}>
                {field.options.map((option) => {
                  const selected = basics[field.key] === option;
                  return (
                    <TouchableOpacity
                      key={option}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => setBasicField(field.key, option)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Interests</Text>
        <View style={styles.chipsWrap}>
          {INTEREST_OPTIONS.map((interest) => {
            const selected = interests.includes(interest);
            return (
              <TouchableOpacity
                key={interest}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => toggleInterest(interest)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{interest}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity style={styles.button} onPress={save} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Save Changes</Text>
        </TouchableOpacity>

        <View style={styles.settingsCard}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Hide my profile</Text>
              <Text style={styles.settingSubtext}>Temporarily remove yourself from Discovery</Text>
            </View>
            <Switch
              value={profileHidden}
              onValueChange={toggleHideProfile}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
          <View style={styles.settingDivider} />
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Push notifications</Text>
              <Text style={styles.settingSubtext}>Get notified about matches and messages</Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={toggleNotifications}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
        </View>

        <TouchableOpacity style={styles.premiumButton} onPress={() => navigation.navigate('Paywall')} activeOpacity={0.85}>
          <Text style={styles.premiumButtonText}>✨ Manage Premium</Text>
        </TouchableOpacity>

        {isAdmin && (
          <TouchableOpacity style={styles.adminButton} onPress={() => navigation.navigate('AdminReports')} activeOpacity={0.85}>
            <Text style={styles.adminButtonText}>Review Reports (Admin)</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.signOutButton} onPress={handleDataExport} disabled={exporting}>
          <Text style={styles.signOutText}>{exporting ? 'Preparing export...' : 'Request My Data'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteButton} onPress={confirmDeleteAccount} disabled={deleting}>
          <Text style={styles.deleteText}>
            {deleting ? 'Deleting account...' : 'Delete Account'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { marginBottom: spacing.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settingsGear: { padding: spacing.xs },
  settingsGearText: { fontSize: 22 },
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
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.lg, textTransform: 'uppercase', letterSpacing: 0.5 },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xs },
  galleryItem: {
    width: 72, height: 72, borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  galleryImage: { width: '100%', height: '100%' },
  pendingOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingVertical: 2,
  },
  pendingOverlayText: { color: '#fff', fontSize: 9, textAlign: 'center', fontWeight: '700' },
  addPhotoButton: {
    width: 72, height: 72, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center',
  },
  addPhotoText: { color: colors.textTertiary, fontSize: 28, fontWeight: '300' },
  helperText: { ...typography.small, color: colors.textTertiary, marginBottom: spacing.md },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  basicFieldBlock: { marginBottom: spacing.sm },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: colors.surfaceElevated, color: colors.textPrimary, borderRadius: radius.sm, padding: spacing.md, fontSize: 15 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', ...shadow.button, marginTop: spacing.sm },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  settingsCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, marginTop: spacing.lg, padding: spacing.md,
  },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  settingDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  settingLabel: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  settingSubtext: { ...typography.small, color: colors.textTertiary, marginTop: 2 },
  premiumButton: { borderColor: colors.primary, borderWidth: 1.5, borderRadius: radius.full, paddingVertical: 15, alignItems: 'center', marginTop: spacing.lg },
  premiumButtonText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  adminButton: { backgroundColor: colors.surface, borderRadius: radius.full, paddingVertical: 15, alignItems: 'center', marginTop: spacing.md, borderWidth: 1, borderColor: colors.border },
  adminButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
  signOutButton: { paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md },
  signOutText: { color: colors.textTertiary, fontSize: 14 },
  deleteButton: { paddingVertical: spacing.sm, alignItems: 'center' },
  deleteText: { color: colors.primary, fontSize: 13, opacity: 0.7 },
});