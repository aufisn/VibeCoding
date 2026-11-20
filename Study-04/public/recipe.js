// Turns Claude's plain-text recipe into blocks the page can show safely
// (as text, never as HTML). Pure, so it's tested in Node too.

const clean = (s) => s.replace(/\*\*|__/g, "").replace(/^#+\s*/, "").trim();

/** @returns {Array<{type: "title"|"heading"|"bullets"|"steps"|"para", text?: string, items?: string[]}>} */
export function parseRecipe(text) {
  const blocks = [];
  const push = (type, item) => {
    const last = blocks[blocks.length - 1];
    if (last?.type === type) last.items.push(item);
    else blocks.push({ type, items: [item] });
  };
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = /^[-*•]\s+(.*)$/.exec(line))) push("bullets", clean(m[1]));
    else if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) push("steps", clean(m[1]));
    else if (!blocks.length) blocks.push({ type: "title", text: clean(line) });
    else if ((m = /^(?:\*\*|#+\s*)?(Ingredients|Steps|Method|Instructions|Directions)\s*:?\s*(?:\*\*)?\s*:?$/i.exec(line))) blocks.push({ type: "heading", text: m[1] });
    else blocks.push({ type: "para", text: clean(line) });
  }
  return blocks;
}
