# quickerSTORM — documentation for humans and AI

This folder holds **product context, conventions, planning artifacts, and specs** for quickerSTORM.

| Path (under `docs/`) | Purpose |
| --- | --- |
| **`ROADMAP.md`** | **The planning file — open work only, in 18 bundles + milestones + completion %** |
| **`CHANGELOG.md`** | Shipped work, append-only (never re-read for planning) |
| **`PROJECT_BRIEF.md`** | Living product and technical anchors |
| **`CONVENTIONS.md`** | Style, naming, git, AI workflow |
| **`CODE-STYLE.md`** | Indentation, imports, layout |
| **`CONTEXT.md`** | Stack summary, key composables, coordinate transforms, scope boundaries |
| **`tech-debt.md`** | Known shortcuts to revisit |
| **`debug-state.md`** | Notes on the in-page debug panel state |
| **`superpowers/specs/`** | Canonical product specs — read before implementing |
| **`superpowers/plans/`** | Implementation plans for in-flight feature work |
| **`archive/`** | Frozen pre-2026-07-14 gap docs (old `FEATURE-GAPS*.md` — closed, do not append) |

Repo root keeps **`CLAUDE.md`** (tooling entry point) and **`README.md`** (public status + roadmap).

Removed earlier in development (legacy from a prior product — do not reintroduce):
- `VIDEOCONF_PLAN.md` — video conferencing / calendar feature out of scope
- `SUPABASE_BACKEND_PLAN.md` — no backend database; sim is authoritative
- Third-party auth and collaboration scaffolding
