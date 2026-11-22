# Hand control: playing your financial twin by hand

Doppel can be played by hand at a desk. The hand-control component in `tkt/` (Python, MediaPipe) turns a camera into a pointing device. It tracks the hand and drives the pointer, clicks, scrolling and dictation, and Doppel responds to all of them in the browser.

Start everything for the demo with `scripts/demo-with-tkt.ps1` (Windows) or `scripts/demo-with-tkt.sh` (macOS). Setup for the hand-control part (Python 3.11, `uv`, camera permissions) is in [tkt/README.md](../tkt/README.md).

## Desk camera (version A)

| Gesture | In Doppel |
|---|---|
| J1: index finger open, slide | Move the pointer over the board, the cards and the panels |
| J3: thumb closes and opens (left click) | Tap a ringed piece, then one of its decisions; start a game, hold, compare lines, open a past move |
| J6: index and middle slide together | Scroll: board → engine review → move list |
| J11: pinky alone, speak | Dictation into the focused field. Click the what-if bar on the dashboard, say "retire at 60" or "buy a flat in 2028 for 1.2M", then close the fist to press Enter. Doppel parses it in four languages. |
| J9: three/four fingers, swipe | Switch desktop: between Doppel and the slides during the pitch. Or, with the setting below: step through the moves in `/play` (← / →) and compare lines (swipe up, Tab) |
| J10: hand out of view, or Ctrl+Alt+P | Output stops (safe stop) |
| J0: loose fist | Rest |

## Camera facing you (version C, pinch)

| Gesture | In Doppel |
|---|---|
| Open hand, move | Pointer |
| Thumb–index pinch | Click. Target assist frames one nearby button in green, which helps on the decision buttons. |
| Thumb–middle pinch, move | Scroll |
| Thumb on index, hold 2 s | Right click (not needed) |

The auto mode (macOS) switches between A and C by itself: C when a face is in view, A otherwise.

## Targets

The decision buttons are at least 44 px high. A board square is about 35 px on a 320-px phone and larger on a laptop, so use a laptop or a large screen for the demo. Under the board, a "Full review ↓" link jumps to the engine review on small screens.

## 30-second demo

1. Clone with `git clone --recurse-submodules`, then start everything: `scripts/demo-with-tkt.ps1` (Windows) or `scripts/demo-with-tkt.sh` (macOS). Calibrate the hand if asked (`c` in the debug view).
2. Open `/play` and pick Alexia. Point at the queen and click it, then click "Start working".
3. Scroll down to the engine review: label, points breakdown, where the effect lands.
4. Scroll back up and play two more moves on the board. Point at the last move in the move list to review it.
5. On the dashboard, click the what-if bar, raise the pinky (J11) and say "retire at 60"; close the fist. The twin recomputes.
6. Say: "The camera sends plain clicks, scrolls and dictation. Doppel's maths never changes."

## Swipes as `/play` shortcuts

`/play` listens for ← / → (previous / next move) and Tab (compare lines). The swipes switch desktops by default. To send those keys instead, set this in `tkt/config/control.toml`:

```toml
[swipe]
left = "key_left"
right = "key_right"
up = "key_tab"
```

Tab compares lines only while the focus is on the page itself, not in a field. This mapping is covered by tests in `tkt/` but was not tried with a live camera.

## Next steps

- **Event bridge:** a versioned localhost event stream (Python standard library only) and a feature-flagged subscriber in Doppel.
- **Desk documents:** one still frame of a receipt or bill on the desk goes into Doppel's snap cascade. OCR runs in the browser first.

## What is verified

- **Verified:** Doppel's side, in Playwright at 320 and 1280 px: board targets, decisions and keyboard shortcuts.
- **Not run:** the demo scripts end to end and the hand control with a live camera, because there is no camera on the build machine. Run the demo once on the demo machine before the pitch.
