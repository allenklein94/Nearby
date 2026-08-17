import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert, Keyboard, TouchableWithoutFeedback, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '../services/supabase';
import { checkTextModeration } from '../services/textModeration';
import { searchPlacesByText, getPlaceDetails } from '../services/places';
import { logBusinessAcquisitionEvent } from '../services/businessAcquisitionEvents';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export const BUSINESS_CATEGORIES = [
  { key: 'food_drink', label: '☕ Food & Drink' },
  { key: 'fitness_wellness', label: '💪 Fitness & Wellness' },
  { key: 'retail_shopping', label: '🛍️ Retail & Shopping' },
  { key: 'arts_entertainment', label: '🎨 Arts & Entertainment' },
  { key: 'professional_services', label: '💼 Professional Services' },
  { key: 'other', label: '✨ Other' },
];

export const FEATURE_OPTIONS = [
  { key: 'offers', label: 'Create offers & perks for customers' },
  { key: 'host_gatherings', label: 'Host gatherings at my business' },
  { key: 'sponsor_community', label: 'Sponsor a community' },
  { key: 'get_listed', label: 'Just get listed & discovered' },
];

// Best-effort, never blocks or prompts — a business owner searching for their own
// business shouldn't have to grant location access first. Only used if permission
// was already granted some other time; otherwise the search just runs unbiased.
async function getOptionalLocationBias() {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getLastKnownPositionAsync();
    if (!pos) return null;
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
    return null;
  }
}

export default function BusinessPartnerApplyScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  // Business Partner acquisition experience, Milestone 2 (see CLAUDE.md's locked
  // Decision 2): a real "Find your business" step ahead of the form, using the
  // app's existing live Google Places integration to reduce typing — never framed
  // as "claiming a pre-existing Nearby listing," since no such listing exists.
  const [step, setStep] = useState('search'); // 'search' | 'confirm' | 'form'
  const [sessionId] = useState(() => crypto.randomUUID());
  const searchStartedLogged = useRef(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchedOnce, setSearchedOnce] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState(null);

  const [businessName, setBusinessName] = useState('');
  const [description, setDescription] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [category, setCategory] = useState(null);
  const [website, setWebsite] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [requestedFeatures, setRequestedFeatures] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    logBusinessAcquisitionEvent(sessionId, 'apply_started');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleFeature(key) {
    setRequestedFeatures((prev) =>
      prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]
    );
  }

  async function runSearch() {
    if (!searchQuery.trim()) return;
    if (!searchStartedLogged.current) {
      searchStartedLogged.current = true;
      logBusinessAcquisitionEvent(sessionId, 'search_started');
    }
    setSearching(true);
    setSearchedOnce(true);
    try {
      const bias = await getOptionalLocationBias();
      const results = await searchPlacesByText(searchQuery, bias?.latitude, bias?.longitude);
      setSearchResults(results);
    } catch (e) {
      console.log('runSearch failed', e.message);
      setSearchResults([]);
    }
    setSearching(false);
  }

  async function confirmPlace(place) {
    setSelectedPlace(place);
    logBusinessAcquisitionEvent(sessionId, 'business_found');
    // Pre-fill what search already returned; enrich with phone/website/category
    // via a real Place Details call, which Text Search results don't include.
    setBusinessName(place.name ?? '');
    setAddress(place.address ?? '');
    try {
      const details = await getPlaceDetails(place.placeId);
      if (details) {
        setPhone(details.phone ?? '');
        setWebsite(details.website ?? '');
        if (details.category) setCategory(details.category);
        if (details.address) setAddress(details.address);
      }
    } catch (e) {
      console.log('getPlaceDetails failed (non-fatal, form still usable)', e.message);
    }
    setStep('form');
  }

  function startManualEntry() {
    setSelectedPlace(null);
    setStep('form');
  }

  async function submit() {
    if (!businessName.trim()) {
      return Alert.alert('Business name required', "Tell us your business's name.");
    }

    const nameCheck = await checkTextModeration(businessName);
    if (!nameCheck.safe) {
      return Alert.alert('Name not allowed', 'Please revise and try again.');
    }

    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const myId = sessionData?.session?.user?.id;

      const { error } = await supabase.from('business_partner_requests').insert({
        requester_id: myId,
        business_name: businessName.trim(),
        business_description: description.trim() || null,
        contact_info: contactInfo.trim() || null,
        category,
        website: website.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        requested_features: requestedFeatures.length ? requestedFeatures : null,
      });

      if (error) {
        if (error.code === '23505') {
          throw new Error("You already have a pending application — we'll follow up on that one soon.");
        }
        throw error;
      }

      logBusinessAcquisitionEvent(sessionId, 'apply_submitted');
      Alert.alert(
        'Application Submitted',
        "Once submitted, your business is reviewed before going live — we'll let you know as soon as it's approved.",
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSubmitting(false);
  }

  if (step === 'search') {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
            <Text style={styles.header}>Get Your Business on Nearby</Text>
            <Text style={styles.subheader}>
              Businesses can host gatherings and communities, create offers for real customers who
              opt in, and build genuine relationships — not just run ads.{'\n\n'}Get started in
              about 30 seconds.
            </Text>

            <Text style={styles.label}>Find your business</Text>
            <View style={styles.searchRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Search by business name"
                placeholderTextColor={colors.textTertiary}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={runSearch}
                returnKeyType="search"
                accessibilityLabel="Search for your business"
              />
              <TouchableOpacity
                style={styles.searchButton}
                onPress={runSearch}
                disabled={searching || !searchQuery.trim()}
                accessibilityRole="button"
                accessibilityLabel="Search"
              >
                {searching ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchButtonText}>Search</Text>}
              </TouchableOpacity>
            </View>

            {searchResults.map((place) => (
              <TouchableOpacity
                key={place.placeId}
                style={styles.resultRow}
                onPress={() => confirmPlace(place)}
                accessibilityRole="button"
                accessibilityLabel={`Is this your business: ${place.name}`}
              >
                <Text style={styles.resultName}>{place.name}</Text>
                {place.address ? <Text style={styles.resultAddress}>{place.address}</Text> : null}
              </TouchableOpacity>
            ))}

            {searchedOnce && !searching && searchResults.length === 0 ? (
              <Text style={styles.emptyText}>No matches found. You can still add your business manually below.</Text>
            ) : null}

            <TouchableOpacity onPress={startManualEntry} style={styles.manualLink} accessibilityRole="button">
              <Text style={styles.manualLinkText}>Can't find your business? Enter it manually →</Text>
            </TouchableOpacity>
          </ScrollView>
        </TouchableWithoutFeedback>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => setStep('search')} accessibilityRole="button">
            <Text style={styles.backLink}>← Back to search</Text>
          </TouchableOpacity>

          {selectedPlace ? (
            <View style={styles.confirmBanner}>
              <Text style={styles.confirmTitle}>Confirm your business</Text>
              <Text style={styles.confirmSubtitle}>We found "{selectedPlace.name}" — we've filled in what we can below.</Text>
            </View>
          ) : (
            <Text style={styles.header}>Complete your profile</Text>
          )}

          <Text style={styles.label}>Business Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Coastal Coffee"
            placeholderTextColor={colors.textTertiary}
            value={businessName}
            onChangeText={setBusinessName}
            accessibilityLabel="Business name"
          />

          <Text style={styles.label}>Tell us about your business</Text>
          <TextInput
            style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
            placeholder="What do you do, and what kind of community would you want to build?"
            placeholderTextColor={colors.textTertiary}
            value={description}
            onChangeText={setDescription}
            multiline
            accessibilityLabel="Business description, optional"
          />

          <Text style={styles.label}>Contact Info</Text>
          <TextInput
            style={styles.input}
            placeholder="Email or phone number"
            placeholderTextColor={colors.textTertiary}
            value={contactInfo}
            onChangeText={setContactInfo}
            accessibilityLabel="Contact info, optional"
          />

          <Text style={styles.label}>Category</Text>
          <View style={styles.chipRow}>
            {BUSINESS_CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c.key}
                style={[styles.chip, category === c.key && styles.chipActive]}
                onPress={() => setCategory(category === c.key ? null : c.key)}
                accessibilityRole="button"
                accessibilityLabel={c.label}
                accessibilityState={{ selected: category === c.key }}
              >
                <Text style={[styles.chipText, category === c.key && styles.chipTextActive]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Website</Text>
          <TextInput
            style={styles.input}
            placeholder="https://yourbusiness.com"
            placeholderTextColor={colors.textTertiary}
            value={website}
            onChangeText={setWebsite}
            autoCapitalize="none"
            keyboardType="url"
            accessibilityLabel="Website, optional"
          />

          <Text style={styles.label}>Phone</Text>
          <TextInput
            style={styles.input}
            placeholder="(555) 123-4567"
            placeholderTextColor={colors.textTertiary}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            accessibilityLabel="Phone, optional"
          />

          <Text style={styles.label}>Address</Text>
          <TextInput
            style={styles.input}
            placeholder="Street, city, state"
            placeholderTextColor={colors.textTertiary}
            value={address}
            onChangeText={setAddress}
            accessibilityLabel="Address, optional"
          />

          <Text style={styles.label}>What would you like to offer?</Text>
          {FEATURE_OPTIONS.map((f) => {
            const checked = requestedFeatures.includes(f.key);
            return (
              <TouchableOpacity
                key={f.key}
                style={styles.checkboxRow}
                onPress={() => toggleFeature(f.key)}
                accessibilityRole="checkbox"
                accessibilityLabel={f.label}
                accessibilityState={{ checked }}
              >
                <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                  {checked && <Text style={styles.checkboxMark}>✓</Text>}
                </View>
                <Text style={styles.checkboxLabel}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            style={styles.button}
            onPress={submit}
            disabled={submitting}
            activeOpacity={0.85}
            accessibilityLabel={submitting ? 'Submitting' : 'Submit application'}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{submitting ? 'Submitting...' : 'Submit Application'}</Text>
          </TouchableOpacity>
          <Text style={styles.reviewNote}>Once submitted, your business is reviewed before going live.</Text>
        </ScrollView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  subheader: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg, lineHeight: 18 },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', marginTop: spacing.xl, ...shadow.button },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  reviewNote: { ...typography.caption, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginRight: spacing.xs, marginBottom: spacing.xs },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  checkbox: { width: 22, height: 22, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  checkboxLabel: { ...typography.body, color: colors.textPrimary, flex: 1 },
  searchRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'stretch' },
  searchButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  searchButtonText: { color: '#fff', fontWeight: '700' },
  resultRow: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm },
  resultName: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  resultAddress: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  emptyText: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.md, textAlign: 'center' },
  manualLink: { marginTop: spacing.lg, alignItems: 'center' },
  manualLinkText: { ...typography.body, color: colors.primary, fontWeight: '600' },
  backLink: { ...typography.body, color: colors.primary, fontWeight: '600', marginBottom: spacing.md },
  confirmBanner: { backgroundColor: colors.primaryMuted, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1.5, borderColor: colors.primary },
  confirmTitle: { ...typography.headline, color: colors.textPrimary },
  confirmSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
});
