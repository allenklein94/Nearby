// Business Profile as ONE reviewable summary (owner, 2026-11-14): Tell Nearby about your business -> review what Nearby
// knows -> tap a section to change it -> save (each section keeps its existing controls and save). Each section header
// shows, in one line, what is SAVED for it today, read from the partner row ("want more" = its saved priority occasions +
// customer kinds). Only real values: nothing set = the caller's "Not set"; never a guess, never a default.
// Settings (automation, notifications, payments) is advanced and shows no summary line.
import { occasionLabel, experiencePartyTypeLabel, businessAttributeLabel, OCCASION_OPTIONS } from '../constants/businessAttributes';
import { BUSINESS_DIETARY_OPTIONS, dietaryOptionsOf } from '../constants/dietaryOptions';
import { isServiceArea } from './businessLocationMode';

export const SUMMARY_MAX_PIECES = 3;

const nonEmpty = (v) => v !== null && v !== undefined && String(v).trim() !== '';

// Pieces for one section, in the order shown. fmt = { categoryLabel(key), subcategoryLabel(key), upToPeople(n) }.
export function profileSummaryPieces(key, partner, fmt = {}) {
  const p = partner ?? {};
  switch (key) {
    case 'basics': {
      const out = [];
      if (nonEmpty(p.category)) out.push(fmt.categoryLabel ? fmt.categoryLabel(p.category) : p.category);
      if (nonEmpty(p.subcategory)) out.push(fmt.subcategoryLabel ? fmt.subcategoryLabel(p.subcategory) : p.subcategory);
      // Where it is (utils/businessLocationMode.js): a business that goes to its customers has no address, only its mode.
      if (isServiceArea(p)) out.push(fmt.serviceArea ?? 'We go to customers');
      else if (nonEmpty(p.address)) out.push(String(p.address).trim());
      return out;
    }
    case 'accommodate': {
      const out = [];
      const n = Number(p.max_group_size);
      if (p.max_group_size != null && Number.isFinite(n) && n > 0) out.push(fmt.upToPeople ? fmt.upToPeople(n) : String(n));
      for (const o of Array.isArray(p.offered_occasions) ? p.offered_occasions : []) out.push(occasionLabel(o));
      return out;
    }
    case 'who': {
      const out = [];
      for (const t of Array.isArray(p.accommodates_party_types) ? p.accommodates_party_types : []) out.push(experiencePartyTypeLabel(t));
      for (const d of dietaryOptionsOf(p)) out.push(BUSINESS_DIETARY_OPTIONS.find((o) => o.key === d)?.label ?? d);
      return out;
    }
    case 'grow': {
      // What the business wants MORE of (a ranking preference, never a capability): saved occasions, then customer kinds.
      const out = [];
      for (const k of Array.isArray(p.priority_occasions) ? p.priority_occasions : []) out.push(OCCASION_OPTIONS.find((o) => o.key === k)?.label ?? k);
      for (const a of Array.isArray(p.priority_attributes) ? p.priority_attributes : []) out.push(businessAttributeLabel(a));
      return out;
    }
    default:
      return [];
  }
}

// The one line under a section header: up to 3 pieces, then "+N"; nothing saved = notSet; Settings = null (no line).
export function profileSummaryLine(key, partner, fmt = {}) {
  if (key === 'settings') return null;
  const pieces = profileSummaryPieces(key, partner, fmt).filter(nonEmpty);
  if (pieces.length === 0) return fmt.notSet ?? null;
  const shown = pieces.slice(0, SUMMARY_MAX_PIECES);
  const more = pieces.length - shown.length;
  return shown.join(' · ') + (more > 0 ? ` · +${more}` : '');
}
