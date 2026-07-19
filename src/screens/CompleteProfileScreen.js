import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Image, Platform, Linking } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '../services/supabase';
import { pickProfilePhoto, uploadProfilePhoto } from '../services/photos';
import { useAuth } from '../context/AuthContext';

const MIN_AGE = 18;
const TERMS_URL = 'https://allenklein94.github.io/Nearby/terms.html';
const PRIVACY_URL = 'https://allenklein94.github.io/Nearby/privacy.html';

function calculateAge(birthdate) {
  const today = new Date();
  let age = today.getFullYear() - birthdate.getFullYear();
  const monthDiff = today.getMonth() - birthdate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthdate.getDate())) {
    age--;
  }
  return age;
}

export default function CompleteProfileScreen() {
  const { refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [birthdate, setBirthdate] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [photoAsset, setPhotoAsset] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const maxSelectableDate = new Date();
  maxSelectableDate.setFullYear(maxSelectableDate.getFullYear() - MIN_AGE);

  async function choosePhoto() {
    try {
      const asset = await pickProfilePhoto();
      if (asset) setPhotoAsset(asset);
    } catch (e) {
      Alert.alert('Couldn\u2019t access photos', e.message);
    }
  }

  async function submit() {
    if (!displayName.trim()) {
      return Alert.alert('Name required', 'Enter a display name.');
    }
    if (!birthdate) {
      return Alert.alert('Birthdate required', 'This app is 18+ only — enter your date of birth.');
    }
    const age = calculateAge(birthdate);
    if (age < MIN_AGE) {
      return Alert.alert(
        'Age requirement not met',
        'You must be 18 or older to use this app.'
      );
    }
    if (!photoAsset) {
      return Alert.alert('Photo required', 'Add a profile photo to continue. It\u2019ll be reviewed before it\u2019s visible to others.');
    }
    if (!agreedToTerms) {
      return Alert.alert(
        'Agreement required',
        'You must agree to the Terms of Service and Privacy Policy to use Nearby.'
      );
    }

    setSubmitting(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;

    const { error: profileError } = await supabase.from('profiles').upsert({
      id: userId,
      display_name: displayName.trim(),
      birthdate: birthdate.toISOString().split('T')[0],
      terms_accepted_at: new Date().toISOString(),
    });

    if (profileError) {
      setSubmitting(false);
      return Alert.alert('Error', profileError.message);
    }

    try {
      await uploadProfilePhoto(userId, photoAsset);
    } catch (e) {
      setSubmitting(false);
      return Alert.alert('Photo upload failed', e.message);
    }

    setSubmitting(false);
    Alert.alert(
      'Almost there',
      'Your profile is saved. Your photo is being reviewed and will appear to others shortly — usually within a few minutes.'
    );
    refreshProfile();
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Complete your profile</Text>
      <Text style={styles.subheader}>Nearby is for adults 18+ only.</Text>

      <Text style={styles.label}>Display Name</Text>
      <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="How you'll appear to others" placeholderTextColor="#8888a8" />

      <Text style={styles.label}>Date of Birth</Text>
      <TouchableOpacity style={styles.input} onPress={() => setShowPicker(true)}>
        <Text style={{ color: birthdate ? '#fff' : '#8888a8' }}>
          {birthdate ? birthdate.toLocaleDateString() : 'Tap to select'}
        </Text>
      </TouchableOpacity>
      {showPicker && (
        <DateTimePicker
          value={birthdate || maxSelectableDate}
          mode="date"
          maximumDate={maxSelectableDate}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, selectedDate) => {
            setShowPicker(Platform.OS === 'ios');
            if (selectedDate) setBirthdate(selectedDate);
          }}
        />
      )}

      <Text style={styles.label}>Profile Photo</Text>
      <TouchableOpacity style={styles.photoPicker} onPress={choosePhoto}>
        {photoAsset ? (
          <Image source={{ uri: photoAsset.uri }} style={styles.photoPreview} />
        ) : (
          <Text style={styles.photoPickerText}>Tap to choose a photo</Text>
        )}
      </TouchableOpacity>
      <Text style={styles.helperText}>
        Every photo is reviewed before your profile becomes visible to anyone else.
      </Text>

      <TouchableOpacity
        style={styles.consentRow}
        onPress={() => setAgreedToTerms(!agreedToTerms)}
        activeOpacity={0.7}
      >
        <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
          {agreedToTerms && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.consentText}>
          I agree to the{' '}
          <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)}>
            Terms of Service
          </Text>
          {' '}and{' '}
          <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)}>
            Privacy Policy
          </Text>
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, !agreedToTerms && styles.buttonDisabled]}
        onPress={submit}
        disabled={submitting}
      >
        <Text style={styles.buttonText}>{submitting ? 'Saving...' : 'Continue'}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 24, paddingTop: 40 },
  header: { fontSize: 26, fontWeight: '700', color: '#fff' },
  subheader: { color: '#8888a8', fontSize: 14, marginBottom: 20 },
  label: { color: '#8888a8', fontSize: 13, marginBottom: 6, marginTop: 16 },
  input: { backgroundColor: '#2a2a4a', color: '#fff', borderRadius: 12, padding: 14, justifyContent: 'center', minHeight: 48 },
  photoPicker: {
    backgroundColor: '#2a2a4a', borderRadius: 16, height: 160, width: 160,
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden', alignSelf: 'center', marginTop: 8,
  },
  photoPreview: { width: '100%', height: '100%' },
  photoPickerText: { color: '#8888a8', textAlign: 'center', paddingHorizontal: 12 },
  helperText: { color: '#8888a8', fontSize: 12, textAlign: 'center', marginTop: 10, lineHeight: 16 },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 24, paddingHorizontal: 4 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#8888a8',
    marginRight: 10, marginTop: 2, justifyContent: 'center', alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: '#e94560', borderColor: '#e94560' },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  consentText: { color: '#c9c9e0', fontSize: 13, flex: 1, lineHeight: 19 },
  link: { color: '#e94560', textDecorationLine: 'underline' },
  button: { backgroundColor: '#e94560', borderRadius: 30, paddingVertical: 16, alignItems: 'center', marginTop: 28 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});