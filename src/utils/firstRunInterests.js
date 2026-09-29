import { canonicalizeInterests } from '../constants/interestGraph';
import { tr, getCurrentLanguage } from '../i18n/translate';
import { joinAnd } from '../i18n/list';
import { categoryName } from '../i18n/categoryNames';

// Item 55: the first Home shows the person that Nearby listened. Only interests they really declared
// are named; a pick with no matching nearby item is said plainly, never padded.
// Category names are shown in the person's language (i18n/categoryNames.js); sentences are ui.homeParts.firstRun.
const joinNames = (names) => joinAnd(names.map((n) => categoryName(n, getCurrentLanguage())));

export function firstRunInterestLine(declaredInterests, recommendations, limit = 3) {
  const picks = canonicalizeInterests(declaredInterests).slice(0, limit);
  if (picks.length === 0) return null;
  const tagOf = (r) => r?.data?.interest_tag ?? r?.data?.target_interest_tag ?? null;
  const covered = picks.filter((p) => (recommendations ?? []).some((r) => tagOf(r) === p));
  const uncovered = picks.filter((p) => !covered.includes(p));
  const told = tr('ui.homeParts.firstRun.told', { list: joinNames(picks) });
  const followUp = covered.length > 0
    ? (uncovered.length > 0
      ? tr('ui.homeParts.firstRun.foundSome', { covered: joinNames(covered), uncovered: joinNames(uncovered) })
      : tr('ui.homeParts.firstRun.foundAll'))
    : tr('ui.homeParts.firstRun.none');
  return { picks, covered, uncovered, text: `${told} ${followUp}` };
}
