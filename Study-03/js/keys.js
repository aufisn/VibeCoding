// Keyboard shortcuts for the Question screen, as a pure function so the
// rules can be unit-tested without a DOM. ui.js gathers the context and
// acts on the result.

const LETTER_KEYS = ["a", "b", "c", "d"];
const NUMBER_KEYS = ["1", "2", "3", "4"];

/**
 * @param {string} key KeyboardEvent.key
 * @param {object} context
 * @param {string} context.screen current screen ("question" is the only one with shortcuts)
 * @param {boolean} context.answered the answer is locked
 * @param {boolean} [context.dialogOpen] a modal dialog is showing
 * @param {boolean} [context.inTextField] focus is in a text input (e.g. nickname)
 * @param {boolean} [context.onOtherControl] focus is on a control that handles
 *   Enter/Space itself (Exit, Eliminate, Skip, the theme switch)
 * @param {boolean} [context.modifier] Ctrl, Alt or Meta is held
 * @param {number} [context.optionCount] defaults to 4
 * @param {number[]} [context.eliminated] option indexes that can't be chosen
 * @returns {{type: "select", index: number} | {type: "next"} | null}
 */
export function mapKey(key, context) {
  const {
    screen,
    answered,
    dialogOpen = false,
    inTextField = false,
    onOtherControl = false,
    modifier = false,
    optionCount = 4,
    eliminated = [],
  } = context ?? {};
  if (screen !== "question" || dialogOpen || inTextField || modifier) return null;
  if (typeof key !== "string") return null;

  if (key === "Enter" || key === " " || key === "Spacebar") {
    if (!answered || onOtherControl) return null;
    return { type: "next" };
  }

  const lower = key.toLowerCase();
  let index = LETTER_KEYS.indexOf(lower);
  if (index === -1) index = NUMBER_KEYS.indexOf(key);
  if (index === -1 || index >= optionCount) return null;
  if (answered || eliminated.includes(index)) return null;
  return { type: "select", index };
}
