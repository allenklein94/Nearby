import * as Contacts from 'expo-contacts';
import { supabase } from './supabase';

// Normalizes a phone number to the same E.164-ish digit format
// Supabase auth stores (matching by digits, not exact string
// formatting) — contacts typically have spaces, dashes, parentheses
// that need stripping before matching.
function normalizePhone(raw) {
  const digitsOnly = raw.replace(/[^\d]/g, '');
  if (digitsOnly.length === 10) return `1${digitsOnly}`;
  return digitsOnly;
}

export async function requestContactsPermission() {
  const { status } = await Contacts.requestPermissionsAsync();
  return status === 'granted';
}

// Reads the device's contacts, extracts and normalizes phone
// numbers, and checks which ones match existing Nearby accounts —
// via a secure server-side function that only ever returns matches,
// never confirming or denying any specific number that didn't match.
// Raw contact data is never sent anywhere except this one matching
// call, and is never stored.
export async function findFriendsFromContacts() {
  const hasPermission = await requestContactsPermission();
  if (!hasPermission) {
    throw new Error('Contacts access is needed to find friends already on Nearby.');
  }

  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.PhoneNumbers],
  });

  const phoneNumbers = new Set();
  for (const contact of data) {
    for (const phone of contact.phoneNumbers ?? []) {
      if (phone.number) phoneNumbers.add(normalizePhone(phone.number));
    }
  }

  if (phoneNumbers.size === 0) return [];

  const { data: matches, error } = await supabase.rpc('match_contacts_to_users', {
    phone_numbers: Array.from(phoneNumbers),
  });

  if (error) {
    console.error('findFriendsFromContacts error', error);
    return [];
  }

  return matches ?? [];
}