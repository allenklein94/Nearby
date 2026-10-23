// Create from an ask carries the exact start time the ask established (owner, 2026-10-23): the same reading AskBusiness uses
// (`statedStartMinutes`, utils/askUnderstood.js), never a second reading of the words. Only onto a day the ask also carried
// (Tonight / Tomorrow): Create has one date-and-time, so a time without a day is left for Create's When step to ask, like any
// window ("after 7" is a constraint, never a start). A time already past, or "Now" (it means right away), carries nothing.
// "Tonight" stays selected only for an afternoon/evening time; a morning one (a chip switched to 7 AM) shows as a picked date.
import { statedStartMinutes } from './askUnderstood';

export function createStartFromAsk(classifyResult, typedText, whenPreset, now = new Date()) {
  if (whenPreset !== 'tonight' && whenPreset !== 'tomorrow') return {};
  const minutes = statedStartMinutes(classifyResult, typedText);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60) return {};
  const d = new Date(now);
  if (whenPreset === 'tomorrow') d.setDate(d.getDate() + 1);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (d.getTime() <= now.getTime()) return {};
  const preset = whenPreset === 'tonight' && minutes < 12 * 60 ? 'custom' : whenPreset;
  return { quickStartWhenPreset: preset, quickStartWhenISO: d.toISOString() };
}
