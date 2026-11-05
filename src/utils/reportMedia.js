// A reported photo on the admin report list (20270391). The server decides what is held; this only joins it to its signed link and
// says it in words. A link is asked for only while the file is held.
export function reportMediaPaths(rows) {
  return [...new Set((rows || []).filter((r) => r.file_held).map((r) => r.media_path))];
}

export function reportMediaByReport(rows, signed) {
  const url = Object.fromEntries((signed || []).filter((s) => s.signedUrl && !s.error).map((s) => [s.path, s.signedUrl]));
  return Object.fromEntries((rows || []).map((r) => [r.report_id, { ...r, url: r.file_held ? url[r.media_path] || null : null }]));
}

export function reportMediaStatus(m) {
  if (!m.file_held) return 'The file is no longer held.';
  if (m.still_live) return 'Still visible to its audience.';
  return 'No longer visible to its audience. Held here for this report.';
}
