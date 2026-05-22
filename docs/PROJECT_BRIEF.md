# Project Brief — QuickerStorm

> **Living context document** for goals, constraints, and technical anchors. Update as the product evolves. Include in AI prompts alongside `CONVENTIONS.md` and relevant ADRs.

## Purpose

QuickerStorm is a web-based 3D viewer for Open Simulator and Second Life.  It provides real-time presence awareness, proximity-based voice chat, user messaging, groups, inventory, movement, teleporting, SLURLs, landmarks, etc.

## Target Users

Opensim or SL users who want a lighter experience accessing their grids without needing to do an install.

## Stack & Infrastructure

| Layer | Choice |
| --- | --- |
| Frontend | Vue 3 (Composition API, `<script setup>`), Vite, Pinia, Vue Router |
| 3D Engine | Three.js — scene, avatar meshes, room geometry, door meshes, GSAP tweening |
| Voice | WebRTC (browser native) + Bun WS server for signaling |
| Data | ? |
| Styling | Scoped component CSS + Tailwind utilities; light/dark theming via `useTheme()` |
| Hosting | Vite SPA (static) + **Bun WS server ? ** |

## Key Constraints

- **Hash-based routing** (`createWebHashHistory`) for standalone and potential embedded hosts (see ADR-0001).

## Core Features

1. **3D virtual world viewer** — Three.js 
2. **Real-time presence** — Heartbeat to world sync for instant updates. 
3. **Proximity voice chat** — WebRTC peer connections with VAD talking indicators and mic/speaker device selection.
19. **2D flat view** — Simplified view for low-end devices and mobile, more HTML & buttons, perhaps mini map.

## Out of Scope (unless explicitly added)

- ?

## Success Metrics

- Online users have near parity of abilities with those using the thick clients
- Users see their region, move around, interact with objects and each other, run LSL scripts, teleport, cross regions
- Voice chat connects reliably between peers in the same area

## Glossary

| Term | Meaning |
| --- | --- |

## Related Docs

| Doc | Role |
| --- | --- |
| `../CLAUDE.md` | Setup commands, architecture summary, key files for AI sessions |
| `CONTEXT.md` | Quick AI context, tech stack, important paths, Railway services, presence warning |
| `CONVENTIONS.md` | Style, naming, git, AI workflow hooks |
| `../TODO.md` | Current work checklist |
| `tech-debt.md` | Known shortcuts and fragile areas |
