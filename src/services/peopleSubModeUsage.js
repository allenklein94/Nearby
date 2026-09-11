// Item 46 follow-up (CLAUDE.md): the real, durable usage-frequency signal
// behind Discover's People > Dating|Friends default -- see
// src/utils/peopleSubModePreference.js for the pure decision logic this
// feeds, and 20261009_people_submode_usage_tracking.sql for the schema.
import { supabase } from './supabase';

// Fire-and-forget, same shape as this codebase's other lightweight
// behavioral-analytics writes (intentOutcomes.js) -- never blocks the
// caller's own selectPeopleSubMode() UI update.
export async function recordPeopleSubModeUse(submode) {
  try {
    const { error } = await supabase.rpc('record_people_submode_use', { submode });
    if (error) throw error;
  } catch (e) {
    console.error('recordPeopleSubModeUse failed', e);
  }
}

export async function getMyPeopleSubModeUsage() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { datingUses: 0, friendsUses: 0 };
    const { data, error } = await supabase
      .from('profiles')
      .select('people_submode_dating_uses, people_submode_friends_uses')
      .eq('id', user.id)
      .single();
    if (error) throw error;
    return {
      datingUses: data?.people_submode_dating_uses ?? 0,
      friendsUses: data?.people_submode_friends_uses ?? 0,
    };
  } catch (e) {
    console.error('getMyPeopleSubModeUsage failed', e);
    return { datingUses: 0, friendsUses: 0 };
  }
}
