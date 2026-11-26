// Columns a staged migration adds before it is live (owner, 2026-11-14: tattoo / piercing preferences, 20270417).
// Until then the server refuses any read or write naming them; the app must keep working exactly as before. So every read
// and write that names them goes through here: on "column doesn't exist" the same call runs again without them, and the
// result says whether they exist, so a screen can leave out what it can't save.
export const DATING_PRESENCE_PREF_COLUMNS = Object.freeze(['dating_pref_tattoos', 'dating_pref_piercings']);

// PostgREST: 42703 (Postgres undefined column) on reads, PGRST204 (column not in schema cache) on writes.
export function isMissingColumnError(error, columns = DATING_PRESENCE_PREF_COLUMNS) {
  if (!error) return false;
  if (error.code !== '42703' && error.code !== 'PGRST204') return false;
  const text = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`;
  return columns.some((c) => text.includes(c));
}

const list = (columns) => columns.split(',').map((c) => c.trim()).filter(Boolean);

export function withoutColumns(columns, drop = DATING_PRESENCE_PREF_COLUMNS) {
  return list(columns).filter((c) => !drop.includes(c)).join(', ');
}

// read(columns) -> { data, error }. Returns { data, error, available } (available = the optional columns exist).
export async function readWithOptionalColumns(read, columns, optional = DATING_PRESENCE_PREF_COLUMNS) {
  const first = await read(columns);
  if (!isMissingColumnError(first?.error, optional)) return { ...first, available: true };
  const res = await read(withoutColumns(columns, optional));
  return { ...res, available: false };
}

// write(values) -> { error }. Drops the optional keys and retries once when the server doesn't know them.
export async function writeWithOptionalColumns(write, values, optional = DATING_PRESENCE_PREF_COLUMNS) {
  const first = await write(values);
  if (!isMissingColumnError(first?.error, optional)) return { ...first, available: true };
  const rest = Object.fromEntries(Object.entries(values).filter(([k]) => !optional.includes(k)));
  const res = await write(rest);
  return { ...res, available: false };
}
