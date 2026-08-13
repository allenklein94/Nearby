import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyEmergencyContacts, addEmergencyContact, deleteEmergencyContact } from '../services/emergencyContacts';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

export default function EmergencyContactsScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await getMyEmergencyContacts();
      setContacts(data);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleAdd() {
    if (!name.trim() || !phone.trim()) {
      Alert.alert('Missing info', 'Please add both a name and a phone number.');
      return;
    }
    setSubmitting(true);
    try {
      await addEmergencyContact(name.trim(), phone.trim(), relationship.trim());
      setName('');
      setPhone('');
      setRelationship('');
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSubmitting(false);
  }

  function confirmDelete(contact) {
    Alert.alert(
      `Remove ${contact.name}?`,
      "They'll no longer be suggested when you set up a date safety check-in.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(contact.id);
            try {
              await deleteEmergencyContact(contact.id);
              load();
            } catch (e) {
              Alert.alert('Error', e.message);
            }
            setDeletingId(null);
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading your emergency contacts...</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load your emergency contacts." onRetry={load} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.headerTitle} accessibilityRole="header">Emergency Contacts</Text>
          <Text style={styles.headerSubtitle}>
            Save someone you trust so they're ready to go the next time you set up a Date Safety
            Check-In. Nearby never contacts them automatically — you're always the one who taps
            share.
          </Text>

          {contacts.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🛡️</Text>
              <Text style={styles.emptyText}>No emergency contacts yet.</Text>
            </View>
          )}

          {contacts.map((contact) => (
            <View key={contact.id} style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{contact.name}</Text>
                <Text style={styles.detail}>{contact.phone}</Text>
                {contact.relationship ? <Text style={styles.detail}>{contact.relationship}</Text> : null}
              </View>
              <TouchableOpacity
                style={styles.removeButton}
                onPress={() => confirmDelete(contact)}
                disabled={deletingId === contact.id}
                accessibilityLabel={`Remove ${contact.name}`}
                accessibilityRole="button"
              >
                <Text style={styles.removeButtonText}>{deletingId === contact.id ? '...' : 'Remove'}</Text>
              </TouchableOpacity>
            </View>
          ))}

          <Text style={styles.sectionLabel} accessibilityRole="header">Add a contact</Text>
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Name"
              placeholderTextColor={colors.textTertiary}
              value={name}
              onChangeText={setName}
              accessibilityLabel="Contact name"
            />
            <TextInput
              style={styles.input}
              placeholder="Phone number"
              placeholderTextColor={colors.textTertiary}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              accessibilityLabel="Contact phone number"
            />
            <TextInput
              style={styles.input}
              placeholder="Relationship (optional, e.g. Sister, Best friend)"
              placeholderTextColor={colors.textTertiary}
              value={relationship}
              onChangeText={setRelationship}
              accessibilityLabel="Relationship, optional"
            />
            <TouchableOpacity style={styles.addButton} onPress={handleAdd} disabled={submitting} activeOpacity={0.85}>
              <Text style={styles.addButtonText}>{submitting ? 'Adding...' : 'Add Contact'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  emptyState: { alignItems: 'center', paddingVertical: spacing.lg },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  name: { ...typography.bodyBold, color: colors.textPrimary },
  detail: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  removeButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  removeButtonText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.md, textTransform: 'uppercase', letterSpacing: 0.5 },
  form: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  input: {
    backgroundColor: colors.surfaceElevated, color: colors.textPrimary, borderRadius: radius.md,
    padding: spacing.sm, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  addButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.xs },
  addButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
