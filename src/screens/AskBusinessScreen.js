import React, { useState } from 'react';
import { SEARCH_RADIUS_OPTIONS } from '../constants/searchRadius';
import useFormDraft from '../hooks/useFormDraft';
import DraftBanner from '../components/DraftBanner';
import { presentRecoverableError } from '../utils/recoverableError';
import { formatDistance } from '../utils/formatDistance';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { submitBusinessRequest, submitBusinessRequestForGathering, submitBusinessRequestForCommunity, searchActiveBusinessAvailability } from '../services/businessFulfillment';
import { linkExperienceStop } from '../services/plans';
import { createBusinessRequestForMatch } from '../services/dateProposals';
import { requestBusinessPartnership } from '../services/businessPartnerships';
import { checkTextModeration } from '../services/textModeration';
import PlatformDateTimeInput from '../components/PlatformDateTimeInput';
import { toTimeParam, timeLabel } from '../utils/requestTime';
import DietaryPicker from '../components/DietaryPicker';
import RequestedItemsPicker from '../components/RequestedItemsPicker';
import { INTEREST_OPTIONS } from '../constants/gatheringCategories';
import { BUSINESS_ATTRIBUTE_OPTIONS, CUISINE_OPTIONS, OCCASION_OPTIONS, businessAttributeLabel, cuisineLabel, occasionLabel, dietaryLabel, REQUESTED_ITEM_CATEGORIES, requestedItemLabel } from '../constants/businessAttributes';
import { BUDGET_LEVEL_OPTIONS, resolveBudgetMax, initialBudgetSelectionFromMax, EXPERIENCE_LEVEL_OPTIONS } from '../services/celebrateSomething';
import StaggeredReveal from '../components/StaggeredReveal';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { requireUserLocation } from '../services/userLocation';
import { moneyLabel } from '../utils/outcomeDisplay';

import { countLabel } from '../utils/plural';
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

// P0 #2 from the Aug 28 2026 Full Coherence Audit (CLAUDE.md's own Aug 29
// remediation plan): "Friday" -- or any other specific date -- had
// nowhere to go in this flow, since the four presets above are the only
// options and business_requests.date has no free-text fallback anywhere.
// A real 5th chip opens the same DateTimePicker CreateGatheringScreen.js
// already uses elsewhere in this codebase -- mode="date" only, since
// business_requests.date is a plain calendar date with no time-of-day
// component (see toDateParam()'s own comment).
export const PICK_DATE_KEY = 'pick_date';

// PRODUCT_AUDIT/INTENT_LAYER_UX_WALKTHROUGH_2026-08-14.md finding 4 -- the
// empty-fallback's own "try widening what you're looking for" copy
// previously had no real control behind it; this is that control, threaded
// straight through to submitBusinessRequest/submitBusinessRequestForGathering's
// already-existing radiusMiles param (no RPC change needed -- both already
// accept it).
const RADIUS_OPTIONS = SEARCH_RADIUS_OPTIONS;

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toDateParam(dateWindow) {
  const now = new Date();
  const todayStart = startOfDay(now);
  // 'tonight'/'now' are both real values create-assistant can return
  // (VALID_DATE_WINDOWS includes both, since the Universal Signal
  // Remediation Pass's P2 item 8 gave "now" its own real, distinct
  // vocabulary value -- CLAUDE.md) but previously had no branch here at
  // all -- fell through to the final `return null`, silently dropping the
  // "same day" signal from a submitted business request. Bug found during
  // Aug 15 2026 stabilization-pass bug hunt. Both still collapse to
  // today's date here, unlike intentResolverScoring.js's own
  // matchesDateWindow() (which gives "now" a real, narrower window) --
  // business_requests.date is a plain calendar date with no time-of-day
  // component, so there's no honest way to narrow further than "today"
  // against it.
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

// P0 #2 fix: a real picked date always wins over the preset math above --
// dateWindow only ever equals PICK_DATE_KEY once a real date has actually
// been picked (the chip itself doesn't set dateWindow until onChange
// fires), so pickedDate is never null here in practice, but the fallback
// to toDateParam() keeps this safe regardless.
function resolveDateParam(dateWindow, pickedDate) {
  if (dateWindow === PICK_DATE_KEY && pickedDate) return pickedDate.toISOString().slice(0, 10);
  return toDateParam(dateWindow);
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
// Item 72: the targeted ask reached from a business's booking CTA says what the person tapped (the flow is the same request).
function bookingAskHeading(mode, targetPartner) {
  if (mode === 'reservation_required') return `Book with ${targetPartner.name}`;
  if (mode === 'reservation_recommended') return `Reserve at ${targetPartner.name}`;
  if (mode === 'request_required') return `Request from ${targetPartner.name}`;
  return `Ask ${targetPartner.name}`;
}

export default function AskBusinessScreen({ navigation, route }) {
  const { colors, shadow, isDark } = useTheme();
  const styles = getStyles(colors, shadow);

  // "Ask this specific business": the SAME form and request model as asking nearby businesses; only the recipient differs
  // (one chosen business instead of the ranked nearby set). { id, name }, plus partnershipTarget when it started from a gathering.
  const targetPartner = route.params?.targetPartner ?? null;
  // Item 72: opened from a business's Reserve / Book / Request CTA. Same request, worded for what the person tapped.
  const [noteToBusiness, setNoteToBusiness] = useState('');
  // Optional preferred start time (deterministic picker, never inferred). null = any time.
  const [startTime, setStartTime] = useState(null);
  const [showTimePicker, setShowTimePicker] = useState(false);
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
  const experienceStopId = route.params?.experienceStopId ?? null;
  // "ok do it" (CLAUDE.md): the Occasion wizard's "Skip -- post manually"
  // escape hatch already collected a real "Involve" selection before
  // landing here -- forwarded as-is to the resulting request's own
  // "Invite Someone" panel, same shape submitSelectedBusinessRequests()
  // already uses for the main submit path.
  const suggestedInviteeIds = route.params?.suggestedInviteeIds ?? null;
  const suggestedInviteeLabel = route.params?.suggestedInviteeLabel ?? null;

  const [text, setText] = useState(route.params?.prefillText ?? '');
  const [category, setCategory] = useState(route.params?.prefillCategory ?? null);
  const [partySize, setPartySize] = useState(route.params?.prefillPartySize ? String(route.params.prefillPartySize) : '');
  // Item 94 ("Add budget without making it feel transactional", CLAUDE.md):
  // replaces the old required free-number "Budget max" field with a
  // lightweight $/$$/$$$/No preference pick (defaults to "No preference"
  // -- never blocks submission, unlike the field it replaces) plus an
  // optional exact "Set a maximum per person" override. Shares the exact
  // same tiers/helpers CelebrateSomethingScreen's own group-plan budget
  // step uses (celebrateSomething.js) -- one budget vocabulary, not two.
  const initialBudgetSelection = initialBudgetSelectionFromMax(route.params?.prefillBudgetMax ?? null);
  const [budgetRangeKey, setBudgetRangeKey] = useState(initialBudgetSelection.key);
  const [budgetMaxOverride, setBudgetMaxOverride] = useState(initialBudgetSelection.override);
  const [showBudgetMaxOverride, setShowBudgetMaxOverride] = useState(!!initialBudgetSelection.override);
  // 'tonight' is a real value create-assistant can return, but this
  // screen's own chip set only has today/tomorrow/weekend/flexible --
  // previously an incoming 'tonight' was kept as-is, so no chip ever
  // rendered as selected and toDateParam() (before its own fix above)
  // silently submitted no date at all. Normalized to 'today' here, same
  // as toDateParam() itself now treats them as equivalent.
  const rawPrefillDateWindow = route.params?.prefillDateWindow;
  const normalizedPrefillDateWindow = rawPrefillDateWindow === 'tonight' || rawPrefillDateWindow === 'now' ? 'today' : rawPrefillDateWindow;
  const [dateWindow, setDateWindow] = useState(normalizedPrefillDateWindow && normalizedPrefillDateWindow !== 'flexible' ? normalizedPrefillDateWindow : 'flexible');
  // P0 #2 fix: a genuinely picked date, independent of the preset chips --
  // pickedDate only matters while dateWindow === PICK_DATE_KEY; switching
  // back to any preset chip abandons it rather than leaving it silently
  // attached to a submit that no longer reflects it. Re-hydrated from
  // Finding 4's own "Try a Wider Radius" retry (BusinessRequestDetailScreen
  // pushes a fresh AskBusiness with prefillDateWindow carried forward) --
  // without this, a retry after a real picked date would silently lose it
  // and fall back to "flexible".
  const [pickedDate, setPickedDate] = useState(
    normalizedPrefillDateWindow === PICK_DATE_KEY && route.params?.prefillPickedDateISO
      ? new Date(route.params.prefillPickedDateISO)
      : null
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [radiusMiles, setRadiusMiles] = useState(RADIUS_OPTIONS.includes(route.params?.prefillRadiusMiles) ? route.params.prefillRadiusMiles : 15);
  // Phase 3 item 1 (CLAUDE.md): the real intent_submissions row behind
  // this ask, when Home's own intent flow is what led here -- carried
  // through to create_business_request so the funnel can trace a
  // group-plan-originated request back to its real originating
  // individual ask. Absent when this screen is reached any other way
  // (a gathering's own "Ask Local Businesses" link, a direct nav) --
  // stays honestly null there, never fabricated.
  const submissionId = route.params?.prefillSubmissionId ?? null;
  const [submitting, setSubmitting] = useState(false);
  // Taxonomy audit Phase 2 (CLAUDE.md, Aug 25 2026): optional, solo mode
  // only -- matching where party size/budget are already solo-only inputs
  // on this screen, same isSoloMode gate.
  const [attributesInput, setAttributesInput] = useState([]);
  // Opt-in interest sharing (design 2026-09-18): OFF by default, per request only, never remembered.
  const [cuisineInput, setCuisineInput] = useState(null);
  const [dietaryInput, setDietaryInput] = useState([]);
  const [itemsInput, setItemsInput] = useState([]);
  // "Intelligent demand inbox" Phase 1 (CLAUDE.md, Sep 3 2026): a real
  // WHY signal, genuinely optional in every mode -- unlike attributes/
  // cuisine (solo-only, since party size/budget are already solo-only
  // here), a gathering or a confirmed date can honestly have an occasion
  // too ("birthday dinner for the gathering"), so this isn't gated on
  // isSoloMode. Never inferred *here* -- create-assistant's own extraction
  // is the one place a best-effort guess happens. Intent engine vision,
  // first increment (2026-09-06): that guess now genuinely prefills this
  // field (route.params?.prefillOccasion, from HomeScreen's own intent-box
  // flow) -- same "AI suggests, never silently commits" pattern every
  // other prefilled field on this screen (category/partySize/budgetMax/
  // dateWindow) already follows: fully visible as a normal selected chip,
  // fully editable/deselectable, the user still reviews before submitting.
  const [occasionInput, setOccasionInput] = useState(route.params?.prefillOccasion ?? null);
  const isSoloMode = !gatheringId && !matchId && !communityId;
  const showItems = isSoloMode && REQUESTED_ITEM_CATEGORIES.includes(category);
  // Item 95 (CLAUDE.md, "Ask 'How important is the occasion?'"): solo mode
  // only, same gating as attributes/cuisine above -- a real, explicit,
  // never-inferred 'simple'/'special'/'go_all_out' answer that adjusts
  // both resolveIntent()'s own priceLevel scoring (on the "Find options
  // nearby" search below) and the context a business sees when deciding
  // how to respond. Defaults to 'special', the sensible middle ground,
  // same posture as CelebrateSomethingScreen's own wizard.
  const [experienceLevel, setExperienceLevel] = useState(route.params?.prefillExperienceLevel ?? 'special');
  // Item 96 (CLAUDE.md, "Add surprise mode"): purely inherited context --
  // this screen has no "who is this for" step of its own to decide a
  // surprise from scratch, so it's carried forward read-only from the
  // Occasion wizard's own "Skip -- post manually" escape hatch, never a
  // new toggle here.
  const surpriseMode = !!route.params?.prefillSurpriseMode;

  // Item 82: an unfinished ask survives a failed send, leaving the screen and an app restart. Only a plain solo or
  // targeted ask (gathering/match/community asks take their facts from that object, and an ask prefilled from Home's
  // intent box already has its own starting point, so neither is offered a stale draft).
  const askDraft = useFormDraft(
    `business-request:${targetPartner?.id ?? 'nearby'}`,
    {
      text, category, partySize, budgetRangeKey, budgetMaxOverride, dateWindow, pickedDate: pickedDate instanceof Date && !isNaN(pickedDate) ? pickedDate.toISOString() : null,
      startTime: startTime instanceof Date && !isNaN(startTime) ? startTime.toISOString() : null,
      radiusMiles, attributesInput, cuisineInput, dietaryInput, itemsInput, occasionInput, experienceLevel, noteToBusiness,
    },
    {
      enabled: isSoloMode && !route.params?.prefillText && !route.params?.prefillCategory && !route.params?.prefillOccasion,
      isEmpty: (d) => !String(d.text ?? '').trim() && !String(d.noteToBusiness ?? '').trim(),
    }
  );
  function applyAskDraft(d) {
    setText(d.text ?? ''); setCategory(d.category ?? null); setPartySize(d.partySize ?? '');
    setBudgetRangeKey(d.budgetRangeKey ?? initialBudgetSelection.key); setBudgetMaxOverride(d.budgetMaxOverride ?? null);
    setShowBudgetMaxOverride(!!d.budgetMaxOverride);
    const picked = d.pickedDate ? new Date(d.pickedDate) : null;
    if (d.dateWindow === PICK_DATE_KEY) {
      if (picked && picked.getTime() > Date.now()) { setPickedDate(picked); setDateWindow(PICK_DATE_KEY); }
    } else setDateWindow(d.dateWindow ?? 'flexible');
    setStartTime(d.startTime ? new Date(d.startTime) : null);
    setRadiusMiles(RADIUS_OPTIONS.includes(d.radiusMiles) ? d.radiusMiles : 15);
    setAttributesInput(Array.isArray(d.attributesInput) ? d.attributesInput : []); setCuisineInput(d.cuisineInput ?? null);
    setDietaryInput(Array.isArray(d.dietaryInput) ? d.dietaryInput : []); setItemsInput(Array.isArray(d.itemsInput) ? d.itemsInput : []);
    setOccasionInput(d.occasionInput ?? null); setExperienceLevel(d.experienceLevel ?? 'special'); setNoteToBusiness(d.noteToBusiness ?? '');
  }

  // Item 53 ("The business relationship should attach to the Plan",
  // CLAUDE.md): "Allen + Claude + Dinner + Friday 7PM" should let Nearby
  // find real restaurant options right away, not only after a business
  // notices the ask and responds on its own time. Reuses the exact
  // mechanism already proven for the dating-plan case (DateProposalScreen's
  // handleFindNearby/handleChooseNearby, external UX critique reply item 4)
  // and the exact preferredAvailabilityId binding submitBusinessRequest()
  // already supports (Intent Layer UX walkthrough finding 5) -- no new RPC,
  // no new schema. Solo mode only: a gathering/community already sources
  // location server-side (no device location to search from here), and a
  // match's own pre-accept search already lives on DateProposalScreen
  // itself. Suppressed once matchedAvailability is already set -- that's
  // already a specific bound posting from somewhere else, so a second,
  // competing search step here would be redundant.
  const [searchingNearby, setSearchingNearby] = useState(false);
  const [nearbyResults, setNearbyResults] = useState(null);
  const [pickedAvailability, setPickedAvailability] = useState(null);

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
  // Item 94 ("Add budget without making it feel transactional", CLAUDE.md):
  // budget is a deliberate, disclosed exception to the rule above now --
  // it always has a real, deterministic value selected too (defaults to
  // "No preference", the same reasoning the When? chip row already
  // established), so a forced "must type a number" check would contradict
  // the whole point of this item -- keeping the initial interaction easy.
  function findMissingField() {
    if (!text.trim()) return { title: 'Tell us what you want', body: 'A few words about what you’re looking for.' };
    if (!category) return { title: 'Pick a category', body: 'Helps us route this to the right kind of business.' };
    if (!gatheringId && !matchId && !partySize.trim()) return { title: 'How many people?', body: 'A real party size helps a business quote the right offer.' };
    return null;
  }

  // Read-only, contacts no business -- same "browsing is free, asking is
  // the real action" precedent DateProposalScreen's own handleFindNearby
  // already established. category may genuinely be null (a plain "show me
  // what's around" browse); partySize is passed through so capacity is
  // honestly filtered, matching how submit itself uses it.
  async function handleFindNearby() {
    setSearchingNearby(true);
    setNearbyResults(null);
    try {
      const location = await requireUserLocation('Location access is needed to find nearby options.');
      const partySizeNum = partySize.trim() ? parseInt(partySize.trim(), 10) : null;
      const results = await searchActiveBusinessAvailability({
        category,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        radiusMiles,
        partySize: Number.isInteger(partySizeNum) && partySizeNum > 0 ? partySizeNum : null,
      });
      setNearbyResults(results);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'find businesses for you', error: e, draftKept: true, onRetry: () => handleFindNearby() });
    }
    setSearchingNearby(false);
  }

  // Composes a real description from the chosen posting the same way
  // DateProposalScreen's handleChooseNearby does -- but only when the
  // caller hasn't already typed their own "what do you want?" text, so a
  // browse-then-pick never silently clobbers something the user wrote
  // first.
  function handleChooseNearby(result) {
    setPickedAvailability(result);
    if (!text.trim()) {
      setText(`${category ?? 'Something'} at ${result.partner_name}${result.title ? ` — ${result.title}` : ''}`);
    }
    setNearbyResults(null);
  }

  async function handleSubmit() {
    const missing = findMissingField();
    if (missing) {
      Alert.alert(missing.title, missing.body);
      return;
    }
    if (targetPartner && noteToBusiness.trim()) {
      const check = await checkTextModeration(noteToBusiness);
      if (!check.safe) {
        Alert.alert('Note not allowed', 'Please revise your note and try again.');
        return;
      }
    }
    setSubmitting(true);
    try {
      const safeBudgetMax = resolveBudgetMax(budgetRangeKey, budgetMaxOverride);

      const partySizeNum = partySize.trim() ? parseInt(partySize.trim(), 10) : null;
      const safePartySize = Number.isInteger(partySizeNum) && partySizeNum > 0 ? partySizeNum : null;

      // Only one real raw_text column exists server-side -- the optional
      const finalText = text.trim();
      // P0 #2 fix: resolveDateParam() honors a real picked date over the
      // preset math when PICK_DATE_KEY is selected -- computed once here
      // so every branch below and the navigation params after submit all
      // reflect the exact same resolved date.
      const resolvedDate = resolveDateParam(dateWindow, pickedDate);

      let result;
      if (gatheringId) {
        result = await submitBusinessRequestForGathering({
          gatheringId,
          text: finalText,
          category,
          budgetMax: safeBudgetMax,
          radiusMiles,
          occasion: occasionInput,
          dietary: category === 'Foodie' && dietaryInput.length > 0 ? dietaryInput : null,
          targetPartnerId: targetPartner?.id ?? null,
          note: noteToBusiness.trim() || null,
        });
        // From a gathering's "request a specific business": also send the co-host partnership request. It reuses the request just
        // made (no second offer). Best-effort -- the business already has the request either way.
        if (targetPartner && route.params?.partnershipTarget) {
          try {
            await requestBusinessPartnership({ ...route.params.partnershipTarget, partnerId: targetPartner.id, message: noteToBusiness.trim() || null });
          } catch (_e) { /* e.g. already pending */ }
        }
      } else if (matchId) {
        result = await createBusinessRequestForMatch({
          matchId,
          text: finalText,
          category,
          budgetMax: safeBudgetMax,
          date: resolvedDate,
          radiusMiles,
          occasion: occasionInput,
          dietary: category === 'Foodie' && dietaryInput.length > 0 ? dietaryInput : null,
        });
      } else if (communityId) {
        result = await submitBusinessRequestForCommunity({
          communityId,
          text: finalText,
          category,
          partySize: safePartySize,
          budgetMax: safeBudgetMax,
          date: resolvedDate,
          radiusMiles,
          dietary: category === 'Foodie' && dietaryInput.length > 0 ? dietaryInput : null,
        });
      } else {
        result = await submitBusinessRequest({
          text: finalText,
          category,
          partySize: safePartySize,
          budgetMax: safeBudgetMax,
          date: resolvedDate,
          timeWindowStart: toTimeParam(startTime),
          radiusMiles,
          submissionId,
          preferredAvailabilityId: matchedAvailability?.availabilityId ?? pickedAvailability?.id ?? null,
          attributes: attributesInput.length > 0 ? attributesInput : null,
          cuisine: category === 'Foodie' ? cuisineInput : null,
          dietary: category === 'Foodie' && dietaryInput.length > 0 ? dietaryInput : null,
          items: showItems && itemsInput.length > 0 ? itemsInput : null,
          occasion: occasionInput,
          experienceLevel,
          surpriseMode,
          targetPartnerId: targetPartner?.id ?? null,
          note: noteToBusiness.trim() || null,
        });
      }
      // Experience stop: bind this request to the stop it was started from so the stop (and the experience Plan's
      // status) follow it. Best-effort -- the request itself already exists and must never be blocked by this.
      if (experienceStopId && result?.requestId) {
        try { await linkExperienceStop(experienceStopId, result.requestId); } catch (_e) { /* the stop just stays unlinked */ }
      }
      // Finding 4: carry the original ask's real prefill fields forward so
      // the "Try a Wider Radius" button on BusinessRequestDetail can push a
      // fresh AskBusiness pre-filled from them, rather than a dead end.
      askDraft.clear();
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
        prefillPickedDateISO: dateWindow === PICK_DATE_KEY && pickedDate ? pickedDate.toISOString() : null,
        prefillRadiusMiles: radiusMiles,
        prefillOccasion: occasionInput,
        prefillExperienceLevel: isSoloMode ? experienceLevel : null,
        prefillSurpriseMode: surpriseMode || undefined,
        prefillSubmissionId: submissionId,
        gatheringId,
        gatheringTitle,
        gatheringPartySize,
        matchId,
        matchName,
        communityId,
        communityName,
        suggestedInviteeIds,
        suggestedInviteeLabel,
      });
    } catch (e) {
      presentRecoverableError(Alert, { what: 'send your request', error: e, draftKept: true, onRetry: () => handleSubmit() });
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
      // P0 #2 fix: a genuinely picked date recaps as its own real,
      // formatted date -- never falls through to "undefined" now that
      // dateWindow can hold PICK_DATE_KEY, which isn't in DATE_OPTIONS.
      const dateLabel = dateWindow === PICK_DATE_KEY && pickedDate
        ? pickedDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
        : DATE_OPTIONS.find((d) => d.key === dateWindow)?.label;
      if (dateLabel) recapParts.push(dateLabel);
    }
    if (!gatheringId && !matchId && partySize.trim()) recapParts.push(countLabel(partySize.trim(), 'person', 'people') ?? `${partySize.trim()} people`);
    const recapBudgetMax = resolveBudgetMax(budgetRangeKey, budgetMaxOverride);
    if (recapBudgetMax) recapParts.push(`up to ${moneyLabel(recapBudgetMax)}`);
    if (occasionInput) recapParts.push(occasionLabel(occasionInput));
    if (isSoloMode && experienceLevel && experienceLevel !== 'special') {
      recapParts.push(EXPERIENCE_LEVEL_OPTIONS.find((o) => o.key === experienceLevel)?.label ?? null);
    }
    if (surpriseMode) recapParts.push('🎁 kept as a surprise');
    if (isSoloMode && category === 'Foodie' && cuisineInput) recapParts.push(cuisineLabel(cuisineInput));
    if (showItems && itemsInput.length > 0) recapParts.push(itemsInput.map(requestedItemLabel).join(' + '));
    if (category === 'Foodie' && dietaryInput.length > 0) recapParts.push(dietaryInput.map(dietaryLabel).join(', '));
    if (isSoloMode && attributesInput.length > 0) recapParts.push(attributesInput.map(businessAttributeLabel).join(', '));
    if (isSoloMode && pickedAvailability) recapParts.push(`at ${pickedAvailability.partner_name}`);
    recapParts.push(`within ${radiusMiles} mi`);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          {askDraft.draft && (
            <DraftBanner
              what="request"
              savedAt={askDraft.draft.savedAt}
              onContinue={() => askDraft.restore(applyAskDraft)}
              onDiscard={askDraft.discard}
            />
          )}
          <Text style={styles.heading}>
            {targetPartner
              ? bookingAskHeading(route.params?.bookingMode, targetPartner)
              : matchedAvailability && route.params?.bookingMode
              ? bookingAskHeading(route.params.bookingMode, { name: matchedAvailability.partnerName })
              : gatheringId
              ? `Find ${gatheringTitle ?? 'your gathering'} somewhere to go`
              : matchId
                ? `Find something for you and ${matchName ?? 'your match'}`
                : communityId
                  ? `Ask nearby businesses for ${communityName ?? 'your community'}`
                  : 'Can Nearby make this happen?'}
          </Text>
          <Text style={styles.subtitle}>
            {targetPartner
              ? `Only ${targetPartner.name} will see this — they can answer with a real offer.`
              : gatheringId
              ? `Asking on behalf of your ${gatheringPartySize ?? ''}-person gathering — real nearby businesses can respond with a real offer for the group.`
              : matchId
                ? `You both agreed on a plan — real nearby businesses can respond with a real offer for the two of you.`
                : communityId
                  ? `Describe what you need — every eligible business near your community's Area can respond with a real, custom offer.`
                  : matchedAvailability
                    ? `${matchedAvailability.partnerName} already has this available — review below and send your ask.`
                    : 'Tell us what you want, then see real nearby availability right away — or just ask, and businesses can respond with a real offer.'}
          </Text>

          {matchedAvailability && (
            <View style={styles.matchedAvailabilityBanner}>
              <Text style={styles.matchedAvailabilityTitle}>{matchedAvailability.partnerName}</Text>
              <Text style={styles.matchedAvailabilityText}>
                {matchedAvailability.title}
                {matchedAvailability.price != null ? ` · ${moneyLabel(matchedAvailability.price)}` : ''}
              </Text>
              {matchedAvailability.description ? (
                <Text style={styles.matchedAvailabilityDescription}>{matchedAvailability.description}</Text>
              ) : null}
              {((matchedAvailability.attributes ?? []).length > 0 || matchedAvailability.cuisine) && (
                <Text style={styles.matchedAvailabilityDescription}>
                  {[
                    matchedAvailability.cuisine ? cuisineLabel(matchedAvailability.cuisine) : null,
                    ...((matchedAvailability.attributes ?? []).map(businessAttributeLabel)),
                  ].filter(Boolean).join(' · ')}
                </Text>
              )}
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
                onPress={() => {
                  setCategory(category === c ? null : c);
                  setNearbyResults(null);
                  setPickedAvailability(null);
                }}
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
                    onPress={() => {
                      // P0 #2 fix: switching to any preset chip abandons a
                      // previously picked date -- never leaves it silently
                      // attached to a submit that no longer reflects it.
                      setPickedDate(null);
                      setDateWindow(d.key);
                    }}
                    accessibilityLabel={d.label}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.chipText, dateWindow === d.key && styles.chipTextSelected]}>{d.label}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[styles.chip, dateWindow === PICK_DATE_KEY && styles.chipSelected]}
                  onPress={() => setShowDatePicker(true)}
                  accessibilityLabel="Pick a specific date"
                  accessibilityRole="button"
                >
                  <Text style={[styles.chipText, dateWindow === PICK_DATE_KEY && styles.chipTextSelected]}>
                    📅 {dateWindow === PICK_DATE_KEY && pickedDate
                      ? pickedDate.toLocaleDateString([], { month: 'short', day: 'numeric' })
                      : 'Pick a date'}
                  </Text>
                </TouchableOpacity>
              </View>
              {showDatePicker && (
                <DateTimePicker
                  value={pickedDate ?? new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  themeVariant={isDark ? 'dark' : 'light'}
                  minimumDate={new Date()}
                  onChange={(event, selectedDate) => {
                    setShowDatePicker(Platform.OS === 'ios');
                    if (selectedDate) {
                      setPickedDate(selectedDate);
                      setDateWindow(PICK_DATE_KEY);
                    }
                  }}
                />
              )}
            </>
          )}

          {isSoloMode && (
            <>
              <Text style={styles.label}>Time (optional)</Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, !startTime && styles.chipSelected]}
                  onPress={() => { setStartTime(null); setShowTimePicker(false); }}
                  accessibilityRole="button"
                  accessibilityLabel="Any time"
                >
                  <Text style={[styles.chipText, !startTime && styles.chipTextSelected]}>Any time</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, !!startTime && styles.chipSelected]}
                  onPress={() => { if (!startTime) { const d = new Date(); d.setHours(18, 0, 0, 0); setStartTime(d); } setShowTimePicker(true); }}
                  accessibilityRole="button"
                  accessibilityLabel="Pick a time"
                >
                  <Text style={[styles.chipText, !!startTime && styles.chipTextSelected]}>🕐 {startTime ? timeLabel(startTime) : 'Pick a time'}</Text>
                </TouchableOpacity>
              </View>
              {showTimePicker && (
                <PlatformDateTimeInput
                  value={startTime ?? new Date()}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  themeVariant={isDark ? 'dark' : 'light'}
                  onChange={(event, selected) => {
                    setShowTimePicker(Platform.OS === 'ios');
                    if (selected && event?.type !== 'dismissed') setStartTime(selected);
                  }}
                />
              )}
            </>
          )}

          {!gatheringId && !matchId && (
            <>
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
            </>
          )}

          {/* Item 94 ("Add budget without making it feel transactional",
              CLAUDE.md): a lightweight quick-pick instead of the old
              required "Budget max" number field -- defaults to "No
              preference," which keeps this screen submittable with zero
              budget friction unless the user actually wants precision. */}
          <Text style={styles.label}>What's your budget?</Text>
          <View style={styles.chipRow}>
            {BUDGET_LEVEL_OPTIONS.map((o) => {
              const selected = budgetRangeKey === o.key;
              return (
                <TouchableOpacity
                  key={o.key}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setBudgetRangeKey(o.key)}
                  accessibilityRole="button"
                  accessibilityLabel={o.label}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {showBudgetMaxOverride ? (
            <TextInput
              style={styles.input}
              placeholder="Maximum per person (optional)"
              placeholderTextColor={colors.textTertiary}
              value={budgetMaxOverride}
              onChangeText={setBudgetMaxOverride}
              keyboardType="number-pad"
              accessibilityLabel="Maximum budget per person, optional"
            />
          ) : (
            <TouchableOpacity
              onPress={() => setShowBudgetMaxOverride(true)}
              accessibilityRole="button"
              accessibilityLabel="Set a maximum per person"
            >
              <Text style={styles.inlineLinkText}>+ Set a maximum per person</Text>
            </TouchableOpacity>
          )}

          {targetPartner && (
            <>
              <Text style={styles.label}>Anything else? (optional)</Text>
              <TextInput
                style={styles.textArea}
                placeholder={`A note for ${targetPartner.name}`}
                placeholderTextColor={colors.textTertiary}
                value={noteToBusiness}
                onChangeText={(t) => setNoteToBusiness(t.slice(0, 300))}
                multiline
                accessibilityLabel={`Optional note for ${targetPartner.name}. Only they will see it.`}
              />
              <Text style={styles.subtitle}>Only {targetPartner.name} sees this note.</Text>
            </>
          )}

          {isSoloMode && !matchedAvailability && !targetPartner && (
            <View style={{ marginTop: spacing.md }}>
              <Text style={styles.label}>See what's actually available first?</Text>
              <TouchableOpacity
                style={styles.findNearbyButton}
                onPress={handleFindNearby}
                disabled={searchingNearby}
                accessibilityLabel="Find options nearby"
                accessibilityRole="button"
              >
                {searchingNearby ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={styles.findNearbyButtonText}>🔎 Find options nearby</Text>
                )}
              </TouchableOpacity>

              {searchingNearby && <Text style={styles.nearbyEmptyText}>Finding availability…</Text>}

              {nearbyResults && nearbyResults.length === 0 && (
                <Text style={styles.nearbyEmptyText}>
                  Nothing real available right now — you can still send your ask below and hear back from a business directly.
                </Text>
              )}

              {nearbyResults && nearbyResults.length > 0 && (
                <View style={styles.nearbyResultsList}>
                  {/* Item 124 ("Use animation when something becomes available"): the real
                      "we found options" moment for this search -- each result settles into
                      place with a small per-index cascade instead of appearing all at once. */}
                  {nearbyResults.map((result, resultIndex) => (
                    <StaggeredReveal key={result.id} index={resultIndex}>
                    <TouchableOpacity
                      style={[styles.nearbyResultCard, pickedAvailability?.id === result.id && styles.nearbyResultCardSelected]}
                      onPress={() => handleChooseNearby(result)}
                      accessibilityLabel={`Choose ${result.partner_name}`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.nearbyResultTitle}>{result.partner_name}</Text>
                      {!!result.title && <Text style={styles.nearbyResultSubtitle}>{result.title}</Text>}
                      <Text style={styles.nearbyResultMeta}>
                        {[
                          result.offer_type,
                          result.price != null ? `${moneyLabel(result.price)}` : null,
                          formatDistance(result.distance_miles),
                          result.remaining_capacity != null ? `${countLabel(result.remaining_capacity, 'spot')} left` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </TouchableOpacity>
                    </StaggeredReveal>
                  ))}
                </View>
              )}

              {pickedAvailability && (
                <View style={styles.matchedAvailabilityBanner}>
                  <Text style={styles.matchedAvailabilityTitle}>✓ {pickedAvailability.partner_name}</Text>
                  <Text style={styles.matchedAvailabilityText}>
                    {pickedAvailability.title}
                    {pickedAvailability.price != null ? ` · ${moneyLabel(pickedAvailability.price)}` : ''}
                  </Text>
                </View>
              )}
            </View>
          )}

          <Text style={styles.label}>What's this for? (optional)</Text>
          <View style={styles.chipRow}>
            {OCCASION_OPTIONS.map((o) => (
              <TouchableOpacity
                key={o.key}
                style={[styles.chip, occasionInput === o.key && styles.chipSelected]}
                onPress={() => setOccasionInput(occasionInput === o.key ? null : o.key)}
                accessibilityLabel={o.label}
                accessibilityRole="button"
                accessibilityState={{ selected: occasionInput === o.key }}
              >
                <Text style={[styles.chipText, occasionInput === o.key && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {isSoloMode && (
            <>
              {/* Item 95 (CLAUDE.md, "Ask 'How important is the
                  occasion?'"): solo mode only -- a real signal that
                  adjusts what "Find options nearby" above surfaces and
                  what the business sees, never forced ("special" is
                  already a real, deterministic default). */}
              <Text style={styles.label}>What kind of experience are you looking for?</Text>
              <View style={styles.chipRow}>
                {EXPERIENCE_LEVEL_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.key}
                    style={[styles.chip, experienceLevel === o.key && styles.chipSelected]}
                    onPress={() => setExperienceLevel(o.key)}
                    accessibilityLabel={o.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected: experienceLevel === o.key }}
                  >
                    <Text style={[styles.chipText, experienceLevel === o.key && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {isSoloMode && (
            <>
              <Text style={styles.label}>Preferences (optional)</Text>
              <View style={styles.chipRow}>
                {BUSINESS_ATTRIBUTE_OPTIONS.map((a) => {
                  const selected = attributesInput.includes(a.key);
                  return (
                    <TouchableOpacity
                      key={a.key}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => setAttributesInput((prev) => (selected ? prev.filter((k) => k !== a.key) : [...prev, a.key]))}
                      accessibilityLabel={a.label}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{a.icon} {a.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {category === 'Foodie' && (
                <>
                  <Text style={styles.label}>Cuisine (optional)</Text>
                  <View style={styles.chipRow}>
                    {CUISINE_OPTIONS.map((c) => (
                      <TouchableOpacity
                        key={c.key}
                        style={[styles.chip, cuisineInput === c.key && styles.chipSelected]}
                        onPress={() => setCuisineInput(cuisineInput === c.key ? null : c.key)}
                        accessibilityLabel={c.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected: cuisineInput === c.key }}
                      >
                        <Text style={[styles.chipText, cuisineInput === c.key && styles.chipTextSelected]}>{c.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
            </>
          )}

          {showItems && <RequestedItemsPicker selected={itemsInput} onChange={setItemsInput} />}
          {category === 'Foodie' && <DietaryPicker selected={dietaryInput} onChange={setDietaryInput} />}

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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md, marginRight: spacing.sm, marginBottom: spacing.sm,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  inlineLinkText: { color: colors.primary, fontWeight: '600', fontSize: 13, marginTop: spacing.xs },
  findNearbyButton: {
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.primary,
    paddingVertical: spacing.sm, alignItems: 'center', backgroundColor: colors.primaryMuted,
    marginBottom: spacing.sm,
  },
  findNearbyButtonText: { ...typography.body, color: colors.primary, fontWeight: '700' },
  nearbyEmptyText: { ...typography.caption, color: colors.textTertiary, fontStyle: 'italic' },
  nearbyResultsList: { gap: spacing.xs },
  nearbyResultCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm,
  },
  nearbyResultCardSelected: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: colors.primaryMuted },
  nearbyResultTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  nearbyResultSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  nearbyResultMeta: { ...typography.small, color: colors.textTertiary, marginTop: 2 },
  submitButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.md,
    alignItems: 'center', marginTop: spacing.xl,
  },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
