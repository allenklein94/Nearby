import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import { supabase } from '../services/supabase';
import { ADMIN_PHOTO_LINK_SECONDS } from '../utils/adminReviewCase';
import { reportReasonLabel, reportedWhatLabel } from '../utils/reportReasons';
import { reportMediaByReport, reportMediaPaths, reportMediaStatus } from '../utils/reportMedia';

// Linked reports in Admin Review's case: what each report said + the server's copy of what it was about, so the admin
// understands the case without switching to Admin Reports (owner, 2026-11-08). Reads only, on open, through the same
// admin-only access Admin Reports uses (the reports policy, admin_get_report_media, Storage's 15-minute links); nothing is
// copied or stored here, and the reporter is never read. Report actions stay on Admin Reports.
const COLUMNS = 'id, details, content_type, content_excerpt, content_sent_at';

async function loadLinked(ids) {
  const { data, error } = await supabase.from('reports').select(COLUMNS).in('id', ids);
  if (error) return { error: true, rows: {}, media: {} };
  const rows = Object.fromEntries((data || []).map((r) => [r.id, r]));
  const storyIds = (data || []).filter((r) => r.content_type === 'story').map((r) => r.id);
  if (!storyIds.length) return { rows, media: {} };
  const held = await supabase.rpc('admin_get_report_media', { report_ids_param: storyIds });
  if (held.error) return { rows, media: {} };
  const paths = reportMediaPaths(held.data);
  const signed = paths.length
    ? await supabase.storage.from('stories').createSignedUrls(paths, ADMIN_PHOTO_LINK_SECONDS)
    : { data: [] };
  return { rows, media: reportMediaByReport(held.data, signed.error ? [] : signed.data) };
}

export default function LinkedReportsSection({ reports, styles }) {
  const list = Array.isArray(reports) ? reports : [];
  const key = list.filter((r) => r.still_kept).map((r) => r.report_id).join(',');
  const [state, setState] = useState({ rows: {}, media: {} });

  useEffect(() => {
    let live = true;
    setState({ rows: {}, media: {} });
    if (!key) return undefined;
    loadLinked(key.split(',')).then(
      (next) => { if (live) setState(next); },
      () => { if (live) setState({ error: true, rows: {}, media: {} }); },
    );
    return () => { live = false; };
  }, [key]);

  if (!list.length) return null;
  return (
    <>
      <Text style={styles.subTitle}>Linked reports</Text>
      {state.error ? <Text style={styles.meta}>Couldn't load what these reports said. Open the case again to retry.</Text> : null}
      {list.map((r) => {
        if (!r.still_kept) return <Text key={r.report_id} style={styles.meta}>Report no longer kept (retention)</Text>;
        const row = state.rows[r.report_id];
        const media = state.media[r.report_id];
        return (
          <View key={r.report_id}>
            <Text style={styles.meta}>{`${reportReasonLabel(r.reason)} · ${new Date(r.created_at).toLocaleString()}${r.resolved ? ' · resolved' : ''}`}</Text>
            {row?.details ? <Text style={styles.event}>{row.details}</Text> : null}
            {row?.content_excerpt ? (
              <>
                <Text style={styles.meta}>Reported {reportedWhatLabel(row.content_type)}{row.content_sent_at ? ` · sent ${new Date(row.content_sent_at).toLocaleString()}` : ''}</Text>
                <Text style={styles.event}>{row.content_excerpt}</Text>
              </>
            ) : null}
            {media?.url && media.media_type === 'image' ? (
              <Image source={{ uri: media.url }} style={styles.photo} resizeMode="contain" accessibilityLabel="Reported photo" />
            ) : null}
            {media ? <Text style={styles.meta}>{reportMediaStatus(media)}</Text> : null}
          </View>
        );
      })}
    </>
  );
}
