import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _photoPoolStateForTests,
  _resetPhotoPoolForTests,
  acquireCompressionSlot,
} from '../photo-upload-pool';

describe('photo-upload-pool', () => {
  beforeEach(() => _resetPhotoPoolForTests());
  afterEach(() => _resetPhotoPoolForTests());

  it('grants up to MAX_CONCURRENT slots immediately', async () => {
    const { maxConcurrent } = _photoPoolStateForTests();
    const releases: Array<() => void> = [];
    for (let i = 0; i < maxConcurrent; i++) {
      releases.push(await acquireCompressionSlot());
    }
    expect(_photoPoolStateForTests().active).toBe(maxConcurrent);
    expect(_photoPoolStateForTests().waiting).toBe(0);
    releases.forEach((r) => r());
    expect(_photoPoolStateForTests().active).toBe(0);
  });

  it('queues acquires beyond MAX_CONCURRENT and resolves them on release in FIFO order', async () => {
    const { maxConcurrent } = _photoPoolStateForTests();
    const granted: number[] = [];

    // Saturate the pool
    const initialReleases: Array<() => void> = [];
    for (let i = 0; i < maxConcurrent; i++) {
      const r = await acquireCompressionSlot();
      initialReleases.push(r);
      granted.push(i);
    }

    // Two more requests should queue up
    const queued: Array<Promise<() => void>> = [];
    queued.push(
      acquireCompressionSlot().then((r) => {
        granted.push(maxConcurrent);
        return r;
      })
    );
    queued.push(
      acquireCompressionSlot().then((r) => {
        granted.push(maxConcurrent + 1);
        return r;
      })
    );

    // Yield once so the queued promises register their waiters
    await Promise.resolve();
    await Promise.resolve();

    expect(_photoPoolStateForTests().waiting).toBe(2);
    expect(granted).toEqual([0, 1]); // queued ones haven't fired yet

    // Release one — first queued waiter should fire
    initialReleases[0]();
    const r3 = await queued[0];
    expect(granted).toEqual([0, 1, maxConcurrent]);
    expect(_photoPoolStateForTests().waiting).toBe(1);

    // Release another — second queued waiter fires
    initialReleases[1]();
    const r4 = await queued[1];
    expect(granted).toEqual([0, 1, maxConcurrent, maxConcurrent + 1]);
    expect(_photoPoolStateForTests().waiting).toBe(0);

    r3();
    r4();
    expect(_photoPoolStateForTests().active).toBe(0);
  });

  it('release is idempotent — calling twice does not over-decrement', async () => {
    const r = await acquireCompressionSlot();
    r();
    r(); // second call must be a no-op
    expect(_photoPoolStateForTests().active).toBe(0);

    // Confirm the pool is still healthy after the double-release
    const r2 = await acquireCompressionSlot();
    expect(_photoPoolStateForTests().active).toBe(1);
    r2();
  });

  it('does NOT leak slots when a queued waiter is released without acquiring more', async () => {
    const { maxConcurrent } = _photoPoolStateForTests();
    const initial: Array<() => void> = [];
    for (let i = 0; i < maxConcurrent; i++) {
      initial.push(await acquireCompressionSlot());
    }
    const queuedPromise = acquireCompressionSlot();
    await Promise.resolve();
    expect(_photoPoolStateForTests().waiting).toBe(1);

    // Release one — queued slot is handed off
    initial[0]();
    const queuedRelease = await queuedPromise;
    expect(_photoPoolStateForTests().active).toBe(maxConcurrent);

    // Release everything
    initial[1]();
    queuedRelease();
    expect(_photoPoolStateForTests().active).toBe(0);
    expect(_photoPoolStateForTests().waiting).toBe(0);
  });
});
