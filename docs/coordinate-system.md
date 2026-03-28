# Coordinate System Design — KissWind

## 1. Purpose

This document defines a **single world map coordinate system** for all gameplay and rendering. The player’s boat is **fixed at the center of the screen**; every other entity is positioned in **world space** and appears to move **relative to the boat** through a consistent **world → screen** transform.

The goal is to remove ad-hoc mixing of screen pixels, accumulated offsets, and world units, and to make zoom (`MAP_ZOOM_BASE`), spawning, and physics easier to reason about.

---

## 2. Coordinate Spaces

### 2.1 World space `(worldX, worldY)`

- **Units**: Abstract map units (same units as physics position `posX`, `posY`, wind zones, etc.).
- **Origin**: Arbitrary fixed origin on the map (e.g. start position `(0, 0)`).
- **Convention**: `+X` = east (right), `+Y` = south (down), matching current physics heading math (`cos/sin` of heading).

Every **persistent** entity that exists “on the map” should store **world coordinates** only:

| Entity            | World position                          |
|-------------------|-----------------------------------------|
| Boat              | `(boatWorldX, boatWorldY)`              |
| Wind zones        | `(worldX, worldY)` per zone             |
| Debris / props    | `(worldX, worldY)`                      |
| Decorative waves  | Optional: world or shader UV; see §5    |

### 2.2 Screen space `(screenX, screenY)`

- **Units**: Pixels, top-left origin (Phaser default).
- Used for: input pointer positions, HUD layout, text, and the **final** draw position after projection.

### 2.3 Camera model (boat-centered)

The camera is a **rigid translation + scale** that keeps the boat at the viewport center. There is **no** separate “scroll offset” that drifts independently of the boat; the only source of truth for “where we are on the map” is **boat world position**.

---

## 3. Core Transforms

Let:

- `(boatX, boatY)` — boat position in world space (from physics).
- `(W, H)` — viewport width and height in pixels.
- `zoom` — `MAP_ZOOM_BASE` (world units → screen pixels for horizontal/vertical displacement).

### 3.1 World → screen (for any world point)

For a point `(wx, wy)` in world space:

```
screenX = W/2 + (wx - boatX) * zoom
screenY = H/2 + (wy - boatY) * zoom
```

**Interpretation**: `(wx - boatX, wy - boatY)` is the **vector from boat to the entity in world space**. Multiplying by `zoom` converts that displacement to pixels. Adding `(W/2, H/2)` places the boat at the center.

### 3.2 Screen → world (e.g. for future world-space picking)

```
worldX = boatX + (screenX - W/2) / zoom
worldY = boatY + (screenY - H/2) / zoom
```

### 3.3 Boat

The boat is always drawn at **`(W/2, H/2)`** (center). Its **logical** position is `(boatX, boatY)` in world space; no separate “boat screen position” is needed for placement.

---

## 4. Motion and Relative Movement

### 4.1 Principle

If the boat moves by `(ΔboatX, ΔboatY)` in world space per frame, then **without** changing any other entity’s world position, the **screen** projection of those entities updates automatically via §3.1.

Therefore:

- **Do not** maintain a parallel `offsetX` / `offsetY` that duplicates boat motion for zones unless it is strictly identical to `-boatX` / `-boatY` (redundant; prefer removing it).
- **Do not** move decorative objects by subtracting `boatVx * dt` in screen space unless those objects are **pure screen-space effects** (see §5).

### 4.2 Velocities

- Boat velocity `(vx, vy)` in **world units per second** comes from physics (`heading`, `speed`).
- Entities that are **fixed in the world** (debris resting on water) have world velocity `(0, 0)`; their apparent motion is entirely from the camera transform.
- Entities that **drift** with wind or current should have an explicit **world-space velocity** added each frame to their `(worldX, worldY)`, then project with §3.1.

---

## 5. Layers (recommended split)

| Layer        | Coordinate model | Notes |
|-------------|------------------|--------|
| **Gameplay** | World `(x, y)`   | Wind zones, pickups, obstacles, AI. |
| **Boat / HUD** | Screen + angles | Boat sprite at center; HUD uses pixels. |
| **Pure VFX** | Screen or UV     | Full-screen gradient, post-processing; may ignore world if they don’t represent map objects. |

**Decorative waves** today are screen-wrapped streaks. Two consistent options:

1. **World-space waves**: store `(worldX, worldY)`; update with wind as small world deltas; project with §3.1; wrap in a **world** window around the boat (large enough to cover the view).
2. **Screen-space VFX**: keep as non-map eye candy; document that they are **not** `(worldX, worldY)` and must not affect gameplay.

---

## 6. Zoom (`MAP_ZOOM_BASE`)

- `zoom` scales **world displacement** to **pixels**: larger `zoom` = more pixels per world unit (closer “camera”).
- **Radii and distances** in world space should be authored so that `radius * zoom` yields the desired **on-screen** size (or use a single `WORLD_PER_PIXEL = 1/zoom` when defining content).

Gameplay logic (e.g. “inside zone if distance `< radius`”) should use **world-space** `radius` and **world-space** distances only; **never** multiply by `zoom` inside physics queries.

---

## 7. Invariants

1. **Single boat pose**: `(boatX, boatY)` from physics is the only anchor for the map camera.
2. **World positions are authoritative** for all map entities; screen positions are always derived.
3. **Projection is centralized**: one function (e.g. `worldToScreen(wx, wy, boat, zoom, W, H)`) used by `World` drawing, minimaps, and tools.
4. **Wind / physics** use the same world units as positions; `getStrengthAt(worldX, worldY)` uses boat world coordinates for the sample point.

---

## 8. Migration Notes (from current implementation)

Roughly, the codebase today combines:

- Physics **`posX` / `posY`** (world).
- **`World.offsetX` / `offsetY`** updated by `-boatVelocity * dt` (approximate negative integral of motion).
- Wind zones drawn with `(zone.worldX + offsetX) * zoom` (mix of world + offset).
- Debris / wave lines stored as **screen** coordinates updated by velocity (simulates parallax without world positions).

**Target state**:

- Remove reliance on **`offsetX` / `offsetY`** for projection; use **`boatX` / `boatY`** explicitly in §3.1.
- Convert debris (and optionally waves) to **`(worldX, worldY)`** with wrap rules in world space, or clearly label them as screen VFX per §5.
- Pass **`(boatX, boatY)`** into `World.update` / `World.draw` (or read from a shared `GameState`) so the transform is explicit.

---

## 9. Summary

| Concept | Definition |
|--------|------------|
| **World map** | All gameplay entities use `(worldX, worldY)`. |
| **Camera** | Boat at `(boatX, boatY)`; screen center = boat. |
| **Others “move”** | They stay in world space; **relative motion** is `(entityWorld - boatWorld)` before zoom. |
| **Zoom** | Scales world displacement to pixels; physics stays in world units. |

This yields one clear pipeline: **simulate in world → project with boat-centered camera → draw in screen space.**
