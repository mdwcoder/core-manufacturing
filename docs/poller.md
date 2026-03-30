# Poller

## Purpose

`server/poller.js` implements the printer status polling loop. It queries every registered (non-held) printer's PrusaLink API concurrently on a fixed interval, updates the database when status changes, and emits events that the Phase 2 job scheduler will hook into.

## Key File

`server/poller.js` — exports the `PrinterPoller` class.

## Architecture

`PrinterPoller` extends Node.js `EventEmitter`. A single shared instance is created in `server/index.js` after the server starts listening. There is **one timer** for the entire fleet — not one timer per printer.

```
setInterval (15s)
    │
    ▼
 _tick()
    │  loads all non-held printers from DB
    │
    ▼
 Promise.allSettled([
    _pollPrinter(printer1),
    _pollPrinter(printer2),
    ...
    _pollPrinter(printerN),   ← all fire concurrently
 ])
    │
    ▼
 each _pollPrinter():
    ├─ GET http://{ip}/api/v1/status  (timeout: 8s)
    ├─ success → extract printer.state, uppercase
    └─ any error → 'OFFLINE'
    │
    ├─ if status changed → UPDATE printers SET status = ?
    ├─ emit 'statusChange' for any transition
    └─ emit 'printerIdle' when IDLE ← used by Phase 2 scheduler
```

`Promise.allSettled()` is used (not `Promise.all()`) so a rejection from one printer never blocks or kills the loop for others. Each printer's failure is isolated.

## Interval

```js
const POLL_INTERVAL_MS = 15000;
```

The first tick fires immediately on `poller.start()` — the interval begins after that first tick completes. This means printers have a live status within seconds of server boot.

## PrusaLink Status Mapping

The poller reads `response.data.printer.state` from the PrusaLink `/api/v1/status` endpoint and uppercases it. Expected values:

| PrusaLink state | Stored as | Meaning |
|---|---|---|
| `idle` | `IDLE` | Available for next job |
| `printing` | `PRINTING` | Actively printing |
| `finished` | `FINISHED` | Job done, needs clearing |
| `paused` | `PAUSED` | Operator intervention needed |
| `error` | `ERROR` | Fault state |
| `attention` | `ATTENTION` | Needs filament or action |
| *(unreachable)* | `OFFLINE` | Network timeout or refused |

## Events Emitted

Both events are available for the Phase 2 scheduler to `poller.on(...)`.

### `statusChange`

Fired on every status transition (any state → any other state).

```js
poller.on('statusChange', ({ printer, previousStatus, newStatus }) => { ... });
// printer: full row from DB at time of previous poll
// previousStatus: string e.g. 'PRINTING'
// newStatus: string e.g. 'FINISHED'
```

### `printerIdle`

Fired only when a printer transitions *into* `IDLE` from any non-IDLE state. This is the primary hook for Phase 2 dispatch logic.

```js
poller.on('printerIdle', ({ printer }) => { ... });
// printer: DB row with status already updated to 'IDLE'
```

## Held Printers

Printers with `is_held = 1` are excluded from the poll query entirely. They receive no status updates and are never considered for dispatch. A printer can be held/unheld via `PUT /api/printers/:id` with `{ "is_held": 1 }`.

## Timeout

Each individual printer poll has an 8-second axios timeout. If the printer doesn't respond within 8 seconds, it's marked `OFFLINE`. The 15-second interval between ticks means there's always a 7-second buffer between when one tick's slowest poll finishes and the next tick begins — assuming ≤50 printers all timing out simultaneously (worst case: 8s).

## Usage

```js
const PrinterPoller = require('./poller');
const poller = new PrinterPoller(db);
poller.start();   // begins polling immediately
poller.stop();    // clears the interval (for clean shutdown / tests)
```

## Dependencies

| Package | Purpose |
|---|---|
| `axios` | HTTP client for PrusaLink API calls |
| `events` | Node.js built-in `EventEmitter` base class |
