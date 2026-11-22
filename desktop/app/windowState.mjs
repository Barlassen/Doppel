// Remembers the main window's size and position between launches (window-state.json in the data folder).
import fs from "node:fs";
import { screen } from "electron";

const DEFAULTS = { width: 1280, height: 860 };
export const MIN = { width: 320, height: 520 };

export function load(file) {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // First launch.
  }
  const isSize = (n) => Number.isFinite(n) && n >= 200 && n <= 20000;
  const state = {
    width: isSize(saved.width) ? Math.max(saved.width, MIN.width) : DEFAULTS.width,
    height: isSize(saved.height) ? Math.max(saved.height, MIN.height) : DEFAULTS.height,
    maximized: saved.maximized === true,
  };
  if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    // Only reuse a position that is still on a connected display.
    const area = screen.getDisplayMatching({ x: saved.x, y: saved.y, width: state.width, height: state.height }).workArea;
    const visible = saved.x + state.width > area.x + 80 && saved.x < area.x + area.width - 80 && saved.y >= area.y - 10 && saved.y < area.y + area.height - 80;
    if (visible) Object.assign(state, { x: saved.x, y: saved.y });
  }
  const work = screen.getPrimaryDisplay().workAreaSize;
  if (state.x === undefined) {
    state.width = Math.min(state.width, work.width);
    state.height = Math.min(state.height, work.height);
  }
  return state;
}

/** Saves on move, resize and close. */
export function track(win, file) {
  let timer = null;
  const save = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const bounds = win.getNormalBounds();
    try {
      fs.writeFileSync(file, JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
    } catch {
      // Not worth interrupting the user for.
    }
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  win.on("resize", later);
  win.on("move", later);
  win.on("close", () => {
    clearTimeout(timer);
    save();
  });
}
