// One rule for a blocked form (owner UX audit, 2026-11-21; the pattern Create Gathering already used): only the FIRST
// problem in the form's own top-to-bottom order is shown, inline under its field, and the screen scrolls so that field
// sits a little below the top. Everything already entered is kept (nothing here touches the values).
export const FORM_ERROR_SCROLL_CONTEXT = 120;

// problems: [{ field, message }] in any order; order: the form's fields top to bottom. Returns the first one or null.
export function firstFormProblem(problems, order) {
  const list = (problems ?? []).filter((p) => p && p.field && p.message);
  if (list.length === 0) return null;
  const rank = (f) => {
    const i = (order ?? []).indexOf(f);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return list.reduce((best, p) => (rank(p.field) < rank(best.field) ? p : best), list[0]);
}

export function formErrorScrollY(fieldY) {
  const y = Number(fieldY);
  return Number.isFinite(y) ? Math.max(0, y - FORM_ERROR_SCROLL_CONTEXT) : null;
}
