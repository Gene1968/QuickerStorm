# quickerSTORM

## A web-based 3D viewer for Open Simulator and Second Life

Testing with OSGrid so far, but all the usual grids are listed for near-future testing.



## Tech stack

- **Vue 3** (Composition API), **Vite**, **Pinia**, **Vue Router**
- **Three.js** — 3D scene, avatar meshes, room navigation, theme-aware materials
- **Bun WebSocket server** — real-time presence, pose sync, chat relay, WebRTC signaling (`server/`)
- **WebRTC** — proximity voice chat; peer connections brokered by the WS server
- **Tailwind CSS** + **Bootstrap 5**


## Getting started with building:

### 1. Install dependencies

```sh
npm install
```


1. Vite server (port 517x): `npm run dev`

2. Bun server runs on port 8787 — open a second terminal and run `npm run dev:server`







## Documentation

See `docs/README.md` for the full documentation tree, including `docs/PROJECT_BRIEF.md`, `docs/CONVENTIONS.md`, and `docs/CONTEXT.md`.
