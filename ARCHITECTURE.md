# HLL:V Controller Architecture

This controller is designed so new features can be added without every feature managing its own RCON connection, timeout, cache or retry policy.

## Request path

Browser feature -> `public/controller-runtime.js` -> controller HTTP proxy -> HLLV RCON bridge -> pooled RCON connections -> HLL:V server.

## Rules for new frontend features

1. Use normal same-origin `fetch()` calls. Do not open RCON/TCP connections from browser code.
2. Do not add custom infinite retries. The shared runtime already provides request deduplication, cache, bounded queues, stale fallback, timeouts and a circuit breaker.
3. Keep polling feature-local. If a tab/view is not visible, avoid polling it.
4. Prefer existing endpoints over creating a second endpoint for the same data.
5. Commands such as kick, ban, message and map change must remain explicit POST/DELETE operations. Do not automatically replay failed moderation commands.
6. Add new JS/CSS files to `public/index.html`; CI verifies every referenced local asset exists and has valid JavaScript syntax.
7. Keep one feature per JS module where practical. A feature failure should not require editing the core app shell.

## Performance budget

The default bridge uses one command lane and multiple read lanes. `controller-runtime.js` adapts its browser-side read concurrency to the healthy pool size reported by `/api/v2/connection/pool`.

Heavy reads such as logs should be short-lived, deduplicated and performed only while their view is active. The bridge additionally applies bounded lane queues and HTTP admission control, so accidental poll storms fail fast rather than freezing the controller.

## Diagnostics

- `/health` - local Railway/controller health only.
- `/controller/diagnostics` - authenticated controller-to-bridge diagnostic.
- `/api/v2/connection/status` - game RCON connection status.
- `/api/v2/connection/pool` - RCON pool health and lane metrics.
- `/api/v2/resilience/status` - bridge HTTP load-shedding metrics.
- `window.__HLLVControllerRuntime.status()` - browser request coordinator metrics.

## Deployment safety

Both repositories run GitHub validation on every push and pull request. Railway should have **Wait for CI** enabled so a failed validation never replaces the currently working deployment.
