// A business with no coordinates is skipped by every request routing rule (they are all distance-based), so it never
// receives an opportunity and never appears on the map. This says so plainly. Null = nothing to fix.
import { tr } from '../i18n/translate';

export function businessLocationNotice(partner) {
  if (!partner) return null;
  const hasCoords = partner.latitude != null && partner.longitude != null;
  if (hasCoords) return null;
  if (!partner.address) {
    return { needsAction: true, text: tr('ui.bizHelp.location.addAddress') };
  }
  return { needsAction: true, text: tr('ui.bizHelp.location.cantPlace') };
}
