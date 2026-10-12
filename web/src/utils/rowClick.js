// A whole row opens its record, but a click that lands on something inside it
// that is interactive of its own (the title link, a button, an input) is left
// to that control — no double navigation, no stolen "Accept" click.
export const rowClick = (go) => (e) => {
  if (e.target.closest?.("a, button, input, textarea, select, [role='button']")) return;
  go();
};
