// Owner item 44 (2026-10-11): the geometry of a map pin growing into its business sheet. Pure, so the numbers that run are
// the numbers that are tested. Both points are in the sheet overlay's own coordinates.
import { journeyStart } from './pulseGeometry';

// The frame's starting transform: the sheet's outline shrunk to a pin-sized square centred on the pin. The transform order is
// translate then scale (React Native scales about the view's centre), so the start centre lands exactly on the pin.
export function pinFrameStart(pin, rect, pinSize) {
  return journeyStart(pin, rect, pinSize); // item 55: the Nearby Pulse's one journey geometry
}

// A pin's spot in window coordinates -> the overlay's coordinates (the overlay may not start at the window's top, e.g. under
// an Android status bar). Unknown either way = null (no frame; the sheet still opens).
export function toOverlayPoint(windowPoint, overlayOffset) {
  if (!windowPoint || !overlayOffset) return null;
  const x = windowPoint.x - overlayOffset.x;
  const y = windowPoint.y - overlayOffset.y;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

// The map reports a pin's coordinate at its tip (a standard pin is anchored bottom-centre); the frame starts from the pin's
// head, about this far above the tip. Not measured on a device.
export const PIN_HEAD_LIFT = 18;
