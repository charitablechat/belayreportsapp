/**
 * Regression: withInspectionPushLock must serialize remote pushes for the
 * same inspection id, release on success and failure, and never block
 * pushes for a different inspection id.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  withInspectionPushLock,
  __resetInspectionPushLocksForTests,
} from "@/lib/form-savers/inspection-push-mutex";

beforeEach(() => {
  __resetInspectionPushLocksForTests();
});

describe("withInspectionPushLock", () => {
  it("E1: serializes overlapping calls for the same inspection id", async () => {
    const events: string[] = [];
    const id = "ins-A";

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => { releaseFirst = r; });

    const p1 = withInspectionPushLock(id, async () => {
      events.push("1:start");
      await firstGate;
      events.push("1:end");
    });
    const p2 = withInspectionPushLock(id, async () => {
      events.push("2:start");
      events.push("2:end");
    });

    // Give microtasks a chance to settle — p2 must NOT have started yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["1:start"]);

    releaseFirst();
    await Promise.all([p1, p2]);
    expect(events).toEqual(["1:start", "1:end", "2:start", "2:end"]);
  });

  it("E2: releases the lock when fn throws (next caller can proceed)", async () => {
    const id = "ins-B";
    await expect(
      withInspectionPushLock(id, async () => { throw new Error("boom"); }),
    ).rejects.toThrow("boom");

    let ran = false;
    await withInspectionPushLock(id, async () => { ran = true; });
    expect(ran).toBe(true);
  });

  it("E3: different inspection ids do NOT block each other", async () => {
    const events: string[] = [];

    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => { releaseA = r; });

    const pA = withInspectionPushLock("ins-X", async () => {
      events.push("A:start");
      await gateA;
      events.push("A:end");
    });
    const pB = withInspectionPushLock("ins-Y", async () => {
      events.push("B:start");
      events.push("B:end");
    });

    await pB; // B should complete without waiting on A
    expect(events).toEqual(["A:start", "B:start", "B:end"]);
    releaseA();
    await pA;
  });
});
