import React, { useEffect, useState } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import LoadErrorState from '../components/LoadErrorState';
import { PullToRefresh } from '../motion';
import { behaviorEvidenceLines } from '../utils/behaviorCaseEvidence';
import { reportReasonLabel, sortReportQueue, reportQueueTag, reportedWhatLabel } from '../utils/reportReasons';
import { ADMIN_PHOTO_LINK_SECONDS } from '../utils/adminReviewCase';
import { reportMediaByReport, reportMediaPaths, reportMediaStatus } from '../utils/reportMedia';
import { storyFileCleanupNotice } from '../utils/storyFileCleanup';
import { LEGAL_HOLD_HISTORY_LABEL, LEGAL_HOLD_REASON_MAX, LEGAL_HOLD_REFERENCE_MAX, activeHoldsByTarget, holdFor, legalHoldPhotoNote, legalHoldReasonReady, legalHoldReferenceReady, legalHoldStatusLine, legalHoldTargetLabel } from '../utils/legalHolds';
import { RESTRICTION_CAPABILITIES, RESTRICTION_DAYS, RESTRICTION_DEFAULT_DAYS, RESTRICTION_REASON_MAX, activeRestrictions, restrictionFormReady, restrictionReasonReady, restrictionStatusLine, toggleCapability } from '../utils/accountRestrictions';
import AccountFactsSection from '../components/AccountFactsSection';
import { REMOVAL_REASON_MAX, canRemoveReportedObject, removalReasonReady, removeActionLabel, reportObjectIds, reportObjectStatus } from '../utils/reportObjects';

// I3 (20270355): reports carry a server copy of the reported content; resolving records an outcome. I1 (20270357): account
// review cases (identical photo + an approved rule; 20270363: behaviour patterns, counts only) are listed above the reports. Both work on a database without those
// migrations: the old columns / direct resolve are used and no cases show.
const REPORT_COLUMNS = 'id, reason, details, created_at, resolved, reporter_id, reported_id, reported:profiles!reports_reported_id_fkey(display_name, suspended_at)';
const CONTENT_COLUMNS = ', content_type, content_excerpt, content_sent_at';
const isMissing = (error) => !!error && ['PGRST202', 'PGRST204', '42703', '42883'].includes(error.code);
const CASE_REASON = {
  many_accounts: 'Same photo on several accounts',
  similar_names: 'Same photo + similar names',
  behavior_pattern: 'Unusual activity pattern',
};

// This screen is reached as a top-level stack push (not a bottom tab),
// headerShown: false in RootNavigator, and previously took no navigation
// prop at all -- the same "reachable, but no visible way back" shape
// found and fixed on FriendDiscoveryScreen.
export default function AdminReportsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [cases, setCases] = useState([]);
  const [media, setMedia] = useState({});
  const [cleanup, setCleanup] = useState(null);
  const [objects, setObjects] = useState({});
  const [removing, setRemoving] = useState(null); // { id, reason }: the one report whose Remove form is open
  // 20270395: active legal holds (null = an older database: no hold control at all) and the one open hold form
  const [holds, setHolds] = useState(null);
  const [holdForm, setHoldForm] = useState(null); // { mode: 'place' | 'release', targetType, targetId, holdId, reason, reference }
  // 20270399: each listed person's restrictions (null = an older database: no restriction control) and the one open form
  const [restrictions, setRestrictions] = useState(null); // { [userId]: rows }
  const [restrictForm, setRestrictForm] = useState(null); // { mode: 'restrict' | 'lift', userId, reportId, caseId, capabilities, days, reason, restrictionId }

  useEffect(() => {
    load();
  }, []);

  const holdsByTarget = activeHoldsByTarget(holds);
  // holds whose item has no card here (a removal record held by procedure, a case no longer listed): shown so they can be released
  const shownTargets = new Set([...reports.map((r) => `report:${r.id}`), ...cases.map((c) => `review_case:${c.id}`)]);
  const otherHolds = (holds || []).filter((h) => !shownTargets.has(`${h.target_type}:${h.target_id}`));

  async function load() {
    setLoading(true);
    try {
      // 20270398: urgent safety, then impersonation, oldest first within each (review_priority); older databases: same order client-side
      const run = (columns, byPriority) => {
        let query = supabase.from('reports').select(columns).order('resolved', { ascending: true });
        if (byPriority) query = query.order('review_priority', { ascending: false });
        return query.order('created_at', { ascending: byPriority });
      };
      let { data, error } = await run(REPORT_COLUMNS + CONTENT_COLUMNS, true);
      if (isMissing(error)) ({ data, error } = await run(REPORT_COLUMNS + CONTENT_COLUMNS, false));
      if (isMissing(error)) ({ data, error } = await run(REPORT_COLUMNS, false));
      if (error) throw error;
      setReports(sortReportQueue(data));
      setLoadError(false);
      await loadMedia(data);
      await loadObjects(data);
      const listed = await supabase.rpc('admin_list_account_review_cases');
      setCases(listed.error ? [] : listed.data || []);
      // 20270391: files that won't delete. An older database simply has nothing to show.
      const fileStatus = await supabase.rpc('admin_story_file_cleanup_status');
      setCleanup(fileStatus.error ? null : storyFileCleanupNotice(fileStatus.data));
      const held = await supabase.rpc('admin_list_legal_holds', { include_released_param: false });
      setHolds(held.error ? null : held.data || []);
      await loadRestrictions(data, listed.error ? [] : listed.data || []);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  // 20270399: restrictions of every person a card names (the reported person, review-case members). An older database = no control.
  async function loadRestrictions(rows, caseRows) {
    const ids = [...new Set([
      ...(rows || []).map((r) => r.reported_id),
      ...(caseRows || []).flatMap((c) => (c.members || []).map((m) => m.user_id)),
    ].filter(Boolean))];
    const byUser = {};
    for (const id of ids) {
      const { data, error } = await supabase.rpc('admin_list_account_restrictions', { user_id_param: id });
      if (error) return setRestrictions(null);
      byUser[id] = data || [];
    }
    setRestrictions(byUser);
  }

  // Pause actions / lift a pause (20270399). The server checks the admin, the reason and the duration and keeps the record; a pause
  // ends by itself, and the person is told at the refused action what is paused and until when. Never automatic.
  async function submitRestriction() {
    const f = restrictForm;
    const { data, error } = f.mode === 'restrict'
      ? await supabase.rpc('admin_restrict_account', {
        user_id_param: f.userId, capabilities_param: f.capabilities, days_param: f.days, reason_param: f.reason,
        report_id_param: f.reportId || null, review_case_id_param: f.caseId || null,
      })
      : await supabase.rpc('admin_lift_account_restriction', { restriction_id_param: f.restrictionId, reason_param: f.reason });
    if (error) return presentRecoverableError(Alert, { what: 'complete that', error, onRetry: submitRestriction });
    setRestrictForm(null);
    if (f.mode === 'lift' && data?.already) Alert.alert('Already ended', 'This pause had already ended or been lifted. Nothing changed.');
    load();
  }

  // One control per person: their active pauses (each with Lift), Pause Actions, and the form when it is open for them.
  function renderRestrictionControl(userId, { reportId = null, caseId = null } = {}) {
    if (restrictions === null || !userId) return null;
    const active = activeRestrictions(restrictions[userId]);
    const open = restrictForm && restrictForm.userId === userId && restrictForm.reportId === reportId && restrictForm.caseId === caseId;
    const ready = open && (restrictForm.mode === 'restrict' ? restrictionFormReady(restrictForm) : restrictionReasonReady(restrictForm.reason));
    return (
      <View>
        {active.map((r) => (
          <View key={r.restriction_id}>
            <Text style={styles.holdLine}>{restrictionStatusLine(r)}</Text>
            {!open ? (
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => setRestrictForm({ mode: 'lift', userId, reportId, caseId, restrictionId: r.restriction_id, reason: '' })}
                  accessibilityRole="button"
                >
                  <Text style={styles.actionText}>Lift Pause</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ))}
        {!open ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setRestrictForm({ mode: 'restrict', userId, reportId, caseId, capabilities: [], days: RESTRICTION_DEFAULT_DAYS, reason: '' })}
              accessibilityRole="button"
            >
              <Text style={styles.actionText}>Pause Actions</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.evidence}>
            {restrictForm.mode === 'restrict' ? (
              <>
                <Text style={styles.meta}>Only the chosen actions are paused, for this person only, and end by themselves. They're told what is paused and until when. Nothing else changes. Recorded with your account and the time.</Text>
                <View style={styles.actions}>
                  {RESTRICTION_CAPABILITIES.map((c) => {
                    const on = restrictForm.capabilities.includes(c.key);
                    return (
                      <TouchableOpacity
                        key={c.key}
                        style={[styles.actionButton, on && styles.resolveButton]}
                        onPress={() => setRestrictForm({ ...restrictForm, capabilities: toggleCapability(restrictForm.capabilities, c.key) })}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${c.label}: ${c.covers}`}
                      >
                        <Text style={styles.actionText}>{on ? '✓ ' : ''}{c.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {restrictForm.capabilities.map((k) => (
                  <Text key={k} style={styles.meta}>{RESTRICTION_CAPABILITIES.find((c) => c.key === k)?.label}: {RESTRICTION_CAPABILITIES.find((c) => c.key === k)?.covers}</Text>
                ))}
                <View style={styles.actions}>
                  {RESTRICTION_DAYS.map((d) => (
                    <TouchableOpacity
                      key={d}
                      style={[styles.actionButton, restrictForm.days === d && styles.resolveButton]}
                      onPress={() => setRestrictForm({ ...restrictForm, days: d })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: restrictForm.days === d }}
                    >
                      <Text style={styles.actionText}>{d === 1 ? '1 day' : `${d} days`}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : (
              <Text style={styles.meta}>The action works again at once. Recorded with your account and the time.</Text>
            )}
            <TextInput
              style={styles.reasonInput}
              value={restrictForm.reason}
              onChangeText={(reason) => setRestrictForm({ ...restrictForm, reason })}
              placeholder={restrictForm.mode === 'restrict' ? 'Why? What did the evidence show?' : 'Why is it lifted early?'}
              placeholderTextColor={colors.textTertiary}
              maxLength={RESTRICTION_REASON_MAX}
              multiline
              accessibilityLabel={restrictForm.mode === 'restrict' ? 'Reason for pausing actions' : 'Reason for lifting the pause'}
            />
            <View style={styles.actions}>
              <TouchableOpacity style={styles.actionButton} onPress={() => setRestrictForm(null)} accessibilityRole="button">
                <Text style={styles.actionText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.resolveButton, !ready && styles.actionDisabled]}
                onPress={submitRestriction}
                disabled={!ready}
                accessibilityRole="button"
                accessibilityState={{ disabled: !ready }}
              >
                <Text style={styles.actionText}>{restrictForm.mode === 'restrict' ? `Pause for ${restrictForm.days === 1 ? '1 day' : `${restrictForm.days} days`}` : 'Lift Pause'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  }

  // A reported photo (20270391): Storage issues the 15-minute link only after re-checking the admin and the hold.
  async function loadMedia(rows) {
    const ids = (rows || []).filter((r) => r.content_type === 'story').map((r) => r.id);
    if (!ids.length) { setMedia({}); return; }
    const held = await supabase.rpc('admin_get_report_media', { report_ids_param: ids });
    if (held.error) { setMedia({}); return; }
    const paths = reportMediaPaths(held.data);
    const signed = paths.length
      ? await supabase.storage.from('stories').createSignedUrls(paths, ADMIN_PHOTO_LINK_SECONDS)
      : { data: [] };
    setMedia(reportMediaByReport(held.data, signed.error ? [] : signed.data));
  }

  // 20270393: is a reported gathering or community still there? An older database shows no status and no Remove button.
  async function loadObjects(rows) {
    const ids = reportObjectIds(rows);
    if (!ids.length) { setObjects({}); return; }
    const { data, error } = await supabase.rpc('admin_get_report_objects', { report_ids_param: ids });
    setObjects(error ? {} : Object.fromEntries((data || []).map((o) => [o.report_id, o])));
  }

  // The server checks the admin, the report and the reason, and keeps the record. The report stays open: Mark Resolved closes it.
  async function removeObject() {
    const { id, reason } = removing;
    const { data, error } = await supabase.rpc('admin_remove_reported_content', { report_id_param: id, reason_param: reason });
    if (error) return presentRecoverableError(Alert, { what: 'complete that', error, onRetry: removeObject });
    setRemoving(null);
    if (data?.already) Alert.alert('Already gone', 'It was removed or cancelled before this. Nothing changed.');
    load();
  }

  // Place or release a legal hold (20270395). The server checks the admin and the reason and keeps the record (who, when, why);
  // a release returns the evidence to its ordinary retention, never deletes it, and another active hold still keeps it.
  async function submitHold() {
    const f = holdForm;
    const { data, error } = f.mode === 'place'
      ? await supabase.rpc('admin_place_legal_hold', { target_type_param: f.targetType, target_id_param: f.targetId, reason_param: f.reason, reference_param: f.reference || null, scope_param: f.wholeHistory ? 'account_history' : 'item' })
      : await supabase.rpc('admin_release_legal_hold', { hold_id_param: f.holdId, reason_param: f.reason });
    if (error) return presentRecoverableError(Alert, { what: 'complete that', error, onRetry: submitHold });
    setHoldForm(null);
    const note = f.mode === 'place' ? legalHoldPhotoNote(data) : null;
    if (data?.already) Alert.alert(f.mode === 'place' ? 'Already on hold' : 'Already released', 'Nothing changed.');
    else if (note) Alert.alert('Hold placed', note);
    load();
  }

  function confirmRelease() {
    Alert.alert('Release this legal hold?', 'Nothing is deleted now. Live records go back to their ordinary retention. Copies and original files kept from a deleted account stay until a recorded retention policy allows their removal; another active hold still keeps them. Recorded with your account.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Release', style: 'destructive', onPress: submitHold },
    ]);
  }

  // One control for every holdable item: the status line, Place / Release, and the form when it is open for this item.
  function renderHoldControl(targetType, targetId) {
    if (holds === null) return null;
    const hold = holdFor(holdsByTarget, targetType, targetId);
    const open = holdForm && holdForm.targetType === targetType && holdForm.targetId === targetId;
    const ready = open && legalHoldReasonReady(holdForm.reason) && legalHoldReferenceReady(holdForm.reference);
    return (
      <View>
        {hold ? <Text style={styles.holdLine}>{legalHoldStatusLine(hold)}</Text> : null}
        {!open ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setHoldForm({ mode: hold ? 'release' : 'place', targetType, targetId, holdId: hold?.hold_id, reason: '', reference: '' })}
              accessibilityRole="button"
            >
              <Text style={styles.actionText}>{hold ? 'Release Legal Hold' : 'Place Legal Hold'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.evidence}>
            <Text style={styles.meta}>{holdForm.mode === 'place'
              ? 'Kept past every retention job until an admin releases it. Recorded with your account and the time.'
              : 'Nothing is deleted now: the evidence goes back to its ordinary retention. Recorded with your account and the time.'}</Text>
            <TextInput
              style={styles.reasonInput}
              value={holdForm.reason}
              onChangeText={(reason) => setHoldForm({ ...holdForm, reason })}
              placeholder={holdForm.mode === 'place' ? 'Why is it held?' : 'Why is it released?'}
              placeholderTextColor={colors.textTertiary}
              maxLength={LEGAL_HOLD_REASON_MAX}
              multiline
              accessibilityLabel={holdForm.mode === 'place' ? 'Reason for the legal hold' : 'Reason for releasing the legal hold'}
            />
            {holdForm.mode === 'place' ? (
              <TextInput
                style={[styles.reasonInput, styles.referenceInput]}
                value={holdForm.reference}
                onChangeText={(reference) => setHoldForm({ ...holdForm, reference })}
                placeholder="Reference (optional): a ticket or request number"
                placeholderTextColor={colors.textTertiary}
                maxLength={LEGAL_HOLD_REFERENCE_MAX}
                accessibilityLabel="Legal hold reference, optional"
              />
            ) : null}
            {holdForm.mode === 'place' ? (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => setHoldForm({ ...holdForm, wholeHistory: !holdForm.wholeHistory })}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!holdForm.wholeHistory }}
              >
                <Text style={styles.actionText}>{holdForm.wholeHistory ? '☑' : '☐'} {LEGAL_HOLD_HISTORY_LABEL}</Text>
              </TouchableOpacity>
            ) : null}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.actionButton} onPress={() => setHoldForm(null)} accessibilityRole="button">
                <Text style={styles.actionText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.resolveButton, !ready && styles.actionDisabled]}
                onPress={holdForm.mode === 'place' ? submitHold : confirmRelease}
                disabled={!ready}
                accessibilityRole="button"
                accessibilityState={{ disabled: !ready }}
              >
                <Text style={styles.actionText}>{holdForm.mode === 'place' ? 'Place Hold' : 'Release Hold'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  }

  async function retryCleanup() {
    const { error } = await supabase.rpc('admin_retry_story_file_cleanup');
    if (error) return presentRecoverableError(Alert, { what: 'complete that', error, onRetry: retryCleanup });
    Alert.alert('Retry queued', 'The next hourly run tries them again.');
    load();
  }

  function removePhoto(item) {
    Alert.alert('Remove this photo?', 'Everyone stops seeing it now. It stays here for review until you resolve the report.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('admin_remove_reported_media', { report_id_param: item.id });
          if (error) return presentRecoverableError(Alert, { what: 'complete that', error, onRetry: () => removePhoto(item) });
          load();
        },
      },
    ]);
  }

  // The outcome is recorded with the admin and time (report_actions); before 20270355 the plain resolve is used.
  function markResolved(item) {
    const resolve = async (outcome) => {
      let { error } = await supabase.rpc('admin_resolve_report', { report_id_param: item.id, outcome_param: outcome });
      if (isMissing(error)) ({ error } = await supabase.from('reports').update({ resolved: true }).eq('id', item.id));
      if (error) return presentRecoverableError(Alert, { what: 'complete that', error, onRetry: () => resolve(outcome) });
      load();
    };
    Alert.alert('Resolve this report?', 'Recorded with your account and the time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'No action needed', onPress: () => resolve('no_action') },
      { text: 'Action taken', onPress: () => resolve('action_taken') },
    ]);
  }

  // A case is a signal for review, never proof: closing it changes nothing about the accounts.
  function closeCase(c) {
    const close = async (outcome) => {
      const { error } = await supabase.rpc('admin_close_account_review_case', { case_id_param: c.id, outcome_param: outcome });
      if (error) return presentRecoverableError(Alert, { what: 'complete that', error, onRetry: () => close(outcome) });
      load();
    };
    Alert.alert('Close this review?', 'Nothing happens to these accounts. Suspend from a report if action is needed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'No action needed', onPress: () => close('no_action') },
      { text: 'Action taken', onPress: () => close('action_taken') },
    ]);
  }

  // Suspension is decided by the server (admin_suspend_user / admin_reinstate_user, 20270351): admin only, recorded with
  // this report, the profile hidden, sessions ended and sign-in refused; every social action refused while suspended.
  // The alert says what the server actually did, never what was intended.
  function suspendReportedUser(item) {
    Alert.alert(
      'Suspend this user?',
      'Hides their profile, signs them out, blocks sign-in and refuses messages, invitations, hosting and every other social action until reinstated. Recorded with this report.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Suspend',
          style: 'destructive',
          onPress: async () => {
            const { data, error } = await supabase.rpc('admin_suspend_user', {
              user_id_param: item.reported_id,
              reason_param: `Report: ${reportReasonLabel(item.reason)}`,
              report_id_param: item.id,
            });
            if (error) return presentRecoverableError(Alert, { what: 'complete that', error, onRetry: () => suspendReportedUser(item) });
            Alert.alert(data?.already ? 'Already suspended' : 'Suspended', data?.already ? 'This account was already suspended.' : 'Profile hidden, signed out and blocked from social actions.');
            load();
          },
        },
      ]
    );
  }

  function reinstateReportedUser(item) {
    Alert.alert('Reinstate this user?', 'Restores their profile and sign-in. Recorded in the moderation log.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reinstate',
        onPress: async () => {
          const { data, error } = await supabase.rpc('admin_reinstate_user', {
            user_id_param: item.reported_id,
            reason_param: `Reinstated from report: ${reportReasonLabel(item.reason)}`,
          });
          if (error) return presentRecoverableError(Alert, { what: 'complete that', error, onRetry: () => reinstateReportedUser(item) });
          Alert.alert(data?.already ? 'Not suspended' : 'Reinstated', data?.already ? 'This account was not suspended.' : 'Their profile and sign-in are restored.');
          load();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Reports</Text>
      </View>
      <FlatList
        data={reports}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
        refreshControl={<PullToRefresh refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={cases.length || cleanup || otherHolds.length ? (
          <View>
            {cleanup ? (
              <View style={styles.card}>
                <Text style={styles.reason}>{cleanup.title}</Text>
                <Text style={styles.meta}>{cleanup.reasons}</Text>
                <Text style={styles.meta}>Nobody can see these files. They stay in Storage until deleted.</Text>
                {cleanup.canRetry ? (
                  <View style={styles.actions}>
                    <TouchableOpacity style={[styles.actionButton, styles.resolveButton]} onPress={retryCleanup} accessibilityRole="button">
                      <Text style={styles.actionText}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ) : null}
            {otherHolds.length ? <Text style={styles.sectionTitle}>Other legal holds</Text> : null}
            {otherHolds.map((h) => (
              <View key={h.hold_id} style={styles.card}>
                <Text style={styles.reason}>{legalHoldTargetLabel(h.target_type)}</Text>
                <Text style={styles.meta}>{h.target_id}</Text>
                {renderHoldControl(h.target_type, h.target_id)}
              </View>
            ))}
            {cases.length ? <Text style={styles.sectionTitle}>Account review</Text> : null}
            {cases.map((c) => (
              <View key={c.id} style={styles.card}>
                <Text style={styles.reason}>{CASE_REASON[c.reason] || c.reason}</Text>
                {behaviorEvidenceLines(c.evidence).map((line) => (
                  <Text key={line} style={styles.meta}>{line}</Text>
                ))}
                {(c.members || []).map((m) => (
                  <View key={m.user_id}>
                    <Text style={styles.meta}>{m.display_name || m.user_id}{m.suspended ? ' · suspended' : ''}</Text>
                    {!m.suspended ? renderRestrictionControl(m.user_id, { caseId: c.id }) : null}
                  </View>
                ))}
                <AccountFactsSection caseId={c.id} styles={styles} />
                <Text style={styles.date}>Opened {new Date(c.opened_at).toLocaleString()}</Text>
                <View style={styles.actions}>
                  <TouchableOpacity style={[styles.actionButton, styles.resolveButton]} onPress={() => closeCase(c)} accessibilityRole="button">
                    <Text style={styles.actionText}>Close Review</Text>
                  </TouchableOpacity>
                </View>
                {renderHoldControl('review_case', c.id)}
              </View>
            ))}
            <Text style={styles.sectionTitle}>Reports</Text>
          </View>
        ) : null}
        ListEmptyComponent={
          loadError ? (
            <LoadErrorState message="Couldn't load reports." onRetry={load} />
          ) : (
            <Text style={styles.empty}>No reports.</Text>
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.card, item.resolved && styles.cardResolved]}>
            <Text style={styles.reason}>{reportReasonLabel(item.reason)}{!item.resolved ? reportQueueTag(item.reason) : ''}</Text>
            {item.content_type === 'business' ? (
              <Text style={styles.meta}>About a business (nobody named)</Text>
            ) : item.reported_id ? (
              <Text style={styles.meta}>Against: {item.reported?.display_name || item.reported_id}</Text>
            ) : null}
            {item.reported?.suspended_at ? <Text style={styles.meta}>Suspended {new Date(item.reported.suspended_at).toLocaleString()}</Text> : null}
            {item.details ? <Text style={styles.details}>{item.details}</Text> : null}
            {item.content_excerpt ? (
              <View style={styles.evidence}>
                <Text style={styles.meta}>Reported {reportedWhatLabel(item.content_type)}{item.content_sent_at ? ` · sent ${new Date(item.content_sent_at).toLocaleString()}` : ''}</Text>
                <Text style={styles.details}>{item.content_excerpt}</Text>
                {media[item.id]?.url && media[item.id].media_type === 'image' ? (
                  <Image source={{ uri: media[item.id].url }} style={styles.reportPhoto} resizeMode="contain" accessibilityLabel="Reported photo" />
                ) : null}
                {media[item.id] ? <Text style={styles.meta}>{reportMediaStatus(media[item.id])}</Text> : null}
                {reportObjectStatus(objects[item.id]) ? <Text style={styles.meta}>{reportObjectStatus(objects[item.id])}</Text> : null}
              </View>
            ) : null}
            <Text style={styles.date}>{new Date(item.created_at).toLocaleString()}</Text>

            {/* a suspended account can be reinstated from its report even after the report is resolved */}
            {(!item.resolved || item.reported?.suspended_at) && (
              <View style={styles.actions}>
                {/* a report with no person on it (a business report, 20270381) offers no Suspend: nobody is accused */}
                {!item.reported_id ? null : item.reported?.suspended_at ? (
                  <TouchableOpacity style={styles.actionButton} onPress={() => reinstateReportedUser(item)} accessibilityRole="button">
                    <Text style={styles.actionText}>Reinstate User</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.actionButton} onPress={() => suspendReportedUser(item)} accessibilityRole="button">
                    <Text style={styles.actionText}>Suspend User</Text>
                  </TouchableOpacity>
                )}
                {!item.resolved && media[item.id]?.still_live ? (
                  <TouchableOpacity style={styles.actionButton} onPress={() => removePhoto(item)} accessibilityRole="button">
                    <Text style={styles.actionText}>Remove Photo</Text>
                  </TouchableOpacity>
                ) : null}
                {canRemoveReportedObject(item, objects[item.id]) && removing?.id !== item.id ? (
                  <TouchableOpacity style={styles.actionButton} onPress={() => setRemoving({ id: item.id, reason: '' })} accessibilityRole="button">
                    <Text style={styles.actionText}>{removeActionLabel(item.content_type)}</Text>
                  </TouchableOpacity>
                ) : null}
                {!item.resolved && (
                  <TouchableOpacity style={[styles.actionButton, styles.resolveButton]} onPress={() => markResolved(item)}>
                    <Text style={styles.actionText}>Mark Resolved</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {removing?.id === item.id ? (
              <View style={styles.evidence}>
                <Text style={styles.meta}>Gone for everyone at once, including attendees and members, and repeats of a gathering. Its chat is deleted and unpaid bookings are cancelled. This can't be undone. The report keeps its copy.</Text>
                <TextInput
                  style={styles.reasonInput}
                  value={removing.reason}
                  onChangeText={(reason) => setRemoving({ id: item.id, reason })}
                  placeholder="Why? Recorded with your account."
                  placeholderTextColor={colors.textTertiary}
                  maxLength={REMOVAL_REASON_MAX}
                  multiline
                  accessibilityLabel="Reason for removing"
                />
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.actionButton} onPress={() => setRemoving(null)} accessibilityRole="button">
                    <Text style={styles.actionText}>Keep It</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.resolveButton, !removalReasonReady(removing.reason) && styles.actionDisabled]}
                    onPress={removeObject}
                    disabled={!removalReasonReady(removing.reason)}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !removalReasonReady(removing.reason) }}
                  >
                    <Text style={styles.actionText}>Remove for Everyone</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            {/* a temporary pause on the reported person (20270399); a suspended account needs none */}
            {item.reported_id && !item.reported?.suspended_at && !item.resolved ? renderRestrictionControl(item.reported_id, { reportId: item.id }) : null}
            {/* a hold on a report also keeps its removal record (20270395), so a removed object's evidence is held from here too */}
            {renderHoldControl('report', item.id)}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.md },
  backButton: { padding: spacing.xs },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  empty: { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xxl },
  reportPhoto: { width: '100%', height: 240, marginTop: spacing.sm, borderRadius: radius.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardResolved: { opacity: 0.5 },
  sectionTitle: { ...typography.bodyBold, color: colors.textSecondary, marginBottom: spacing.sm, marginTop: spacing.sm },
  evidence: { marginTop: spacing.sm, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.border },
  reason: { ...typography.bodyBold, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  details: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, fontStyle: 'italic' },
  date: { ...typography.small, color: colors.textTertiary, marginTop: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md, gap: spacing.sm },
  actionButton: { backgroundColor: colors.surfaceElevated, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  resolveButton: { backgroundColor: colors.primary },
  actionDisabled: { opacity: 0.4 },
  holdLine: { ...typography.caption, color: colors.textPrimary, fontWeight: '700', marginTop: spacing.sm },
  referenceInput: { minHeight: 0 },
  reasonInput: { ...typography.caption, color: colors.textPrimary, marginTop: spacing.sm, padding: spacing.sm, minHeight: 64, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, textAlignVertical: 'top' },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});