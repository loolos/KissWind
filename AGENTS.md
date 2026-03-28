# AGENTS.md

## Cursor Cloud specific instructions

**KissWind** is a client-side-only browser sailing game (TypeScript + Vite + Phaser 3). There is no backend, database, or external service — the entire product is a static web app.

### Key commands

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Dev server | `npm run dev` (Vite, port 5173) |
| Type-check | `npx tsc --noEmit` |
| Production build | `npm run build` (runs `tsc && vite build`, output in `dist/`) |
| Preview build | `npm run preview` |

### Notes

- No linter is configured in the project; `tsc --noEmit` is the primary static-analysis check.
- No automated test framework is set up; manual browser testing is the only verification method.
- To expose the dev server for browser testing inside the VM, use `npm run dev -- --host 0.0.0.0`.
- The game requires a WebGL-capable browser (Chrome works). After loading `localhost:5173`, click "SET SAIL!" to enter gameplay and drag to control the sail angle.
