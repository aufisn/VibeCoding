// Light/dark theme switch. The choice is stored in localStorage under
// "quiz.theme"; with no stored choice the page follows the system setting.
// index.html applies a stored choice before first paint (no flash).

export const THEME_KEY = "quiz.theme";

const darkQuery = () => globalThis.matchMedia?.("(prefers-color-scheme: dark)");

/** The theme currently showing: "light" or "dark". */
export function currentTheme(root = document.documentElement) {
  const set = root.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return darkQuery()?.matches ? "dark" : "light";
}

/** Show `theme` and remember it. Storage errors are ignored. */
export function setTheme(theme, root = document.documentElement) {
  root.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* blocked storage: the switch still works for this visit */
  }
}

/**
 * Wire a toggle button (aria-pressed = dark mode on). `onChange` runs after
 * every change, including system changes while no choice is stored.
 */
export function bindThemeToggle(button, onChange = () => {}) {
  const sync = () => {
    const dark = currentTheme() === "dark";
    button.setAttribute("aria-pressed", String(dark));
    button.dataset.mode = dark ? "dark" : "light";
    onChange(dark);
  };
  button.addEventListener("click", () => {
    setTheme(currentTheme() === "dark" ? "light" : "dark");
    sync();
  });
  darkQuery()?.addEventListener?.("change", sync);
  sync();
}
