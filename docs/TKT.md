# Doppel × TKT: hand control (draft)

**Status: draft, nothing here was tested with TKT.** TKT turns a desk-facing camera into a hand-tracking touchpad (thumb click and drag, two-finger scroll, three- and four-finger shortcuts) and sends ordinary OS mouse and keyboard input. Level 1 needs no TKT code change: Doppel only has to respond to keys and large targets. `/play` is not merged yet (spec: [PLAY.md](PLAY.md) §11), so the key map below is the plan, not shipped behaviour.

## Level 1 mapping (keyboard)

| Gesture (TKT) | Key sent | Doppel action in `/play` (planned) |
|---|---|---|
| Three-finger swipe right | → | next year / next move |
| Three-finger swipe left | ← | previous year / step back |
| Four-finger tap 1–4 (one shortcut each) | 1, 2, 3, 4 | pick card 1–4 |
| Four-finger fist or hold | H | hold (skip the year) |
| Three-finger tap | Tab | compare lines |
| Two-finger scroll | mouse wheel | scrolls the timeline |
| Thumb click on a target | mouse click | any button (large targets) |

The gesture column is a proposal. TKT's real shortcut config and gesture names could not be checked (see blockers below); assign the keys in TKT's existing shortcut config to whichever three- and four-finger gestures it already offers.

On today's dashboard (`main`) these keys do nothing special; ordinary OS mouse input can activate controls and scroll; TKT hardware operation has not been verified.

## 30-second demo flow

1. Open Doppel on `http://localhost:3000/play` (after `/play` is merged) and start TKT live mode.
2. Thumb-click a starting profile.
3. Swipe right to step a year. Tap 1–4 to pick a card; the engine review appears for the chosen move.
4. Tap Tab to compare two lines; scroll with two fingers along the timeline.
5. Say: "The camera sends plain keystrokes and clicks. Doppel's maths never changes."

## Level 2 (not started, needs TKT PR approval)

A local, versioned JSON event stream from TKT's `app` layer (Python standard library only, for example Server-Sent Events). Planned events: `scrub_age`, `accept_card`, `hold`, `compare_lines`, `capture_document`. Doppel would subscribe behind a feature flag and map events to the same actions as the keys. For document capture, TKT grabs one still frame when the hand has left the picture and passes it to Doppel's snap cascade; OCR runs locally in the browser first; a later cloud fallback may transmit an image under the existing snap routing rules. TKT constraints from the brief: `vision` and `control` never import each other, `src/tkt/core/` is off limits, new config keys and dependencies need approval, and tests use `SyntheticSource`, `DryBackend` and recordings.

## Not verified

- The mapping with TKT live mode on the demo machine (hardware test).
- TKT's real gesture and shortcut names.
- `/play` keyboard handling (not merged).

## Source and hardware blockers

The local candidate `/Users/oktay/TKT` and its `D0ktay/TKT` remote currently contain a chat interface, not the hand-tracking source described in the task. Its TKT instructions, shortcut configuration and app layer are unavailable. Level 1 requires the actual source/config and demo hardware; Level 2 cannot be implemented or validated against this unrelated checkout.
