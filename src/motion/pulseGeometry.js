// Owner item 55: the Nearby Pulse's journey geometry (form 2), pure so the numbers that run are the numbers that are tested.
// Where a journey starts: the target's outline shrunk to an origin-sized square centred on the origin point. Translate then
// scale (React Native scales about the view's centre), so the start centre lands exactly on the origin. Unknown = null.
export function journeyStart(origin, rect, originSize) {
  if (!origin || !rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return null;
  return {
    translateX: origin.x - (rect.x + rect.width / 2),
    translateY: origin.y - (rect.y + rect.height / 2),
    scaleX: Math.min(1, originSize / rect.width),
    scaleY: Math.min(1, originSize / rect.height),
  };
}
