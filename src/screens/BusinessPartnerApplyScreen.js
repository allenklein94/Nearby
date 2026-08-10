import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert, Keyboard, TouchableWithoutFeedback } from 'react-native';
import { supabase } from '../services/supabase';
import { checkTextModeration } from '../services/textModeration';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

const BUSINESS_CATEGORIES = [
  { key: 'food_drink', label: '☕ Food & Drink' },
  { key: 'fitness_wellness', label: '💪 Fitness & Wellness' },
  { key: 'retail_shopping', label: '🛍️ Retail & Shopping' },
  { key: 'arts_entertainment', label: '🎨 Arts & Entertainment' },
  { key: 'professional_services', label: '💼 Professional Services' },
  { key: 'other', label: '✨ Other' },
];

const FEATURE_OPTIONS = [
  { key: 'offers', label: 'Create offers & perks for customers' },
  { key: 'host_gatherings', label: 'Host gatherings at my business' },
  { key: 'sponsor_community', label: 'Sponsor a community' },
  { key: 'get_listed', label: 'Just get listed & discovered' },
];

export default function BusinessPartnerApplyScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [businessName, setBusinessName] = useState('');
  const [description, setDescription] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [category, setCategory] = useState(null);
  const [website, setWebsite] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [requestedFeatures, setRequestedFeatures] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  function toggleFeature(key) {
    setRequestedFeatures((prev) =>
      prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]
    );
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

      Alert.alert('Application Submitted', "We'll review your request and follow up soon.", [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSubmitting(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
          <Text style={styles.header}>Partner With Us</Text>
          <Text style={styles.subheader}>
            Businesses can host gatherings and communities, create offers for real customers who opt in, and build genuine relationships — not just run ads.
          </Text>

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
});