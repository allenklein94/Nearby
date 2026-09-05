// Shared by any hero-card gradient fallback (Discover's notable-gathering
// hero tier; Home's own Best Pick hero, Phase 8 section H) -- simple
// additive lightening feeding a decorative gradient endpoint only. Text
// legibility over the resulting image always comes from a separate dark
// scrim layered on top, so this never needs to hit a real contrast ratio
// on its own.
export function lightenHex(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + Math.round(255 * amount));
  const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * amount));
  const b = Math.min(255, (num & 0xff) + Math.round(255 * amount));
  return `rgb(${r}, ${g}, ${b})`;
}
