// Item 123 ("Use 'anticipation' animations"): a real, deterministic day-count bucket -- never a
// fabricated continuous percentage, since there's no honest "started N days ago" baseline to
// compute a true progress ring from for most occasions. Thresholds are a disclosed judgment call,
// not measured data.
//
// 'none'     -- more than 2 weeks out, or unknown/past. Far enough away that any visual treatment
//               would just be noise -- "don't create a countdown on everything."
// 'building' -- 4-14 days out. Getting real, worth a slightly warmer tone.
// 'close'    -- 1-3 days out. The final stretch.
// 'today'    -- the day itself.
export function anticipationTier(daysUntil) {
  if (daysUntil == null || !Number.isFinite(daysUntil) || daysUntil < 0) return 'none';
  if (daysUntil === 0) return 'today';
  if (daysUntil <= 3) return 'close';
  if (daysUntil <= 14) return 'building';
  return 'none';
}
