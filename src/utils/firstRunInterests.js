import { canonicalizeInterests } from '../constants/interestGraph';

// Item 55: the first Home shows the person that Nearby listened. Only interests they really declared
// are named; a pick with no matching nearby item is said plainly, never padded.
function joinNames(names) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function firstRunInterestLine(declaredInterests, recommendations, limit = 3) {
  const picks = canonicalizeInterests(declaredInterests).slice(0, limit);
  if (picks.length === 0) return null;
  const tagOf = (r) => r?.data?.interest_tag ?? r?.data?.target_interest_tag ?? null;
  const covered = picks.filter((p) => (recommendations ?? []).some((r) => tagOf(r) === p));
  const uncovered = picks.filter((p) => !covered.includes(p));
  const told = `You told us you're into ${joinNames(picks)}.`;
  const followUp = covered.length > 0
    ? (uncovered.length > 0
      ? ` Here's what we found for ${joinNames(covered)}; nothing upcoming nearby for ${joinNames(uncovered)} yet.`
      : ' Here\'s what we found for that.')
    : ' Nothing upcoming nearby matches yet, so we\'ll surface it as soon as something does.';
  return { picks, covered, uncovered, text: told + followUp };
}
