import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert, Keyboard, TouchableWithoutFeedback } from 'react-native';
import { supabase } from '../services/supabase';
import { checkTextModeration } from '../services/textModeration';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export default function BusinessPartnerApplyScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [businessName, setBusinessName] = useState('');
  const [description, setDescription] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
      });

      if (error) throw error;

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
});