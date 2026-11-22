# Task E: Doppel × TKT (hand-tracking touchpad) bridge

**Owner:** Oktay (he owns TKT). **Start:** after `/play` lands. **Conflict risk:** TKT repo only.
Read `AGENTS.md` here and TKT's own `AGENTS.md`, `README.md` and `docs/plan/*` first.

## Idea
"Your financial twin on the desk." TKT turns a desk-facing camera into a touchpad: hand tracking, thumb click and drag, two-finger scroll, and three- or four-finger shortcuts. Doppel's `/play` life game and dashboard become playable by hand, and documents placed on the desk can be captured by the same camera.

## Level 1: no TKT code changes
TKT already sends OS mouse and keyboard input.
- On the Doppel side, `/play` gets keyboard shortcuts and large targets (planned in `docs/PLAY.md` §11):
  - ←/→: step through moves
  - 1–4: pick a card
  - H: hold
  - Tab: compare lines
- Map TKT's three- and four-finger shortcuts to these keys in TKT's existing shortcut config. Two-finger scroll scrolls the timeline.
- Deliverable: a short `docs/TKT.md` in Doppel with the mapping table and a 30-second demo flow.

## Level 2: a local bridge (TKT PR, needs approval)
- **Event stream.** TKT's `app` layer publishes a versioned JSON event stream on localhost. Use the Python standard library only, e.g. Server-Sent Events over `http.server` / `asyncio`, because TKT's rules forbid new dependencies without approval. Events carry gesture semantics:
  - `scrub_age`
  - `accept_card`
  - `hold`
  - `compare_lines`
  - `capture_document`
- **Doppel side.** Doppel subscribes behind a feature flag and maps events to the same actions as the keyboard. The contract shares its versioning idea with Pocket's planned `TwinCommand` bus.
- **Document capture.** When a still document is on the desk and the hand has left the frame, TKT grabs one frame and hands it to Doppel's snap cascade, through the existing `DocumentSource` idea. The frame stays local: OCR runs in the browser first, as everywhere in Doppel.
- **TKT constraints:**
  - `vision` and `control` never import each other; only `app` combines them;
  - `src/tkt/core/` is off limits;
  - thresholds come from config, but new config keys need approval;
  - tests use `SyntheticSource`, `DryBackend` and recordings.

## Done when
- **Level 1:** the mapping works with TKT's live mode on the demo machine (manual test) and is documented.
- **Level 2:** a TKT PR with the bridge and tests on recorded input, plus a Doppel PR with the feature-flagged subscriber. Both PRs list what couldn't be verified without hardware.
