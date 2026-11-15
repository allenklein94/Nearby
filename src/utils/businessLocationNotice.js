// A business with no coordinates is skipped by every request routing rule (they are all distance-based), so it never
// receives an opportunity and never appears on the map. This says so plainly. Null = nothing to fix.
// A business that goes to its customers (utils/businessLocationMode.js) is complete with its rounded area alone.
import { tr } from '../i18n/translate';
import { isServiceArea } from './businessLocationMode';

export function businessLocationNotice(partner) {
  if (!partner) return null;
  const hasCoords = partner.latitude != null && partner.longitude != null;
  if (hasCoords) return null;
  // It said it goes to its customers (e.g. a website application) but hasn't marked its area: never ask for an address.
  if (isServiceArea(partner)) return { needsAction: true, text: tr('ui.bizHelp.location.markServiceArea') };
  if (!partner.address) {
    return { needsAction: true, text: tr('ui.bizHelp.location.addAddress') };
  }
  return { needsAction: true, text: tr('ui.bizHelp.location.cantPlace') };
}

// The dashboard's one location line: what to fix, else what is saved (never "📍 null" for a pin without an address).
export function businessLocationBanner(partner) {
  if (!partner) return null;
  const notice = businessLocationNotice(partner);
  if (notice) return notice;
  if (isServiceArea(partner)) return { needsAction: false, text: tr('ui.bizHelp.location.serviceAreaBanner') };
  if (!partner.address) return { needsAction: false, text: tr('ui.bizHelp.location.pinnedNoAddress') };
  return { needsAction: false, text: `📍 ${partner.address}` };
}
