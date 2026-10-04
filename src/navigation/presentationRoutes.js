// Outside-entry presentations (owner, 2026-10-04): a route that renders an EXISTING surface (or one mode of it) on top of the
// current history, so an entry from a stack screen keeps the person's place (item 139). It is not a second screen: the same
// component the canonical surface renders, the same data and rules, only presented on top. screenRegistry.test.js checks
// each one renders exactly its surface's component (or, with `mode`, the component that surface embeds for that mode).
//   surface: the canonical route it presents        mode: which mode of that surface, when it presents only one
export const PRESENTATION_ROUTES = {
  // The wave push's destination. Route name kept as 'Notices' to avoid churn; the header and button both read "Activity".
  Notices: { surface: 'Activity' },
  // People -> Friends opened on top of a stack screen (the Friends list, the gathering-published screen, typed-ask people
  // rows, Create's invite picker), where switching tabs would close what the person was doing. Same FriendDiscoveryScreen
  // that Discover embeds for its Friends mode; entries that start on a tab open Discover -> People -> Friends instead.
  FriendDiscovery: { surface: 'Discover', mode: 'people/friends', component: 'FriendDiscoveryScreen' },
  // The Profile tab opened on top of a stack screen whose workflow a tab switch would close (Dating Preferences' "edit
  // gender / interests on your Profile" links), so Back returns there. Same ProfileScreen as the tab.
  MyProfile: { surface: 'Profile' },
};

// The surface a route really shows, for "is this already on screen?" (notificationNav.js). Only whole-surface presentations
// alias their surface: a mode presentation is not the same as the surface tab, which may be showing another mode.
export function canonicalRoute(name) {
  const p = PRESENTATION_ROUTES[name];
  return p && !p.mode ? p.surface : name;
}

export function isPresentation(name) {
  return Object.prototype.hasOwnProperty.call(PRESENTATION_ROUTES, name);
}
