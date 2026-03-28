# KissWind (Working Title)

All documentation in this repository is written in **English**.

## Overview

KissWind is a lightweight browser-based sailing game where players control a boat by adjusting the sail angle to harness wind (and optionally currents in later versions). The gameplay focuses on intuitive control, immediate feedback, and hidden depth through vector-based movement.

The core experience is simple:

> Align your sail with the wind to maximize speed — but the optimal angle is not always obvious.

---

## Core Gameplay

### 1. Core Mechanic

The player controls **only the sail angle**.

- Drag (mouse or touch) to rotate the sail
- The boat’s **heading** may follow simple rules (e.g. slowly bias toward a favorable direction); **rotational inertia is out of scope for MVP** (see Movement Model)
- **Thrust and speed** come from wind and sail interaction, plus water resistance — not from a single “efficiency × wind = speed” shortcut

---

### 2. Movement Model (MVP: Simplified)

Motion uses a small set of symbols:

- `H` — unit vector, **boat heading** (bow direction)
- `v` — scalar **speed** along heading (`v ≥ 0`)
- **Velocity**: `v_vec = v * H` (velocity is always **parallel to the heading**)
- Wind: direction vector and **wind strength**; sail angle (or sail normal vs wind) sets how much **thrust along `H`** you get
- **Angular velocity**: **not modeled** in MVP (no rudder/inertia steering equations). How `H` changes over time is a separate, simple rule (e.g. input or autopilot), not part of `F = ma` for rotation

#### Key Idea

**Wind strength and sail angle determine acceleration along the heading**, not an instantaneous speed. **Water drag** opposes motion. Speed is integrated from acceleration.

#### Thrust and Drag (illustrative)

Thrust acceleration along the heading comes from wind + sail geometry (exact curve TBD). Drag acts opposite to motion; because `v_vec ∥ H`, drag acceleration is along `-H`, typically increasing with speed:

```text
a_drag = -k1 * v - k2 * v^2   (k1, k2 tunable)
a_total = a_wind_sail + a_drag   (+ optional current term later)
```

Each step:

```text
v += a_total * deltaTime
position += v_vec * deltaTime
```

**Implementation note:** Thrust can be computed as “force along `H` only” or as a wind force vector projected onto `H`; they coincide for pure headway. Document the chosen path when implementing.

---

### 3. Sweet Spot System

To keep the game intuitive and skill-based:

- There is a **“sweet spot”** sail angle range
- **Stacking rule (MVP):** Base **thrust / acceleration along `H`** comes from the wind–sail model above; the sweet spot **modifies** that thrust (or its cap), e.g. multiplier or bonus acceleration — **not** a separate unrelated “cos = speed” layer. UI can still show green/yellow/red for feedback
- Inside the range: noticeably stronger acceleration (or higher effective cap), stronger wake, green sail highlight
- Outside: weaker thrust, possible **stall** at extreme angles, red/yellow feedback

---

### 4. Wind System

- Wind direction shifts slightly over time
- Optional zones:
  - **Gusts** (temporary boost to wind strength / thrust)
  - **Dead zones** (weak wind)

Players keep adjusting the sail as conditions change.

---

### 5. Core Gameplay Loop

1. Read wind (and zones)
2. Adjust sail angle
3. Stay in or near the sweet spot to build speed
4. Choose whether to chase gusts or hold a line

---

### 6. Game Modes

#### Time Trial (Primary Mode)

- Travel as far as possible within a **time limit**
- Dynamic wind
- **Score = distance traveled** (see Scoring & Rules)

#### Challenge Mode

- Reach a goal under constrained wind (puzzle-like routing)

#### Daily Challenge (Optional Future)

- Fixed wind seed, leaderboard

---

### 7. Skill Depth

- Predicting wind shifts
- Holding optimal sail alignment
- Routing through gust/dead zones
- Combos for sustained perfect alignment (optional)

---

## Scoring & Time Trial Rules (MVP)

- **Timer reaches zero → run ends** (no overtime unless explicitly added later)
- **Distance**: accumulate **path length** along the boat’s motion — i.e. sum of `|v_vec| * dt` (or equivalent discrete step length). No separate “projection to a finish line” unless a challenge mode defines a goal vector
- **Lives / respawn**: **single continuous run** for MVP — no respawn mid-run; optional later
- HUD should show at least **remaining time** and **distance / score**

---

## World, Water & Camera

- **Open ocean**: no shore/islands in MVP; **logical world** can be unbounded (large coordinates) or softly bounded — **no hard “map edge” gameplay** required for the first ship-in-open-water slice
- **Water surface**: visible **waves** (animated/shaded; no need for physical wave simulation)
- **Floating debris** (wood, seaweed, buoys, etc.): **spawn occasionally** as **visual reference** — together with waves they sell **relative motion** so players sense **which way the boat is moving**, especially with the boat fixed in the center of the screen
- **Camera**: **boat stays locked to the screen center**; the **world scrolls** under the camera. **No off-center lookahead** in MVP (would conflict with the center-lock spec)

**MVP note:** Flotsam is **non-colliding decoration** unless a future mode adds hazards; avoids fighting the “sail only” control fantasy.

---

## Display & Layout (Multi-Screen & Mobile)

**Requirement:** Playable and readable from **small phones to large desktops**; **portrait and landscape** are both first-class; **touch is as important as mouse**.

- **Canvas scaling:** Use Phaser 3 **Scale Manager** (e.g. `FIT` / `RESIZE` + centering, or project-chosen letterboxing). Pick a **design aspect baseline** (e.g. 16:9 logical game area) and accept **letterboxing or mild crop** — HUD must not only work in one aspect ratio
- **Orientation:** On rotate or window **resize**, **re-layout HUD** (timer, distance, wind indicator, sail touch area). No controls clipped or stacked unusably
- **Mobile:**
  - Respect **safe areas** (`safe-area-inset`: notch, home indicator)
  - **Touch targets** ≥ ~44×44 CSS px (or equivalent in game UI units)
  - Account for **browser chrome** (e.g. iOS Safari URL bar changing visible height); don’t assume a fixed pixel viewport height for “critical” layout
- **Desktop:** Same scaling when resizing or fullscreen; drag-to-adjust-sail mirrors touch drag

Game world uses a fixed **logical coordinate system**; **screen HUD** uses anchors / percentages / safe margins.

---

## Controls

### Input

- **Mouse / touch drag** → sail angle

### Design Goals

- One-handed play on phone
- Feedback within about a second of input
- No complex combos

---

## Visual Feedback

- Wind direction indicator (on-screen arrow)
- Sail color: green / yellow / red (pair with icons or patterns for colorblind users — see Accessibility)
- Speed: wake intensity; optional subtle screen shake at high speed (toggle — see Accessibility)

---

## Audio (MVP Intent)

- Ambient **water** loop
- Short cues for **wind shifts** or entering gust/dead zones (if distinct)
- **Sweet spot / stall** stingers (lightweight)
- Optional low-footprint **BGM**
- Player-facing **mute** and **SFX-only** where applicable

---

## Accessibility

- **Colorblind:** Don’t rely on hue alone for sail state — add **icons, patterns, or labels**
- **Motion:** Option to **reduce or disable** screen shake and heavy camera motion
- **Touch:** Large enough drag region for sail; avoid tiny HUD hit targets

---

## Tech Stack (Recommended)

### Core stack (one line)

**TypeScript + Vite + Phaser 3**; **custom** acceleration/drag loop (no full physics engine); **HUD** via DOM/CSS or Phaser UI — add **lightweight React** only for menus if complexity grows (keep the main loop out of heavy React state).

### Frontend

- **Language:** TypeScript
- **Build:** Vite
- **Game:** Phaser 3 (WebGL)
- **UI:** HTML/CSS or Phaser UI; React optional for shell menus only

### Why Phaser (vs alternatives)

| Option | Fits KissWind |
|--------|----------------|
| **Phaser 3** | Strong default: scenes, input, loader, audio, scale — **fast MVP** |
| **PixiJS + custom loop** | More rendering control, **more** engine glue to write |
| **Excalibur.js** | Nice patterns; **smaller** ecosystem than Phaser |
| **Kaboom** | Great for tiny jams; **weaker** for longer maintenance |

### Physics & Code Organization

- No Box2D-style engine; **pure functions** for wind/thrust/drag help **unit tests** (e.g. Vitest)
- Optional: **ESLint + Prettier**, **CI** build on push (GitHub Actions or similar)

### Deployment

**Static hosting:** Cloudflare Pages / Vercel / Netlify — **no backend for MVP**.

### Optional Future Services

- **Leaderboards:** Supabase / Firebase
- **Analytics:** PostHog / Plausible
- **PWA** installability

---

### Design Philosophy

- Simple input, deep mastery
- Physics-inspired, not simulation-grade
- Immediate feedback
- Short sessions, high replay value

---

## MVP Scope

### In scope

- One boat, **open water** map
- Dynamic wind (+ optional gust/dead zones)
- Sail-only control; movement model above (accel + drag, `v ∥ H`, no angular dynamics)
- **Time trial** with timer + distance score
- **Center camera**, waves + occasional floating props
- **Responsive** layout; portrait + landscape; mobile-safe HUD

### Out of scope (initially)

- Heavy simulation, multiplayer, many ship types, heavy 3D art

---

## Future Expansion (Phased)

**Lower cost / higher leverage**

- Daily run with **seeded wind** + local/cloud **leaderboard**
- **Replay / share seed** (“ghost” optional)
- Light **meta**: achievements, cosmetics

**Medium**

- Challenge **levels** or authored wind puzzles
- **Islands / obstacles** and wind shadows (2D colliders)

**Higher cost**

- **Realtime multiplayer** (rooms, sync, anti-cheat)
- Seasonal monetization / cosmetics (product/legal separate from core design)

**Platform:** PWA already listed; **desktop wrapper** (Tauri/Electron) possible later without changing the web-first stack.

---

## Summary

KissWind is a **thrust-and-drag sailing toy**: wind and sail drive **acceleration**, water **slows** you, and the **world moves** while the boat stays **center stage** — readable on **any screen** and **orientation**.

Core fun:

- Finding the right sail angle
- Riding changing wind
- Staying in flow

Goal: **easy to learn, hard to master**, ideal for short web sessions.
