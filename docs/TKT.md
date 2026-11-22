# Doppel × TKT: playing your financial twin by hand

[TKT](https://github.com/D0ktay/TKT) (Oktay's repository, Python/MediaPipe) turns a desk-facing camera into a touchpad: hand tracking, relative cursor movement, thumb click and drag, two-finger scroll, and three- or four-finger system shortcuts. Doppel is a web app. The two stay separate applications: each one works on its own, and neither loses a feature to the other.

## One project, two apps

TKT lives in this repository as the git submodule `tkt/` (pinned to a tested commit of [D0ktay/TKT](https://github.com/D0ktay/TKT)). One clone with `--recurse-submodules` brings both apps. TKT's code, history, rules and ownership stay in Oktay's repository: change TKT there, then bump the pointer here (`git -C tkt pull origin main`, commit `tkt`).

The integration is running both; no code changes on either side. TKT drives the real OS pointer and keyboard, so it controls Doppel in the browser like any other window. `scripts/demo-with-tkt.ps1` (Windows: version A) and `scripts/demo-with-tkt.sh` (macOS: auto mode A/C) start both.

### Version A: camera looking down at the desk

| TKT gesture | Doppel |
|---|---|
| J1: index finger open, slide | Move the pointer over the board, the cards and the panels |
| J3: thumb closes and opens (left click) | Tap a ringed piece, then one of its decisions; start a game, hold, compare lines, open a past move |
| J6: index and middle slide together | Scroll: board → engine review → move list |
| J11: pinky alone, speak | Dictation into the focused field. Click Doppel's what-if bar on the dashboard, say "retire at 60" or "buy a flat in 2028 for 1.2M", then close the fist to press Enter. Doppel parses it in four languages. |
| J9: three/four fingers, swipe | Switch desktop: between Doppel and the slides during the pitch |
| J10: hand out of view, or Ctrl+Alt+P | TKT's output stops (safe stop) |
| J0: loose fist | Rest |

### Version C: camera facing you (pinch)

| TKT gesture | Doppel |
|---|---|
| Open hand, move | Pointer |
| Thumb–index pinch | Click. TKT's target assist frames one nearby button in green, which helps on the decision buttons. |
| Thumb–middle pinch, move | Scroll |
| Thumb on index, hold 2 s | Right click (not needed) |

The auto mode (macOS) switches between A and C by itself: C when a face is in view, A otherwise.

Large targets help a hand-driven pointer. The decision buttons are at least 44 px high. A board square is about 35 px on a 320-px phone and larger on a laptop, so use a laptop or a large screen for the demo. Under the board, a "Full review ↓" link jumps to the engine review on small screens.

### 30-second demo

1. Clone with `--recurse-submodules` (or run `git submodule update --init`), then start both: `scripts/demo-with-tkt.ps1` (Windows) or `scripts/demo-with-tkt.sh` (macOS). Calibrate the hand in TKT if asked (`c` in its debug view).
2. Open `/play` and pick Alexia. Point at the queen and thumb-click it, then thumb-click "Start working".
3. Two-finger scroll down to the engine review: label, points breakdown, where the effect lands.
4. Scroll back up and play two more moves on the board. Point at the last move in the move list to review it.
5. On the dashboard, click the what-if bar, raise the pinky (J11) and say "retire at 60"; close the fist. The twin recomputes.
6. Say: "The camera sends plain clicks, scrolls and dictation. Doppel's maths never changes."

## Optional, not needed for the submission: gestures as Doppel shortcuts (TKT change, owner's approval)

Doppel already has keyboard shortcuts in `/play`:

- ← / →: step through moves
- 1–4: play a card
- H: hold
- Tab: compare lines

TKT has **no configurable shortcut map** today. Swipes are hard-wired to OS actions (`desktop_left`, `desktop_right` and `mission_control` in `src/tkt/control/gestures.py`). To send ← / → while the Doppel window is in front, TKT needs a small change in its `app`/`control` layer and new config keys. TKT's rules require the owner's approval for new config keys, so this is Oktay's call and his PR.

Proposed mapping:

| Gesture | Key | Doppel action |
|---|---|---|
| Swipe left / right | ← / → | Previous / next move |
| Swipe up | Tab | Compare your line and the engine's |

## Optional, later: event bridge and desk document capture (both repositories)

See `docs/tasks/E-tkt-bridge.md`:

- a versioned localhost event stream from TKT, standard library only;
- a feature-flagged subscriber in Doppel;
- one still frame of a document on the desk handed to Doppel's snap cascade. OCR runs in the browser first; a later cloud fallback may send the image only under the existing snap routing rules.

TKT's constraints: `vision` and `control` never import each other, `src/tkt/core/` is off limits, new config keys and dependencies need approval, and tests use `SyntheticSource`, `DryBackend` and recordings.

## What is verified

- **Verified:** the Doppel side, in Playwright at 320 and 1280 px: board targets, decisions and keyboard shortcuts.
- **Not run:** the demo scripts end to end. They would start TKT on this machine.
- **Not verified here:** TKT itself, because there is no camera on this machine. The gesture tables follow `tkt/README.md` at the pinned commit (PR #53, 2026-11-22). Bump the submodule and update the tables if TKT changes. The TKT commands in the scripts follow TKT's README (`uv run python -m tkt.app.main --source live`). Run the demo once on the demo machine before the pitch.

## Changes from the earlier draft

- **Source checked.** The earlier draft could not find TKT's hand-tracking source; the checkout it saw was a chat interface. The real source is `D0ktay/TKT`, last merged PR #39 (checked 2026-11-22).
- **No shortcut config in TKT.** The draft assumed TKT had a shortcut config that could map gestures to Doppel keys. It has none: swipes are hard-wired to OS actions. That makes the key mapping a Level 1 TKT change.
- **The integration is running both.** TKT's own gestures (pointer, click, scroll, swipes) already control Doppel, and neither project changes. Key mapping and the event bridge are optional extras.
- **`/play` is on the branch.** Its keyboard shortcuts work (←/→, 1–4, H, Tab), and it is on the branch `t3/play-chessboard`.
- **TKT is now a submodule.** It is pinned to `D0ktay/TKT` PR #53, which adds versions A/C, the auto mode and dictation. The submission is one repository.
