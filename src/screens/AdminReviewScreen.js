import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Image, StyleSheet, SafeAreaView, Alert, useWindowDimensions } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { typography, spacing, radius } from '../theme';
import LoadErrorState from '../components/LoadErrorState';
import { presentRecoverableError } from '../utils/recoverableError';
import { reportReasonLabel, sortReportQueue, reportQueueTag } from '../utils/reportReasons';
import AccountFactsSection from '../components/AccountFactsSection';
import LinkedReportsSection from '../components/LinkedReportsSection';
import CaseLinkCount from '../components/CaseLinkCount';
import { behaviorEvidenceLines } from '../utils/behaviorCaseEvidence';
import {
  ADMIN_PHOTO_LINK_SECONDS, caseTitle, caseBadges, caseActions, eventLine, photosByAccount, casePhotoPaths, signedUrlMap,
  linksStale, reopenReasonProblem, linkProblem, canOpenInvestigation, deletedAccountLines, DELETED_ACCOUNT_NOTE, OUTCOME_LABEL, CHECK_RESULT_LABEL,
  priorSuspensionLines, PRIOR_SUSPENSION_NOTE, sharedDeviceLines, SHARED_DEVICE_NOTE, sharedTextLines, SHARED_TEXT_NOTE,
  sharedCaseGroups, SHARED_CASES_NOTE,
} from '../utils/adminReviewCase';

// Admin review on the business website (owner, 2026-10-30; 20270368 + 20270369). Website only (BusinessWebNavigator), so
// the native app build is unchanged. Every read and action is an admin-only server function; photos are private and shown
// through 15-minute signed links that Storage issues only after re-checking the admin (policy "Admins can view photos
// under review"). A case is a reason to look, never proof: closing or reopening it changes nothing about the accounts.
// Reports stay reports: an admin may open a linked investigation from one; a report never opens one by itself.
const REPORT_COLUMNS = 'id, reason, details, created_at, resolved, reported_id, reported:profiles!reports_reported_id_fkey(display_name)';
const isMissingColumn = (error) => !!error && ['PGRST204', '42703'].includes(error.code);

export default function AdminReviewScreen() {
  const { colors } = useTheme();
  const { isAdmin } = useAuth();
  const styles = getStyles(colors);
  const wide = useWindowDimensions().width >= 900;
  const [cases, setCases] = useState([]);
  const [reports, setReports] = useState([]);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState(null); // full case from admin_get_account_review_case
  const [prior, setPrior] = useState(null); // a prior-suspension case's earlier decisions (20270374), else null
  const [kept, setKept] = useState(null); // what a deleted account left behind (20270406), else null
  const [reportKept, setReportKept] = useState({}); // the same, per open report the admin asked about
  const [shared, setShared] = useState(null); // other review cases its accounts are in (20270379, read-only), else null
  const openId = useRef(null); // the case on screen: a late answer for an earlier case is dropped
  const [links, setLinks] = useState({ at: 0, urls: {} });
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [check, setCheck] = useState({ source: '', result: 'no_match', link: '' });

  const load = useCallback(async () => {
    const listed = await supabase.rpc('admin_list_account_review_cases', { include_closed_param: includeClosed });
    // 20270398: urgent safety, then impersonation, oldest first within each (review_priority, before the 100-row limit); older databases: newest first
    const openReports = (columns, byPriority) => {
      let query = supabase.from('reports').select(columns).eq('resolved', false);
      if (byPriority) query = query.order('review_priority', { ascending: false });
      return query.order('created_at', { ascending: byPriority }).limit(100);
    };
    let rep = await openReports(`${REPORT_COLUMNS}, content_type, content_excerpt, reported_deleted_at`, true);
    if (isMissingColumn(rep.error)) rep = await openReports(REPORT_COLUMNS, false);
    if (listed.error || rep.error) { setLoadError(true); return; }
    setLoadError(false);
    setCases(listed.data || []);
    setReports(sortReportQueue(rep.data || []));
  }, [includeClosed]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const signPhotos = useCallback(async (c) => {
    const paths = casePhotoPaths(c);
    if (!paths.length) { setLinks({ at: Date.now(), urls: {} }); return; }
    const { data, error } = await supabase.storage.from('profile-photos').createSignedUrls(paths, ADMIN_PHOTO_LINK_SECONDS);
    setLinks({ at: Date.now(), urls: error ? {} : signedUrlMap(data) });
  }, []);

  const openCase = useCallback(async (id) => {
    const { data, error } = await supabase.rpc('admin_get_account_review_case', { case_id_param: id });
    if (error) return presentRecoverableError(Alert, { what: 'open that case', error, onRetry: () => openCase(id) });
    setSelected(data);
    setPrior(null);
    setKept(null);
    setShared(null);
    openId.current = id;
    supabase.rpc('admin_get_shared_review_cases', { case_id_param: id }).then(
      (r) => { if (openId.current === id) setShared(r.error ? { error: true } : sharedCaseGroups(r.data)); },
      () => { if (openId.current === id) setShared({ error: true }); });
    if (data?.signal === 'prior_suspension') {
      const earlier = await supabase.rpc('admin_get_prior_suspension', { case_id_param: id });
      setPrior(earlier.error ? { error: true } : (earlier.data || []));
    }
    if (data?.signal === 'prior_unresolved' || data?.subject_deleted_at) {
      const record = await supabase.rpc('admin_get_deleted_account_record', { case_id_param: id });
      if (openId.current === id) setKept(record.error ? { error: true } : (record.data || []));
    }
    setNote(''); setReason(''); setCheck({ source: '', result: 'no_match', link: '' });
    signPhotos(data);
  }, [signPhotos]);

  // links last 15 minutes: re-sign when the open case's links are about to expire
  useEffect(() => {
    if (!selected) return undefined;
    const t = setInterval(() => { if (linksStale(links.at)) signPhotos(selected); }, 30000);
    return () => clearInterval(t);
  }, [selected, links.at, signPhotos]);

  const after = async (error, retry) => {
    if (error) return presentRecoverableError(Alert, { what: 'complete that', error, onRetry: retry });
    await load();
    if (selected) await openCase(selected.id);
    return null;
  };

  const close = (outcome) => Alert.alert('Close this case?', 'Recorded with your account and the time. Nothing happens to these accounts.', [
    { text: 'Cancel', style: 'cancel' },
    { text: OUTCOME_LABEL[outcome], onPress: async () => {
      const { error } = await supabase.rpc('admin_close_account_review_case', { case_id_param: selected.id, outcome_param: outcome, note_param: note || null });
      after(error, () => close(outcome));
    } },
  ]);

  const reopen = async () => {
    const problem = reopenReasonProblem(reason);
    if (problem) return Alert.alert('Reopen', problem);
    const { error } = await supabase.rpc('admin_reopen_account_review_case', { case_id_param: selected.id, reason_param: reason.trim() });
    return after(error, reopen);
  };

  const addNote = async () => {
    if (!note.trim()) return;
    const { error } = await supabase.rpc('admin_add_account_review_note', { case_id_param: selected.id, note_param: note.trim() });
    after(error, addNote);
  };

  const recordCheck = async () => {
    const problem = !check.source.trim() ? 'Say where you checked.' : linkProblem(check.link);
    if (problem) return Alert.alert('Outside check', problem);
    const { error } = await supabase.rpc('admin_record_case_external_check', {
      case_id_param: selected.id, source_param: check.source.trim(), result_param: check.result, link_param: check.link.trim() || null, note_param: null,
    });
    return after(error, recordCheck);
  };

  const openFromReport = (report) => Alert.alert('Open an investigation?', 'The report stays as it is. Joins this person\'s open case if there is one.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Open', onPress: async () => {
      const { data, error } = await supabase.rpc('admin_open_case_from_report', { report_id_param: report.id, note_param: null });
      if (error) return presentRecoverableError(Alert, { what: 'complete that', error, onRetry: () => openFromReport(report) });
      await load();
      return openCase(data.case_id);
    } },
  ]);

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.empty}>Admins only.</Text>
      </SafeAreaView>
    );
  }

  const queue = (
    <View style={wide ? styles.leftCol : null}>
      <View style={styles.row}>
        <Text style={styles.sectionTitle}>Review cases</Text>
        <TouchableOpacity onPress={() => setIncludeClosed((v) => !v)} accessibilityRole="button">
          <Text style={styles.link}>{includeClosed ? 'Hide closed' : 'Show closed'}</Text>
        </TouchableOpacity>
      </View>
      {loadError ? <LoadErrorState message="Couldn't load the review queue." onRetry={load} /> : null}
      {!loadError && !cases.length ? <Text style={styles.meta}>No cases need review.</Text> : null}
      {cases.map((c) => (
        <TouchableOpacity key={c.id} style={[styles.card, selected?.id === c.id && styles.cardSelected]} onPress={() => openCase(c.id)} accessibilityRole="button">
          <Text style={styles.title}>{caseTitle(c)}</Text>
          {caseBadges(c).map((b) => <Text key={b} style={styles.badge}>{b}</Text>)}
          <Text style={styles.meta}>{(c.members || []).map((m) => m.display_name || 'Account').join(', ')}</Text>
          <Text style={styles.date}>Opened {new Date(c.opened_at).toLocaleString()} · {c.photos} photo{c.photos === 1 ? '' : 's'} · {c.reports} report{c.reports === 1 ? '' : 's'}</Text>
        </TouchableOpacity>
      ))}
      <Text style={styles.sectionTitle}>Open reports</Text>
      {!reports.length ? <Text style={styles.meta}>No open reports.</Text> : null}
      {reports.map((r) => (
        <View key={r.id} style={styles.card}>
          <Text style={styles.title}>{reportReasonLabel(r.reason)}{reportQueueTag(r.reason)}</Text>
          <Text style={styles.meta}>{r.content_type === 'business' ? 'About a business (nobody named)' : `About ${r.reported?.display_name || 'an account'}`} · {new Date(r.created_at).toLocaleString()}</Text>
          {['business', 'story', 'gathering', 'community'].includes(r.content_type) && r.content_excerpt ? <Text style={styles.details}>{r.content_excerpt}</Text> : null}
          {r.details ? <Text style={styles.details}>{r.details}</Text> : null}
          {r.reported_deleted_at && !r.reported_id ? (
            <>
              <Text style={styles.meta}>The account has been deleted.</Text>
              {reportKept[r.id] ? (reportKept[r.id].error
                ? <Text style={styles.meta}>Couldn't load what was kept.</Text>
                : deletedAccountLines(reportKept[r.id]).map((line, i) => <Text key={`k${i}`} style={styles.event}>{line}</Text>))
                : (
                  <TouchableOpacity style={styles.button} accessibilityRole="button" onPress={async () => {
                    const record = await supabase.rpc('admin_get_deleted_account_record', { report_id_param: r.id });
                    setReportKept((all) => ({ ...all, [r.id]: record.error ? { error: true } : (record.data || []) }));
                  }}>
                    <Text style={styles.buttonText}>What was kept</Text>
                  </TouchableOpacity>
                )}
            </>
          ) : null}
          {canOpenInvestigation(r) ? (
            <TouchableOpacity style={styles.button} onPress={() => openFromReport(r)} accessibilityRole="button">
              <Text style={styles.buttonText}>Open investigation</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
    </View>
  );

  const detail = selected ? (
    <View style={wide ? styles.rightCol : null}>
      <Text style={styles.sectionTitle}>{caseTitle(selected)}</Text>
      {caseBadges(selected).map((b) => <Text key={b} style={styles.badge}>{b}</Text>)}
      <Text style={styles.meta}>
        {selected.status === 'open' ? `Review by ${new Date(selected.review_due_at).toLocaleDateString()}` : `Closed ${new Date(selected.closed_at).toLocaleString()}`}
      </Text>
      {selected.signal === 'prior_suspension' ? (
        <>
          <Text style={styles.subTitle}>Earlier suspension</Text>
          <Text style={styles.meta}>{PRIOR_SUSPENSION_NOTE}</Text>
          {prior?.error ? <Text style={styles.meta}>Couldn't load the earlier decisions. Open the case again to retry.</Text> : null}
          {Array.isArray(prior) ? priorSuspensionLines(prior).map((line, i) => <Text key={`p${i}`} style={styles.event}>{line}</Text>) : null}
        </>
      ) : null}
      {kept ? (
        <>
          <Text style={styles.subTitle}>Deleted account</Text>
          <Text style={styles.meta}>{DELETED_ACCOUNT_NOTE}</Text>
          {kept.error ? <Text style={styles.meta}>Couldn't load what was kept. Open the case again to retry.</Text> : null}
          {Array.isArray(kept) ? deletedAccountLines(kept).map((line, i) => <Text key={`k${i}`} style={styles.event}>{line}</Text>) : null}
        </>
      ) : null}
      {selected.signal === 'shared_device' ? (
        <>
          <Text style={styles.subTitle}>Same phone notification token</Text>
          <Text style={styles.meta}>{SHARED_DEVICE_NOTE}</Text>
          {sharedDeviceLines(selected.evidence).map((line, i) => <Text key={`d${i}`} style={styles.event}>{line}</Text>)}
        </>
      ) : null}
      {selected.signal === 'shared_text' ? (
        <>
          <Text style={styles.subTitle}>Same public text</Text>
          <Text style={styles.meta}>{SHARED_TEXT_NOTE}</Text>
          {sharedTextLines(selected.evidence).map((line, i) => <Text key={`t${i}`} style={styles.event}>{line}</Text>)}
        </>
      ) : null}
      {behaviorEvidenceLines(selected.evidence).length ? (
        <>
          <Text style={styles.subTitle}>Activity counted</Text>
          {behaviorEvidenceLines(selected.evidence).map((line, i) => <Text key={`b${i}`} style={styles.event}>{line}</Text>)}
        </>
      ) : null}
      <AccountFactsSection caseId={selected.id} styles={styles} />
      <Text style={styles.subTitle}>Shared review cases</Text>
      <Text style={styles.meta}>{SHARED_CASES_NOTE}</Text>
      {shared?.error ? <Text style={styles.meta}>Couldn't load the shared review cases. Open the case again to retry.</Text> : null}
      {Array.isArray(shared) && !shared.length ? <Text style={styles.meta}>These accounts are in no other review case.</Text> : null}
      {Array.isArray(shared) ? shared.map((g) => (
        <View key={g.userId} style={styles.card}>
          <Text style={styles.title}>{g.name}{g.suspended ? ' · Suspended' : ''}</Text>
          {g.cases.map((c) => (
            <TouchableOpacity key={c.id} onPress={() => openCase(c.id)} accessibilityRole="button" accessibilityLabel={`${c.label}: ${c.title}, ${c.status}. Open this case`}>
              <Text style={styles.badge}>{c.label}</Text>
              <Text style={styles.link}>{c.title}</Text>
              <Text style={styles.meta}>{c.status} · Opened {new Date(c.opened).toLocaleDateString()}</Text>
              <Text style={styles.meta}>{c.others}</Text>
            </TouchableOpacity>
          ))}
          {g.more ? <Text style={styles.meta}>{g.more} older case{g.more === 1 ? '' : 's'} not shown</Text> : null}
        </View>
      )) : null}
      <Text style={styles.subTitle}>Photos side by side</Text>
      <Text style={styles.meta}>A similar photo is a reason to look, never proof (shared, stock and group photos match too). Links last 15 minutes.</Text>
      <ScrollView horizontal contentContainerStyle={styles.photoRow}>
        {photosByAccount(selected).map((g) => (
          <View key={g.userId} style={styles.account}>
            <Text style={styles.title}>{g.name}</Text>
            {g.suspended ? <Text style={styles.badge}>Suspended</Text> : null}
            {g.afterClose ? <Text style={styles.badge}>Added after closing</Text> : null}
            {g.photos.map((p) => (links.urls[p.path] ? (
              <Image key={p.objectId} source={{ uri: links.urls[p.path] }} style={styles.photo} resizeMode="contain" accessibilityLabel={`Photo of ${g.name}`} />
            ) : (
              <View key={p.objectId} style={[styles.photo, styles.photoMissing]}><Text style={styles.meta}>Not available</Text></View>
            )))}
            {g.photos.some((p) => !p.inUse) ? <Text style={styles.meta}>Includes a photo no longer on the profile</Text> : null}
          </View>
        ))}
      </ScrollView>
      <CaseLinkCount caseId={selected.id} styles={styles} />
      <LinkedReportsSection reports={selected.reports} styles={styles} />
      <Text style={styles.subTitle}>History</Text>
      {(selected.events || []).map((e, i) => (
        <Text key={`${e.at}-${i}`} style={styles.event}>{new Date(e.at).toLocaleString()} · {eventLine(e)}</Text>
      ))}

      <Text style={styles.subTitle}>Note</Text>
      <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="What you looked at, what you decided" placeholderTextColor={colors.textTertiary} multiline maxLength={1000} />
      <View style={styles.row}>
        {caseActions(selected).includes('note') ? (
          <TouchableOpacity style={styles.buttonQuiet} onPress={addNote} accessibilityRole="button"><Text style={styles.buttonText}>Add note</Text></TouchableOpacity>
        ) : null}
        {caseActions(selected).includes('close') ? (
          <>
            <TouchableOpacity style={styles.button} onPress={() => close('no_action')} accessibilityRole="button"><Text style={styles.buttonText}>Close: no action</Text></TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={() => close('action_taken')} accessibilityRole="button"><Text style={styles.buttonText}>Close: action taken</Text></TouchableOpacity>
          </>
        ) : null}
      </View>
      {caseActions(selected).includes('reopen') ? (
        <>
          <Text style={styles.subTitle}>Reopen (only for materially new evidence)</Text>
          <TextInput style={styles.input} value={reason} onChangeText={setReason} placeholder="What is new" placeholderTextColor={colors.textTertiary} multiline maxLength={1000} />
          <TouchableOpacity style={styles.button} onPress={reopen} accessibilityRole="button"><Text style={styles.buttonText}>Reopen case</Text></TouchableOpacity>
        </>
      ) : null}
      <Text style={styles.subTitle}>Outside check you did yourself</Text>
      <TextInput style={styles.input} value={check.source} onChangeText={(v) => setCheck((x) => ({ ...x, source: v }))} placeholder="Where (e.g. reverse image search)" placeholderTextColor={colors.textTertiary} maxLength={100} />
      <View style={styles.row}>
        {Object.entries(CHECK_RESULT_LABEL).map(([k, label]) => (
          <TouchableOpacity key={k} style={[styles.chip, check.result === k && styles.chipOn]} onPress={() => setCheck((x) => ({ ...x, result: k }))} accessibilityRole="button" accessibilityState={{ selected: check.result === k }}>
            <Text style={styles.chipText}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput style={styles.input} value={check.link} onChangeText={(v) => setCheck((x) => ({ ...x, link: v }))} placeholder="https:// link (optional)" placeholderTextColor={colors.textTertiary} autoCapitalize="none" maxLength={500} />
      <TouchableOpacity style={styles.buttonQuiet} onPress={recordCheck} accessibilityRole="button"><Text style={styles.buttonText}>Record check</Text></TouchableOpacity>
    </View>
  ) : (
    <View style={wide ? styles.rightCol : null}><Text style={styles.meta}>Choose a case to review.</Text></View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, wide && styles.contentWide]}>
        {queue}
        {detail}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  contentWide: { flexDirection: 'row', alignItems: 'flex-start' },
  leftCol: { width: 380 },
  rightCol: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.xs },
  sectionTitle: { ...typography.bodyBold, color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.sm },
  subTitle: { ...typography.bodyBold, color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  cardSelected: { borderColor: colors.primary },
  title: { ...typography.bodyBold, color: colors.textPrimary },
  badge: { ...typography.caption, color: colors.textPrimary, marginTop: spacing.xs, fontWeight: '700' },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  details: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, fontStyle: 'italic' },
  date: { ...typography.small, color: colors.textTertiary, marginTop: spacing.sm },
  event: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  empty: { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xxl },
  link: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  photoRow: { gap: spacing.md, paddingVertical: spacing.sm },
  account: { width: 200 },
  photo: { width: 200, height: 200, borderRadius: radius.md, backgroundColor: colors.surface, marginTop: spacing.xs },
  photoMissing: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  input: { ...typography.body, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.xs, minHeight: 40 },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.sm, alignSelf: 'flex-start' },
  buttonQuiet: { backgroundColor: colors.surfaceElevated, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.sm, alignSelf: 'flex-start' },
  buttonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.surfaceElevated },
  chipText: { ...typography.caption, color: colors.textPrimary },
});
