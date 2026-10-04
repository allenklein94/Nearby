// Rule 14 (owner, 2026-10-04, LOCKED; CLAUDE.md "Rule 14: a dedicated screen needs a reason to exist"): the ONE registry of
// every navigable screen and why it deserves to be a screen of its own. A screen must do at least one of:
//   A Decision (should I join this?)          B Commitment (accept / reserve / attend)
//   C Management (edit / invite / cancel)     D Communication (message / chat)
//   E Transaction (accept offer / payment / redemption)   F Deep information (a full business profile)
//
// The canonical list of screens is the navigators themselves (navigation/RootNavigator.js and
// navigation/BusinessWebNavigator.js: every <X.Screen name="..." component={...}>). screenRegistry.test.js reads them and
// fails if a registered route has no entry here, if an entry names a route nobody registers, or if a screen file under
// src/screens is neither registered nor listed in EMBEDDED_SCREENS. So adding a screen means writing down its job first.
// Keyed by ROUTE NAME (what navigation uses); a route shared by both navigators has one entry.
//
// Top-level surfaces (the tabs and the main lists people browse) are surfaces, not detail screens, and are marked
// `surface: true`; they need a reason but no job letter. `borderline: true` marks a screen kept on purpose pending evidence.

export const RULE14_JOBS = {
  A: 'Decision', B: 'Commitment', C: 'Management', D: 'Communication', E: 'Transaction', F: 'Deep information',
};

export const SCREEN_REGISTRY = {
  // ---- top-level surfaces ----
  Home: { surface: true, reason: 'Tab: what should I do right now (one capped attention list).' },
  Discover: { surface: true, jobs: ['A', 'E'], reason: 'Tab: what exists around me; also where perks are selected and redeemed in place.' },
  Create: { surface: true, reason: 'Tab: start a gathering, a community or a plan for someone.' },
  Activity: { surface: true, jobs: ['B'], reason: 'Tab: invitations, requests and replies that need an answer.' },
  Plans: { surface: true, jobs: ['C'], reason: 'Your upcoming, hosting and past plans; the way into managing each one.' },
  Gatherings: { surface: true, jobs: ['A'], reason: 'The nearby gatherings feed (filters change it in place).' },

  // ---- signing in and onboarding (one multi-step setup workflow) ----
  Onboarding: { jobs: ['C'], reason: 'Welcome step of setting up an account.' },
  OnboardingQuestions: { jobs: ['C'], reason: 'Setup step: goals, interests and what you are looking for.' },
  OnboardingLocation: { jobs: ['C'], reason: 'Setup step: the one location permission ask.' },
  OnboardingNotifications: { jobs: ['C'], reason: 'Setup step: what Nearby should notify you about.' },
  OnboardingOccasions: { jobs: ['C'], reason: 'Setup step (skippable): occasions to remember.' },
  OnboardingRecommendations: { jobs: ['A'], reason: '"You\'re ready": first gatherings to decide on, each with its action.' },
  Login: { jobs: ['C'], reason: 'Signing in (phone code).' },
  CompleteProfile: { jobs: ['C'], reason: 'Finishing your profile before using the app.' },

  // ---- you ----
  Profile: { jobs: ['C'], reason: 'Edit your profile, photos and prompts.' },
  Settings: { jobs: ['C'], reason: 'Preferences, privacy, notifications and account controls.' },
  DatingPreferences: { jobs: ['C'], reason: 'Edit your dating profile and who you want to see.' },
  QuickFilterCustomize: { jobs: ['C'], reason: 'Choose, set and reorder your quick filters.' },
  BlockedUsers: { jobs: ['C'], reason: 'Review and unblock people you blocked.' },
  EmergencyContacts: { jobs: ['C'], reason: 'Add and remove your emergency contacts.' },
  Occasions: { jobs: ['C'], reason: 'Add, edit and remove the occasions Nearby remembers for you.' },
  MusicMode: { jobs: ['C'], reason: 'Connect Spotify and pick the tracks shown on your profile.' },
  IdVerification: { jobs: ['C'], reason: 'Submit your ID for verification.' },
  InviteFriends: { jobs: ['C'], reason: 'Invite people to Nearby and track the bonus.' },
  Momentum: {
    jobs: ['F'], borderline: true,
    reason: 'Your streak, weekly chart and month-over-month changes. Borderline KEEP (owner, 2026-10-04): revisit with real usage data; it may belong in Profile.',
  },
  Billing: { jobs: ['E'], reason: 'Your subscription and payments.' },
  Paywall: { jobs: ['E'], reason: 'Upgrade to premium.' },
  Legal: { jobs: ['F'], reason: 'Terms and privacy policy.' },

  // ---- people and conversations ----
  Messages: { jobs: ['D'], reason: 'Your conversations with matches.' },
  Chat: { jobs: ['D'], reason: 'One conversation with a match, and the "Do Something Together" tools.' },
  ViewProfile: { jobs: ['A', 'F'], reason: 'Someone\'s full profile, to decide whether to connect.' },
  Friends: { jobs: ['C'], reason: 'Your friends and friend requests to accept or decline.' },
  PreferencePolls: { jobs: ['D'], reason: 'Answer a quick question a match sent you.' },
  DateProposal: { jobs: ['B', 'D'], reason: 'Propose, accept or decline a date with a match.' },

  // ---- tools shared with a match (each opened from that match's chat) ----
  SharedPlaylist: { jobs: ['D', 'C'], reason: 'A playlist you build together with a match.' },
  TripPlanning: { jobs: ['D', 'C'], reason: 'Trip ideas you collect together with a match.' },
  SharedDecisions: { jobs: ['D', 'C'], reason: 'Decisions you note down together with a match.' },
  TimelinePlanner: { jobs: ['D', 'C'], reason: 'Where the relationship is heading, written together.' },
  StressTest: { jobs: ['D', 'C'], reason: 'Hard scenarios you talk through together.' },
  RelationshipConstitution: { jobs: ['D', 'C'], reason: 'Shared ground rules you write together.' },
  MemoryVault: { jobs: ['D', 'C'], reason: 'Memories you save together with a match.' },
  RelationshipLegacy: { jobs: ['C'], reason: 'Leave anonymous relationship wisdom from a match.' },

  // ---- private relationship reflection ----
  RehearsalRoom: { jobs: ['C'], reason: 'Practise a hard conversation privately.' },
  ChemistryDiaryList: { jobs: ['C'], reason: 'Your private chemistry diary entries.' },
  ChemistryDiaryEntry: { jobs: ['C'], reason: 'Write or edit one diary entry.' },
  GoodbyeArchiveList: { jobs: ['C'], reason: 'Your private reflections on ended connections.' },
  GoodbyeArchiveEntry: { jobs: ['C'], reason: 'Write or edit one reflection.' },
  LegacyLibrary: { jobs: ['F'], reason: 'Anonymous reflections from real couples (content, not navigation).' },
  RelationshipEmergencyKit: { jobs: ['F'], reason: 'Advice for hard moments (content, not navigation).' },

  // ---- gatherings ----
  GatheringDetail: { jobs: ['A', 'B', 'C'], reason: 'Decide and join; hosts manage attendees, edit and cancel here.' },
  GatheringHub: { jobs: ['D'], reason: 'Attendees on the day: notices and who you\'ll meet.' },
  GatheringChat: { jobs: ['D'], reason: 'The gathering\'s group chat.' },
  CreateGathering: { jobs: ['C'], reason: 'The multi-step workflow that creates a gathering.' },
  EditGathering: { jobs: ['C'], reason: 'Edit a gathering you host and its settings.' },
  SelectGatheringLocation: { jobs: ['C'], reason: 'Pick the gathering\'s place on a map (a step of creating or editing).' },
  GatheringConfirmation: { jobs: ['C'], reason: 'After publishing: invite connections and share.' },

  // ---- communities ----
  Communities: {
    jobs: ['C'],
    reason: 'Your communities + Create (trimmed 2026-10-04: public communities are found only in Discover -> Communities).',
  },
  CommunityDetail: { jobs: ['A', 'B', 'C'], reason: 'Decide and join; leaders manage the community here.' },
  CommunityChat: { jobs: ['D'], reason: 'The community\'s group chat.' },
  CreateCommunity: { jobs: ['C'], reason: 'Create a community.' },
  EditCommunity: { jobs: ['C'], reason: 'Edit a community you lead.' },

  // ---- plans, occasions and business requests ----
  CelebrateSomething: { jobs: ['C'], reason: 'The plan-for-someone workflow.' },
  MakeAPlan: { jobs: ['B', 'C'], reason: 'Make a plan with friends and invite them.' },
  PlanDetail: { jobs: ['C'], reason: 'One plan: its stops, date, sharing and edits.' },
  PlanChat: { jobs: ['D'], reason: 'A plan\'s group chat.' },
  SharedNight: { jobs: ['F'], reason: 'A night someone shared with you, read-only (the only view a shared person gets).' },
  GroupPlan: { jobs: ['B', 'C', 'E'], reason: 'Respond to a group plan, confirm offers and manage it.' },
  GroupOccasionPlan: { jobs: ['B', 'C'], reason: 'Vote on and respond to an occasion group plan.' },
  AskBusiness: { jobs: ['B'], reason: 'Send a request to nearby businesses (or one business).' },
  RequestBusinessPartner: { jobs: ['B'], reason: 'Pick the business to ask, then continue into the request.' },
  BusinessRequestDetail: { jobs: ['E', 'C'], reason: 'Your request\'s replies: accept an offer, cancel or reopen.' },
  BusinessProfile: { jobs: ['F'], reason: 'A business\'s full profile, hours and how to book.' },
  BusinessConversation: { jobs: ['D'], reason: 'A conversation between a customer and a business.' },

  // ---- business owners ----
  BusinessDashboard: { jobs: ['C', 'E'], reason: 'Opportunities, bookings, availability and profile for an owner.' },
  BusinessWebHome: { jobs: ['C'], reason: 'The business website\'s landing and sign-in entry.' },
  BusinessAIAssistant: { jobs: ['D'], reason: 'An owner\'s conversation with the AI assistant.' },
  BusinessAIAutomation: { jobs: ['C'], reason: 'An owner\'s automation rules and policies.' },
  BusinessPartnerApply: { jobs: ['C'], reason: 'Apply to list a business.' },
  MyBusinessApplication: { jobs: ['C', 'F'], reason: 'Your application\'s status and the resubmit form.' },

  // ---- admin ----
  AdminReports: { jobs: ['C'], reason: 'Admin: review user reports.' },
  AdminVerification: { jobs: ['C'], reason: 'Admin: review ID verifications.' },
  AdminBusinessRequests: { jobs: ['C'], reason: 'Admin: review business applications and map categories.' },
  AdminBusinessTier: { jobs: ['C'], reason: 'Admin: set business tiers.' },
  AdminContentReview: { jobs: ['C'], reason: 'Admin: review held business content.' },
  AdminSponsoredRefunds: { jobs: ['C', 'E'], reason: 'Admin: refund sponsored placements (named approvers only).' },
  MarketValidation: { jobs: ['F'], reason: 'Admin: real market-validation figures.' },
};

// Navigation infrastructure that is registered as a route but is not a screen a person reads (exempt from rule 14).
export const INFRASTRUCTURE_ROUTES = {
  MainTabs: 'The bottom-tab container; the tabs inside it are registered above.',
};

// Outside-entry presentations of an existing surface (owner, 2026-10-04): not screens of their own. Each renders exactly
// its surface's component on top of the current history so a push tap keeps the person's place (item 139). The route ->
// surface map lives in navigation/presentationRoutes.js (navigation reads it too); this states why each one exists.
export { PRESENTATION_ROUTES } from '../navigation/presentationRoutes';
export const PRESENTATION_REASONS = {
  Notices: 'The wave push opens Activity on top of the current screen so Back returns exactly where you were; titled Activity, never a separate Notices screen.',
  FriendDiscovery: 'People -> Friends opened on top of a stack screen (Friends list, gathering published, typed-ask people row, Create invite picker) so Back returns there; the same FriendDiscoveryScreen Discover embeds, never a separate Friends surface.',
};

// Screen components that are never navigated to on their own: they render inside another registered screen.
export const EMBEDDED_SCREENS = {
  MatchesScreen: 'Rendered inside Messages (the conversations list).',
  DiscoveryScreen: 'Discover -> People -> Dating (the dating deck); its standalone Nearby route was removed 2026-10-04.',
};

// The rule 14 audit (owner, 2026-10-04). Removed and folded routes must stay gone; trimmed and borderline ones stay.
export const RULE14_DECISIONS = {
  removed: ['Places', 'FeaturesOverview', 'RelationshipHub', 'MemoryVaultIndex', 'RelationshipTools', 'Timeline', 'Nearby'],
  folded: {
    BrandOffers: 'Discover -> Perks (browse and redeem in place)',
    Rewards: 'one tier line at the top of Discover -> Perks',
  },
  // Notices was registered as its own surface; it is Activity presented on top for push entry (PRESENTATION_ROUTES).
  presentations: { Notices: 'Activity', FriendDiscovery: 'Discover -> People -> Friends' },
  trimmed: { Communities: 'your own communities + Create; public discovery is Discover -> Communities' },
  borderlineKeep: ['Momentum'],
};
