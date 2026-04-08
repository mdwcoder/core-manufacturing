const Database     = require('better-sqlite3');
const JobScheduler = require('../scheduler');

function makeScheduler() {
  const db = new Database(':memory:');
  // Minimal schema — sweep tests stub _dispatchToPrinter and _waitForBatch
  // so the DB doesn't need real data.
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings (key, value) VALUES ('dispatch_batch_size', '10');
  `);
  return new JobScheduler(db, { on: () => {} });
}

const fakePrinter  = (id, name = `P${id}`) => ({ id, name, model: 'mk4s' });

// ── _isSweeping flag & _pendingPrinters queue ────────────────────────────────

describe('_sweepInBatches — sweep lock', () => {
  test('sets _isSweeping true for the duration of the sweep', async () => {
    const scheduler = makeScheduler();
    const states = [];

    scheduler._dispatchToPrinter = jest.fn(() => {
      states.push(scheduler._isSweeping);
      return Promise.resolve(null);
    });
    scheduler._waitForBatch = jest.fn().mockResolvedValue();

    await scheduler._sweepInBatches([fakePrinter(1)]);

    expect(states).toEqual([true]);           // true while dispatching
    expect(scheduler._isSweeping).toBe(false); // false after sweep completes
  });

  test('_isSweeping is false after sweep completes normally', async () => {
    const scheduler = makeScheduler();
    scheduler._dispatchToPrinter = jest.fn().mockResolvedValue(null);
    scheduler._waitForBatch = jest.fn().mockResolvedValue();

    await scheduler._sweepInBatches([fakePrinter(1)]);

    expect(scheduler._isSweeping).toBe(false);
  });

  test('_isSweeping is false even when _dispatchToPrinter throws', async () => {
    const scheduler = makeScheduler();
    scheduler._dispatchToPrinter = jest.fn().mockRejectedValue(new Error('boom'));
    scheduler._waitForBatch = jest.fn().mockResolvedValue();

    // Errors in individual dispatches are caught inside _sweepInBatches
    await scheduler._sweepInBatches([fakePrinter(1)]);

    expect(scheduler._isSweeping).toBe(false);
  });

  test('concurrent _sweepInBatches call defers printers to _pendingPrinters', async () => {
    const scheduler = makeScheduler();

    // Hold P1 until we've injected P2
    let releaseP1;
    const p1Gate = new Promise(r => { releaseP1 = r; });

    scheduler._dispatchToPrinter = jest.fn((printer) => {
      if (printer.id === 1) return p1Gate.then(() => null);
      return Promise.resolve(null);
    });
    scheduler._waitForBatch = jest.fn().mockResolvedValue();

    const sweepPromise = scheduler._sweepInBatches([fakePrinter(1)]);

    // Sweep is now in progress (awaiting P1) — a second call should defer P2
    scheduler._sweepInBatches([fakePrinter(2)]);

    expect(scheduler._pendingPrinters).toHaveLength(1);
    expect(scheduler._pendingPrinters[0].id).toBe(2);

    releaseP1();
    await sweepPromise;
  });

  test('deferred printers are dispatched after the main sweep completes', async () => {
    const scheduler = makeScheduler();
    const dispatched = [];

    let releaseP1;
    const p1Gate = new Promise(r => { releaseP1 = r; });

    scheduler._dispatchToPrinter = jest.fn((printer) => {
      dispatched.push(printer.id);
      if (printer.id === 1) return p1Gate.then(() => null);
      return Promise.resolve(null);
    });
    scheduler._waitForBatch = jest.fn().mockResolvedValue();

    const sweepPromise = scheduler._sweepInBatches([fakePrinter(1)]);

    // Defer P2 mid-sweep
    scheduler._sweepInBatches([fakePrinter(2)]);

    releaseP1();
    await sweepPromise;

    expect(dispatched).toEqual([1, 2]);
    expect(scheduler._isSweeping).toBe(false);
    expect(scheduler._pendingPrinters).toHaveLength(0);
  });

  test('multiple deferred printers are all dispatched at the tail', async () => {
    const scheduler = makeScheduler();
    const dispatched = [];

    let releaseP1;
    const p1Gate = new Promise(r => { releaseP1 = r; });

    scheduler._dispatchToPrinter = jest.fn((printer) => {
      dispatched.push(printer.id);
      if (printer.id === 1) return p1Gate.then(() => null);
      return Promise.resolve(null);
    });
    scheduler._waitForBatch = jest.fn().mockResolvedValue();

    const sweepPromise = scheduler._sweepInBatches([fakePrinter(1)]);

    // Defer P2 and P3 via separate calls mid-sweep
    scheduler._sweepInBatches([fakePrinter(2)]);
    scheduler._sweepInBatches([fakePrinter(3)]);

    releaseP1();
    await sweepPromise;

    expect(dispatched).toEqual([1, 2, 3]);
  });

  test('_pendingPrinters is empty after sweep drains them', async () => {
    const scheduler = makeScheduler();

    let releaseP1;
    const p1Gate = new Promise(r => { releaseP1 = r; });

    scheduler._dispatchToPrinter = jest.fn((printer) => {
      if (printer.id === 1) return p1Gate.then(() => null);
      return Promise.resolve(null);
    });
    scheduler._waitForBatch = jest.fn().mockResolvedValue();

    const sweepPromise = scheduler._sweepInBatches([fakePrinter(1)]);
    scheduler._sweepInBatches([fakePrinter(2)]);

    releaseP1();
    await sweepPromise;

    expect(scheduler._pendingPrinters).toHaveLength(0);
  });
});

// ── scheduleForPrinter ────────────────────────────────────────────────────────

describe('scheduleForPrinter', () => {
  test('dispatches immediately when no sweep is running', () => {
    const scheduler = makeScheduler();
    scheduler._dispatchToPrinter = jest.fn().mockResolvedValue(1);

    scheduler.scheduleForPrinter(fakePrinter(1));

    expect(scheduler._dispatchToPrinter).toHaveBeenCalledWith(fakePrinter(1));
    expect(scheduler._pendingPrinters).toHaveLength(0);
  });

  test('defers to _pendingPrinters when a sweep is in progress', () => {
    const scheduler = makeScheduler();
    scheduler._isSweeping = true;
    scheduler._dispatchToPrinter = jest.fn();

    scheduler.scheduleForPrinter(fakePrinter(1));

    expect(scheduler._dispatchToPrinter).not.toHaveBeenCalled();
    expect(scheduler._pendingPrinters).toHaveLength(1);
    expect(scheduler._pendingPrinters[0].id).toBe(1);
  });

  test('deferred printer is dispatched when the sweep later completes', async () => {
    const scheduler = makeScheduler();
    const dispatched = [];

    let releaseP1;
    const p1Gate = new Promise(r => { releaseP1 = r; });

    scheduler._dispatchToPrinter = jest.fn((printer) => {
      dispatched.push(printer.id);
      if (printer.id === 1) return p1Gate.then(() => null);
      return Promise.resolve(null);
    });
    scheduler._waitForBatch = jest.fn().mockResolvedValue();

    const sweepPromise = scheduler._sweepInBatches([fakePrinter(1)]);

    // Single set-ready mid-sweep — should be deferred
    scheduler.scheduleForPrinter(fakePrinter(2));

    releaseP1();
    await sweepPromise;

    expect(dispatched).toContain(2);
    expect(scheduler._isSweeping).toBe(false);
  });

  test('multiple scheduleForPrinter calls during a sweep all get deferred', async () => {
    const scheduler = makeScheduler();
    const dispatched = [];

    let releaseP1;
    const p1Gate = new Promise(r => { releaseP1 = r; });

    scheduler._dispatchToPrinter = jest.fn((printer) => {
      dispatched.push(printer.id);
      if (printer.id === 1) return p1Gate.then(() => null);
      return Promise.resolve(null);
    });
    scheduler._waitForBatch = jest.fn().mockResolvedValue();

    const sweepPromise = scheduler._sweepInBatches([fakePrinter(1)]);

    scheduler.scheduleForPrinter(fakePrinter(2));
    scheduler.scheduleForPrinter(fakePrinter(3));
    scheduler.scheduleForPrinter(fakePrinter(4));

    expect(scheduler._pendingPrinters).toHaveLength(3);

    releaseP1();
    await sweepPromise;

    expect(dispatched).toEqual([1, 2, 3, 4]);
  });
});
