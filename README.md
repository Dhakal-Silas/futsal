# Stickman Futsal 5v5

A complete 5v5 futsal game with procedurally drawn stickmen, playable in the browser.
TypeScript + Vite + Canvas 2D, no game engine, no external art or audio assets.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
npm test         # unit tests (ball physics, AI helpers, bracket logic, full headless matches)
```

## Modes

- **Quick Match** – 1 player vs CPU (Easy / Medium / Hard / Legend).
- **Local 2 Players** – two humans on one keyboard or two gamepads.
- **Champions Cup** – 16-team knockout (Round of 16 → Quarter-finals → Semi-finals → FINAL),
  optional group stage first (4 groups of 4, top 2 qualify for the quarter-finals), optional
  *Clásico mode* that keeps Real Madrid and FC Barcelona apart until the final. Matches that do
  not involve you are auto-simulated from team ratings. Progress is saved after every match and
  can be resumed from the tournament menu. Draws are settled by extra time and penalties.
- **CPU vs CPU** – spectate the AI (also runs behind the title screen).

## Controls

| Action | Player 1 | Player 2 | Gamepad |
| --- | --- | --- | --- |
| Move | W A S D | Arrow keys | Left stick / D-pad |
| Pass (hold for power) / Press when defending | J | Numpad 1 or `,` | A / Cross |
| Through pass | K | Numpad 2 or `.` | B / Circle |
| Shoot (hold to charge) / Contain when defending | L | Numpad 3 or `/` | X / Square |
| Cross / lob | I | Numpad 5 or `;` | Y / Triangle |
| Slide tackle | U | Numpad 0 or `'` | RB |
| Sprint | Left Shift | Right Shift | RT or LB |
| Switch player | Space | Enter | LT |
| Pause | Esc or P | Esc or P | Start |

Keys can be rebound from the Controls screen (saved to localStorage).
`M` toggles mute, `F3` toggles the debug overlay (FPS, AI roles, ball speed, formation anchors).

Goalkeepers are automatic for both teams. When your team has the ball you control the ball
carrier; control follows the ball to the receiver as soon as a pass is released. When defending
you control the defender nearest to the ball (Space switches manually). A triangle marker and a
ring show the active player, a dashed line shows who will receive the next pass, and a bar near
the player shows shot/pass power while charging.

Penalty shootout: the shooter aims with the move keys (left/right across the goal, up/down for
height), holds Shoot to charge and releases to kick.

## Rules implemented

Kick-off, kick-ins, corners, goal clearances, free kicks for slide-tackle fouls (with visual
yellow cards), two halves with a configurable length (1/2/3/5 minutes), extra time (2 × 1 min)
and penalties in knockout matches. No walls, no offside. The clock stops at dead balls.

## Architecture

```
src/
  config.ts          every gameplay constant
  core/              loop (fixed 60 Hz + render interpolation), input (keyboard/gamepad/rebinding),
                     audio (WebAudio synth), camera, seeded RNG, storage, canvas scaling
  sim/               pure deterministic simulation: ball (2.5D), player movement/actions,
                     possession, kicks, formations, match rules + phases, penalties
  ai/                difficulty table, steering, pure scoring helpers, team coordinator,
                     outfield brain, keeper brain
  render/            pitch, procedural stickman skeleton, ball, effects, HUD, crests
  ui/                screens (title, menus, team/formation select, controls, pause, post-match,
                     tournament draw/bracket/champion)
  game/              match session (sim + controllers + camera + presentation), settings
  tournament/        bracket + group logic, auto-sim, state with save/resume
  data/              teams.json, formations.json, difficulty.json
tests/               vitest unit + headless full-match tests
```

The simulation never touches the DOM. Humans and AI both drive players through the same
`PlayerCommand` structure, and every random draw uses a seeded RNG, so a match is
deterministic given the seed and the inputs.

Dev shortcuts: `?quick` boots straight into a match, add `&demo` for CPU vs CPU, `&ko` for a
knockout match, `&half=0.1` for very short halves, `&pens` to start in a penalty shootout.

## Notes

Club names and kit colours are used for recognisability only. Crests are procedural coloured
placeholders; no official logos or copyrighted assets are included.
