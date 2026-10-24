import React, { useState, useCallback, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import EmptyCopy from '../components/EmptyCopy';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import FadeInState from '../components/FadeInState';
import { NLoader } from '../motion';
import { getMyEmergencyContacts, addEmergencyContact, deleteEmergencyContact } from '../services/emergencyContacts';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Emergency contacts, shown in place under Settings > Safety (screen-reduction audit 2026-10-24, owner approved: this was its
// own screen, EmergencyContacts, same pattern as BlockedUsersSection). Loads when the section opens; add/remove re-read the list.
export default function EmergencyContactsSection() {
  const { t } = useLanguage();
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

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!name.trim() || !phone.trim()) {
      Alert.alert(t('ui.emergencyContacts.missingInfo'), t('ui.emergencyContacts.pleaseAddBothAName'));
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
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleAdd() });
    }
    setSubmitting(false);
  }

  function confirmDelete(contact) {
    Alert.alert(
      t('ui.emergencyContacts.remove', { name: contact.name }),
      t('ui.emergencyContacts.theyllNoLongerBeSuggested'),
      [
        { text: t('ui.emergencyContacts.cancel'), style: 'cancel' },
        {
          text: t('ui.emergencyContacts.remove2'),
          style: 'destructive',
          onPress: async () => {
            setDeletingId(contact.id);
            try {
              await deleteEmergencyContact(contact.id);
              load();
            } catch (e) {
              presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => confirmDelete(contact) });
            }
            setDeletingId(null);
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <NLoader fullScreen={false} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{t('ui.emergencyContacts.loadingYourEmergencyContacts')}</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.container}>
        <LoadErrorState message={t('ui.emergencyContacts.couldntLoadYourEmergencyContacts')} onRetry={load} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
          <Text style={styles.headerSubtitle}>
            {t('ui.emergencyContacts.saveSomeoneYouTrustSo')}
          </Text>

          {contacts.length === 0 && (
            <FadeInState style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🛡️</Text>
              <EmptyCopy id="emergency_contacts" />
            </FadeInState>
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
                accessibilityLabel={t('ui.emergencyContacts.removeA11y', { name: contact.name })}
                accessibilityRole="button"
              >
                <Text style={styles.removeButtonText}>{deletingId === contact.id ? '...' : t('ui.emergencyContacts.remove2')}</Text>
              </TouchableOpacity>
            </View>
          ))}

          <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.emergencyContacts.addAContact')}</Text>
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder={t('ui.emergencyContacts.name')}
              placeholderTextColor={colors.textTertiary}
              value={name}
              onChangeText={setName}
              accessibilityLabel={t('ui.emergencyContacts.contactNameA11y')}
            />
            <TextInput
              style={styles.input}
              placeholder={t('ui.emergencyContacts.phoneNumber')}
              placeholderTextColor={colors.textTertiary}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              accessibilityLabel={t('ui.emergencyContacts.contactPhoneNumberA11y')}
            />
            <TextInput
              style={styles.input}
              placeholder={t('ui.emergencyContacts.relationshipOptionalEGSister')}
              placeholderTextColor={colors.textTertiary}
              value={relationship}
              onChangeText={setRelationship}
              accessibilityLabel={t('ui.emergencyContacts.relationshipOptionalA11y')}
            />
            <TouchableOpacity style={styles.addButton} onPress={handleAdd} disabled={submitting} activeOpacity={0.85} accessibilityRole="button" accessibilityState={{ disabled: submitting }}>
              <Text style={styles.addButtonText}>{submitting ? t('ui.emergencyContacts.adding') : t('ui.emergencyContacts.addContact')}</Text>
            </TouchableOpacity>
          </View>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { marginBottom: spacing.md },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.md, lineHeight: 18 },
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
