/**
 * Doppel Play keyboard shortcuts as a pure function, so the rules can be checked without a browser
 * (`npm run play:check`):
 *
 *   ← / →   previous / next move        1–4   play that card
 *   H       hold                        C     compare lines (your line / the engine's)
 *
 * Tab is never taken: it moves the focus, as everywhere else. A key held down plays once (auto-repeat is ignored
 * for 1–4, H and C; stepping through moves with a held arrow is fine). Nothing happens while typing in a field, and
 * 1–4, H and C do nothing while a button or a link has the focus, where Space and Enter already act.
 */
export type KeyAction = { kind: "prev" } | { kind: "next" } | { kind: "card"; index: number } | { kind: "hold" } | { kind: "compare" };

export interface KeyInput {
  key: string;
  repeat?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  /** Tag name of the element that has the focus (the event target), e.g. "INPUT", "BUTTON", "BODY". */
  targetTag?: string | null;
  /** The target is a contenteditable element. */
  editable?: boolean;
}

const FIELDS = new Set(["INPUT", "SELECT", "TEXTAREA"]);
const CONTROLS = new Set(["BUTTON", "A", "SUMMARY"]);

export function keyAction(e: KeyInput): KeyAction | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  const tag = (e.targetTag ?? "").toUpperCase();
  if (FIELDS.has(tag) || e.editable) return null;
  if (e.key === "ArrowLeft") return { kind: "prev" };
  if (e.key === "ArrowRight") return { kind: "next" };
  if (e.repeat || CONTROLS.has(tag)) return null;
  if (/^[1-4]$/.test(e.key)) return { kind: "card", index: Number(e.key) - 1 };
  if (e.key === "h" || e.key === "H") return { kind: "hold" };
  if (e.key === "c" || e.key === "C") return { kind: "compare" };
  return null;
}
