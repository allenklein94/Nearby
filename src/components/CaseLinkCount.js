import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { supabase } from '../services/supabase';
import { caseLinkCountLine, CASE_LINK_COUNT_NOTE, accountFactsMissing } from '../utils/adminReviewCase';

// Link count (20270404): one read-only line inside an admin's review case: how many different links were detected in the reported
// text stored with this case. A count only: every decision stays with the admin. Nothing to inspect = no line, never a 0.
export default function CaseLinkCount({ caseId, styles }) {
  const [state, setState] = useState(null); // null = loading or nothing to show, { line } or { error: true }

  useEffect(() => {
    let live = true;
    setState(null);
    supabase.rpc('admin_get_case_link_count', { case_id_param: caseId }).then(
      ({ data, error }) => {
        if (!live) return;
        if (error) setState(accountFactsMissing(error) ? null : { error: true });
        else setState({ line: caseLinkCountLine(data) });
      },
      () => { if (live) setState({ error: true }); },
    );
    return () => { live = false; };
  }, [caseId]);

  if (!state) return null;
  if (state.error) return <Text style={styles.meta}>Couldn't load the link count. Open the case again to retry.</Text>;
  if (!state.line) return null;
  return (
    <View>
      <Text style={styles.meta}>{state.line}</Text>
      <Text style={styles.meta}>{CASE_LINK_COUNT_NOTE}</Text>
    </View>
  );
}
