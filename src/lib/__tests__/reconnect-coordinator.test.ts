import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  runReconnect,
  registerReconnectRunners,
  onReconnectEvent,
  _resetReconnectCoordinatorForTests,
  isReconnectInFlight,
  setReconnectUserIdResolver,
} from "../reconnect-coordinator";

describe("reconnect-coordinator", () => {
  beforeEach(() => {
    _resetReconnectCoordinatorForTests();
    setReconnectUserIdResolver(() => "real-user-1");
  });

  it("collapses concurrent triggers into a single flight", async () => {
    const calls: string[] = [];
    const slow = () =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          calls.push("drain");
          resolve();
        }, 25),
      );
    registerReconnectRunners({ reportQueueDrain: slow });

    const p1 = runReconnect("online");
    const p2 = runReconnect("visibility");
    const p3 = runReconnect("focus");
    expect(isReconnectInFlight()).toBe(true);
    await Promise.all([p1, p2, p3]);
    expect(calls).toEqual(["drain"]);
  });

  it("runs stages in documented order", async () => {
    const order: string[] = [];
    registerReconnectRunners({
      authReconcile: () => { order.push("auth"); },
      reportQueueDrain: () => { order.push("report"); },
      photoQueueDrain: () => { order.push("photo"); },
      deletionQueueDrain: () => { order.push("deletion"); },
      refreshLocalState: () => { order.push("refresh"); },
      prewarm: () => { order.push("prewarm"); },
    });
    await runReconnect("manual");
    expect(order).toEqual([
      "auth", "report", "photo", "deletion", "refresh", "prewarm",
    ]);
  });

  it("stage failure does not block subsequent stages or future runs", async () => {
    const events: string[] = [];
    onReconnectEvent((e) => {
      if (e.type === "stage-failed" && e.stage) events.push("fail:" + e.stage);
      if (e.type === "stage-ok" && e.stage) events.push("ok:" + e.stage);
    });
    registerReconnectRunners({
      reportQueueDrain: () => { throw new Error("boom"); },
      refreshLocalState: () => { events.push("refreshed"); },
    });
    await runReconnect("manual");
    expect(events).toContain("fail:report-queue-drain");
    expect(events).toContain("refreshed");

    // Second run after failure must still execute.
    events.length = 0;
    registerReconnectRunners({
      reportQueueDrain: () => { events.push("retry-ok"); },
    });
    await runReconnect("manual");
    expect(events).toContain("retry-ok");
  });

  it("guest sessions skip transmit stages but still refresh local state", async () => {
    setReconnectUserIdResolver(() => "guest-abc");
    const order: string[] = [];
    registerReconnectRunners({
      authReconcile: () => { order.push("auth"); },
      reportQueueDrain: () => { order.push("report"); },
      refreshLocalState: () => { order.push("refresh"); },
      prewarm: () => { order.push("prewarm"); },
    });
    await runReconnect("manual");
    expect(order).toEqual(["refresh"]);
  });

  it("non-manual triggers within min-gap are no-ops; manual always runs", async () => {
    const calls: string[] = [];
    registerReconnectRunners({
      reportQueueDrain: () => { calls.push("x"); },
    });
    await runReconnect("manual");
    expect(calls.length).toBe(1);
    // Immediately again with a non-manual trigger — should be skipped.
    await runReconnect("online");
    expect(calls.length).toBe(1);
    // Manual bypasses the gap.
    await runReconnect("manual");
    expect(calls.length).toBe(2);
  });
});
