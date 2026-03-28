# KissWind

**KissWind** is a lightweight browser sailing game: you steer only the **sail**, while wind and water resistance shape how fast you go. The goal is intuitive one-gesture play with room to improve—finding the right angle as the wind moves.

> Align your sail with the wind to build speed — the sweet spot is not always obvious.

## Play

- **[Play in your browser](https://loolos.github.io/KissWind/)** — no install; works on desktop and mobile.

## What you do

- **Drag** (mouse or touch) to set the sail angle.
- **Wind** pushes the boat through thrust along your heading; **drag** slows you down, so speed builds and falls smoothly instead of snapping to a fixed “efficiency number.”
- Watch the **wind indicator** and **sail feedback** (green / yellow / gray) to stay near the **sweet spot** for stronger acceleration and a livelier wake; bad angles can leave you sluggish.
- A slow-changing **water current** also affects your ground track, so matching sail to wind is only part of high-speed runs.
- The **camera stays on the boat** while the open sea scrolls beneath you—waves and occasional floating props help you feel motion and direction.
- You can adjust map zoom during play (mouse wheel or touch pinch) to read nearby wind zones more easily.

## Game loop

1. Read the wind (and any gust or calm zones, when present).
2. Trim the sail.
3. Hold a good line through shifts to carry speed.
4. In time trial, **score is distance traveled** before the timer hits zero.

## Modes (roadmap)

- **Time trial** (MVP focus): go as far as you can in a time limit with changing wind.
- **Challenge** and **daily runs** are possible later; see the design doc for full scope.

## Tech & repo

- Built with **TypeScript**, **Vite**, and **Phaser 3**; movement uses a small custom thrust-and-drag model rather than a full physics engine.
- **Design & detailed spec:** [docs/design.md](docs/design.md)

---

**Documentation language:** all project docs in this repository are written in **English**. The game is under active development; behavior and features may change.
