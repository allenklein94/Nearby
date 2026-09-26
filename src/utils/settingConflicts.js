// Item 86 (migration 20270226): how the app SHOWS a contradictory business setting. The server is the only authority: it refuses the
// save with a structured conflict (HINT 'setting_conflict', DETAIL = a JSON array of the exact owner-facing lines), or the
// screen-business-content function returns 400 {code: 'setting_conflict', conflicts}. This file only reads that answer and keeps
// per-surface display state; it knows no conflict rule and no message wording of its own.

// The conflict lines carried by an error, or null when the error is anything else (an outage, a network failure, another rule).
export function settingConflictsOf(error) {
  if (!error) return null;
  let list = null;
  if (Array.isArray(error.conflicts)) {
    list = error.conflicts;
  } else if (error.hint === 'setting_conflict' || error.code === 'setting_conflict') {
    try {
      list = typeof error.details === 'string' ? JSON.parse(error.details) : error.details;
    } catch {
      list = null;
    }
  }
  if (!Array.isArray(list)) return null;
  const lines = [...new Set(list.filter((m) => typeof m === 'string' && m.trim()))];
  return lines.length > 0 ? lines : null;
}

// Wrap a Supabase RPC error so the conflict survives a service's `throw new Error(error.message)`.
export function errorWithConflicts(rpcError, fallback = 'Could not save your changes.') {
  const e = new Error(rpcError?.message || fallback);
  const conflicts = settingConflictsOf(rpcError);
  if (conflicts) {
    e.conflicts = conflicts;
    e.code = 'setting_conflict';
  }
  return e;
}

// Display state, one entry per editing surface:
//   { messages: string[], check: { kind, patch } | null, pending?: any }
// `pending` is an unsaved choice on a save-per-tap row (the row shows it; nothing was persisted). `check` is what to ask the server
// (check_business_setting_conflicts) to learn whether the conflict still stands. All pure, so tests pin the lifecycle.

export function reportConflict(entries, surface, messages, { check = null, pending } = {}) {
  if (!messages || messages.length === 0) return entries;
  const entry = { messages: [...new Set(messages)], check };
  if (pending !== undefined) entry.pending = pending;
  return { ...entries, [surface]: entry };
}

export function clearConflict(entries, surface) {
  if (!entries[surface]) return entries;
  const next = { ...entries };
  delete next[surface];
  return next;
}

// A re-check answer. Resolved (no lines) clears the message; an unsaved per-tap choice stays visible, waiting for the owner's Save.
export function applyRecheck(entries, surface, messages, check) {
  const entry = entries[surface];
  if (!entry) return entries;
  const lines = [...new Set(messages ?? [])];
  if (lines.length === 0 && entry.pending === undefined) return clearConflict(entries, surface);
  return { ...entries, [surface]: { ...entry, messages: lines, check: check ?? entry.check } };
}

export function conflictMessages(entries, surface) {
  return entries[surface]?.messages ?? [];
}

export function hasPending(entries, surface) {
  return entries[surface] !== undefined && entries[surface].pending !== undefined;
}

// What a save-per-tap row shows: the owner's unsaved choice while one exists, else the saved value.
export function shownValue(entries, surface, saved) {
  return hasPending(entries, surface) ? entries[surface].pending : saved;
}
