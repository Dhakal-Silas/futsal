# Stickman Futsal 5v5 — PLAN

## Stack
TypeScript + Vite + Canvas 2D, Vitest for tests. No engine, no external assets. Everything
procedural. WebAudio synth for sound. localStorage for persistence.

## Core decisions (and why)
- **World units are meters.** Pitch is 40 x 20 m (futsal), x along the length (-20..20),
  y across (-10..10), z = height. Goals 3 m wide, 2 m high. The camera converts meters to
  the 1280x720 logical canvas. This keeps physics constants physically meaningful.
- **Side-angled top-down rendering.** The pitch is drawn top-down (slightly foreshortened in y),
  stickmen are drawn upright on screen with their feet at the world position. Ball height z is
  drawn as an upward screen offset with a shadow at ground level. Stickman legs/arms animate in a
  local "side plane" oriented along the facing direction and projected to the screen.
- **Sim is pure and deterministic.** `sim/` has no DOM/canvas imports. `Match.step(dt)` advances
  the fixed 60 Hz simulation; every random draw goes through a seeded RNG. Humans and AI both drive
  players through the same `PlayerCommand` struct (move vector, sprint, action + power), so the
  rules code never knows who is in control.
- **One controller per player per tick.** The human controller writes the command for the active
  player; the `ai/` brain writes commands for everyone else (including a human team's teammates).
  Keepers always use the keeper brain.
- **Render interpolation.** Entities store `prev` and `cur` positions; the renderer lerps by the
  accumulator alpha. All timing in sim is in ticks of 1/60 s.
- **Single `config.ts`** for all gameplay constants, `data/difficulty.json` for the AI table,
  `data/teams.json`, `data/formations.json`.

## File layout
```
src/
  main.ts            bootstrap: canvas, loop, screen manager
  config.ts          every gameplay constant
  core/   loop, input (keyboard+gamepad+rebinding), audio (synth), camera, rng, storage, math
  sim/    types, ball, player (movement+actions+anim state), keeper, formation, rules,
          setpieces, penalties, stats, match (state machine)
  ai/     difficulty, steering, evaluate (pure scoring helpers), coordinator (team roles),
          brain (outfield), keeperBrain
  render/ renderer, pitch, stickman (procedural skeleton), ballRender, effects, hud, debug, crest
  ui/     screen manager + screens (title, mode, teamSelect, formation, settings, controls,
          pause, postMatch, draw, bracket, champion), widgets (kb/gamepad navigable menus)
  data/   teams.json, formations.json, difficulty.json
  tournament/ bracket (pure), autosim, tournament (state + save/resume)
tests/    ball, evaluate, bracket, match-smoke (runs full CPU vs CPU matches headless)
```

## Simplifications chosen (spec allowed "pick the simplest fun option")
- No headers, no "star player" selection (spec marked optional).
- Fouls: only slide tackles that hit the player before the ball. Yellow card is visual only.
- Kick-ins/corners/goal clearances: ball is placed, the nearest player of the restart team takes
  it automatically after a short delay (human can pass/shoot from it), opponents are pushed back.
- Penalty shootout: shooter picks aim with move direction and charges power; keeper dives
  probabilistically.
- Group stage is implemented as a toggle; matches of the human team are played, others auto-simmed.
- Replay: a 2 s slow-motion of the last ~2.5 s of recorded entity positions after a goal.

## Milestones
1. Setup, loop, fixed timestep, canvas scaling, input manager, pitch rendering.
2. Ball 2.5D physics, one stickman with smooth run animation, dribbling, shooting.
3. Full 5v5 with formations, active marker, switching, pass/through/cross/shoot/slide, auto keepers.
4. Rules: goals, kick-off, kick-in, corners, goal clearance, fouls, clock, halves, scoreboard.
5. CPU AI with difficulty table; 1P vs CPU; tuning.
6. Local 2P, rebinding, gamepad.
7. Team data, team select, formation select, kits.
8. Tournament: draw, bracket, autosim, ET + penalties, final presentation, champion, save/resume.
9. Polish: blending, camera, particles, sound, slow-mo, stats, settings.
10. Tests, balancing, README, cleanup.
