import { supabase } from './supabase';

export async function getMyEmergencyContacts() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from('emergency_contacts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getMyEmergencyContacts error', error);
    return [];
  }
  return data ?? [];
}

export async function addEmergencyContact(name, phone, relationship) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('emergency_contacts')
    .insert({ user_id: userId, name, phone, relationship: relationship || null });

  if (error) throw error;
}

export async function deleteEmergencyContact(id) {
  const { error } = await supabase.from('emergency_contacts').delete().eq('id', id);
  if (error) throw error;
}
