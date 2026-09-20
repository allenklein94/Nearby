// "Read this for me" -- pure rules for turning creative-extraction SUGGESTIONS into offer-form values.
// Locked (owner, 2026-09-20): manual only, suggestion-only, business name from the account, validity is a day hint that
// only preselects the existing Today/Tomorrow control (never a time or date), redemption text goes in the existing
// redemption field, everything stays editable, and the discount cap + screening stay the final authority at send time.

import { discountCapProblem } from './discountCap';

// Mirrors supabase/functions/read-offer-creative `sanitize` (the server validates first; the client re-checks anyway).
function text(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return t || null;
}
function num(v, min, max) {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export function sanitizeCreativeSuggestions(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    product: text(s.product, 120),
    offerWording: text(s.offerWording, 300),
    price: num(s.price, 0, 100000),
    discountPct: num(s.discountPct, 1, 100),
    validity: s.validity === 'today' || s.validity === 'tomorrow' ? s.validity : null,
    redemptionInstruction: text(s.redemptionInstruction, 500),
  };
}

export function hasAnySuggestion(s) {
  return !!s && Object.values(s).some((v) => v != null);
}

// What to write into the form. Only EMPTY fields are filled (never overwrite what the owner typed or picked). `current`:
// { title, description, price, discountPct, redemption, validDay, offerType }. Returns the patch plus what it filled.
export function creativeFormPatch(suggestions, current = {}) {
  const s = sanitizeCreativeSuggestions(suggestions);
  const empty = (v) => v == null || String(v).trim() === '';
  const patch = {};
  if (s.product && empty(current.title)) patch.title = s.product;
  if (s.offerWording && empty(current.description)) patch.description = s.offerWording;
  if (s.price != null && empty(current.price)) patch.price = String(s.price);
  if (s.discountPct != null && empty(current.discountPct)) {
    patch.discountPct = String(s.discountPct);
    if ((current.offerType ?? 'standard') === 'standard') patch.offerType = 'discount';
  }
  if (s.redemptionInstruction && empty(current.redemption)) patch.redemption = s.redemptionInstruction;
  // Validity: the DAY only, and only when the owner has not already chosen one. The end time is left for the owner to pick.
  if (s.validity && current.validDay == null) patch.validDay = s.validity;
  return patch;
}

// "We detected: Latte, $5, Valid today, Coastal Coffee" -- the business name is the authenticated account's own.
export function detectedSummary(suggestions, businessName) {
  const s = sanitizeCreativeSuggestions(suggestions);
  const parts = [];
  if (s.product) parts.push(s.product);
  if (s.discountPct != null) parts.push(`${s.discountPct}% off`);
  if (s.price != null) parts.push(`$${Number.isInteger(s.price) ? s.price : s.price.toFixed(2)}`);
  if (s.validity) parts.push(s.validity === 'today' ? 'Valid today' : 'Valid tomorrow');
  if (s.redemptionInstruction) parts.push('How to redeem');
  if (parts.length === 0) return null;
  const name = typeof businessName === 'string' && businessName.trim() ? businessName.trim() : null;
  if (name) parts.push(name);
  return `We detected: ${parts.join(', ')}`;
}

// A warning shown right away when the extracted discount is over the owner's cap (same rule as a typed one; the server
// still refuses it at send time).
export function extractedDiscountWarning(suggestions, cap) {
  const s = sanitizeCreativeSuggestions(suggestions);
  if (s.discountPct == null) return null;
  return discountCapProblem({ offerType: 'discount', pctInput: String(s.discountPct), cap });
}

// Web samples no video frames, so extraction there is image-only. Native reads a video through its sampled frames.
export function canReadCreative(asset, platform) {
  if (!asset) return false;
  if (asset.type === 'video') return platform !== 'web';
  return true;
}
