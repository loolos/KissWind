# KissWind — Current Game Design (Implementation)

This document describes the **as-built** gameplay, physics, wind model, visuals, and UI. It reflects the code under `src/` at the time of writing.

---

## 1. High-level concept

- **Genre:** Top-down sailing toy: drag to trim the sail, ride global wind and local wind patches, and **maximize distance** in a time limit.
- **Engine:** Phaser 3 (`GameScene`, `BootScene`).
- **Session length:** **180 seconds** per run (`GAME_DURATION` in `GameScene.ts`).
- **Objective:** Travel as far as possible in world space; distance is shown as “meters” using a simple conversion from world units.

---

## 2. Player input

- **Sail trim:** Click/touch and drag relative to the screen center. The sail angle updates by the **angular delta** between pointer-down and current pointer (same as rotating a control around the boat).
- **Boat heading:** Not directly steered by the player. The boat’s **motion direction** follows **velocity** (see Physics).

---

## 3. World and camera

- The boat is drawn near the **center of the screen**; the **world scrolls** around the boat (boat-centered projection).
- World entities (waves, debris, wind zones) use world coordinates; see **`docs/coordinate-system.md`** for the boat-centered map transform and `MAP_ZOOM`.

---

## 4. Physics model (`Physics.ts`)

### 4.1 State

- **Position:** `posX`, `posY` (world).
- **Velocity:** `velX`, `velY` (vector).
- **Acceleration (last frame):** `accX`, `accY` (for debugging / future UI).

There is **no hard speed cap**: speed is limited by **drag balancing thrust**, not by clamping velocity magnitude.

### 4.2 Sail force (thrust vector)

- Wind is a **unit vector** in the direction the wind **blows toward** (`windDir`).
- The sail is a line in the plane; **sail normal** \(\hat{n}\) is perpendicular to the sail (`sailAngle + π/2`).
- **Signed wind projection** on the normal: `windOnNormal = wind · n̂`. This sets both **side** and **magnitude** of the force along the normal.
- **Force vector:**  
  `thrust = n̂ × (windOnNormal × windStrength × 3)`  
  (`multiplier` in `ThrustResult` is kept at **1.0** for force; the `× 3` is a global tuning gain.)

### 4.3 Sail “quality” (green / yellow / gray)

- **Only affects UI feedback** (sail tint and HUD gauge dot color), **not** thrust magnitude.
- Bands are defined by angular distance of the **sail direction** from **`OPTIMAL_ANGLE`** relative to **`windDir`** (see constants in `Physics.ts`):
  - **Green:** within `GREEN_ZONE_HALF_WIDTH` (45° total band around optimal).
  - **Yellow:** between green and `YELLOW_ZONE_OUTER_HALF_WIDTH` (45° band on each side beyond green).
  - **Gray:** outside the yellow band.

### 4.4 Water drag (vector)

- Speed magnitude: `speed = |v|`.
- Drag magnitude: `K1 * speed + K2 * speed²` with **`K1 = 0.1`**, **`K2 = 0.015`**.
- **Drag vector** is **opposite to velocity**:  
  `drag = -(v / |v|) * dragMag` when `|v| > ε`, else zero.

### 4.5 Integration

- `acc = thrust + drag` (component-wise).
- `v += acc * dt`, `pos += v * dt`.

### 4.6 Display heading vs speed

- **Heading** used for drawing the boat is **`atan2(velY, velX)`** when speed is non-zero.
- **Speed** shown in HUD is `|v|`.

---

## 5. Wind system (`Wind.ts`)

### 5.1 Global wind

- **`direction`:** radians, direction wind **blows toward**; slowly drifts.
- **`strength`:** scalar; oscillates toward a sinusoidal target and is clamped to a band scaled by **`BASE_WIND_STRENGTH_MULT` (1.5)**.
- **Direction change rate** is scaled by **`WIND_DIRECTION_CHANGE_MULT` (0.3)** relative to the internal drift target.

### 5.2 Wind zones (local patches)

- Each zone is a **circle** in world space: center `(worldX, worldY)`, radius `radius`, type **`gust`** or **`dead`**.
- **Gust:** `multiplier = 1.5` (stronger local effective wind).
- **Dead (“weak wind”):** `multiplier = 0.3` (weaker local effective wind).
- Spawning is **random** around a reference point (usually the boat); distance and radius are scaled by **`MAP_ZOOM`** (see `mapConfig.ts`, `MAP_ZOOM = 20`).
- Zones far from the boat are removed; the system tries to keep **2–5** active zones.

### 5.3 Effective strength at a point

- Start from global `strength`.
- For each zone whose circle contains the point, **linearly blend** toward `strength × zone.multiplier` from edge to center (`blend = 1 - dist/radius`).
- Zones are applied **sequentially** (overlaps compound).
- Result is floored with `Math.max(0.1, s)`.

This value is **`getStrengthAt(boatX, boatY)`** fed into `computeThrust`.

---

## 6. World rendering (`World.ts`)

- Draws **ocean background**, **wave lines**, **debris**, and **wind zones** (gust vs dead styling) using the boat-centered projection and `MAP_ZOOM`.

---

## 7. Boat visuals (`Boat.ts`)

- **Scale:** `BOAT_VIS_SCALE = 2.1` (visual scale for hull, sails, strokes, wake).
- **Hull:** elongated plan shape; dark blue hull + cream inner deck; **pseudo-3D** projection with **`CAMERA_ELEV = 30°`** (π/6) to foreshorten the deck and lift mast/sail tips.
- **Sails:** Main sail split into two panels + a **smaller opposite-side** panel; **pink stripe** decoration; fill color follows **sail quality** (green/yellow/gray).
- **Wake:** simple line trail behind the boat when speed is above a threshold.

---

## 8. HUD and UI (`GameScene.ts`)

- **Timer:** countdown from 180 s; bottom bar shows remaining fraction.
- **Distance:** accumulated path length in world units × `METERS_PER_UNIT` (2) for display.
- **Speed text:** scalar speed `|v|`.
- **Acceleration text:** time derivative of **speed** (scalar), used as a simple feedback number.
- **Wind compass (top center):** wind direction arrow, wind strength label, boat **velocity** direction arrow.
- **Speed bar (left):** fills relative to **`HUD_SPEED_BAR_REF`** (currently **20**) — **display only** (not a physics cap).
- **Sail hint gauge (bottom center):** enlarged arc showing green/yellow optimal bands vs wind; colored dot = sail quality; **small white dot on arc = wind direction** (not boat velocity).

---

## 9. Boot / title (`BootScene.ts`)

- Title screen with animated waves and a **Set Sail** button starting `GameScene`.
- Instruction text mentions **180 seconds** and basic drag-to-trim.

---

## 10. End of run

- When time runs out, a **game over** overlay shows total distance and a rating tier based on meters; **Sail Again** restarts the scene.

---

## 11. File map (core)

| Area | Main files |
|------|------------|
| Physics | `src/game/Physics.ts` |
| Wind | `src/game/Wind.ts` |
| Map scale | `src/game/mapConfig.ts` |
| World draw | `src/game/World.ts`, `src/game/camera.ts` |
| Boat art | `src/game/Boat.ts` |
| Gameplay scene | `src/scenes/GameScene.ts` |
| Title | `src/scenes/BootScene.ts` |

---

## 12. Design notes

- The model is **arcade-style**, not a full hydrodynamics simulation: sail force is aligned with the **sail normal**, drag opposes **velocity**, and **no rudder** is modeled.
- **Balance** is controlled mainly by `K1`, `K2`, the thrust `× 3` gain, `Wind` strength/zones, and `BASE_WIND_STRENGTH_MULT`.
