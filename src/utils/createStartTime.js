// Create from an ask carries the exact start time the ask established (owner, 2026-10-23): the same reading AskBusiness uses
// (`statedStartMinutes`, utils/askUnderstood.js), never a second reading of the words. Only onto a day the ask also carried
// (Tonight / Tomorrow, or a named weekday): Create has one date-and-time, so a time without a day is left for Create's When
// step to ask, like any window ("after 7" is a constraint, never a start). A time already past, or "Now" (it means right away),
// carries nothing. "Tonight" stays selected only for an afternoon/evening time; a morning one (a chip switched to 7 AM) shows as
// a picked date.
// Named weekdays (owner, 2026-10-23): the day comes from `statedCalendarDay` (the shared weekday rule) and is shown as a picked
// date. With an exact time: that date and time. Without one (no time, a window, or an ambiguous "at 9"): the date alone
// (`quickStartDateISO`), Create asks only for the time and offers both readings of an ambiguous hour (`quickStartTimeChoices`);
// no time is ever filled in for the person. An exact time already past on that day carries nothing.
import { statedStartMinutes, statedCalendarDay } from './askUnderstood';

const localDateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function createStartFromAsk(classifyResult, typedText, whenPreset, now = new Date()) {
  if (whenPreset === 'tonight' || whenPreset === 'tomorrow') return presetStart(classifyResult, typedText, whenPreset, now);
  if (whenPreset === 'now') return {};
  const named = statedCalendarDay(classifyResult, typedText, now);
  if (!named) return {};
  const { date, minutes, choices } = named;
  if (Number.isInteger(minutes)) {
    const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(minutes / 60), minutes % 60);
    return { quickStartWhenPreset: 'custom', quickStartWhenISO: at.toISOString() };
  }
  return { quickStartWhenPreset: 'custom', quickStartDateISO: localDateKey(date), ...(choices ? { quickStartTimeChoices: choices } : {}) };
}

function presetStart(classifyResult, typedText, whenPreset, now) {
  const minutes = statedStartMinutes(classifyResult, typedText);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60) return {};
  const d = new Date(now);
  if (whenPreset === 'tomorrow') d.setDate(d.getDate() + 1);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (d.getTime() <= now.getTime()) return {};
  const preset = whenPreset === 'tonight' && minutes < 12 * 60 ? 'custom' : whenPreset;
  return { quickStartWhenPreset: preset, quickStartWhenISO: d.toISOString() };
}

// A carried date-only key ("2026-10-24") back to that local day, or null.
export function localDateFromKey(key) {
  const m = typeof key === 'string' ? key.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// That day at a chosen minute of the day (Create's "9 AM" / "9 PM" choice, or the time picker's hours and minutes).
export function atMinutes(day, minutes) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
}
