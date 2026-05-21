import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../reconnect-coordinator", () => {
  const calls: string[] = [];
  return {
    runReconnect: vi.fn((trigger: string) => {
      calls.push(trigger);
      return Promise.resolve();
    }),
    __getCalls: () => calls,
  };
});

import { runReconnect } from "../reconnect-coordinator";
import { initReconnectEvents, __test_only__resetReconnectEvents } from "../reconnect-events";

describe("reconnect-events", () => {
  beforeEach(() => {
    __test_only__resetReconnectEvents();
    (runReconnect as unknown as { mockClear: () => void }).mockClear();
    initReconnectEvents();
  });

  it("fires on online event", () => {
    window.dispatchEvent(new Event("online"));
    expect(runReconnect).toHaveBeenCalledWith("online");
  });

  it("fires on focus event", () => {
    window.dispatchEvent(new Event("focus"));
    expect(runReconnect).toHaveBeenCalledWith("focus");
  });

  it("fires on pageshow event", () => {
    window.dispatchEvent(new Event("pageshow"));
    expect(runReconnect).toHaveBeenCalledWith("pageshow");
  });

  it("fires on visibilitychange when visible", () => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(runReconnect).toHaveBeenCalledWith("visibility");
  });

  it("init is idempotent (no duplicate listeners)", () => {
    initReconnectEvents();
    initReconnectEvents();
    (runReconnect as unknown as { mockClear: () => void }).mockClear();
    window.dispatchEvent(new Event("online"));
    expect(runReconnect).toHaveBeenCalledTimes(1);
  });
});
