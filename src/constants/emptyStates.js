// Item 80: one empty-state language. An empty section explains itself in two parts -- WHAT is empty (title, plain and
// specific, never "No data") and WHAT TO DO or what will appear (body). Bodies are true statements about how the section
// fills; the tappable next step stays with the screen that owns the destination (Item 56, no dead ends). Add a new empty
// state here first; `emptyStateLanguage.test.js` rejects database voice and unknown ids.
export const EMPTY_STATES = {
  plans_upcoming: { title: 'No upcoming plans', body: 'Find something nearby or start something new.' },
  plans_hosting: { title: "You're not hosting anything", body: 'Start a gathering and people nearby can join.' },
  plans_past: { title: 'No past plans yet', body: "Gatherings you've been to will be kept here." },
  activity: { title: 'Nothing new yet', body: 'Notices, crossed paths and other activity will show up here.' },
  business_opportunities: { title: 'No new opportunities', body: "We'll show requests from nearby customers here." },
  business_stats: { title: 'No activity to show yet', body: 'Views, followers and redemptions appear here once customers start finding your business.' },
  places_category: { title: 'Nothing nearby in this category', body: 'Try another category or widen what you are looking for.' },
  places_search: { title: 'No places match "{query}"', body: 'Try a different word, or clear the search.' },
  // Item 80 sweep: the rest of the bare-fragment empties.
  admin_business_requests: { title: "No pending requests", body: "New business applications will appear here for review." },
  admin_content_review: { title: "Nothing to review", body: "Every recent submission was either published automatically or blocked outright." },
  admin_businesses: { title: "No businesses match", body: "Try a different search." },
  admin_verification: { title: "No pending verifications", body: "New ID submissions will appear here for review." },
  ai_activity: { title: "No automation activity yet", body: "When automation responds to a request, you'll see it here." },
  business_gatherings: { title: "No gatherings hosted yet", body: "Host one and it will show up here." },
  business_communities: { title: "No communities yet", body: "Start a community to bring your regulars together." },
  business_demand: { title: "No demand to show yet", body: "Demand appears here once enough people nearby are looking for what you offer." },
  business_occasion_demand: { title: "No occasion demand yet", body: "It appears here once enough people nearby are planning an occasion you offer." },
  business_postings: { title: "Nothing posted yet", body: "Post when you have room and Nearby will match it to requests." },
  business_packages: { title: "No packages yet", body: "Create an occasion package and Nearby can offer it to matching requests." },
  business_returning: { title: "No returning customers yet", body: "Customers who come back will be counted here." },
  business_insights: { title: "Not enough activity yet", body: "Insights appear once there's enough real activity to be meaningful." },
  business_missed: { title: "Nothing missed", body: "No opportunities went unanswered in the last 30 days." },
  business_declined: { title: "Nothing declined", body: "You haven't declined any opportunities in the last 30 days." },
  business_cancelled: { title: "No cancellations", body: "No reservations were cancelled in the last 30 days." },
  business_offers_sent: { title: "No offers sent yet", body: "Offers you send to customers will be listed here." },
  business_offers: { title: "No offers yet", body: "Create one to give your community a reason to visit." },
  business_signature: { title: "No signature experiences yet", body: "Create one to offer something only you can." },
  business_policy: { title: "No standing policy yet", body: "Set one so Nearby knows your usual terms." },
  business_messages: { title: "No messages yet", body: "Messages from your community will appear here." },
  community_members: { title: "No members yet", body: "People who join will appear here." },
  community_calendar: { title: "Nothing on the calendar", body: "Be the first to plan something." },
  request_no_responses: { title: "No responses yet", body: "Nearby is matching your request with businesses. You'll be notified when one responds." },
  communities_discover: { title: "No communities nearby yet", body: "Start your own and people nearby can join." },
  emergency_contacts: { title: "No emergency contacts yet", body: "Add someone you trust for date safety." },
  friend_circles: { title: "No circles yet", body: "Group your friends into circles to plan together." },
  shared_thoughts: { title: "No thoughts shared yet", body: "Add one to start the conversation." },
  trip_ideas: { title: "No ideas yet", body: "Add an idea to get planning." },
  playlist: { title: "No songs yet", body: "Search above to add the first one." },
  occasions: { title: "No occasions saved yet", body: "Save a birthday or anniversary and Nearby will remind you." },
  business_application: { title: "No application yet", body: "Apply to bring your business to Nearby." },
  gathering_questions: { title: "No questions yet", body: "Questions about this gathering will appear here." },
  gif_search: { title: "No GIFs match", body: "Try another search." },
  gatherings_search: { title: "No gatherings match \"{query}\"", body: "Try a different word, or clear the search." },
  communities_search: { title: "No communities match \"{query}\"", body: "Try a different word, or clear the search." },
  perks_search: { title: "No perks match \"{query}\"", body: "Try a different word, or clear the search." },
};

export function emptyCopy(id, vars = {}) {
  const e = EMPTY_STATES[id];
  if (!e) return null;
  const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
  return { title: fill(e.title), body: fill(e.body) };
}
