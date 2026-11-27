# SKYHARBOR — Kestrel 07

A flight sortie game for the make.fun "Make the best flight game" bounty.

Take off from the city airport runway (RWY 18) in the Kestrel 07, thread six
glowing gates in order around the harbour city — over its rooftops, the
downtown towers and the bays — then bring her home and land back on the same
strip. Your touchdown is graded: sink rate, touchdown speed and centreline
decide the landing bonus on the debrief card.

## Play

Open `game/index.html` in desktop Chrome (or run `node serve.ts` and visit
http://localhost:8080). No network requests; everything is vendored locally.

- **W / S** pitch (tap to set the nose; it stays where you put it)
- **A / D** bank and turn
- **Shift / Ctrl** throttle up / down
- **G** landing gear, **F** flaps, **B** wheel brake, **Space** air brake
- **Mouse** hold and drag = yoke
- **P** pause, **R** restart, **H** flight manual / briefing

## What's simulated

- Takeoff roll, rotation speed, lift and flap-dependent stall (44–50 kt)
- Gear and flap drag, air brake, G-load in banked turns, fuel burn
- Terrain collision, ditching, hard-landing airframe damage
- Gate capture only in order, scored with a centre bonus per ring
- Landing grades from *Butter* to *Teeth-Rattler*, with a full debrief card
- Synthesised engine, wind, gate chimes and a soft golden-hour music loop (WebAudio, no files)

## Layout

- `main.ts` — hand-in program: copies `game/` and `screenshots/` to the output
  directory and writes the dossier with `vendor/makefun-game.ts`
- `game/` — the static game (Three.js vendored as `game/vendor/three.min.js`)
- `screenshots/` — real renders of the game running in Chrome
