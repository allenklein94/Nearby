// Outside-entry presentations (owner, 2026-10-04): a route that renders an EXISTING surface's screen on top of the current
// history, so a push tap opens it without closing what the person was on (item 139). It is not a second screen: the same
// component, the same data, only presented on top. screenRegistry.test.js checks each one renders exactly its surface's
// component; notificationNav.js treats it as that surface (already showing it = refresh in place, never a duplicate copy).
export const PRESENTATION_ROUTES = {
  // The wave push's destination. Route name kept as 'Notices' to avoid churn; the header and button both read "Activity".
  Notices: 'Activity',
};

// The surface a route really shows: a presentation's surface, else the route itself.
export function canonicalRoute(name) {
  return PRESENTATION_ROUTES[name] ?? name;
}

export function isPresentation(name) {
  return Object.prototype.hasOwnProperty.call(PRESENTATION_ROUTES, name);
}
