import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { supabase } from '../services/supabase';
import { accountFactsLines, accountFactsMissing, ACCOUNT_FACTS_NOTE } from '../utils/adminReviewCase';

// Account facts (20270401): one compact read-only block inside an admin's review case. Admin-only English, like the rest of
// the admin screens. It only shows facts; every decision stays with the admin. `styles` = the host screen's own text styles.
export default function AccountFactsSection({ caseId, styles }) {
  const [state, setState] = useState(null); // null = loading, { facts } or { error: true }

  useEffect(() => {
    let live = true;
    setState(null);
    supabase.rpc('admin_get_account_facts', { case_id_param: caseId }).then(
      ({ data, error }) => {
        if (!live) return;
        if (error) setState(accountFactsMissing(error) ? { facts: [] } : { error: true });
        else setState({ facts: Array.isArray(data) ? data : [] });
      },
      () => { if (live) setState({ error: true }); },
    );
    return () => { live = false; };
  }, [caseId]);

  if (!state) return null;
  if (state.error) return <Text style={styles.meta}>Couldn't load the account facts. Open the case again to retry.</Text>;
  if (!state.facts.length) return null;
  return (
    <View>
      <Text style={styles.subTitle || styles.reason}>Account facts</Text>
      {state.facts.map((f) => {
        const lines = accountFactsLines(f);
        return (
          <View key={f.user_id}>
            <Text style={styles.title || styles.meta}>{lines.name}</Text>
            {lines.account ? <Text style={styles.meta}>{lines.account}</Text> : null}
            <Text style={styles.meta}>{lines.reports}</Text>
          </View>
        );
      })}
      <Text style={styles.meta}>{ACCOUNT_FACTS_NOTE}</Text>
    </View>
  );
}
