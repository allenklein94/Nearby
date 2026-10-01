// A gathering's host-declared practical facts (practicalFacts in utils/gatheringPractical.js) in the person's language. English is
// practicalFacts itself (byte-identical); other languages word the SAME facts, in the same order, from ui.gatheringOptions.*,
// ui.gatheringParts.fact.* and ui.suitedAges.*. Display only.
import { translate } from './translate';
import { localDuration } from './format';
import { practicalFacts, durationLabel, genreLabel, cleanFeatures, GATHERING_FEATURE_OPTIONS } from '../utils/gatheringPractical';
import { formatLabel, formatIcon } from '../constants/activityFormat';
import { skillLabel } from '../constants/skillLevel';
import { effortLabel } from '../constants/intensityEffort';
import { suitedAgesLabel } from './businessProfileDisplay';

export function practicalFactsIn(g, language) {
  if (!language || language === 'en') return practicalFacts(g);
  const o = (key) => translate(language, `ui.gatheringOptions.${key}`);
  const f = (key, vars) => translate(language, `ui.gatheringParts.fact.${key}`, vars);
  const out = [];
  if (g?.equipment_provided === true) out.push(`🎾 ${o('equipment.provided')}`);
  else if (g?.equipment_provided === false) out.push(`🎒 ${f('byoEquipment')}`);
  if (durationLabel(g?.duration_minutes)) out.push(`⏱️ ${f('about', { duration: localDuration(g.duration_minutes, language) })}`);
  if (genreLabel(g?.genre)) out.unshift(`🎵 ${o(`genre.${g.genre}`)}`);
  const fmt = formatLabel(g?.format) ? `${formatIcon(g.format)} ${o(`format.${g.format}`)}` : null;
  if (fmt) out.unshift(fmt);
  const skill = skillLabel(g?.skill_level) ? `🎯 ${o(`skill.${g.skill_level}`)}` : null;
  if (skill) out.splice(fmt ? 1 : 0, 0, skill);
  if (effortLabel(g?.effort_level)) out.splice((fmt ? 1 : 0) + (skill ? 1 : 0), 0, `💪 ${f('effort', { level: o(`effort.${g.effort_level}`) })}`);
  const ages = suitedAgesLabel(g?.suited_age_min, g?.suited_age_max, language);
  if (ages) out.push(`🧒 ${ages}`);
  for (const k of cleanFeatures(g?.features)) {
    const opt = GATHERING_FEATURE_OPTIONS.find((x) => x.key === k);
    if (opt) out.push(`${opt.icon} ${o(`feature.${k}`)}`);
  }
  return out;
}
