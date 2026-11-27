// Device test (owner, 2026-11-27): People's view switches used playing-card / clipboard emoji (🃏 📋) and the map, info and
// dating-profile buttons used 🗺️ ⓘ 👤, each a different style. Functional controls now use ONE icon set (Ionicons, outline)
// with one convention: a view switch shows the view it switches TO (Discover's List | Map toggle already did), and every
// button keeps its screen-reader label. Emoji stay where they add personality (category glyphs, chips), never as controls.
export const FUNCTIONAL_ICONS = Object.freeze({
  info: 'information-circle-outline',
  list: 'list-outline',
  cards: 'albums-outline',
  map: 'map-outline',
  datingProfile: 'person-circle-outline',
  // Item 34 (device test 2026-11-27): the remaining emoji controls (⚙️ 🔍 📷) use the same outline set.
  settings: 'settings-outline',
  search: 'search-outline',
  camera: 'camera-outline',
});

export const FUNCTIONAL_ICON_SIZE = 21;

// The icon for a two-way view switch: the OTHER view. views = [a, b] keys of FUNCTIONAL_ICONS.
export function switchToIcon(current, views) {
  const [a, b] = views;
  return FUNCTIONAL_ICONS[current === a ? b : a];
}
