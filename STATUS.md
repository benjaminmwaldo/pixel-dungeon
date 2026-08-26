# Status — The Sunken Crypt

**As of 2026-08-26: playable and complete, start to finish.**

Built in one session: a real-time 1–4 player Zelda-1-style dungeon crawler,
zero dependencies, all art and music original.

## What works (verified)

- **Server-authoritative multiplayer** at 30 Hz over a from-scratch WebSocket
  implementation. Party codes, up to 4 heroes, lobby with ready-up, live join,
  clean disconnect. Verified by `scripts/net-test.js` (14 checks).
- **Client prediction + reconciliation** for the local hero, entity
  interpolation for everyone else. ~220-byte snapshots.
- **Per-player cameras** — heroes in different rooms each see their own room;
  the minimap shows where everyone is.
- **The full dungeon**: 20 hand-built rooms, 2 key doors, 1 skull door, 1
  bombable wall, 1 push-block secret, 8 enemy types, a boss, and a win screen.
- **Combat**: sword with a full-hearts beam, bombs, boomerang, knockback,
  mercy frames, armoured enemies that must be flanked, room-clear shutters.
- **Co-op down/revive**, shared party inventory, private hearts.
- **All art hand-authored** — 80 sprites + an 8×8 font, validated by
  `scripts/validate-art.js`.
- **Original chip audio** — dungeon and boss loops plus ~30 effects.

## Notes for future work

- Difficulty is faithful to the original, which means unforgiving: 3 hearts at
  the start and enemies that converge. Worth playtesting with real people
  before tuning.
- Only one dungeon level exists. `shared/dungeon.js` is pure data — a second
  level is a new ASCII room list and a new `LINKS` array, nothing else.
- No persistence: closing the tab ends the run. A save would mean serialising
  `Game.party` + per-room `opened/cleared/itemTaken` flags.
- The `--dev` capture endpoint is for art review only; leave it off in any
  public deployment.

## Bugs found and fixed along the way

- The RFC 6455 magic GUID was wrong from memory (`…-5AB0DC85B11F` instead of
  `…-C5AB0DC85B11`), so browsers refused every handshake. Recovered the real
  one out of the Node binary with `grep -a`.
- The server sampled only the newest input frame, so a one-tick sword press
  could be dropped entirely. It now queues input frames.
- Prediction replay did not restore per-frame button state, so replayed
  attacks were swallowed by edge detection.
- Bombs damaged the hero who set them; in the original they never do.
