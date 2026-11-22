# Task E: hand control (`tkt/`) and Doppel

**Owner:** Oktay. **Start:** after `/play` lands. **Area:** `tkt/`.
Read `AGENTS.md`, `tkt/AGENTS.md`, `tkt/README.md` and `tkt/docs/plan/*` first.

## Idea
"Your financial twin on the desk." The hand control turns a desk-facing camera into a touchpad: hand tracking, thumb click and drag, two-finger scroll, and three- or four-finger shortcuts. Doppel's `/play` life game and dashboard become playable by hand, and documents placed on the desk can be captured by the same camera.

## Level 0 (done): play by hand
The hand control drives the OS mouse and keyboard, so pointer, thumb click and two-finger scroll already control Doppel in the browser: tap a ringed piece, pick a decision, scroll to the review. `scripts/demo-with-tkt.ps1` / `.sh` start both; `docs/TKT.md` has the mapping and a 30-second demo.

## Level 1 (next): gestures as Doppel shortcuts
- `/play` already has the keys: ←/→ step through moves, 1–4 pick a card, H hold, Tab compare lines.
- Swipes are wired to OS actions today (`desktop_left`, `desktop_right`, `mission_control` in `src/tkt/control/gestures.py`). Sending ←/→/Tab while the Doppel window is in front needs a mapping in the `app`/`control` layer and new config keys (approval per `tkt/AGENTS.md`).
- Deliverable: the mapping, and the table in `docs/TKT.md` updated with the final gesture names.

## Level 2 (later): a local bridge
- **Event stream.** The hand control's `app` layer publishes a versioned JSON event stream on localhost. Use the Python standard library only, e.g. Server-Sent Events over `http.server` / `asyncio`, because `tkt/AGENTS.md` forbids new dependencies without approval. Events carry gesture semantics:
  - `scrub_age`
  - `accept_card`
  - `hold`
  - `compare_lines`
  - `capture_document`
- **Doppel side.** Doppel subscribes behind a feature flag and maps events to the same actions as the keyboard. The contract shares its versioning idea with Pocket's planned `TwinCommand` bus.
- **Document capture.** When a still document is on the desk and the hand has left the frame, the hand control grabs one frame and hands it to Doppel's snap cascade, through the existing `DocumentSource` idea. The frame stays local: OCR runs in the browser first, as everywhere in Doppel.
- **Constraints (`tkt/AGENTS.md`):**
  - `vision` and `control` never import each other; only `app` combines them;
  - `src/tkt/core/` is off limits;
  - thresholds come from config, but new config keys need approval;
  - tests use `SyntheticSource`, `DryBackend` and recordings.

## Done when
- **Level 1:** the mapping works in live mode on the demo machine (manual test) and is documented.
- **Level 2:** the bridge with tests on recorded input, and the feature-flagged subscriber in Doppel. Both list what couldn't be verified without hardware.
