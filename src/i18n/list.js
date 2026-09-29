// "A, B and C" in the current language (ui.homeParts.list). English: the app's original wording, byte-identical.
import { tr } from './translate';

export function joinAnd(names) {
  const list = (names ?? []).filter((n) => n != null && n !== '');
  if (list.length <= 1) return list[0] ?? '';
  return tr('ui.homeParts.list.and', { rest: list.slice(0, -1).join(tr('ui.homeParts.list.sep')), last: list[list.length - 1] });
}
