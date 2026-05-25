# Tech Debt Log — quickerSTORM

> Shortcuts and known issues to revisit. Add rows as they appear; review during planning.

| ID | Description | Introduced | Why Accepted | Priority | Effort |
| --- | --- | --- | --- | --- | --- |
| orphaned-ptt-events | Orphaned `ava-ptt-start/stop` event dispatches in useOfficeEngine.js | 2026-05-24 | Legacy file; dispatches removed from listener but still fire into void | low | 1h |

## Orphaned `ava-ptt-start/stop` event dispatches in useOfficeEngine.js

`useOfficeEngine.js` dispatches `ava-ptt-start` and `ava-ptt-stop` window events (lines ~6933, ~6978). The listener in `ProximityVoiceBar.vue` was removed as part of the audio controls redesign (2026-05-24). These dispatches now fire into the void. When `useOfficeEngine.js` is eventually replaced by `useWorldEngine.js`, these dispatches should not be carried over.
