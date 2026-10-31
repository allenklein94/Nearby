// User-content screening (migration 20270373 + edge function screen-user-content). Public text (profile text, gathering
// title/description, community name/description, Q&A, photo comments) is screened BEFORE the app writes it; the database
// refuses any write of text that wasn't (so this is the app's half, never the protection itself).
//
// screenUserContent([{ text, kind }]) -> { outcome }:
//   'publish'     write it
//   'hold'        write it; a person checks it before anyone else sees it (tell the person: heldNotice)
//   'refuse'      don't write; ask the person to change it (the screen's existing "not allowed" words)
//   'unavailable' don't write; screening couldn't run (fail closed: contentCheckUnavailable)
//   'limit'       don't write; today's screening limit is used up
// Before 20270373 / the edge function are live (a build ships first), the server answers 'not_installed' or 404 and the
// app keeps today's check (moderate-text). That window is today's behaviour; once 20270373 is live the database enforces
// screening whatever the app does.
import { supabase, functionUrl } from './supabase';
import { checkTextModeration } from './textModeration';
import { normalizeUgcText, ugcRefusalOf } from '../utils/ugcText';

const SEVERITY = { publish: 0, hold: 1, refuse: 2 };

async function legacyCheck(items) {
  for (const { text } of items) {
    const result = await checkTextModeration(text);
    if (!result?.safe) return { outcome: 'refuse' };
  }
  return { outcome: 'publish' };
}

export async function screenUserContent(items) {
  const texts = (items || [])
    .map(({ text, kind }) => ({ text: normalizeUgcText(text), kind }))
    .filter((i) => i.text);
  if (!texts.length) return { outcome: 'publish' };
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) return { outcome: 'unavailable' };
    const response = await fetch(functionUrl('screen-user-content'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ texts }),
    });
    if (response.status === 404) return legacyCheck(texts);
    const body = await response.json().catch(() => null);
    if (body?.code === 'not_installed') return legacyCheck(texts);
    if (response.status === 429 || body?.code === 'usage_limit') return { outcome: 'limit' };
    if (!response.ok || !body?.outcome || !(body.outcome in SEVERITY)) return { outcome: 'unavailable' };
    return { outcome: body.outcome };
  } catch (e) {
    return { outcome: 'unavailable' };
  }
}

// The pieces a screen shows. `blockedAlert` = true when the save must stop (and the person was told why); the screen's own
// "not allowed" title/body stay its words for a refusal.
export function blockedByScreening(Alert, t, result, { notAllowedTitle, notAllowedBody }) {
  const outcome = result?.outcome;
  if (outcome === 'refuse') { Alert.alert(notAllowedTitle, notAllowedBody); return true; }
  if (outcome === 'unavailable') {
    Alert.alert(t('ui.shared.errors.contentCheckUnavailableTitle'), t('ui.shared.errors.contentCheckUnavailable'));
    return true;
  }
  if (outcome === 'limit') {
    Alert.alert(t('ui.shared.errors.contentCheckUnavailableTitle'), t('ui.shared.errors.contentCheckLimit'));
    return true;
  }
  return false;
}

// A write the database refused because of screening (20270373's hints) -> the person's words. Returns true if handled.
export function handledScreeningRefusal(Alert, t, error, { notAllowedTitle, notAllowedBody, heldNameBody } = {}) {
  const refusal = ugcRefusalOf(error);
  if (!refusal) return false;
  if (refusal === 'content_not_allowed' && notAllowedTitle) Alert.alert(notAllowedTitle, notAllowedBody);
  else if (refusal === 'content_held') Alert.alert(t('ui.shared.contentHeldTitle'), heldNameBody || t('ui.onboarding.nameNeedsReview'));
  else Alert.alert(t('ui.shared.errors.contentCheckUnavailableTitle'), t('ui.shared.errors.contentCheckUnavailable'));
  return true;
}

// The person's own held items (shown on the gathering they host). Before 20270373 the function doesn't exist: nothing.
export async function getMyHeldContent() {
  const { data, error } = await supabase.rpc('get_my_held_content');
  if (error) return [];
  return data || [];
}
