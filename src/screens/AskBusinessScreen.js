import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { submitBusinessRequest, submitBusinessRequestForGathering, submitBusinessRequestForCommunity } from '../services/businessFulfillment';
import { createBusinessRequestForMatch } from '../services/dateProposals';
import { INTEREST_OPTIONS } from '../constants/gatheringCategories';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Same canonical 26-tag list business_requests.category's own (now-widened)
// CHECK constraint validates against -- was a separate, independently-
// drifting 24-tag copy (missing 'Faith & Spirituality' and 'Dating') before
// the category/filter taxonomy pass (CLAUDE.md). Re-exported under its
// original name since CommunityDetailScreen.js still imports it by this
// name for its own prefill-validity guard.
export const CATEGORY_OPTIONS = INTEREST_OPTIONS;

// Reuses the exact same coarse dateWindow vocabulary as create-assistant's
// Phase 1b extension and intentResolver.js -- never a specific date/time
// the user didn't explicitly pick, matching this app's standing "AI never
// infers a specific date/time" rule (this screen has no AI in it at all,
// but the same discipline applies to keep the whole intent flow honest).
const DATE_OPTIONS = [
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'weekend', label: 'This weekend' },
  { key: 'flexible', label: "I'm flexible" },
];

// PRODUCT_AUDIT/INTENT_LAYER_UX_WALKTHROUGH_2026-08-14.md finding 4 -- the
// empty-fallback's own "try widening what you're looking for" copy
// previously had no real control behind it; this is that control, threaded
// straight through to submitBusinessRequest/submitBusinessRequestForGathering's
// already-existing radiusMiles param (no RPC change needed -- both already
// accept it).
const RADIUS_OPTIONS = [15, 30, 50];

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toDateParam(dateWindow) {
  const now = new Date();
  const todayStart = startOfDay(now);
  // 'tonight'/'now' are real values create-assistant can return
  // (VALID_DATE_WINDOWS includes 'tonight') but previously had no branch
  // here at all -- fell through to the final `return null`, silently
  // dropping the "same day" signal from a submitted business request. Bug
  // found during Aug 15 2026 stabilization-pass bug hunt; matches
  // intentResolverScoring.js's own matchesDateWindow(), which already
  // treats today/tonight/now as equivalent.
  if (dateWindow === 'today' || dateWindow === 'tonight' || dateWindow === 'now') return todayStart.toISOString().slice(0, 10);
  if (dateWindow === 'tomorrow') {
    const d = new Date(todayStart);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (dateWindow === 'weekend') {
    const dayOfWeek = todayStart.getDay();
    // Sunday (0) is the tail end of the *current* weekend, not 6 days
    // before the next one -- the old wraparound math silently pushed a
    // Sunday submission's business request a full week out. Bug found
    // during Aug 15 2026 stabilization-pass bug hunt (same fix applied to
    // intentResolverScoring.js's matchesDateWindow/dateWindowToDateRange).
    const daysUntilSaturday = dayOfWeek === 0 ? -1 : 6 - dayOfWeek;
    const d = new Date(todayStart);
    d.setDate(d.getDate() + daysUntilSaturday);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

// Reached four ways: from Home's intent box once Tiers 1/3 (existing
// gatherings/perks) genuinely found nothing -- Tier 4 of the resolver,
// "ask a business to make it happen," framed as a real, first-class path,
// never a fallback after "the real options" failed -- or, when
// `route.params.gatheringId` is present, from a gathering's own host
// banner (Phase 3, "a gathering becomes a demand generator") -- or, when
// `route.params.matchId` is present, from a match's own accepted date
// proposal (Offer System Phase 5, see CLAUDE.md's own plan, Decision 4:
// the "Dating Experience -> Business Request" bridge) -- or, when
// `route.params.communityId` is present, from a community's own "Find a
// Business for This Plan" chooser (real user ask, Aug 24 2026: "can't I
// just send the request out the category?" instead of naming one specific
// business). In gathering mode, party size/date/location are all real
// data sourced server-side from the gathering itself, never re-asked here
// -- the "When" step is skipped entirely since the gathering already has
// a real date, and party size renders as a fact, not an editable field.
// Match mode is similar for party size (always the real 2 -- both match
// participants, never user-typed) but keeps the "When" chips, since an
// accepted plan has no fixed date the way a gathering does, and uses real
// device location (like the solo path) since a match has no stored
// coordinates of its own the way a gathering does. Community mode reads
// closest to the solo path -- party size/budget/date all stay caller-
// supplied, since a community has no fixed attendee count the way one
// specific gathering does -- but, like gathering mode, location comes from
// real server-side data (the community's own Community Area), never the
// device's own GPS.
export default function AskBusinessScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  const gatheringId = route.params?.gatheringId ?? null;
  const gatheringTitle = route.params?.gatheringTitle ?? null;
  const gatheringPartySize = route.params?.gatheringPartySize ?? null;
  const matchId = route.params?.matchId ?? null;
  const matchName = route.params?.matchName ?? null;
  const communityId = route.params?.communityId ?? null;
  const communityName = route.params?.communityName ?? null;
  // Set only when reached by tapping a live business_availability candidate
  // on Home's intent results (see intentResolver.js). Its own availabilityId
  // is threaded through handleSubmit() below into submitBusinessRequest(),
  // so this exact posting is really bound on submit (Finding 5 fix,
  // CLAUDE.md) -- not just informational. Still not a guarantee: the RPC
  // re-checks the posting is genuinely still live (active/unexpired/has
  // capacity) at submit time, so a posting that filled up in the interim
  // correctly falls through to nothing rather than a fabricated match.
  const matchedAvailability = route.params?.matchedAvailability ?? null;

  const [text, setText] = useState(route.params?.prefillText ?? '');
  const [category, setCategory] = useState(route.params?.prefillCategory ?? null);
  const [partySize, setPartySize] = useState(route.params?.prefillPartySize ? String(route.params.prefillPartySize) : '');
  const [budgetMax, setBudgetMax] = useState(route.params?.prefillBudgetMax ? String(route.params.prefillBudgetMax) : '');
  // 'tonight' is a real value create-assistant can return, but this
  // screen's own chip set only has today/tomorrow/weekend/flexible --
  // previously an incoming 'tonight' was kept as-is, so no chip ever
  // rendered as selected and toDateParam() (before its own fix above)
  // silently submitted no date at all. Normalized to 'today' here, same
  // as toDateParam() itself now treats them as equivalent.
  const rawPrefillDateWindow = route.params?.prefillDateWindow;
  const normalizedPrefillDateWindow = rawPrefillDateWindow === 'tonight' || rawPrefillDateWindow === 'now' ? 'today' : rawPrefillDateWindow;
  const [dateWindow, setDateWindow] = useState(normalizedPrefillDateWindow && normalizedPrefillDateWindow !== 'flexible' ? normalizedPrefillDateWindow : 'flexible');
  const [radiusMiles, setRadiusMiles] = useState(RADIUS_OPTIONS.includes(route.params?.prefillRadiusMiles) ? route.params.prefillRadiusMiles : 15);
  // Phase 3 item 1 (CLAUDE.md): the real intent_submissions row behind
  // this ask, when Home's own intent flow is what led here -- carried
  // through to create_business_request so the funnel can trace a
  // group-plan-originated request back to its real originating
  // individual ask. Absent when this screen is reached any other way
  // (a gathering's own "Ask Local Businesses" link, a direct nav) --
  // stays honestly null there, never fabricated.
  const submissionId = route.params?.prefillSubmissionId ?? null;
  const [extraNotes, setExtraNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Per the locked design (CLAUDE.md, Aug 24 2026): every field genuinely
  // rendered as an editable input in this mode is required -- fields
  // already server-sourced per mode (gathering's party size/date, match's
  // party size) stay correctly exempt. Checked in the same top-to-bottom
  // order the fields render in, one specific alert per missing field,
  // matching this screen's own established single-check convention rather
  // than a generic "fill in required fields" message.
  // Date isn't checked here -- the "When?" chip row always has a real,
  // deterministic value selected (defaults to 'flexible', a genuine "no
  // preference" answer, not an unanswered field), so there's no missing
  // state to validate against for it.
  function findMissingField() {
    if (!text.trim()) return { title: 'Tell us what you want', body: 'A few words about what you’re looking for.' };
    if (!category) return { title: 'Pick a category', body: 'Helps us route this to the right kind of business.' };
    if (!gatheringId && !matchId && !partySize.trim()) return { title: 'How many people?', body: 'A real party size helps a business quote the right offer.' };
    if (!budgetMax.trim()) return { title: 'What’s your budget?', body: 'A rough ceiling is enough -- it just helps businesses respond with something realistic.' };
    return null;
  }

  async function handleSubmit() {
    const missing = findMissingField();
    if (missing) {
      Alert.alert(missing.title, missing.body);
      return;
    }
    setSubmitting(true);
    try {
      const budgetMaxNum = budgetMax.trim() ? parseInt(budgetMax.trim(), 10) : null;
      const safeBudgetMax = Number.isInteger(budgetMaxNum) && budgetMaxNum > 0 ? budgetMaxNum : null;

      const partySizeNum = partySize.trim() ? parseInt(partySize.trim(), 10) : null;
      const safePartySize = Number.isInteger(partySizeNum) && partySizeNum > 0 ? partySizeNum : null;

      // Only one real raw_text column exists server-side -- the optional
      // "Anything else?" note is a genuinely separate, always-optional
      // field client-side, appended onto the required text only when
      // filled in, so businesses still only ever get the one composed
      // description.
      const finalText = extraNotes.trim() ? `${text.trim()}. ${extraNotes.trim()}` : text.trim();

      let result;
      if (gatheringId) {
        result = await submitBusinessRequestForGathering({
          gatheringId,
          text: finalText,
          category,
          budgetMax: safeBudgetMax,
          radiusMiles,
        });
      } else if (matchId) {
        result = await createBusinessRequestForMatch({
          matchId,
          text: finalText,
          category,
          budgetMax: safeBudgetMax,
          date: toDateParam(dateWindow),
          radiusMiles,
        });
      } else if (communityId) {
        result = await submitBusinessRequestForCommunity({
          communityId,
          text: finalText,
          category,
          partySize: safePartySize,
          budgetMax: safeBudgetMax,
          date: toDateParam(dateWindow),
          radiusMiles,
        });
      } else {
        result = await submitBusinessRequest({
          text: finalText,
          category,
          partySize: safePartySize,
          budgetMax: safeBudgetMax,
          date: toDateParam(dateWindow),
          radiusMiles,
          submissionId,
          preferredAvailabilityId: matchedAvailability?.availabilityId ?? null,
        });
      }
      // Finding 4: carry the original ask's real prefill fields forward so
      // the "Try a Wider Radius" button on BusinessRequestDetail can push a
      // fresh AskBusiness pre-filled from them, rather than a dead end.
      navigation.replace('BusinessRequestDetail', {
        requestId: result.requestId,
        justSubmitted: true,
        notifiedCount: result.notifiedCount,
        duplicate: result.duplicate,
        prefillText: finalText,
        prefillCategory: category,
        prefillPartySize: safePartySize,
        prefillBudgetMax: safeBudgetMax,
        prefillDateWindow: dateWindow,
        prefillRadiusMiles: radiusMiles,
        prefillSubmissionId: submissionId,
        gatheringId,
        gatheringTitle,
        gatheringPartySize,
        matchId,
        matchName,
        communityId,
        communityName,
      });
    } catch (e) {
      Alert.alert('Something went wrong', e.message);
    }
    setSubmitting(false);
  }

  // A real, honest recap built from the exact state about to be submitted --
  // same "preview the state you're about to submit" pattern Create 2.0's own
  // Publish step already established, not a new UI concept. Only rendered
  // once every field genuinely required for this mode is actually filled in.
  const recapReady = findMissingField() === null;
  const recapParts = [];
  if (recapReady) {
    recapParts.push(`Looking for: ${text.trim()}`);
    if (category) recapParts.push(category);
    if (!gatheringId) {
      const dateLabel = DATE_OPTIONS.find((d) => d.key === dateWindow)?.label;
      if (dateLabel) recapParts.push(dateLabel);
    }
    if (!gatheringId && !matchId && partySize.trim()) recapParts.push(`${partySize.trim()} people`);
    if (budgetMax.trim()) recapParts.push(`up to $${budgetMax.trim()}`);
    recapParts.push(`within ${radiusMiles} mi`);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.heading}>
            {gatheringId
              ? `Find ${gatheringTitle ?? 'your gathering'} somewhere to go`
              : matchId
                ? `Find something for you and ${matchName ?? 'your match'}`
                : communityId
                  ? `Ask nearby businesses for ${communityName ?? 'your community'}`
                  : 'Can Nearby make this happen?'}
          </Text>
          <Text style={styles.subtitle}>
            {gatheringId
              ? `Asking on behalf of your ${gatheringPartySize ?? ''}-person gathering — real nearby businesses can respond with a real offer for the group.`
              : matchId
                ? `You both agreed on a plan — real nearby businesses can respond with a real offer for the two of you.`
                : communityId
                  ? `Describe what you need — every eligible business near your community's Area can respond with a real, custom offer.`
                  : matchedAvailability
                    ? `${matchedAvailability.partnerName} already has this available — review below and send your ask.`
                    : "We couldn't find anything already happening for this — real nearby businesses can respond with a real offer."}
          </Text>

          {matchedAvailability && (
            <View style={styles.matchedAvailabilityBanner}>
              <Text style={styles.matchedAvailabilityTitle}>{matchedAvailability.partnerName}</Text>
              <Text style={styles.matchedAvailabilityText}>
                {matchedAvailability.title}
                {matchedAvailability.price != null ? ` · $${matchedAvailability.price}` : ''}
              </Text>
              {matchedAvailability.description ? (
                <Text style={styles.matchedAvailabilityDescription}>{matchedAvailability.description}</Text>
              ) : null}
            </View>
          )}

          <Text style={styles.label}>What do you want?</Text>
          <TextInput
            style={styles.textArea}
            placeholder="Dinner for 4 tonight…"
            placeholderTextColor={colors.textTertiary}
            value={text}
            onChangeText={setText}
            multiline
            accessibilityLabel="What do you want?"
          />

          <Text style={styles.label}>Category</Text>
          <View style={styles.chipRow}>
            {CATEGORY_OPTIONS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.chip, category === c && styles.chipSelected]}
                onPress={() => setCategory(category === c ? null : c)}
                accessibilityLabel={c}
                accessibilityRole="button"
              >
                <Text style={[styles.chipText, category === c && styles.chipTextSelected]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {!gatheringId && (
            <>
              <Text style={styles.label}>When?</Text>
              <View style={styles.chipRow}>
                {DATE_OPTIONS.map((d) => (
                  <TouchableOpacity
                    key={d.key}
                    style={[styles.chip, dateWindow === d.key && styles.chipSelected]}
                    onPress={() => setDateWindow(d.key)}
                    accessibilityLabel={d.label}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.chipText, dateWindow === d.key && styles.chipTextSelected]}>{d.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <View style={styles.row}>
            {!gatheringId && !matchId && (
              <View style={{ flex: 1, marginRight: spacing.sm }}>
                <Text style={styles.label}>Party size</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 4"
                  placeholderTextColor={colors.textTertiary}
                  value={partySize}
                  onChangeText={setPartySize}
                  keyboardType="number-pad"
                  accessibilityLabel="Party size"
                />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Budget max</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 150"
                placeholderTextColor={colors.textTertiary}
                value={budgetMax}
                onChangeText={setBudgetMax}
                keyboardType="number-pad"
                accessibilityLabel="Budget max"
              />
            </View>
          </View>

          <Text style={styles.label}>Anything else? (optional)</Text>
          <TextInput
            style={[styles.textArea, { minHeight: 60 }]}
            placeholder="Atmosphere, dietary needs, anything else that'd help…"
            placeholderTextColor={colors.textTertiary}
            value={extraNotes}
            onChangeText={setExtraNotes}
            multiline
            accessibilityLabel="Anything else? Optional."
          />

          <Text style={styles.label}>Search radius</Text>
          <View style={styles.chipRow}>
            {RADIUS_OPTIONS.map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.chip, radiusMiles === r && styles.chipSelected]}
                onPress={() => setRadiusMiles(r)}
                accessibilityLabel={`${r} miles`}
                accessibilityRole="button"
              >
                <Text style={[styles.chipText, radiusMiles === r && styles.chipTextSelected]}>{r} mi</Text>
              </TouchableOpacity>
            ))}
          </View>

          {recapReady && (
            <View style={styles.recapCard}>
              <Text style={styles.recapText}>{recapParts.join(' · ')}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.submitButton, (submitting || !text.trim()) && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={submitting || !text.trim()}
            accessibilityLabel="Ask nearby businesses"
            accessibilityRole="button"
          >
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Ask Nearby Businesses</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  heading: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  matchedAvailabilityBanner: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  matchedAvailabilityTitle: { ...typography.body, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
  matchedAvailabilityText: { ...typography.body, color: colors.primary, fontWeight: '600', marginBottom: 2 },
  matchedAvailabilityDescription: { ...typography.caption, color: colors.textSecondary },
  recapCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.lg,
  },
  recapText: { ...typography.caption, color: colors.textSecondary, lineHeight: 19 },
  label: { ...typography.caption, color: colors.textTertiary, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.md },
  textArea: {
    ...typography.body, color: colors.textPrimary, backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, minHeight: 90, textAlignVertical: 'top',
  },
  input: {
    ...typography.body, color: colors.textPrimary, backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  row: { flexDirection: 'row' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md, marginRight: spacing.sm, marginBottom: spacing.sm,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  submitButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.md,
    alignItems: 'center', marginTop: spacing.xl,
  },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
